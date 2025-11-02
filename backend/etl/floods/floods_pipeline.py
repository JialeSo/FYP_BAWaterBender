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
from backend.common.db import DatabaseConnection

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

        # Default to the combined PUB + historical source-of-truth CSV
        # Historical floods occupy ID 1-213 in this file
        self.floods_csv = Path(
            self.config.get(
                "floods_csv",
                etl_data_dir / "floods" / "PUB_and_huiying_flood.csv"
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

        # Persist final CSV alongside other flood data for consistency
        self.output_csv = Path(
            self.config.get(
                "output_csv",
                etl_data_dir / "floods" / "floods_3layers.csv"
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
        # Allow frontend fallbacks for planning/subzone like the amenities pipeline
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

        required_files = [self.planning_geojson, self.subzone_geojson, self.road_network_geojson]
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


class SanitizeFloodsForDBStage(PipelineStage):
    """Floods-specific sanitization and schema mapping prior to DB write.

    - Drops unsupported columns and keeps only DB schema fields
    - Coerces IDs to int and float fields to finite numbers
    - Replaces NaN/inf with None for JSON safety
    - Builds GeoJSON geom from origin or start coordinates when missing

    Input: pandas DataFrame from previous stage
    Output: List[Dict] ready for insertion to flood_3layers
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__("Sanitize Floods For DB", config)

        self.allowed_cols = {
            "id",
            "text",
            "event_date",
            "location",
            "event",
            "start_loc",
            "end_loc",
            "parent_road",
            "cleaned_location",
            "start_planning_area",
            "end_planning_area",
            "start_subzone",
            "end_subzone",
            "start_street_name",
            "end_street_name",
            "start_lat",
            "start_lng",
            "start_postal_code",
            "start_pa_id",
            "start_sz_id",
            "start_rn_id",
            "origin_lat",
            "origin_lng",
            "end100_a_lat",
            "end100_a_lng",
            "end100_b_lat",
            "end100_b_lng",
            "end_lat",
            "end_lng",
            "end_postal_code",
            "end_pa_id",
            "end_sz_id",
            "end_rn_id",
            "geom",
        }

    def _json_safe(self, v: Any) -> Any:
        try:
            import math as _math
            if v is None:
                return None
            if isinstance(v, float) and (_math.isnan(v) or _math.isinf(v)):
                return None
            return v
        except Exception:
            return v

    async def process(self, data: Any) -> Any:
        import pandas as pd  # local import to keep module light

        if data is None:
            return []
        if not hasattr(data, "to_dict"):
            return data

        df: pd.DataFrame = data.copy()

        # Convert to records then sanitize each record
        records = df.to_dict(orient="records")
        out = []
        for rec in records:
            r = dict(rec)
            # Remove noisy columns
            r.pop("created_at", None)

            # Normalize event_date to ISO YYYY-MM-DD for Postgres DATE
            if "event_date" in r and r["event_date"] not in (None, ""):
                try:
                    import pandas as _pd
                    # Try parsing with dayfirst to handle formats like 20/3/2014
                    dt = _pd.to_datetime(str(r["event_date"]).strip(), dayfirst=True, errors="coerce")
                    if _pd.notna(dt):
                        r["event_date"] = dt.date().isoformat()
                    else:
                        # As fallback, try without dayfirst
                        dt2 = _pd.to_datetime(str(r["event_date"]).strip(), dayfirst=False, errors="coerce")
                        r["event_date"] = dt2.date().isoformat() if _pd.notna(dt2) else None
                except Exception:
                    r["event_date"] = None

            # Build geom if missing
            if r.get("geom") in (None, "", {}):
                lat = None
                lon = None
                try:
                    if r.get("origin_lat") is not None and r.get("origin_lng") is not None:
                        lat = float(r.get("origin_lat"))
                        lon = float(r.get("origin_lng"))
                    elif r.get("start_lat") is not None and r.get("start_lng") is not None:
                        lat = float(r.get("start_lat"))
                        lon = float(r.get("start_lng"))
                except Exception:
                    lat = lon = None
                if lat is not None and lon is not None:
                    r["geom"] = {"type": "Point", "coordinates": [lon, lat]}

            # Coerce integer ID fields
            for icol in ("id", "start_pa_id", "start_sz_id", "start_rn_id", "end_pa_id", "end_sz_id", "end_rn_id"):
                if icol in r and r[icol] is not None:
                    try:
                        r[icol] = int(r[icol])
                    except Exception:
                        r[icol] = None

            # Coerce float fields and JSON-safe values
            for fcol in (
                "start_lat", "start_lng", "origin_lat", "origin_lng",
                "end_lat", "end_lng", "end100_a_lat", "end100_a_lng", "end100_b_lat", "end100_b_lng",
            ):
                if fcol in r and r[fcol] is not None:
                    try:
                        rf = float(r[fcol])
                        if pd.isna(rf) or pd.isnull(rf):
                            r[fcol] = None
                        else:
                            r[fcol] = rf
                    except Exception:
                        r[fcol] = None

            # Keep only allowed columns and sanitize values
            r2 = {k: self._json_safe(v) for k, v in r.items() if k in self.allowed_cols}
            out.append(r2)

        return out


class FilterIslandPAStage(PipelineStage):
    """Filter out floods in island planning areas (PA IDs: 24, 27, 31)."""

    def __init__(self, excluded_pa_ids: Optional[List[int]] = None):
        super().__init__("Filter Island PA Floods")
        self.excluded = set(excluded_pa_ids or [24, 27, 31])

    async def process(self, data: Any) -> Any:
        if not data:
            return data

        try:
            import pandas as _pd
            if hasattr(data, "to_dict") and isinstance(data, _pd.DataFrame):
                records = data.to_dict(orient="records")
            else:
                records = data
        except Exception:
            records = data

        if not isinstance(records, list):
            records = [records]

        before = len(records)
        def _is_excluded(rec: Dict[str, Any]) -> bool:
            try:
                spa = int(rec.get("start_pa_id") or 0)
            except Exception:
                spa = 0
            try:
                epa = int(rec.get("end_pa_id") or 0)
            except Exception:
                epa = 0
            return (spa in self.excluded) or (epa in self.excluded)

        filtered = [r for r in records if not _is_excluded(r)]
        after = len(filtered)
        logger.info(f"Filtered island PAs {sorted(self.excluded)}: removed {before-after} of {before} rows")
        return filtered


class FilterSubsidedStage(PipelineStage):
    """Exclude 'flood_subsided' events from upload."""

    def __init__(self):
        super().__init__("Filter Subsided Flood Events")

    async def process(self, data: Any) -> Any:
        if not data:
            return data

        try:
            import pandas as _pd
            if hasattr(data, "to_dict") and isinstance(data, _pd.DataFrame):
                records = data.to_dict(orient="records")
            else:
                records = data
        except Exception:
            records = data

        if not isinstance(records, list):
            records = [records]

        before = len(records)
        def _is_subsided(rec: Dict[str, Any]) -> bool:
            val = (rec.get("event") or "").strip().lower()
            return val == "flood_subsided"

        filtered = [r for r in records if not _is_subsided(r)]
        after = len(filtered)
        logger.info(f"Filtered 'flood_subsided': removed {before-after} of {before} rows")
        return filtered

class FloodsUpsertStage(PipelineStage):
    """Floods-specific DB write using upsert on (id)."""

    def __init__(self, table_name: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(f"Database Upsert ({table_name})", config)
        self.table_name = table_name
        self.batch_size = int(self.config.get("batch_size", 1000))
        self.db = self.config.get("db_connection") or DatabaseConnection()

    def validate_config(self) -> bool:
        if not self.table_name:
            raise ValueError("table_name is required")
        if self.batch_size <= 0:
            raise ValueError("batch_size must be positive")
        # test connection
        self.db._get_connection()
        return True

    async def process(self, data: Any) -> Any:
        if not data:
            return data

        # Expect list[dict] from previous sanitize stage; if DataFrame, convert
        try:
            import pandas as _pd
            if hasattr(data, "to_dict") and isinstance(data, _pd.DataFrame):
                records = data.to_dict(orient="records")
            else:
                records = data
        except Exception:
            records = data

        if not isinstance(records, list):
            records = [records]

        total = len(records)
        for i in range(0, total, self.batch_size):
            batch = records[i:i + self.batch_size]
            try:
                # Use upsert on primary key id
                self.db.upsert(table=self.table_name, data=batch, on_conflict="id")
            except Exception as e:
                raise Exception(f"Upsert failed for batch {(i//self.batch_size)+1}: {e}")

        return data


class CleanupRemoteFloodsStage(PipelineStage):
    """Delete disallowed rows from remote table before upsert.

    Removes any existing rows with event == 'flood_subsided' and optionally
    rows in island PAs, so legacy data doesn't persist.
    """

    def __init__(self, table_name: str, remove_island_pas: bool = True):
        super().__init__("Cleanup Remote Floods")
        self.table_name = table_name
        self.remove_island_pas = remove_island_pas
        self.db = DatabaseConnection()

    async def process(self, data: Any) -> Any:
        try:
            client = self.db._get_connection()
            client.table(self.table_name).delete().eq("event", "flood_subsided").execute()
            if self.remove_island_pas:
                excluded = [24, 27, 31]
                client.table(self.table_name).delete().in_("start_pa_id", excluded).execute()
                client.table(self.table_name).delete().in_("end_pa_id", excluded).execute()
        except Exception:
            pass
        return data

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

        # Stage 2.5: Sanitize/match schema for DB (floods-specific)
        sanitize_stage = SanitizeFloodsForDBStage()
        stages.append(sanitize_stage)

        # Stage 3: Drop island planning areas
        stages.append(FilterIslandPAStage())

        # Stage 4: Drop subsided events
        stages.append(FilterSubsidedStage())

        # Stage 5: Ensure remote table has no disallowed legacy rows
        stages.append(CleanupRemoteFloodsStage(self.db_table, remove_island_pas=True))

        # Stage 6: Database Upsert (floods-specific behavior)
        db_config = self.config.get("database_write", {})
        db_stage = FloodsUpsertStage(table_name=self.db_table, config=db_config)
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
