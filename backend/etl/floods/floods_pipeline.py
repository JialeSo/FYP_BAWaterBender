import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from backend.etl.common.pipeline import Pipeline
from backend.etl.common.pipeline_stage import PipelineStage
from backend.etl.common.database_write_stage import DatabaseWriteStage
from backend.etl.floods.scripts.process_floods_3layers import process_floods_data

logger = logging.getLogger(__name__)


# ============================================================================
# PIPELINE STAGES
# ============================================================================

class LoadFloodsStage(PipelineStage):
    """Load floods data from CSV file.

    This stage loads the floods CSV file which contains flood event records
    with location information (lat/lng coordinates).

    Input: None (loads from file)
    Output: DataFrame with floods data
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the load floods stage.

        Args:
            config: Configuration dictionary containing:
                - floods_csv: Path to floods CSV file
        """
        super().__init__("Load Floods Data", config)

        # All data in backend/etl/data
        etl_data_dir = Path(__file__).resolve().parents[1] / "data"

        self.floods_csv = Path(
            self.config.get(
                "floods_csv",
                etl_data_dir / "floods" / "floods_fixed.csv"
            )
        )

    def validate_config(self) -> bool:
        """Validate configuration parameters.

        Returns:
            True if configuration is valid

        Raises:
            ValueError: If configuration is invalid
        """
        if not self.floods_csv.exists():
            raise ValueError(f"Floods CSV not found: {self.floods_csv}")

        return True

    async def process(self, data: Any) -> pd.DataFrame:
        """Load floods data from CSV.

        Args:
            data: Ignored (stage loads from file)

        Returns:
            DataFrame with floods data
        """
        logger.info(f"Loading floods data from {self.floods_csv}")

        df = pd.read_csv(self.floods_csv)

        logger.info(f"✓ Loaded {len(df):,} flood events")

        # Check for required columns
        required_cols = ['id', 'start_lat', 'start_lng']
        missing_cols = [col for col in required_cols if col not in df.columns]

        if missing_cols:
            raise ValueError(f"Required columns missing: {', '.join(missing_cols)}")

        return df


class ProcessFloodsThreeLayersStage(PipelineStage):
    """Process floods data through 3 layers matching (PA/SZ/RN).

    This stage wraps the existing process_floods_3layers logic which:
    1. Matches flood locations to Planning Areas (pa_id)
    2. Matches flood locations to Subzones (sz_id)
    3. Matches flood locations to Road Network (rn_id)

    Input: Floods DataFrame with lat/lng coordinates
    Output: DataFrame with start_pa_id, start_sz_id, start_rn_id, end_pa_id, end_sz_id, end_rn_id
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the floods three layers stage.

        Args:
            config: Configuration dictionary containing:
                - output_csv: Path to save floods_3layers.csv
                - planning_geojson: Path to planning areas GeoJSON
                - subzone_geojson: Path to subzones GeoJSON
                - road_network_geojson: Path to road network GeoJSON
        """
        super().__init__("Floods Three Layers Processing", config)

        # All data in backend/etl/data
        etl_data_dir = Path(__file__).resolve().parents[1] / "data"

        self.output_csv = Path(
            self.config.get(
                "output_csv",
                etl_data_dir / "floods_3layers.csv"
            )
        )

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

    def validate_config(self) -> bool:
        """Validate configuration parameters.

        Returns:
            True if configuration is valid

        Raises:
            ValueError: If configuration is invalid
        """
        required_files = [
            self.planning_geojson,
            self.subzone_geojson,
            self.road_network_geojson,
        ]

        missing = [str(f) for f in required_files if not f.exists()]
        if missing:
            raise ValueError(f"Required files not found: {', '.join(missing)}")

        return True

    async def process(self, data: pd.DataFrame) -> pd.DataFrame:
        """Process floods through 3 layers matching.

        Args:
            data: Floods DataFrame with lat/lng coordinates

        Returns:
            DataFrame with pa_id, sz_id, rn_id columns
        """
        logger.info("Starting 3 layers processing for floods")

        # Save input data to temp file (required by existing function)
        with tempfile.NamedTemporaryFile(suffix='.csv', delete=False, mode='w') as temp_input:
            temp_input_path = Path(temp_input.name)
            data.to_csv(temp_input_path, index=False)

        try:
            # Use existing process_floods_3layers function
            result_df = process_floods_data(
                floods_csv=temp_input_path,
                planning_geojson=self.planning_geojson,
                subzone_geojson=self.subzone_geojson,
                road_network_geojson=self.road_network_geojson,
                output_csv=self.output_csv,
            )

            logger.info(f"✓ Floods 3 layers processing complete: {len(result_df):,} events")

            return result_df

        finally:
            # Clean up temp file
            if temp_input_path.exists():
                temp_input_path.unlink()


# ============================================================================
# FLOODS PIPELINE
# ============================================================================


class FloodsPipeline(Pipeline):
    """Complete pipeline for processing floods data.

    This pipeline processes floods data through these stages:
    1. Load Floods - Load from floods.csv
    2. Three Layers Processing - Match to PA/SZ/RN
    3. Database Write - Upload to Supabase

    The pipeline handles the complete flow from CSV file to database.
    """

    def __init__(
        self,
        config: Optional[Dict[str, Any]] = None,
        db_table: str = "floods",
    ):
        """Initialize the floods pipeline.

        Args:
            config: Configuration dictionary containing:
                - load_floods: Config for load floods stage
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
            name="Floods Pipeline", stages=stages, config=self.config
        )

    def _create_stages(self) -> List[Any]:
        """Create and configure all pipeline stages.

        Returns:
            List of configured pipeline stages
        """
        stages = []

        # Stage 1: Load Floods
        load_config = self.config.get("load_floods", {})
        load_stage = LoadFloodsStage(config=load_config)
        stages.append(load_stage)

        # Stage 2: Three Layers Processing
        three_layers_config = self.config.get("three_layers", {})
        three_layers_stage = ProcessFloodsThreeLayersStage(config=three_layers_config)
        stages.append(three_layers_stage)

        # Stage 3: Database Write
        db_config = self.config.get("database_write", {})
        db_stage = DatabaseWriteStage(
            table_name=self.db_table, config=db_config
        )
        stages.append(db_stage)

        return stages

    async def process_floods(self) -> Any:
        """Process floods through the complete pipeline.

        Returns:
            Final processed data from the pipeline

        Raises:
            Exception: If any pipeline stage fails
        """
        logger.info("Starting floods pipeline processing")

        try:
            # Run the complete pipeline (no input needed, starts with data load)
            result = await self.run(initial_data=None)

            logger.info("Successfully processed floods")
            return result

        except Exception as e:
            logger.error(f"Floods pipeline failed: {e}")
            raise


def build_floods_pipeline(
    table_name: str = "floods",
    config: Optional[Dict[str, Any]] = None,
) -> FloodsPipeline:
    """Build and return a floods pipeline.

    Args:
        table_name: Database table name
        config: Optional pipeline configuration

    Returns:
        Configured FloodsPipeline instance
    """
    return FloodsPipeline(config=config, db_table=table_name)


async def run_floods_pipeline(
    table_name: str = "floods",
    config: Optional[Dict[str, Any]] = None,
) -> None:
    """Run the floods pipeline once.

    Args:
        table_name: Database table name
        config: Optional pipeline configuration
    """
    pipeline = build_floods_pipeline(table_name=table_name, config=config)
    await pipeline.process_floods()


if __name__ == "__main__":
    # Simple entrypoint: run once
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    asyncio.run(run_floods_pipeline())
