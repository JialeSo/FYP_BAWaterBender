import logging
import math
from typing import Any, Dict, List, Optional

from .pipeline_stage import PipelineStage
from backend.common.db import DatabaseConnection

logger = logging.getLogger(__name__)


class DatabaseWriteStage(PipelineStage):
    """Pipeline stage for writing data to the database.

    Writes processed data to a specified database table. Accepts single dict,
    list of dicts, or Pydantic models. No schema remapping — upstream stages
    must produce DB-ready records.
    """

    def __init__(self, table_name: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(f"Database Write ({table_name})", config)
        self.table_name = table_name
        self.batch_size = self.config.get("batch_size", 1000)
        self.on_conflict = self.config.get("on_conflict", None)
        # Optional list of column names to drop from records before writing
        self.drop_columns = set(self.config.get("drop_columns", []) or [])

        self.db = self.config.get("db_connection", None)
        if self.db is None:
            self.db = DatabaseConnection()

    def validate_config(self) -> bool:
        if not self.table_name:
            raise ValueError("table_name is required")
        if self.batch_size <= 0:
            raise ValueError("batch_size must be positive")
        try:
            if self.db and hasattr(self.db, "_get_connection"):
                self.db._get_connection()
        except Exception as e:
            raise ValueError(f"Database connection failed: {e}")
        return True

    async def process(self, data: Any) -> Any:
        if data is None:
            logger.warning("No data provided to write to database")
            return data
        records = self._prepare_data_for_db(data)
        if not records:
            logger.warning("No records to write to database")
            return data
        logger.info(f"Writing {len(records)} records to table '{self.table_name}'")
        try:
            await self._write_batches(records)
            logger.info(f"Successfully wrote {len(records)} records to '{self.table_name}'")
        except Exception as e:
            logger.error(f"Failed to write data to table '{self.table_name}': {e}")
            raise
        return data

    def _prepare_data_for_db(self, data: Any) -> List[Dict]:
        # Pandas DataFrame support
        try:
            import pandas as _pd  # type: ignore
            if isinstance(data, _pd.DataFrame):
                if data.empty:
                    return []
                return data.to_dict(orient="records")
        except Exception:
            pass

        if isinstance(data, dict):
            return [data]
        elif isinstance(data, list):
            if not data:
                return []
            first = data[0]
            if isinstance(first, dict):
                return data
            elif hasattr(first, "dict"):
                return [item.dict() for item in data]
            elif hasattr(first, "model_dump"):
                return [item.model_dump() for item in data]
            else:
                raise ValueError(f"Unsupported list item type: {type(first)}")
        elif hasattr(data, "dict"):
            return [data.dict()]
        elif hasattr(data, "model_dump"):
            return [data.model_dump()]
        else:
            raise ValueError(f"Unsupported data type: {type(data)}")

    def _json_safe(self, value: Any) -> Any:
        """Convert NaN/NaT/inf to JSON-safe types (None or finite numbers)."""
        try:
            if value is None:
                return None
            if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
                return None
            return value
        except Exception:
            return value

    def _sanitize_records(self, records: List[Dict]) -> List[Dict]:
        """Shallow sanitization: replace NaN/inf and nested lists/dicts values."""
        safe: List[Dict] = []
        for rec in records:
            new_rec: Dict[str, Any] = {}
            for k, v in rec.items():
                # Skip any columns configured to be dropped
                if k in self.drop_columns:
                    continue
                if isinstance(v, dict):
                    new_rec[k] = {kk: self._json_safe(vv) for kk, vv in v.items()}
                elif isinstance(v, list):
                    new_rec[k] = [self._json_safe(x) for x in v]
                else:
                    new_rec[k] = self._json_safe(v)
            safe.append(new_rec)
        return safe

    async def _write_batches(self, records: List[Dict]) -> None:
        total_records = len(records)
        for i in range(0, total_records, self.batch_size):
            batch = records[i : i + self.batch_size]
            batch_num = (i // self.batch_size) + 1
            total_batches = (total_records + self.batch_size - 1) // self.batch_size
            logger.debug(f"Writing batch {batch_num}/{total_batches} ({len(batch)} records)")
            try:
                # Ensure batch has no NaN/inf values that break JSON encoding
                batch = self._sanitize_records(batch)
                if not self.db:
                    raise Exception("Database connection not available")
                # Prefer upsert when on_conflict is configured
                if self.on_conflict and hasattr(self.db, "upsert"):
                    self.db.upsert(table=self.table_name, data=batch, on_conflict=self.on_conflict)
                elif hasattr(self.db, "insert"):
                    self.db.insert(table=self.table_name, data=batch)
                else:
                    raise Exception("Database connection does not support insert/upsert")
            except Exception as e:
                msg = f"Failed to write batch {batch_num}/{total_batches}"
                logger.error(f"{msg}: {e}")
                raise Exception(f"{msg}: {e}")

    def __del__(self):
        if hasattr(self, "db") and self.db and hasattr(self.db, "close"):
            try:
                self.db.close()
            except Exception as e:
                logger.warning(f"Error closing database connection: {e}")
