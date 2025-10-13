import os
import json
import asyncio
import logging
from datetime import datetime
from typing import Dict, Optional

from config.config import PUB_CHANNEL_USERNAME, SERVER_URL
from .pub_utils import parse_alert
from telethon import TelegramClient, events
from dotenv import load_dotenv
import httpx


load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class WeatherAlerts:
    def __init__(self):
        """Initialize Telegram client and load environment variables"""
        api_id = os.getenv("TELE_API_ID")
        api_hash = os.getenv("TELE_API_HASH")
        self.bot_token = os.getenv("PUB_TELE_BOT_TOKEN")
        self.channel_username = PUB_CHANNEL_USERNAME
        self.phone = os.getenv("TELE_PHONE_NO")

        missing_vars = []
        if not api_id:
            missing_vars.append("TELE_API_ID")
        if not api_hash:
            missing_vars.append("TELE_API_HASH")
        if not self.channel_username:
            missing_vars.append("PUB_CHANNEL_USERNAME")
        if not self.phone:
            missing_vars.append("TELE_PHONE_NO")

        if missing_vars:
            raise ValueError(
                f"Missing required environment variables: " f"{', '.join(missing_vars)}"
            )

        # At this point we know api_id and api_hash are not None
        assert api_id is not None
        assert api_hash is not None

        self.client = TelegramClient("session", int(api_id), api_hash)

        logger.info(f"Using channel: {self.channel_username}")

        logger.info(
            f"WeatherAlertsETL initialized. " f"Listening on {self.channel_username}"
        )

        # Log environment variables being used (without exposing sensitive values)
        logger.info("Environment variables being used:")
        logger.info(f"TELE_API_ID: {'✓ Set' if api_id else '✗ Missing'}")
        logger.info(f"TELE_API_HASH: {'✓ Set' if api_hash else '✗ Missing'}")
        logger.info(f"PUB_TELE_BOT_TOKEN: {'✓ Set' if self.bot_token else '✗ Missing'}")
        logger.info(f"PUB_CHANNEL_USERNAME: {self.channel_username}")
        logger.info(
            f"LOCATIONIQ_KEY: {'✓ Set' if os.getenv('LOCATIONIQ_KEY') else '✗ Missing'}"
        )
        logger.info(f"SERVER_URL: {SERVER_URL}")

    async def extract_existing_messages(self, limit: int = 100) -> None:
        """Extract existing messages from a channel"""
        messages = []
        if not self.client.is_connected():
            await self.client.connect()

        if not await self.client.is_user_authorized():
            if self.phone:
                self.client.start(phone=self.phone)
            else:
                logger.error("Phone number not provided for authorization")
                return

        try:
            async for message in self.client.iter_messages(
                self.channel_username, limit=limit
            ):
                if message.text:
                    message_data = {
                        "id": message.id,
                        "text": message.text,
                        "created_at": message.date.isoformat(),
                        "sender_id": message.sender_id,
                    }
                    self._save_message(
                        message=message_data,
                        dir="./etl/pub",
                    )
                    messages.append(message_data)
            logger.info(
                f"Extracted {len(messages)} messages from " f"{self.channel_username}"
            )

            logger.debug(
                f"Sample message: "
                f"{messages[0] if messages else 'No messages found'}"
            )
        except Exception as e:
            logger.error(f"Error extracting messages: {e}")

    async def start_live_monitoring(self):
        """Monitor channel for new messages"""
        url = SERVER_URL or "http://localhost:8000"
        WEBHOOK_URL = f"{url}/weather-alerts/webhook"

        try:
            # Start the client with phone parameter - this handles authentication automatically
            await self.client.start(
                phone=self.phone,
                code_callback=lambda: input(
                    "Please enter the verification code you received: "
                ),
            )

            logger.info("✅ Authentication successful, starting monitoring...")

        except Exception as e:
            logger.error(f"❌ Error starting client: {e}")
            return

        # Set up message handler
        @self.client.on(events.NewMessage(chats=self.channel_username))
        async def handler(event):
            data = {
                "id": event.message.id,
                "sender_id": event.sender_id,
                "text": event.message.message,
                "created_at": event.message.date.isoformat(),
            }
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    response = await client.post(WEBHOOK_URL, json=data)
                    logger.info(f"Webhook response: {response.status_code}")
                    response.raise_for_status()
                logger.info(f"✅ Forwarded message to webhook: {data['id']}")
            except httpx.HTTPError as e:
                msg_id = data["id"]
                logger.error(f"❌ HTTP error for message {msg_id}: {e}")
            except Exception as e:
                msg_id = data["id"]
                logger.error(f"❌ Failed webhook for message {msg_id}: {e}")

        logger.info(f"📡 Now monitoring {self.channel_username} for new messages...")

        # Keep the client running
        await self.client.run_until_disconnected()

    def _save_message(
        self,
        message: Dict,
        dir: Optional[str] = "./",
    ) -> None:
        """Process and optionally save message to file"""
        logger.info(f"Processing message: {message}")

        # Process the message using the shared logic
        processed_message = self.process_message(message)

        # Create messages directory if it doesn't exist
        if dir:
            dir = os.path.join(dir, "messages")
            os.makedirs(dir, exist_ok=True)

            # Save message to a single JSON file
            filename = f"{dir}/all_messages.json"

            # Read existing messages if file exists
            messages = []
            if os.path.exists(filename):
                try:
                    with open(filename, "r", encoding="utf-8") as f:
                        messages = json.load(f)
                except json.JSONDecodeError:
                    messages = []

            messages.append(processed_message)

            # Write all messages back to file
            with open(filename, "w", encoding="utf-8") as f:
                json.dump(messages, f, indent=2, ensure_ascii=False)
            logger.info(f"Message appended to {filename}")

    def process_message(self, message: Dict) -> Dict:
        """Process a weather alert message and return the processed data.

        This method processes the message without saving to file or database,
        making it suitable for use in pipelines.

        Args:
            message: Dictionary containing message data

        Returns:
            Processed message dictionary with parsed alert information
        """
        logger.info(f"Processing message: {message}")

        # Convert created_at string back to datetime object before parsing
        alert_datetime = message["created_at"]
        if isinstance(alert_datetime, str):
            # Parse ISO format string back to datetime with proper timezone
            alert_datetime = datetime.fromisoformat(
                alert_datetime.replace("Z", "+00:00")
            )
            # Ensure we have timezone information
            if alert_datetime.tzinfo is None:
                from datetime import timezone
                alert_datetime = alert_datetime.replace(tzinfo=timezone.utc)
        elif isinstance(alert_datetime, datetime) and alert_datetime.tzinfo is None:
            # If datetime object has no timezone, assume UTC
            from datetime import timezone
            alert_datetime = alert_datetime.replace(tzinfo=timezone.utc)

        # parse message
        parsed_msg = parse_alert(message["text"], alert_datetime)

        # Create a copy to avoid modifying the original message
        processed_message = message.copy()

        # Flatten parsed_msg into the message dict
        processed_message.update(parsed_msg)

        # Keep created_at field as is - no need to rename to event_date_time
        # The database schema expects 'created_at' directly

        return processed_message


weather_alerts = WeatherAlerts()

if __name__ == "__main__":
    # Run historical extraction
    scraper = WeatherAlerts()
    asyncio.run(scraper.extract_existing_messages(limit=1))

    # Run live monitoring
    # asyncio.run(monitor_new_messages())
