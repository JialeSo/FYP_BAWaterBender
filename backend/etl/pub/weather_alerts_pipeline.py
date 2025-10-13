import logging
from typing import Any, Dict, List, Optional, Union

from ..common.pipeline import Pipeline
from ..common.weather_alerts_database_write_stage import WeatherAlertsDatabaseWriteStage
from .weather_alerts_processing_stage import WeatherAlertsProcessingStage
from .location_geocoding_stage import LocationGeocodingStage
from .models.pub_models import WeatherAlertMessage

logger = logging.getLogger(__name__)


class WeatherAlertsPipeline(Pipeline):
    """Complete pipeline for processing weather alerts.

    This pipeline processes weather alert messages through these stages:
    1. Weather Alerts Processing - Parse alert text into structured data
    2. Location Geocoding - Geocode locations and store in geocodes table
    3. Database Write - Save processed data to the database

    The pipeline handles the complete flow from raw weather alert messages
    to enriched, geocoded data stored in the database.
    """

    def __init__(
        self,
        config: Optional[Dict[str, Any]] = None,
        db_table: str = "PUB_weather_alerts",
    ):
        """Initialize the weather alerts pipeline.

        Args:
            config: Configuration dictionary containing:
                - weather_processing: Config for weather processing stage
                - location_geocoding: Config for location geocoding stage
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
            name="Weather Alerts Pipeline", stages=stages, config=self.config
        )

    def _create_stages(self) -> List[Any]:
        """Create and configure all pipeline stages.

        Returns:
            List of configured pipeline stages
        """
        stages = []

        # Stage 1: Weather Alerts Processing
        weather_config = self.config.get("weather_processing", {})
        weather_stage = WeatherAlertsProcessingStage(config=weather_config)
        stages.append(weather_stage)

        # Stage 2: Location Geocoding
        geocoding_config = self.config.get("location_geocoding", {})
        geocoding_stage = LocationGeocodingStage(config=geocoding_config)
        stages.append(geocoding_stage)

        # Stage 3: Database Write
        db_config = self.config.get("database_write", {})
        db_stage = WeatherAlertsDatabaseWriteStage(
            table_name=self.db_table, config=db_config
        )
        stages.append(db_stage)

        return stages

    async def process_weather_alerts(
        self,
        alerts: Union[Dict, List[Dict], WeatherAlertMessage, List[WeatherAlertMessage]],
    ) -> Any:
        """Process weather alerts through the complete pipeline.

        Args:
            alerts: Weather alert data to process. Can be:
                - Single dictionary with alert data
                - List of dictionaries with alert data
                - Single WeatherAlertMessage object
                - List of WeatherAlertMessage objects

        Returns:
            Final processed data from the pipeline

        Raises:
            ValueError: If input data format is invalid
            Exception: If any pipeline stage fails
        """
        if not alerts:
            logger.warning("No weather alerts provided for processing")
            return None

        logger.info("Starting weather alerts pipeline processing")

        try:
            # Run the complete pipeline
            result = await self.run(initial_data=alerts)

            # Log processing summary
            if isinstance(alerts, list):
                count = len(alerts)
            else:
                count = 1

            logger.info(f"Successfully processed {count} weather alerts")
            return result

        except Exception as e:
            logger.error(f"Weather alerts pipeline failed: {e}")
            raise

    async def process_single_alert(
        self, alert: Union[Dict, WeatherAlertMessage]
    ) -> Any:
        """Process a single weather alert through the pipeline.

        Args:
            alert: Single weather alert to process

        Returns:
            Processed data from the pipeline

        Raises:
            ValueError: If input data format is invalid
            Exception: If any pipeline stage fails
        """
        result = await self.process_weather_alerts(alert)

        # Return the first (and only) result if it's a list
        if isinstance(result, list) and len(result) == 1:
            return result[0]

        return result

    def get_processing_stage(self) -> WeatherAlertsProcessingStage:
        """Get the weather alerts processing stage.

        Returns:
            WeatherAlertsProcessingStage instance

        Raises:
            ValueError: If stage not found
        """
        stage = self.get_stage("Weather Alerts Processing")
        if not isinstance(stage, WeatherAlertsProcessingStage):
            raise ValueError("Weather Alerts Processing stage not found")
        return stage

    def get_geocoding_stage(self) -> LocationGeocodingStage:
        """Get the location geocoding stage.

        Returns:
            LocationGeocodingStage instance

        Raises:
            ValueError: If stage not found
        """
        stage = self.get_stage("Location Geocoding")
        if not isinstance(stage, LocationGeocodingStage):
            raise ValueError("Location Geocoding stage not found")
        return stage

    def get_database_stage(self) -> WeatherAlertsDatabaseWriteStage:
        """Get the database write stage.

        Returns:
            WeatherAlertsDatabaseWriteStage instance

        Raises:
            ValueError: If stage not found
        """
        stage_name = f"Database Write ({self.db_table})"
        stage = self.get_stage(stage_name)
        if not isinstance(stage, WeatherAlertsDatabaseWriteStage):
            raise ValueError("Database Write stage not found")
        return stage
