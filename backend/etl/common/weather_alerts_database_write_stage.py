import logging
from typing import Any, Dict, List, Optional, Union
from datetime import datetime

from .database_write_stage import DatabaseWriteStage
from common.db import db

logger = logging.getLogger(__name__)


class WeatherAlertsDatabaseWriteStage(DatabaseWriteStage):
    """
    Extended database write stage for weather alerts with geocoding support.

    This stage handles writing both weather alert data and managing
    the relationships with the geocodes table.
    """

    def __init__(self, table_name: str, config: Optional[Dict[str, Any]] = None):
        """Initialize the weather alerts database write stage.

        Args:
            table_name: Name of the main weather alerts table
            config: Configuration dictionary containing:
                - batch_size: Number of records to write in each batch
                - geocodes_table: Name of geocodes table (default: "geocodes")
                - db_connection: Optional custom database connection
        """
        super().__init__(table_name, config)
        self.geocodes_table = self.config.get("geocodes_table", "geocodes")

    async def process(self, data: Any) -> Any:
        """
        Write weather alerts data to database with geocoding support.

        This method processes the data to ensure geocoding relationships
        are properly handled before writing to the main table.

        Args:
            data: Input data to write

        Returns:
            The original input data (pass-through)
        """
        if data is None:
            logger.warning("No data provided to write to database")
            return data

        # Convert data to list of dictionaries for processing
        records = self._prepare_data_for_db(data)

        if not records:
            logger.warning("No records to write to database")
            return data

        logger.info(
            f"Writing {len(records)} weather alert records to table "
            f"'{self.table_name}'"
        )

        # Process records to handle geocoding relationships
        processed_records = await self._process_geocoding_relationships(records)

        # Write processed data with individual record error handling
        successful_records, failed_records = (
            await self._write_records_with_error_handling(processed_records)
        )

        # Log results
        total_records = len(processed_records)
        success_count = len(successful_records)
        failure_count = len(failed_records)

        if failure_count > 0:
            logger.warning(
                f"Partial success: {success_count}/{total_records} records written to "
                f"'{self.table_name}'. {failure_count} records failed."
            )
            for i, (record, error) in enumerate(failed_records):
                logger.error(f"Failed record {i+1}: {error}")
                logger.debug(f"Failed record data: {record}")
        else:
            logger.info(
                f"Successfully wrote all {success_count} records to "
                f"'{self.table_name}'"
            )

        return data

    async def _write_records_with_error_handling(
        self, records: List[Dict]
    ) -> tuple[List[Dict], List[tuple[Dict, str]]]:
        """
        Write records to database with individual error handling.

        Args:
            records: List of records to write

        Returns:
            Tuple of (successful_records, failed_records_with_errors)
        """
        successful_records = []
        failed_records = []

        for record in records:
            try:
                # Try to write individual record with upsert on primary key "id"
                response = db.upsert(
                    table=self.table_name,
                    data=[record],
                    on_conflict="id",
                )
                if response.data and len(response.data) > 0:
                    successful_records.append(record)
                    logger.debug(
                        f"Successfully wrote record: {record.get('id', 'unknown')}"
                    )
                else:
                    error_msg = "Database insert returned empty response"
                    failed_records.append((record, error_msg))
                    logger.warning(
                        f"Failed to write record {record.get('id', 'unknown')}: {error_msg}"
                    )

            except Exception as e:
                error_msg = str(e)
                failed_records.append((record, error_msg))

                # Check if it's a JSON serialization error and provide helpful info
                if "JSON serializable" in error_msg:
                    logger.error(
                        f"JSON serialization error for record {record.get('id', 'unknown')}"
                    )
                    logger.error("Record contains non-serializable objects:")
                    for key, value in record.items():
                        if (
                            hasattr(value, "__class__")
                            and value.__class__.__module__ != "builtins"
                        ):
                            logger.error(f"  - Field '{key}': {type(value)} = {value}")
                else:
                    logger.error(
                        f"Database error for record {record.get('id', 'unknown')}: {error_msg}"
                    )

        return successful_records, failed_records

    async def _process_geocoding_relationships(self, records: List[Dict]) -> List[Dict]:
        """
        Process records to handle geocoding relationships.

        This method ensures that:
        1. Geocode foreign keys are properly set
        2. Legacy geocoding fields are cleaned up if needed
        3. Datetime objects are properly serialized

        Args:
            records: List of records to process

        Returns:
            List of processed records ready for database insertion
        """
        processed_records = []

        for record in records:
            processed_record = record.copy()

            # Handle geocoding data
            self._process_single_record_geocoding(processed_record)

            # Handle datetime serialization
            self._serialize_datetime_fields(processed_record)

            processed_records.append(processed_record)

        return processed_records

    def _serialize_datetime_fields(self, record: Dict) -> None:
        """
        Convert datetime objects to ISO format strings for JSON serialization.

        Args:
            record: Record dictionary to process (modified in place)
        """
        for key, value in record.items():
            if isinstance(value, datetime):
                # Convert datetime to ISO format string with timezone
                if value.tzinfo is None:
                    # If no timezone info, assume UTC and add +00:00
                    from datetime import timezone
                    value = value.replace(tzinfo=timezone.utc)
                record[key] = value.isoformat()
                logger.debug(f"Serialized datetime field '{key}': {record[key]}")

    def _process_single_record_geocoding(self, record: Dict) -> None:
        """
        Process geocoding data for a single record.

        Args:
            record: Record dictionary to process (modified in place)
        """
        # Ensure geocode foreign keys are present and valid
        if "start_loc_geocode_id" in record and record["start_loc_geocode_id"]:
            # Validate that the geocode ID exists
            if not self._validate_geocode_id(record["start_loc_geocode_id"]):
                logger.warning(
                    f"Invalid start_loc_geocode_id: {record['start_loc_geocode_id']}"
                )
                record["start_loc_geocode_id"] = None

        if "end_loc_geocode_id" in record and record["end_loc_geocode_id"]:
            # Validate that the geocode ID exists
            if not self._validate_geocode_id(record["end_loc_geocode_id"]):
                logger.warning(
                    f"Invalid end_loc_geocode_id: {record['end_loc_geocode_id']}"
                )
                record["end_loc_geocode_id"] = None

        # Clean up legacy fields that are now handled by geocodes table
        legacy_fields = [
            "location",  # Legacy single location field - replaced by start_loc/end_loc
            "start_lat",
            "start_lng",
            "start_postal_code",
            "end_lat",
            "end_lng",
            "end_postal_code",
        ]

        for field in legacy_fields:
            if field in record:
                # Remove legacy fields since we now use geocodes table
                del record[field]

    def _validate_geocode_id(self, geocode_id: int) -> bool:
        """
        Validate that a geocode ID exists in the geocodes table.

        Args:
            geocode_id: Geocode ID to validate

        Returns:
            True if the geocode ID exists, False otherwise
        """
        try:
            response = db.select(self.geocodes_table, columns="id", id=geocode_id)

            return bool(response.data and len(response.data) > 0)

        except Exception as e:
            logger.error(f"Error validating geocode ID {geocode_id}: {e}")
            return False

    def get_geocode_info(self, geocode_id: int) -> Optional[Dict]:
        """
        Get geocoding information for a given geocode ID.

        Args:
            geocode_id: Geocode ID to look up

        Returns:
            Geocode information dict or None if not found
        """
        try:
            response = db.select(self.geocodes_table, columns="*", id=geocode_id)

            if response.data and len(response.data) > 0:
                return response.data[0]
            else:
                return None

        except Exception as e:
            logger.error(f"Error getting geocode info for ID {geocode_id}: {e}")
            return None
