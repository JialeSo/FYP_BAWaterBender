import os
from typing import List, Dict
from telethon import TelegramClient, events
import asyncio
import logging
from dotenv import load_dotenv

from .constants import PUB_CHANNEL_USERNAME

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


class WeatherAlertsETL:
    def __init__(self):
        api_id = os.getenv("TELE_API_ID", None)
        api_hash = os.getenv("TELE_API_HASH", None)

        self.client = TelegramClient("session", api_id, api_hash)
        self.phone = os.getenv("TELE_PHONE_NO", None)
        self.channel_username = PUB_CHANNEL_USERNAME

        missing_vars = []
        if not api_id:
            missing_vars.append("TELE_API_ID")
        if not api_hash:
            missing_vars.append("TELE_API_HASH")
        if not self.phone:
            missing_vars.append("TELE_PHONE_NO")
        if not self.channel_username:
            missing_vars.append("PUB_CHANNEL_USERNAME")

        if missing_vars:
            raise ValueError(
                f"Missing required environment variables: {', '.join(missing_vars)}"
            )
        logger.info("WeatherAlertsETL initialized")

    async def extract_existing_messages(self, limit: int = 100) -> List[Dict]:
        """Extract existing messages from a channel"""
        messages = []
        await self.client.start(phone=self.phone)

        try:
            async for message in self.client.iter_messages(
                self.channel_username, limit=limit
            ):
                if message.text:
                    messages.append(
                        {
                            "id": message.id,
                            "text": message.text,
                            "date": message.date.isoformat(),
                            "sender_id": message.sender_id,
                        }
                    )
            logger.info(
                f"Extracted {len(messages)} messages from {self.channel_username}"
            )

            logger.debug(
                f"Sample message: {messages[0] if messages else 'No messages found'}"
            )
        except Exception as e:
            logger.error(f"Error extracting messages: {e}")

        return messages

    async def start_live_monitoring(self, callback_func=None):
        """Monitor channel for new messages"""
        await self.client.start(phone=self.phone)

        @self.client.on(events.NewMessage(chats=self.channel_username))
        async def handler(event):
            message_data = {
                "id": event.message.id,
                "text": event.message.text,
                "date": event.message.date.isoformat(),
                "sender_id": event.message.sender_id,
            }

            if callback_func:
                await callback_func(message_data)
            else:
                logger.info(f"New message: {message_data}")

        logger.info(f"Started monitoring {self.channel_username}")
        await self.client.run_until_disconnected()


if __name__ == "__main__":
    # Run historical extraction
    scraper = WeatherAlertsETL()
    asyncio.run(scraper.extract_existing_messages())

    # Run live monitoring
    # asyncio.run(monitor_new_messages())
