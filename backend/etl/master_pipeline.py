"""
Master ETL Pipeline Orchestrator

This module provides a consolidated pipeline that orchestrates all ETL processes
in the correct dependency order:

1. Fetch Planning Areas & Subzones (PA/SZ) from OneMap
2. ACRA Companies Pipeline
3. Amenities Pipeline
4. Floods Pipeline

The PA/SZ geojson files must be generated first as they are required by all
subsequent pipelines for spatial geocoding.

Usage:

    # activate your venv
    source .venv/bin/activate      # macOS/Linux
    # .\.venv\Scripts\Activate.ps1 # Windows PowerShell

    # add backend/ to PYTHONPATH so `common` is importable
    export PYTHONPATH="$PWD/backend:$PYTHONPATH"

    ## OPTIONS: 

    # Run complete master pipeline (normal mode)
    python -m backend.etl.master_pipeline

    # Run in dry-run mode (no Supabase writes, just to test the pipeline is working)
    ETL_DRY_RUN=1 python -m backend.etl.master_pipeline

    # Or import and use programmatically
    from backend.etl.master_pipeline import run_master_pipeline
    await run_master_pipeline()
"""

import asyncio
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.etl.common.pipeline import Pipeline
from backend.etl.common.pipeline_stage import PipelineStage

logger = logging.getLogger(__name__)


# ============================================================================
# PIPELINE STAGES
# ============================================================================


class FetchPlanningAreasSubzonesStage(PipelineStage):
    """Fetch and process Planning Areas and Subzones from OneMap API.

    This stage wraps the fetch_pa_sz_onemap.py script which:
    1. Fetches PA/SZ data from data.gov.sg APIs
    2. Processes and cleans the GeoJSON data
    3. Computes area and population density
    4. Saves to both backend/etl/data/roadnetwork/ and frontend/public/map/

    This must run first as all other pipelines depend on these files for
    spatial geocoding.

    Input: None (fetches from API)
    Output: Dict with paths to generated files
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__("Fetch Planning Areas & Subzones", config)
        self.scripts_dir = Path(__file__).resolve().parent / "onemap" / "scripts"
        self.script_path = self.scripts_dir / "fetch_pa_sz_onemap.py"

    def validate_config(self) -> bool:
        """Validate that the fetch script exists."""
        if not self.script_path.exists():
            raise ValueError(f"Fetch script not found: {self.script_path}")
        return True

    async def process(self, data: Any) -> Dict[str, Any]:
        """Execute the PA/SZ fetch script."""
        logger.info("Fetching Planning Areas and Subzones from OneMap...")

        try:
            # Add scripts directory to sys.path so onemap_utils can be imported
            scripts_dir = str(self.scripts_dir)
            if scripts_dir not in sys.path:
                sys.path.insert(0, scripts_dir)

            # Import and run the main function from the script
            import importlib.util
            spec = importlib.util.spec_from_file_location(
                "fetch_pa_sz_onemap", self.script_path
            )
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            # Execute the main function
            exit_code = module.main()

            if exit_code != 0:
                raise RuntimeError(
                    f"PA/SZ fetch script failed with exit code {exit_code}"
                )

            logger.info("Successfully fetched and processed PA/SZ data")

            # Return paths to the generated files
            root = self.script_path.parents[4]
            return {
                "backend_pa": str(root / "backend" / "etl" / "data" / "roadnetwork" / "planning_area.geojson"),
                "backend_sz": str(root / "backend" / "etl" / "data" / "roadnetwork" / "subzone_area.geojson"),
                "frontend_pa": str(root / "frontend" / "public" / "map" / "planning_area.geojson"),
                "frontend_sz": str(root / "frontend" / "public" / "map" / "subzone_area.geojson"),
            }

        except Exception as e:
            logger.error(f"Failed to fetch PA/SZ data: {e}")
            raise


class ACRAPipelineStage(PipelineStage):
    """Execute the ACRA companies pipeline.

    This stage wraps the complete ACRA pipeline which:
    1. Fetches ACRA business data from data.gov.sg
    2. Filters by business status
    3. Geocodes by postal code using OneMap
    4. Uploads to Supabase

    Input: Dict with PA/SZ paths (for reference, though ACRA uses postal codes)
    Output: Result from ACRA pipeline
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__("ACRA Companies Pipeline", config)
        self.table_name = self.config.get("table_name", "acra_companies")
        self.skip_fetch = self.config.get("skip_fetch", False)
        self.csv_path = self.config.get("csv_path")

    async def process(self, data: Any) -> Any:
        """Execute the ACRA pipeline."""
        logger.info("Starting ACRA companies pipeline...")

        try:
            from backend.etl.acra.pipeline import build_acra_pipeline

            pipeline = build_acra_pipeline(
                table_name=self.table_name,
                skip_fetch=self.skip_fetch,
                csv_path=self.csv_path,
            )

            result = await pipeline.run(initial_data=None)

            logger.info("ACRA pipeline completed successfully")
            return result

        except Exception as e:
            logger.error(f"ACRA pipeline failed: {e}")
            raise


class AmenitiesPipelineStage(PipelineStage):
    """Execute the amenities pipeline.

    This stage wraps the complete amenities pipeline which:
    1. Fetches and consolidates amenities from multiple sources
    2. Geocodes to Planning Areas and Subzones
    3. Classifies amenities by category and priority
    4. Matches to Road Network
    5. Uploads to Supabase

    Input: Dict with PA/SZ paths (used for geocoding)
    Output: Result from amenities pipeline
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__("Amenities Pipeline", config)
        self.table_name = self.config.get("table_name", "amenity_3layers")
        self.pipeline_config = self.config.get("pipeline_config", {})

    async def process(self, data: Any) -> Any:
        """Execute the amenities pipeline."""
        logger.info("Starting amenities pipeline...")

        try:
            from backend.etl.amenities.amenities_pipeline import build_amenities_pipeline

            pipeline = build_amenities_pipeline(
                table_name=self.table_name,
                config=self.pipeline_config,
            )

            result = await pipeline.process_amenities()

            logger.info("Amenities pipeline completed successfully")
            return result

        except Exception as e:
            logger.error(f"Amenities pipeline failed: {e}")
            raise


class FloodsPipelineStage(PipelineStage):
    """Execute the floods pipeline.

    This stage wraps the complete floods pipeline which:
    1. Loads floods data from CSV
    2. Matches to Planning Areas, Subzones, and Road Network
    3. Filters island PAs and subsided events
    4. Uploads to Supabase

    Input: Dict with PA/SZ paths (used for geocoding)
    Output: Result from floods pipeline
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__("Floods Pipeline", config)
        self.table_name = self.config.get("table_name", "flood_3layers")
        self.pipeline_config = self.config.get("pipeline_config", {})

    async def process(self, data: Any) -> Any:
        """Execute the floods pipeline."""
        logger.info("Starting floods pipeline...")

        try:
            from backend.etl.floods.floods_pipeline import build_floods_pipeline

            pipeline = build_floods_pipeline(
                table_name=self.table_name,
                config=self.pipeline_config,
            )

            result = await pipeline.process_floods()

            logger.info("Floods pipeline completed successfully")
            return result

        except Exception as e:
            logger.error(f"Floods pipeline failed: {e}")
            raise


# ============================================================================
# MASTER PIPELINE
# ============================================================================


class MasterPipeline(Pipeline):
    """Master pipeline that orchestrates all ETL processes in dependency order.

    Pipeline stages:
    1. Fetch Planning Areas & Subzones (required for all subsequent pipelines)
    2. ACRA Companies Pipeline
    3. Amenities Pipeline
    4. Floods Pipeline

    Each pipeline is executed sequentially to ensure dependencies are satisfied.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the master pipeline.

        Args:
            config: Configuration dictionary containing:
                - continue_on_error: Whether to continue if a pipeline fails (default: False)
                - acra: Config for ACRA pipeline
                - amenities: Config for amenities pipeline
                - floods: Config for floods pipeline
        """
        self.config = config or {}

        # Stop on errors by default for data integrity
        if "continue_on_error" not in self.config:
            self.config["continue_on_error"] = False

        # Initialize pipeline stages
        stages = self._create_stages()

        # Initialize parent Pipeline class
        super().__init__(
            name="Master ETL Pipeline",
            stages=stages,
            config=self.config
        )

    def _create_stages(self) -> List[PipelineStage]:
        """Create and configure all pipeline stages.

        Returns:
            List of configured pipeline stages in execution order
        """
        stages = []

        # Stage 1: Fetch PA/SZ (REQUIRED - all other pipelines depend on this)
        pa_sz_stage = FetchPlanningAreasSubzonesStage()
        stages.append(pa_sz_stage)

        # Stage 2: ACRA Companies Pipeline
        acra_config = self.config.get("acra", {})
        acra_stage = ACRAPipelineStage(config=acra_config)
        stages.append(acra_stage)

        # Stage 3: Amenities Pipeline
        amenities_config = self.config.get("amenities", {})
        amenities_stage = AmenitiesPipelineStage(config=amenities_config)
        stages.append(amenities_stage)

        # Stage 4: Floods Pipeline
        floods_config = self.config.get("floods", {})
        floods_stage = FloodsPipelineStage(config=floods_config)
        stages.append(floods_stage)

        return stages

    async def run_all(self) -> Any:
        """Execute the complete master pipeline.

        Returns:
            Final result from the last pipeline stage

        Raises:
            Exception: If any pipeline fails and continue_on_error is False
        """
        logger.info("=" * 80)
        logger.info("Starting Master ETL Pipeline")
        logger.info("This will run all ETL processes in dependency order:")
        logger.info("  1. Fetch Planning Areas & Subzones (OneMap)")
        logger.info("  2. ACRA Companies Pipeline")
        logger.info("  3. Amenities Pipeline")
        logger.info("  4. Floods Pipeline")
        logger.info("=" * 80)

        try:
            # Run the complete pipeline (no input needed)
            result = await self.run(initial_data=None)

            logger.info("=" * 80)
            logger.info("Master ETL Pipeline completed successfully!")
            logger.info("All data has been processed and uploaded to Supabase")
            logger.info("=" * 80)

            return result

        except Exception as e:
            logger.error("=" * 80)
            logger.error(f"Master ETL Pipeline failed: {e}")
            logger.error("=" * 80)
            raise


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================


def build_master_pipeline(config: Optional[Dict[str, Any]] = None) -> MasterPipeline:
    """Build and return a master pipeline instance.

    Args:
        config: Optional pipeline configuration

    Returns:
        Configured MasterPipeline instance
    """
    return MasterPipeline(config=config)


async def run_master_pipeline(config: Optional[Dict[str, Any]] = None) -> None:
    """Run the complete master ETL pipeline.

    This is a convenience function that builds and executes the master pipeline.

    Args:
        config: Optional pipeline configuration

    Example:
        # Run with default configuration
        await run_master_pipeline()

        # Run with custom configuration
        config = {
            "continue_on_error": False,
            "acra": {
                "table_name": "acra_companies",
                "skip_fetch": False
            },
            "amenities": {
                "table_name": "amenities"
            },
            "floods": {
                "table_name": "floods"
            }
        }
        await run_master_pipeline(config)
    """
    pipeline = build_master_pipeline(config=config)
    await pipeline.run_all()


# ============================================================================
# CLI ENTRYPOINT
# ============================================================================


async def main() -> int:
    """Main entrypoint for CLI execution.

    Returns:
        Exit code (0 for success, 1 for failure)
    """
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    try:
        await run_master_pipeline()
        return 0

    except KeyboardInterrupt:
        logger.info("\nPipeline interrupted by user")
        return 1

    except Exception as e:
        logger.error(f"Pipeline failed: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
