import logging
from typing import Any, Dict, List, Optional

from .pipeline_stage import PipelineStage
from backend.common.db import DatabaseConnection

logger = logging.getLogger(__name__)


class DatabaseWriteStage(PipelineStage):
    """Pipeline stage for writing data to the database.

    This stage writes processed data to a specified database table.
    It handles both single records and lists of records, and can work
    with dictionaries or Pydantic models.
    """

    def __init__(self, table_name: str, config: Optional[Dict[str, Any]] = None):
        """Initialize the database write stage.

        Args:
            table_name: Name of the database table to write to
            config: Configuration dictionary containing:
                - batch_size: Number of records to write in each batch
                  (default: 1000)
                - on_conflict: How to handle conflicts (default: None)
                - db_connection: Optional custom database connection
        """
        super().__init__(f"Database Write ({table_name})", config)
        self.table_name = table_name
        self.batch_size = self.config.get("batch_size", 1000)
        self.on_conflict = self.config.get("on_conflict", None)

        # Use provided DB connection or create a new one
        self.db = self.config.get("db_connection", None)
        if self.db is None:
            self.db = DatabaseConnection()

    def validate_config(self) -> bool:
        """Validate configuration parameters.

        Returns:
            True if configuration is valid

        Raises:
            ValueError: If configuration is invalid
        """
        if not self.table_name:
            raise ValueError("table_name is required")

        if self.batch_size <= 0:
            raise ValueError("batch_size must be positive")

        # Test database connection
        try:
            if self.db and hasattr(self.db, "_get_connection"):
                self.db._get_connection()
        except Exception as e:
            raise ValueError(f"Database connection failed: {e}")

        return True

    async def process(self, data: Any) -> Any:
        """Write data to the database.

        Args:
            data: Input data to write. Can be:
                - Single dictionary
                - List of dictionaries
                - Pydantic model instance
                - List of Pydantic model instances

        Returns:
            The original input data (pass-through)

        Raises:
            ValueError: If data format is unsupported
            Exception: If database write fails
        """
        if data is None:
            logger.warning("No data provided to write to database")
            return data

        # Convert data to list of dictionaries for database insertion
        records = self._prepare_data_for_db(data)

        if not records:
            logger.warning("No records to write to database")
            return data

        table_msg = f"Writing {len(records)} records to table"
        logger.info(f"{table_msg} '{self.table_name}'")

        # Write data in batches
        try:
            await self._write_batches(records)
            success_msg = f"Successfully wrote {len(records)} records"
            logger.info(f"{success_msg} to '{self.table_name}'")
        except Exception as e:
            error_msg = f"Failed to write data to table '{self.table_name}'"
            logger.error(f"{error_msg}: {e}")
            raise

        return data

    def _prepare_data_for_db(self, data: Any) -> List[Dict]:
        """Convert input data to a list of dictionaries for database insertion.

        Args:
            data: Input data in various formats

        Returns:
            List of dictionaries ready for database insertion

        Raises:
            ValueError: If data format is unsupported
        """
        if isinstance(data, dict):
            return [data]

        elif isinstance(data, list):
            if not data:
                return []

            # Check the type of the first element
            first_item = data[0]
            if isinstance(first_item, dict):
                return data
            elif hasattr(first_item, "dict"):  # Pydantic model
                return [item.dict() for item in data]
            elif hasattr(first_item, "model_dump"):  # Pydantic v2 model
                return [item.model_dump() for item in data]
            else:
                item_type = type(first_item)
                raise ValueError(f"Unsupported list item type: {item_type}")

        elif hasattr(data, "dict"):  # Single Pydantic model (v1)
            return [data.dict()]

        elif hasattr(data, "model_dump"):  # Single Pydantic model (v2)
            return [data.model_dump()]

        else:
            raise ValueError(f"Unsupported data type: {type(data)}")

    async def _write_batches(self, records: List[Dict]) -> None:
        """Write records to database in batches.

        Args:
            records: List of dictionaries to write

        Raises:
            Exception: If any batch write fails
        """
        total_records = len(records)

        for i in range(0, total_records, self.batch_size):
            batch = records[i : i + self.batch_size]
            batch_num = (i // self.batch_size) + 1
            total_batches = (total_records + self.batch_size - 1) // self.batch_size

            batch_info = f"batch {batch_num}/{total_batches}"
            logger.debug(f"Writing {batch_info} ({len(batch)} records)")

            try:
                if self.db and self.on_conflict and hasattr(self.db, "upsert"):
                    # Use upsert when on_conflict is provided
                    self.db.upsert(table=self.table_name, data=batch, on_conflict=self.on_conflict)
                elif self.db and hasattr(self.db, "insert"):
                    # Default to insert
                    self.db.insert(table=self.table_name, data=batch)
                else:
                    raise Exception("Database connection not available")
            except Exception as e:
                msg = f"Failed to write batch {batch_num}/{total_batches}"
                logger.error(f"{msg}: {e}")
                raise Exception(f"{msg}: {e}")

    def __del__(self):
        """Clean up database connection when stage is destroyed."""
        if hasattr(self, "db") and self.db and hasattr(self.db, "close"):
            try:
                self.db.close()
            except Exception as e:
                logger.warning(f"Error closing database connection: {e}")
