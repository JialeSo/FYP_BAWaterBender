import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from backend.etl.common.pipeline import Pipeline
from backend.etl.common.pipeline_stage import PipelineStage
from backend.etl.common.database_write_stage import DatabaseWriteStage
from backend.etl.amenities.processors.consolidate import consolidate_amenities
from backend.etl.amenities.processors.geocode import geocode_amenities
from backend.etl.amenities.processors.classify import classify_amenities
from backend.etl.amenities.processors.match_roads import match_roads

logger = logging.getLogger(__name__)


# ============================================================================
# PIPELINE STAGES
# ============================================================================

class FetchAndConsolidateStage(PipelineStage):
    """Fetch and consolidate all amenities data.

    This stage:
    1. Fetches amenities from OneMap API themes (if needed)
    2. Loads amenities from GeoJSON files
    3. Loads OSM OnEMap matched data
    4. Consolidates everything into a single standardized GeoJSON

    Input: None (fetches from files and APIs)
    Output: Consolidated GeoJSON dictionary
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the fetch and consolidate stage.

        Args:
            config: Configuration dictionary containing:
                - output_file: Path to save consolidated GeoJSON
        """
        super().__init__("Fetch and Consolidate Amenities", config)

        # All data goes to backend/etl/data
        etl_data_dir = Path(__file__).resolve().parents[1] / "data"

        self.output_file = Path(
            self.config.get(
                "output_file",
                etl_data_dir / "amenities_consolidated.geojson"
            )
        )

    async def process(self, data: Any) -> Dict[str, Any]:
        """Fetch and consolidate all amenities.

        Args:
            data: Ignored (stage fetches from files and APIs)

        Returns:
            Consolidated GeoJSON dictionary with 'type' and 'features' keys
        """
        logger.info("Fetching and consolidating amenities from all sources")

        # Use existing consolidation logic that:
        # - Loads GeoJSON files from backend/etl/data/geojson/
        # - Loads OSM OnEMap from backend/etl/data/amenities/osm_onemap_matched.json
        # - Fetches from OneMap API (if configured)
        consolidated_geojson = consolidate_amenities(output_file=self.output_file)

        feature_count = len(consolidated_geojson.get('features', []))
        logger.info(f"✓ Consolidated {feature_count:,} total amenities")

        return consolidated_geojson


class AmenitiesThreeLayersStage(PipelineStage):
    """Process amenities through geocoding, classification, and road matching.

    This stage performs the complete "3 layers" processing:
    1. Geocode to Planning Areas (PA) and Subzones (SZ)
    2. Classify amenities (categories, priorities, importance scores)
    3. Match to Road Network (RN)

    Input: Consolidated GeoJSON or amenities data
    Output: DataFrame with pa_id, sz_id, rn_id (amenities_3layers)
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the three layers stage.

        Args:
            config: Configuration dictionary containing:
                - input_geojson: Path to consolidated amenities GeoJSON
                - output_csv: Path to save final amenities_3layers.csv
                - planning_geojson: Path to planning areas GeoJSON
                - subzone_geojson: Path to subzones GeoJSON
                - road_network_geojson: Path to road network GeoJSON
                - postal_codes_csv: Path to postal codes CSV
        """
        super().__init__("Amenities Three Layers Processing", config)

        # All data in backend/etl/data
        etl_data_dir = Path(__file__).resolve().parents[1] / "data"

        # Input/output paths - all in backend/etl/data
        self.input_geojson = Path(
            self.config.get(
                "input_geojson",
                etl_data_dir / "amenities_consolidated.geojson"
            )
        )

        self.output_csv = Path(
            self.config.get(
                "output_csv",
                etl_data_dir / "amenities_3layers.csv"
            )
        )

        # Reference data paths - all in backend/etl/data
        self.planning_geojson = Path(
            self.config.get(
                "planning_geojson",
                etl_data_dir / "geojson" / "planning_area.geojson"
            )
        )

        self.subzone_geojson = Path(
            self.config.get(
                "subzone_geojson",
                etl_data_dir / "geojson" / "subzone_area.geojson"
            )
        )

        self.road_network_geojson = Path(
            self.config.get(
                "road_network_geojson",
                etl_data_dir / "roadnetwork" / "road_network_final.geojson"
            )
        )

        self.postal_codes_csv = Path(
            self.config.get(
                "postal_codes_csv",
                etl_data_dir / "onemap" / "onemap_postal_codes.csv"
            )
        )

    def validate_config(self) -> bool:
        """Validate configuration parameters.

        Returns:
            True if configuration is valid

        Raises:
            ValueError: If configuration is invalid
        """
        # Check required files exist
        required_files = [
            self.input_geojson,
            self.planning_geojson,
            self.subzone_geojson,
            self.road_network_geojson,
            self.postal_codes_csv,
        ]

        missing = [str(f) for f in required_files if not f.exists()]
        if missing:
            raise ValueError(f"Required files not found: {', '.join(missing)}")

        return True

    async def process(self, data: Any) -> pd.DataFrame:
        """Process amenities through 3 layers (geocoding, classification, road matching).

        Args:
            data: Consolidated amenities GeoJSON or DataFrame (can be None if using files)

        Returns:
            DataFrame with pa_id, sz_id, rn_id columns (amenities_3layers)
        """
        logger.info("Starting 3 layers processing for amenities")

        # Use temp files for intermediate steps (cleaned up automatically)
        with tempfile.NamedTemporaryFile(suffix='.csv', delete=True) as temp_geocoded, \
             tempfile.NamedTemporaryFile(suffix='.csv', delete=True) as temp_classified:

            # Step 1: Geocoding (PA/SZ matching)
            logger.info("Step 1/3: Geocoding amenities (PA/SZ matching)")
            geocode_amenities(
                input_geojson=self.input_geojson,
                output_csv=Path(temp_geocoded.name),
                planning_geojson=self.planning_geojson,
                subzone_geojson=self.subzone_geojson,
                road_network_geojson=self.road_network_geojson,
                postal_codes_csv=self.postal_codes_csv,
            )

            # Step 2: Classification
            logger.info("Step 2/3: Classifying amenities (categories, priorities)")
            classify_amenities(
                input_csv=Path(temp_geocoded.name),
                output_csv=Path(temp_classified.name),
            )

            # Step 3: Road matching (writes final output)
            logger.info("Step 3/3: Matching amenities to roads (RN matching)")
            match_roads(
                amenities_csv=Path(temp_classified.name),
                road_network_geojson=self.road_network_geojson,
                output_csv=self.output_csv,
            )

        # Load and return the final result
        logger.info(f"Loading final result from {self.output_csv}")
        df = pd.read_csv(self.output_csv)

        logger.info(f"✓ Amenities 3 layers processing complete: {len(df):,} amenities")

        return df


# ============================================================================
# AMENITIES PIPELINE
# ============================================================================


class AmenitiesPipeline(Pipeline):
    """Complete pipeline for processing amenities data.

    This pipeline processes amenities through these stages:
    1. Fetch and Consolidate - Load from OneMap API, GeoJSON files, OSM data
    2. Three Layers Processing - Geocode to PA/SZ, classify, match to roads
    3. Database Write - Upload to Supabase

    The pipeline handles the complete flow from data sources to database.
    """

    def __init__(
        self,
        config: Optional[Dict[str, Any]] = None,
        db_table: str = "amenities",
    ):
        """Initialize the amenities pipeline.

        Args:
            config: Configuration dictionary containing:
                - fetch_consolidate: Config for fetch/consolidate stage
                - three_layers: Config for three layers stage
                - database_write: Config for database write stage
                - continue_on_error: Whether to continue on stage errors
            db_table: Name of the database table to write to
        """
        self.config = config or {}
        self.db_table = db_table

        # Stop pipeline on stage errors by default for reliable operation
        if "continue_on_error" not in self.config:
            self.config["continue_on_error"] = False

        # Initialize pipeline stages
        stages = self._create_stages()

        # Initialize parent Pipeline class
        super().__init__(
            name="Amenities Pipeline", stages=stages, config=self.config
        )

    def _create_stages(self) -> List[Any]:
        """Create and configure all pipeline stages.

        Returns:
            List of configured pipeline stages
        """
        stages = []

        # Stage 1: Fetch and Consolidate
        fetch_config = self.config.get("fetch_consolidate", {})
        fetch_stage = FetchAndConsolidateStage(config=fetch_config)
        stages.append(fetch_stage)

        # Stage 2: Three Layers Processing
        three_layers_config = self.config.get("three_layers", {})
        three_layers_stage = AmenitiesThreeLayersStage(config=three_layers_config)
        stages.append(three_layers_stage)

        # Stage 3: Database Write
        db_config = self.config.get("database_write", {})
        db_stage = DatabaseWriteStage(
            table_name=self.db_table, config=db_config
        )
        stages.append(db_stage)

        return stages

    async def process_amenities(self) -> Any:
        """Process amenities through the complete pipeline.

        Returns:
            Final processed data from the pipeline

        Raises:
            Exception: If any pipeline stage fails
        """
        logger.info("Starting amenities pipeline processing")

        try:
            # Run the complete pipeline (no input needed, starts with data fetch)
            result = await self.run(initial_data=None)

            logger.info("Successfully processed amenities")
            return result

        except Exception as e:
            logger.error(f"Amenities pipeline failed: {e}")
            raise


def build_amenities_pipeline(
    table_name: str = "amenities",
    config: Optional[Dict[str, Any]] = None,
) -> AmenitiesPipeline:
    """Build and return an amenities pipeline.

    Args:
        table_name: Database table name
        config: Optional pipeline configuration

    Returns:
        Configured AmenitiesPipeline instance
    """
    return AmenitiesPipeline(config=config, db_table=table_name)


async def run_amenities_pipeline(
    table_name: str = "amenities",
    config: Optional[Dict[str, Any]] = None,
) -> None:
    """Run the amenities pipeline once.

    Args:
        table_name: Database table name
        config: Optional pipeline configuration
    """
    pipeline = build_amenities_pipeline(table_name=table_name, config=config)
    await pipeline.process_amenities()


if __name__ == "__main__":
    # Simple entrypoint: run once
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    asyncio.run(run_amenities_pipeline())
