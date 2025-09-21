import os
import requests
from typing import Dict, List, Optional, Union

from common.db import DatabaseConnection
from .utils import parse_alert
from telethon import TelegramClient, events
import asyncio
import logging
from dotenv import load_dotenv
import httpx

from .constants import PUB_CHANNEL_USERNAME, SERVER_URL
import json


load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class WeatherAlerts:
    def __init__(self):
        """Initialize Telegram client and load environment variables"""
        api_id = os.getenv("TELE_API_ID", None)
        api_hash = os.getenv("TELE_API_HASH", None)

        self.channel_username = PUB_CHANNEL_USERNAME
        self.phone = os.getenv("TELE_PHONE_NO", None)
        self.client = TelegramClient("session", api_id, api_hash)

        missing_vars = []
        if not api_id:
            missing_vars.append("TELE_API_ID")
        if not api_hash:
            missing_vars.append("TELE_API_HASH")
        if not self.phone:
            missing_vars.append("TELE_PHONE_NO")
        if not self.channel_username:
            missing_vars.append("PUB_CHANNEL_USERNAME")

        logger.info(f"Using channel: {self.channel_username}")

        if missing_vars:
            raise ValueError(
                f"Missing required environment variables: {', '.join(missing_vars)}"
            )
        logger.info("WeatherAlertsETL initialized")

    async def extract_existing_messages(
        self, save_to_db: bool = False, limit: int = 100
    ) -> None:
        """Extract existing messages from a channel"""
        messages = []
        await self.client.start(phone=self.phone)

        try:
            async for message in self.client.iter_messages(
                self.channel_username, limit=limit
            ):
                if message.text:
                    message_data = {
                        "id": message.id,
                        "text": message.text,
                        "date": message.date.isoformat(),
                        "sender_id": message.sender_id,
                    }
                    self._save_message(
                        message=message_data,
                        dir="./etl/pub",
                    )
                    messages.append(message_data)
            logger.info(
                f"Extracted {len(messages)} messages from {self.channel_username}"
            )

            logger.debug(
                f"Sample message: {messages[0] if messages else 'No messages found'}"
            )
        except Exception as e:
            logger.error(f"Error extracting messages: {e}")

    async def start_live_monitoring(self):
        """Monitor channel for new messages"""

        url = SERVER_URL or "http://localhost:8000"
        WEBHOOK_URL = f"{url}/weather-alerts/webhook"
        await self.client.start(phone=self.phone)

        @self.client.on(events.NewMessage(chats=self.channel_username))
        async def handler(event):
            data = {
                "id": event.chat_id,
                "sender_id": event.sender_id,
                "text": event.message.message,
                "date": str(event.message.date),
            }
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    await client.post(WEBHOOK_URL, json=data)
                logger.debug(f"✅ Forwarded message: {data['text']}")
            except Exception as e:
                logger.error("❌ Failed to send webhook:", e)

        # Keep the client running
        await self.client.run_until_disconnected()

    def _save_message(
        self,
        message: Dict,
        dir: Optional[str] = "./",
        db: Optional[DatabaseConnection] = None,
    ) -> None:
        """Placeholder function to save message to a database"""
        logger.info(f"Saving message to database: {message}")

        # Convert date string back to datetime object before parsing
        alert_datetime = message["date"]
        if isinstance(alert_datetime, str):
            # Parse ISO format string back to datetime
            from datetime import datetime

            alert_datetime = datetime.fromisoformat(
                alert_datetime.replace("Z", "+00:00")
            )

        # parse message
        parsed_msg = parse_alert(message["text"], alert_datetime)

        # Flatten parsed_msg into the initial message dict
        message.update(parsed_msg)

        # Rename date field to date_time for consistency
        if "date" in message:
            message["event_date_time"] = message.pop("date")

        if db:
            try:
                self._save_message_to_db(db=db, messages=message)
            except Exception as e:
                logger.error(f"Error saving message to DB: {e}")
        # Create messages directory if it doesn't exist
        elif dir:
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

            messages.append(message)

            # Write all messages back to file
            with open(filename, "w", encoding="utf-8") as f:
                json.dump(parsed_msg, f, indent=2, ensure_ascii=False)
            logger.info(f"Message appended to {filename}")

    def _save_message_to_db(
        self, messages: Union[Dict, List], db: DatabaseConnection
    ) -> None:
        """Save message to PostgreSQL database"""
        logger.info(f"Saving message to database: {messages}")
        try:

            table = "PUB_weather_alerts"
            # Convert id field to msg_id for database consistency
            if isinstance(messages, dict):
                messages = dict(messages)  # Create a copy to avoid modifying original
                if "id" in messages:
                    messages["msg_id"] = messages.pop("id")
            elif isinstance(messages, list):
                messages = [dict(msg) for msg in messages]  # Create copies
                for msg in messages:
                    if "id" in msg:
                        msg["msg_id"] = msg.pop("id")

            logger.debug(f"Saving to table {table}: {messages}")
            logger.debug("dog;", messages)
            db.insert(table=table, data=messages)

            # Fix the variable reference issue - use msg_id instead of id
            if isinstance(messages, dict):
                logger.info(
                    f"Message {messages.get('msg_id', 'unknown')} saved to database successfully"
                )
            elif isinstance(messages, list):
                logger.info(f"{len(messages)} messages saved to database successfully")

            logger.info("✅ Message saved to database")
        except Exception as e:
            logger.error(f"Error saving message to database: {e}")
        finally:
            if db:
                db.close()


weather_alerts = WeatherAlerts()

if __name__ == "__main__":
    # Run historical extraction
    scraper = WeatherAlerts()
    asyncio.run(scraper.extract_existing_messages(save_to_db=True, limit=1))

    # Run live monitoring
    # asyncio.run(monitor_new_messages())
