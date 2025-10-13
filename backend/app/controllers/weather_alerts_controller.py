import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)


class WeatherAlertsController:
    """Controller for handling weather alerts with lazy-loaded pipeline."""

    def __init__(self):
        """Initialize the controller without loading the pipeline."""
        self._pipeline = None
        self._pipeline_config = None

    def _get_pipeline(self):
        """Lazy load the WeatherAlertsPipeline class."""
        if self._pipeline is None:
            try:
                from etl.pub.weather_alerts_pipeline import WeatherAlertsPipeline

                # Initialize with default config
                config = self._pipeline_config or {
                    "continue_on_error": True,  # Continue processing other records
                    "weather_processing": {},
                    "location_geocoding": {},  # Updated to use new geocoding stage
                    "database_write": {},
                }

                self._pipeline = WeatherAlertsPipeline(
                    config=config, db_table="PUB_weather_alerts"
                )
                logger.info("WeatherAlertsPipeline loaded successfully")

            except ImportError as e:
                logger.error(f"Failed to import WeatherAlertsPipeline: {e}")
                raise
            except Exception as e:
                logger.error(f"Failed to initialize WeatherAlertsPipeline: {e}")
                raise

        return self._pipeline

    def set_pipeline_config(self, config: Dict[str, Any]) -> None:
        """Set configuration for the pipeline.

        Args:
            config: Configuration dictionary for the pipeline
        """
        self._pipeline_config = config
        # Reset pipeline to force reinitialization with new config
        self._pipeline = None

    async def process_weather_alert(self, message: Dict[str, Any]) -> Dict[str, Any]:
        """Process a weather alert message through the pipeline.

        Args:
            message: Weather alert message data

        Returns:
            Dict containing processing result and status

        Raises:
            Exception: If processing fails
        """
        try:
            msg_id = message.get("id", "unknown")
            logger.info(f"Processing weather alert message: {msg_id}")
            logger.debug(f"Input message data: {message}")

            # Get the pipeline (lazy loading)
            pipeline = self._get_pipeline()
            logger.info(f"Pipeline loaded successfully: {type(pipeline)}")

            # Process the message through the pipeline
            logger.info("Starting pipeline processing...")
            result = await pipeline.process_single_alert(message)
            logger.info(f"Pipeline processing completed. Result: {result}")

            logger.info("Weather alert processed successfully through pipeline")

            return {
                "status": "success",
                "message": "Weather alert processed successfully",
                "data": result,
            }

        except Exception as e:
            logger.error(f"Error processing weather alert: {e}")
            raise

    async def process_multiple_alerts(self, messages: list) -> Dict[str, Any]:
        """Process multiple weather alert messages through the pipeline.

        Args:
            messages: List of weather alert message data

        Returns:
            Dict containing processing result and status

        Raises:
            Exception: If processing fails
        """
        try:
            logger.info(f"Processing {len(messages)} weather alert messages")

            # Get the pipeline (lazy loading)
            pipeline = self._get_pipeline()

            # Process the messages through the pipeline
            result = await pipeline.process_weather_alerts(messages)

            success_msg = (
                f"Successfully processed {len(messages)} weather alerts "
                "through pipeline"
            )
            logger.info(success_msg)

            return {
                "status": "success",
                "message": (f"Successfully processed {len(messages)} weather alerts"),
                "data": result,
            }

        except Exception as e:
            logger.error(f"Error processing weather alerts: {e}")
            raise

    def get_pipeline_status(self) -> Dict[str, Any]:
        """Get the current status of the pipeline.

        Returns:
            Dict containing pipeline status information
        """
        return {
            "pipeline_loaded": self._pipeline is not None,
            "pipeline_config": self._pipeline_config,
            "pipeline_class": (
                type(self._pipeline).__name__ if self._pipeline else None
            ),
        }


# Singleton instance of WeatherAlertsController
weather_alerts_controller = WeatherAlertsController()
