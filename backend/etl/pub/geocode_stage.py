import re
import logging
import pandas as pd
import requests
import time
import os
from typing import Any, Dict, List, Optional

from etl.common.pipeline_stage import PipelineStage
from common.db import DatabaseConnection

logger = logging.getLogger(__name__)


class GeocodeStage(PipelineStage):
    """Pipeline stage for geocoding locations with database caching.

    This stage handles:
    1. Cleaning location queries (remove ", Singapore", lowercase)
    2. Querying database for existing geocoded results
    3. Calling LocationIQ API if no database result exists
    4. Enriching weather alerts with coordinates

    Input: Data containing location fields to geocode
    Output: Same data with added coordinate fields
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the geocode stage.

        Args:
            config: Configuration dictionary containing:
                - location_field: Field name containing location strings
                  (default: 'location')
                - output_lat_field: Field name for latitude output
                  (default: 'latitude')
                - output_lng_field: Field name for longitude output
                  (default: 'longitude')
                - clean_queries: Whether to clean location queries
                  (default: True)
                - geocode_table: Database table for geocode cache
                  (default: 'geocode_cache')
                - locationiq_key: LocationIQ API key
                - api_sleep_time: Sleep between API calls (default: 1.0)
        """
        super().__init__("Geocode Stage", config)

        # Configuration
        self.location_field = self.config.get("location_field", "location")
        self.output_lat_field = self.config.get("output_lat_field", "latitude")
        self.output_lng_field = self.config.get("output_lng_field", "longitude")
        self.clean_queries = self.config.get("clean_queries", True)
        self.geocode_table = self.config.get("geocode_table", "geocode_cache")
        self.api_sleep_time = self.config.get("api_sleep_time", 1.0)

        # LocationIQ API configuration
        self.locationiq_key = (
            self.config.get("locationiq_key")
            or os.getenv("LOCATIONIQ_KEY")
            or "pk.e4e9832f2313263c0d4de9baacda589a"
        )
        self.locationiq_url = "https://us1.locationiq.com/v1/search.php"

        # Database connection
        self.db = DatabaseConnection()

        # Statistics
        self.db_hits = 0
        self.db_misses = 0
        self.api_calls = 0

        logger.info("Initialized GeocodeStage with database caching")

    def validate_config(self) -> bool:
        """Validate configuration parameters.

        Returns:
            True if configuration is valid

        Raises:
            ValueError: If configuration is invalid
        """
        if not self.location_field:
            raise ValueError("location_field is required")

        if not self.output_lat_field or not self.output_lng_field:
            raise ValueError("output_lat_field and output_lng_field are " "required")

        if not self.locationiq_key:
            raise ValueError("LocationIQ API key is required")

        return True

    def clean_location_query(self, query: str) -> str:
        """Clean location query by removing ', Singapore' and converting to
        lowercase.

        Args:
            query: Raw location query string

        Returns:
            Cleaned location query
        """
        if not query or not isinstance(query, str):
            return query

        if not self.clean_queries:
            return query

        # Remove ', Singapore' (case insensitive) from the end
        cleaned = re.sub(r",\s*singapore\s*$", "", query, flags=re.IGNORECASE)

        # Convert to lowercase and strip whitespace
        cleaned = cleaned.lower().strip()

        return cleaned

    def query_database_for_coordinates(self, cleaned_query: str) -> Optional[Dict]:
        """Query database for existing geocoded coordinates.

        Args:
            cleaned_query: Cleaned location query

        Returns:
            Dictionary with coordinates if found, None otherwise
        """
        try:
            client = self.db._get_connection()

            # Query the geocode cache table
            response = (
                client.table(self.geocode_table)
                .select("latitude, longitude, last_updated")
                .eq("query", cleaned_query)
                .execute()
            )

            if response.data and len(response.data) > 0:
                result = response.data[0]
                self.db_hits += 1
                return {
                    "latitude": result.get("latitude"),
                    "longitude": result.get("longitude"),
                    "source": "database",
                }

            self.db_misses += 1
            return None

        except Exception as e:
            logger.warning(f"Database query failed for '{cleaned_query}': {e}")
            self.db_misses += 1
            return None

    def call_locationiq_api(self, query: str) -> Optional[Dict]:
        """Call LocationIQ API to geocode a location.

        Args:
            query: Location query string

        Returns:
            Dictionary with coordinates if successful, None otherwise
        """
        try:
            params = {
                "key": self.locationiq_key,
                "q": f"{query}, Singapore",
                "format": "json",
                "limit": 1,
                "countrycodes": "SG",
            }

            response = requests.get(self.locationiq_url, params=params, timeout=12)

            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list) and data:
                    self.api_calls += 1
                    return {
                        "latitude": float(data[0]["lat"]),
                        "longitude": float(data[0]["lon"]),
                        "source": "api",
                    }
            elif response.status_code == 404:
                logger.info(f"Location not found: {query}")
            else:
                logger.warning(
                    f"LocationIQ API error {response.status_code} " f"for '{query}'"
                )

            return None

        except Exception as e:
            logger.error(f"LocationIQ API call failed for '{query}': {e}")
            return None

    def save_to_database(
        self, cleaned_query: str, coordinates: Dict, original_query: str
    ):
        """Save geocoded result to database.

        Args:
            cleaned_query: Cleaned location query
            coordinates: Geocoding results
            original_query: Original input query
        """
        try:
            client = self.db._get_connection()

            data = {
                "query": cleaned_query,
                "original_query": original_query,
                "latitude": coordinates.get("latitude"),
                "longitude": coordinates.get("longitude"),
                "last_updated": pd.Timestamp.now().isoformat(),
            }

            # Insert or update the record
            client.table(self.geocode_table).insert(data).execute()

            logger.debug(f"Saved geocode result for '{cleaned_query}' " f"to database")

        except Exception as e:
            logger.error(f"Failed to save geocode result to database: {e}")

    def geocode_location(self, location: str) -> Dict[str, Any]:
        """Geocode a location using database first, then API.

        Args:
            location: Location string to geocode

        Returns:
            Dictionary with geocoding results
        """
        original_query = location
        cleaned_query = self.clean_location_query(location)

        # First, check database
        db_result = self.query_database_for_coordinates(cleaned_query)
        if db_result:
            return {
                **db_result,
                "original_query": original_query,
                "cleaned_query": cleaned_query,
            }

        # If not in database, call API
        api_result = self.call_locationiq_api(cleaned_query)

        if api_result:
            # Save to database for future use
            self.save_to_database(cleaned_query, api_result, original_query)

            # Add rate limiting
            time.sleep(self.api_sleep_time)

            return {
                **api_result,
                "original_query": original_query,
                "cleaned_query": cleaned_query,
            }

        # Return None result if both database and API fail
        return {
            "latitude": None,
            "longitude": None,
            "source": "failed",
            "original_query": original_query,
            "cleaned_query": cleaned_query,
        }

    async def process(self, data: Any) -> Any:
        """Process data by geocoding location fields.

        Args:
            data: Input data containing location information. Can be:
                - Single dictionary with location field
                - List of dictionaries
                - pandas DataFrame
                - Pydantic model instances

        Returns:
            Same data structure with added coordinate fields

        Raises:
            ValueError: If data format is unsupported or location field missing
        """
        if data is None:
            logger.warning("No data provided for geocoding")
            return data

        # Convert data to list of dictionaries for processing
        records = self._prepare_data_for_processing(data)

        if not records:
            logger.warning("No records to geocode")
            return data

        logger.info(f"Starting geocoding for {len(records)} records")

        # Reset statistics
        self.db_hits = 0
        self.db_misses = 0
        self.api_calls = 0

        # Process each record
        for i, record in enumerate(records):
            if i % 100 == 0 and i > 0:
                logger.info(
                    f"Processed {i}/{len(records)} records. "
                    f"DB hits: {self.db_hits}, "
                    f"API calls: {self.api_calls}"
                )

            location = record.get(self.location_field)
            if not location:
                # Set None values for missing locations
                record[self.output_lat_field] = None
                record[self.output_lng_field] = None
                continue

            # Geocode the location
            result = self.geocode_location(location)

            # Add results to record
            record[self.output_lat_field] = result["latitude"]
            record[self.output_lng_field] = result["longitude"]

            # Optionally add metadata fields
            if self.config.get("include_metadata", False):
                record["geocode_source"] = result["source"]
                record["cleaned_query"] = result["cleaned_query"]

        # Log final statistics
        total_processed = len(records)
        if total_processed > 0:
            db_hit_rate = self.db_hits / total_processed * 100
        else:
            db_hit_rate = 0

        logger.info(f"Geocoding completed: {total_processed} records " f"processed")
        logger.info(f"Database hits: {self.db_hits} ({db_hit_rate:.1f}%)")
        logger.info(f"API calls: {self.api_calls}")

        # Convert back to original data format
        return self._restore_data_format(data, records)

    def _prepare_data_for_processing(self, data: Any) -> List[Dict]:
        """Convert input data to a list of dictionaries for processing.

        Args:
            data: Input data in various formats

        Returns:
            List of dictionaries ready for processing

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
            elif hasattr(first_item, "dict"):  # Pydantic model v1
                return [item.dict() for item in data]
            elif hasattr(first_item, "model_dump"):  # Pydantic model v2
                return [item.model_dump() for item in data]
            else:
                item_type = type(first_item)
                raise ValueError(f"Unsupported list item type: " f"{item_type}")

        elif isinstance(data, pd.DataFrame):
            return data.to_dict("records")

        elif hasattr(data, "dict"):  # Single Pydantic model (v1)
            return [data.dict()]

        elif hasattr(data, "model_dump"):  # Single Pydantic model (v2)
            return [data.model_dump()]

        else:
            raise ValueError(f"Unsupported data type: {type(data)}")

    def _restore_data_format(
        self, original_data: Any, processed_records: List[Dict]
    ) -> Any:
        """Restore the original data format after processing.

        Args:
            original_data: Original input data
            processed_records: Processed list of dictionaries

        Returns:
            Data in the same format as original_data
        """
        if isinstance(original_data, dict):
            return processed_records[0] if processed_records else {}

        elif isinstance(original_data, list):
            return processed_records

        elif isinstance(original_data, pd.DataFrame):
            return pd.DataFrame(processed_records)

        elif hasattr(original_data, "dict") or hasattr(original_data, "model_dump"):
            # For Pydantic models, return the processed dictionary
            # Note: This loses the original Pydantic type, but maintains data
            return processed_records[0] if processed_records else {}

        else:
            return processed_records

    def get_cache_stats(self) -> Dict[str, Any]:
        """Get current cache statistics.

        Returns:
            Dictionary with cache statistics
        """
        # Calculate cache hit rate
        total_requests = self.db_hits + self.db_misses
        if total_requests > 0:
            db_hit_rate = self.db_hits / total_requests * 100
        else:
            db_hit_rate = 0

        return {
            "db_hits": self.db_hits,
            "db_misses": self.db_misses,
            "api_calls": self.api_calls,
            "db_hit_rate": db_hit_rate,
        }
