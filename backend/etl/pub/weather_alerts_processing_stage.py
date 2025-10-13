import logging
from typing import Dict, List, Union, Any, Optional

from ..common.pipeline_stage import PipelineStage
from .models.pub_models import WeatherAlertMessage, ParsedWeatherAlert
from .weather_alerts import WeatherAlerts

logger = logging.getLogger(__name__)


class WeatherAlertsProcessingStage(PipelineStage):
    """Pipeline stage for processing weather alert messages.

    This stage processes raw weather alert messages by:
    1. Parsing alert text to extract structured information
    2. Converting raw messages into ParsedWeatherAlert objects
    3. Handling both single messages and lists of messages
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the weather alerts processing stage.

        Args:
            config: Configuration dictionary (currently unused)
        """
        super().__init__("Weather Alerts Processing", config)

        # Initialize WeatherAlerts instance for message processing
        self.weather_alerts = WeatherAlerts()

    def validate_config(self) -> bool:
        """Validate configuration parameters.

        Returns:
            True if configuration is valid
        """
        return True

    async def process(
        self,
        data: Union[Dict, List[Dict], WeatherAlertMessage, List[WeatherAlertMessage]],
    ) -> Union[ParsedWeatherAlert, List[ParsedWeatherAlert]]:
        """Process weather alert data into ParsedWeatherAlert objects.

        Args:
            data: Input data which can be:
                - Single dictionary with message data
                - List of dictionaries with message data
                - Single WeatherAlertMessage object
                - List of WeatherAlertMessage objects

        Returns:
            Single ParsedWeatherAlert or list of ParsedWeatherAlert objects

        Raises:
            ValueError: If input data format is invalid
            Exception: If processing fails
        """
        if isinstance(data, list):
            return [await self._process_single_message(msg) for msg in data]
        else:
            return await self._process_single_message(data)

    async def _process_single_message(
        self, message: Union[Dict, WeatherAlertMessage]
    ) -> ParsedWeatherAlert:
        """Process a single weather alert message.

        Args:
            message: Single message data as dict or WeatherAlertMessage object

        Returns:
            ParsedWeatherAlert object

        Raises:
            ValueError: If message format is invalid
        """
        # Convert WeatherAlertMessage to dict if necessary
        if isinstance(message, WeatherAlertMessage):
            message_dict = {
                "id": message.id,
                "text": message.text,
                "created_at": message.created_at,
                "sender_id": message.sender_id,
            }
        elif isinstance(message, dict):
            message_dict = message.copy()
        else:
            raise ValueError(f"Unsupported message type: {type(message)}")

        # Validate required fields
        required_fields = ["id", "text", "created_at", "sender_id"]
        missing_fields = [
            field for field in required_fields if field not in message_dict
        ]
        if missing_fields:
            raise ValueError(f"Missing required fields: {missing_fields}")

        logger.debug(f"Processing message: {message_dict['id']}")

        # Process the message using WeatherAlerts._save_message logic
        processed_message = self._process_weather_alert(message_dict)

        # Create and return ParsedWeatherAlert object
        return ParsedWeatherAlert(**processed_message)

    def _process_weather_alert(self, message: Dict) -> Dict:
        """Process a weather alert message using WeatherAlerts logic.

        This method uses the WeatherAlerts.process_message method
        to process the weather alert data.

        Args:
            message: Dictionary containing message data

        Returns:
            Dictionary with processed weather alert data
        """
        # Use the WeatherAlerts instance to process the message
        processed_message = self.weather_alerts.process_message(message)

        # Ensure all required fields for ParsedWeatherAlert are present
        required_parsed_fields = ["id", "text", "created_at", "sender_id"]
        for field in required_parsed_fields:
            if field not in processed_message:
                if field in message:
                    processed_message[field] = message[field]
                else:
                    logger.warning(
                        f"Missing required field '{field}' in processed message"
                    )

        # Keep id field as is - database schema expects 'id' column
        # No need to convert to msg_id

        logger.debug(f"Processed weather alert: {processed_message}")

        return processed_message
