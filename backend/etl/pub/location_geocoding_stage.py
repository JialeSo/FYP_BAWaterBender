import time
import logging
import requests
from typing import Optional, Dict, Any, Union, List
from pydantic import BaseModel

from config.config import LOCATIONIQ_FORWARD_URL, LOCATIONIQ_KEY
from common.db import db
from .pub_utils import clean_location_string
from ..common.pipeline_stage import PipelineStage

logger = logging.getLogger(__name__)


class LocationGeocodingStage(PipelineStage):
    """
    Pipeline stage for geocoding locations with database caching.

    This stage:
    1. Cleans location strings to reduce redundancy
    2. Checks if the location already exists in the geocodes table
    3. If not found, calls LocationIQ API to geocode it
    4. Stores new geocoding data in the geocodes table
    5. Attaches the geocode foreign key to the entry
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the location geocoding stage.

        Args:
            config: Configuration dictionary containing:
                - locationiq_key: API key for LocationIQ service
                - sleep_between_requests: Delay between API calls (default: 1.0)
                - geocodes_table: Name of geocodes table (default: "geocodes")
        """
        super().__init__("Location Geocoding", config)

        # Configuration
        self.locationiq_key = LOCATIONIQ_KEY
        self.sleep_between_requests = self.config.get("sleep_between_requests", 1.0)
        self.geocodes_table = self.config.get("geocodes_table", "geocodes")

        # API endpoints
        self.locationiq_url = LOCATIONIQ_FORWARD_URL

        # Validation
        if not self.validate_config():
            raise ValueError("Configuration validation failed")

    def validate_config(self) -> bool:
        """Validate configuration parameters."""
        if not self.locationiq_key or self.locationiq_key == "YOUR_LOCATIONIQ_KEY":
            raise ValueError("LocationIQ API key is required")

        if self.sleep_between_requests < 0:
            raise ValueError("sleep_between_requests must be non-negative")

        if not self.locationiq_url or not isinstance(self.locationiq_url, str):
            raise ValueError("locationiq_url must be a valid URL string")

        # Basic URL validation
        if not (
            self.locationiq_url.startswith("http://")
            or self.locationiq_url.startswith("https://")
        ):
            raise ValueError("locationiq_url must start with http:// or https://")

        return True

    async def process(
        self, data: Union[BaseModel, List[BaseModel], Dict, List[Dict]]
    ) -> Union[Dict, List[Dict]]:
        """Process input data by enriching location information.

        Args:
            data: Input data which can be:
                - Single Pydantic model with 'start_loc'/'end_loc' fields
                - List of Pydantic models with 'start_loc'/'end_loc' fields
                - Single dictionary with 'start_loc'/'end_loc' fields
                - List of dictionaries with 'start_loc'/'end_loc' fields

        Returns:
            Enhanced data with additional fields:
                - start_loc_geocode_id: Foreign key to geocodes table for start location
                - end_loc_geocode_id: Foreign key to geocodes table for end location
        """
        # Handle single item vs list
        is_single_item = not isinstance(data, list)
        items = [data] if is_single_item else data

        # Convert to dictionaries for processing
        dict_items = []
        for item in items:
            if hasattr(item, "dict"):  # Pydantic v1
                dict_items.append(item.dict())
            elif hasattr(item, "model_dump"):  # Pydantic v2
                dict_items.append(item.model_dump())
            elif isinstance(item, dict):
                dict_items.append(item.copy())
            else:
                raise ValueError(f"Unsupported item type: {type(item)}")

        # Process each item that has location data
        for item in dict_items:
            # Process if item has start_loc or end_loc
            has_location_data = (
                item.get("start_loc") and str(item["start_loc"]).strip()
            ) or (item.get("end_loc") and str(item["end_loc"]).strip())

            if has_location_data:
                await self._enrich_single_item(item)

        # Return in the same format as input
        if is_single_item:
            return dict_items[0] if dict_items else {}
        else:
            return dict_items

    async def _enrich_single_item(self, item: Dict) -> None:
        """Enrich a single item with location geocoding data."""

        # Work with start_loc and end_loc directly instead of location field
        start_loc = item.get("start_loc")
        end_loc = item.get("end_loc")

        # Initialize geocode IDs with defaults
        item.update(
            {
                "start_loc_geocode_id": None,
                "end_loc_geocode_id": None,
            }
        )

        # Process start location
        if start_loc and str(start_loc).strip():
            start_loc_geocode_id = await self._get_or_create_geocode(start_loc)
            item["start_loc_geocode_id"] = start_loc_geocode_id

        # Process end location
        if end_loc and str(end_loc).strip():
            end_loc_geocode_id = await self._get_or_create_geocode(end_loc)
            item["end_loc_geocode_id"] = end_loc_geocode_id

    async def _get_or_create_geocode(self, location_name: str) -> Optional[int]:
        """
        Get existing geocode from database or create new one.

        Args:
            location_name: Raw location name

        Returns:
            Geocode ID (foreign key) or None if geocoding failed
        """
        if not location_name:
            return None

        # Clean the location string
        cleaned_location = clean_location_string(location_name)

        if not cleaned_location:
            return None

        try:
            # Check if location already exists in database
            existing_geocode = self._lookup_existing_geocode(cleaned_location)

            if existing_geocode:
                logger.debug(f"Found existing geocode for '{cleaned_location}'")
                return existing_geocode["id"]

            # If not found, geocode using LocationIQ
            lat, lng, postal_code = await self._geocode_location(location_name)

            if lat is not None and lng is not None:
                # Create new geocode entry
                geocode_data = {
                    "location_name": cleaned_location,
                    "latitude": lat,
                    "longitude": lng,
                    "postal_code": postal_code,
                }

                response = db.insert(self.geocodes_table, geocode_data)
                if response.data and len(response.data) > 0:
                    geocode_id = response.data[0]["id"]
                    logger.info(
                        f"Created new geocode entry for '{cleaned_location}' "
                        f"with ID {geocode_id}"
                    )
                    return geocode_id
                else:
                    logger.error(f"Failed to insert geocode for '{cleaned_location}'")
                    return None
            else:
                logger.warning(f"Could not geocode location: '{location_name}'")
                return None

        except Exception as e:
            logger.error(f"Error processing geocode for '{location_name}': {e}")
            return None

    def _lookup_existing_geocode(self, cleaned_location: str) -> Optional[Dict]:
        """
        Look up existing geocode in database.

        Args:
            cleaned_location: Cleaned location name

        Returns:
            Geocode record dict or None if not found
        """
        try:
            response = db.select(
                self.geocodes_table, columns="*", location_name=cleaned_location
            )

            if response.data and len(response.data) > 0:
                return response.data[0]
            else:
                return None

        except Exception as e:
            logger.error(f"Error looking up geocode for '{cleaned_location}': {e}")
            return None

    async def _geocode_location(
        self, location_name: str
    ) -> tuple[Optional[float], Optional[float], Optional[str]]:
        """
        Geocode a location using LocationIQ API.

        Args:
            location_name: Location name to geocode

        Returns:
            Tuple of (latitude, longitude, postal_code) or (None, None, None)
        """
        if not location_name:
            return None, None, None

        try:
            # Add Singapore to improve geocoding accuracy
            query = f"{location_name}, Singapore"

            params = {
                "key": self.locationiq_key,
                "q": query,
                "format": "json",
                "limit": 1,
                "countrycodes": "SG",
                "addressdetails": 1,
            }

            response = requests.get(self.locationiq_url, params=params, timeout=12)

            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list) and data:
                    result = data[0]
                    lat = float(result["lat"])
                    lng = float(result["lon"])

                    # Extract postal code if available
                    postal_code = None
                    if "address" in result:
                        postal_code = result["address"].get("postcode")

                    logger.debug(
                        f"Geocoded '{location_name}' to "
                        f"({lat}, {lng}) with postal code {postal_code}"
                    )

                    # Add delay between requests
                    time.sleep(self.sleep_between_requests)

                    return lat, lng, postal_code
                else:
                    logger.warning(f"No geocoding results for '{location_name}'")
                    return None, None, None
            elif response.status_code == 404:
                logger.warning(f"Location not found: '{location_name}'")
                return None, None, None
            else:
                logger.error(
                    f"LocationIQ API error for '{location_name}': "
                    f"HTTP {response.status_code}"
                )
                return None, None, None

        except Exception as e:
            logger.error(f"Error geocoding '{location_name}': {e}")
            return None, None, None
