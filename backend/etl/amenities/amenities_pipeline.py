import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from backend.etl.common.pipeline import Pipeline
from backend.etl.common.pipeline_stage import PipelineStage
from backend.etl.common.database_write_stage import DatabaseWriteStage
from backend.etl.amenities.consolidate import consolidate_amenities
from backend.etl.amenities.geocode import geocode_amenities
from backend.etl.amenities.classify import classify_amenities
from backend.etl.amenities.match_roads import match_roads

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
        self.persist_consolidated: bool = bool(self.config.get("persist_consolidated", False))

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
        consolidated_geojson = consolidate_amenities(
            output_file=self.output_file,
            save=self.persist_consolidated,
        )

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

        # Reference data paths - prefer backend/etl/data, fallback to frontend/public/map if missing
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

        # Fallbacks from frontend if backend references are missing
        try:
            frontend_map_dir = Path(__file__).resolve().parents[3] / "frontend" / "public" / "map"
            if not self.planning_geojson.exists():
                fb = frontend_map_dir / "planning_area.geojson"
                if fb.exists():
                    self.planning_geojson = fb
            if not self.subzone_geojson.exists():
                fb = frontend_map_dir / "subzone_area.geojson"
                if fb.exists():
                    self.subzone_geojson = fb
        except Exception:
            pass
        # Allow skipping classification and road matching to output raw only
        try:
            import os as _os
            self.raw_only: bool = bool(self.config.get("raw_only", False)) or (
                _os.getenv("AMENITIES_RAW_ONLY", "0").lower() in {"1", "true", "yes"}
            )
        except Exception:
            self.raw_only = bool(self.config.get("raw_only", False))

    def validate_config(self) -> bool:
        """Lightweight validation.

        Do not hard-require intermediate/reference files; processing will
        gracefully skip steps when inputs are missing.
        """
        # Warn instead of failing hard – geocode step will skip joins if refs are missing
        to_check = [
            ("input_geojson", self.input_geojson),
            ("planning_geojson", self.planning_geojson),
            ("subzone_geojson", self.subzone_geojson),
            ("road_network_geojson", self.road_network_geojson),
            ("postal_codes_csv", self.postal_codes_csv),
        ]
        missing = [name for name, p in to_check if not p.exists()]
        if missing:
            logger.warning(
                "Amenities Three Layers: missing inputs will be skipped: %s",
                ", ".join(missing),
            )
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
        # If upstream provided consolidated GeoJSON in-memory, persist to a temp file first
        temp_input_path: Optional[Path] = None
        if isinstance(data, dict) and data.get('type') == 'FeatureCollection':
            tf = tempfile.NamedTemporaryFile(suffix='.geojson', delete=False)
            temp_input_path = Path(tf.name)
            tf.close()
            import json
            with open(temp_input_path, 'w', encoding='utf-8') as f:
                json.dump(data, f)
            logger.info(f"Wrote consolidated amenities to temp file: {temp_input_path}")

        input_geojson_path = temp_input_path if temp_input_path else self.input_geojson

        with tempfile.NamedTemporaryFile(suffix='.csv', delete=True) as temp_geocoded, \
             tempfile.NamedTemporaryFile(suffix='.csv', delete=True) as temp_classified:

            # Persistent data directory for outputs/lookups
            data_dir = Path(__file__).resolve().parents[1] / "data"
            data_dir.mkdir(parents=True, exist_ok=True)
            amenities_dir = data_dir / "amenities"
            amenities_dir.mkdir(parents=True, exist_ok=True)

            # Step 1: Geocoding (PA/SZ matching)
            logger.info("Step 1/3: Geocoding amenities (PA/SZ matching)")
            geocode_amenities(
                input_geojson=input_geojson_path,
                output_csv=Path(temp_geocoded.name),
                planning_geojson=self.planning_geojson,
                subzone_geojson=self.subzone_geojson,
                road_network_geojson=self.road_network_geojson,
                postal_codes_csv=self.postal_codes_csv,
            )

            # Do not persist pre-classification CSV; proceed directly to classification

            # If configured to output raw only, return immediately after saving raw file
            if self.raw_only:
                # Load and return raw geocoded as DataFrame
                logger.info("Raw-only mode enabled; skipping classification and road matching")
                raw_df = pd.read_csv(raw_out)
                return raw_df

            # Step 2: Classification
            logger.info("Step 2/3: Classifying amenities (categories, priorities)")
            classify_amenities(
                input_csv=Path(temp_geocoded.name),
                output_csv=Path(temp_classified.name),
                output_dir=amenities_dir,
            )

            # Persist a copy of the classified output as amenities/amenities_raw.csv
            try:
                classified_out = amenities_dir / "amenities_raw.csv"
                Path(temp_classified.name).replace(classified_out)
                logger.info(f"Saved classified amenities → {classified_out}")
                # Recreate temp file for downstream road matching
                with open(classified_out, "rb") as src, open(temp_classified.name, "wb") as dst:
                    dst.write(src.read())
            except Exception as e:
                logger.warning(f"Failed to persist amenities_raw.csv (post-classification): {e}")

            # Step 3: Road matching (writes final output)
            logger.info("Step 3/3: Matching amenities to roads (RN matching)")
            # Use the persisted classified CSV for road matching to avoid temp filenames in logs
            match_roads(
                amenities_csv=classified_out,
                road_network_geojson=self.road_network_geojson,
                output_csv=self.output_csv,
            )

        # Load and return the final result
        logger.info(f"Loading final result from {self.output_csv}")
        df = pd.read_csv(self.output_csv)

        logger.info(f"✓ Amenities 3 layers processing complete: {len(df):,} amenities")

        # Cleanup temp input file if created
        if temp_input_path and temp_input_path.exists():
            try:
                temp_input_path.unlink()
            except Exception:
                pass

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
        # Default to upsert on primary key 'id' to avoid duplicate key errors
        db_config.setdefault("on_conflict", "id")
        # Backward-compat: drop new grouping columns if target table hasn't been migrated yet
        drop_cols_default = ["amenity_group_id", "amenity_group"]
        existing_drop = db_config.get("drop_columns")
        if existing_drop is None:
            db_config["drop_columns"] = drop_cols_default
        elif isinstance(existing_drop, (list, tuple, set)):
            # Merge without duplicates
            db_config["drop_columns"] = list({*existing_drop, *drop_cols_default})

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
