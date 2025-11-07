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

    async def fetch_and_process_recent_alerts(self, hours: int = 24) -> Dict[str, Any]:
        """
        Fetch weather alerts from the last N hours and process them.
        Uses the singleton WeatherAlerts instance to avoid session locking.

        Args:
            hours: Number of hours to look back (default: 24)

        Returns:
            Dict containing processing result and statistics
        """
        from etl.pub.weather_alerts import weather_alerts

        try:
            logger.info(
                f"🔄 Starting cron job: "
                f"Fetching weather alerts from last {hours} hours"
            )

            # Use singleton instance to avoid session file locking
            messages = await weather_alerts.extract_and_save_recent_messages(
                hours=hours
            )

            logger.info(
                f"✅ Cron job completed: " f"Fetched and saved {len(messages)} messages"
            )

            return {
                "status": "success",
                "message": (
                    f"Successfully fetched and processed {len(messages)} "
                    f"messages from last {hours} hours"
                ),
                "messages_processed": len(messages),
                "hours": hours,
            }

        except Exception as e:
            logger.error(f"❌ Cron job failed: {e}")
            raise

    async def backfill_historical_alerts(self, limit: int = 100) -> Dict[str, Any]:
        """
        Extract historical messages from Telegram and load them into Supabase.
        Uses the singleton WeatherAlerts instance to avoid session locking.

        Args:
            limit: Number of messages to fetch (default: 100)

        Returns:
            Dict containing processing result and statistics
        """
        from etl.pub.weather_alerts import weather_alerts
        from etl.pub.weather_alerts_pipeline import WeatherAlertsPipeline

        try:
            logger.info(
                f"🔄 Starting backfill: " f"Extracting {limit} historical messages"
            )

            # Connect and authorize if needed
            if not weather_alerts.client.is_connected():
                await weather_alerts.client.connect()

            if not await weather_alerts.client.is_user_authorized():
                if weather_alerts.phone:
                    await weather_alerts.client.start(phone=weather_alerts.phone)
                else:
                    logger.error("Phone number not provided for authorization")
                    return {
                        "status": "error",
                        "message": "Phone number not provided",
                        "messages_processed": 0,
                    }

            # Extract messages
            messages = []
            async for message in weather_alerts.client.iter_messages(
                weather_alerts.channel_username, limit=limit
            ):
                if message.text:
                    message_data = {
                        "id": message.id,
                        "text": message.text,
                        "created_at": message.date.isoformat(),
                        "sender_id": message.sender_id,
                    }
                    messages.append(message_data)

            logger.info(f"📥 Extracted {len(messages)} messages from Telegram")

            # Process all messages through the pipeline
            if messages:
                logger.info("🔄 Processing messages through pipeline...")
                config = {
                    "continue_on_error": True,
                    "weather_processing": {},
                    "location_geocoding": {},
                    "database_write": {},
                }
                pipeline = WeatherAlertsPipeline(
                    config=config, db_table="PUB_weather_alerts"
                )
                await pipeline.process_weather_alerts(messages)
                logger.info(
                    f"✅ Successfully processed and saved " f"{len(messages)} messages"
                )
            else:
                logger.info("ℹ️  No messages found")

            logger.info(
                f"✅ Backfill completed: " f"Processed {len(messages)} messages"
            )

            return {
                "status": "success",
                "message": (
                    f"Successfully backfilled {len(messages)} " f"historical messages"
                ),
                "messages_processed": len(messages),
                "limit": limit,
            }

        except Exception as e:
            logger.error(f"❌ Backfill failed: {e}")
            raise


# Singleton instance of WeatherAlertsController
weather_alerts_controller = WeatherAlertsController()
