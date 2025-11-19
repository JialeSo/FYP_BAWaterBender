import os
import asyncio
import logging
import json
import httpx
from typing import Dict, Optional
from datetime import datetime

from config.config import (
    PUB_CHANNEL_USERNAME,
    PUB_CREDENTIALS_BUCKET,
    SERVER_URL,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
)
from .pub_utils import parse_alert
from telethon import TelegramClient, events
from dotenv import load_dotenv
from supabase import create_client, Client


load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class WeatherAlerts:
    def __init__(self):
        """Initialize configuration and load environment variables"""
        self.api_id = os.getenv("TELE_API_ID")
        self.api_hash = os.getenv("TELE_API_HASH")
        self.bot_token = os.getenv("PUB_TELE_BOT_TOKEN")
        self.channel_username = PUB_CHANNEL_USERNAME
        self.phone = os.getenv("TELE_PHONE_NO")

        missing_vars = []
        if not self.api_id:
            missing_vars.append("TELE_API_ID")
        if not self.api_hash:
            missing_vars.append("TELE_API_HASH")
        if not self.channel_username:
            missing_vars.append("PUB_CHANNEL_USERNAME")
        if not self.phone:
            missing_vars.append("TELE_PHONE_NO")

        if missing_vars:
            raise ValueError(
                f"Missing required environment variables: " f"{', '.join(missing_vars)}"
            )

        # Defer client creation until needed in async context
        self._client = None
        self._session_path = os.path.join("/tmp", "session")
        self._loop = None  # Track the event loop

        logger.info(f"Telegram Client subscribed to {self.channel_username}")

    async def _get_client(self) -> TelegramClient:
        """Get or create TelegramClient in the current async context"""
        current_loop = asyncio.get_event_loop()

        # Recreate client if event loop has changed or client doesn't exist
        if self._client is None or self._loop != current_loop:
            # Disconnect old client if it exists and loop changed
            if self._client is not None and self._loop != current_loop:
                logger.info("🔄 Event loop changed, recreating TelegramClient")
                try:
                    if self._client.is_connected():
                        await self._client.disconnect()
                except Exception as e:
                    logger.warning(f"Error disconnecting old client: {e}")
                self._client = None

            # Check if session file exists, download if needed
            session_file = f"{self._session_path}.session"
            if not os.path.exists(session_file):
                logger.info("🔄 Session file not found, " "retrieving from storage...")
                self.get_credentials_from_storage()
            else:
                logger.info("✅ Using cached session file from /tmp")

            # Create client in the current event loop context
            # Note: api_id is int, api_hash is string (hexadecimal)
            # These are guaranteed to be non-None by __init__ validation
            self._client = TelegramClient(
                self._session_path,
                int(self.api_id),  # type: ignore
                self.api_hash,  # type: ignore
            )
            self._loop = current_loop
            logger.info("✅ TelegramClient initialized in current event loop")

        return self._client

    async def extract_existing_messages(self, limit: int = 100) -> None:
        """Extract existing messages from a channel"""
        messages = []
        client = await self._get_client()

        if not client.is_connected():
            await client.connect()

        if not await client.is_user_authorized():
            if self.phone:
                await client.start(phone=self.phone)
            else:
                logger.error("Phone number not provided for authorization")
                return

        try:
            async for message in client.iter_messages(
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

    async def extract_all_messages(self, batch_size: int = 1000) -> Dict[str, any]:
        """
        Extract ALL existing messages from a channel in batches.

        This method first queries the total message count, then extracts
        all messages in batches to avoid memory issues and API rate limits.

        Args:
            batch_size: Number of messages to fetch per batch (default: 1000)

        Returns:
            Dict containing total count, extracted count, and batch details
        """
        client = await self._get_client()

        if not client.is_connected():
            await client.connect()

        if not await client.is_user_authorized():
            if self.phone:
                await client.start(phone=self.phone)
            else:
                logger.error("Phone number not provided for authorization")
                return {
                    "total_messages": 0,
                    "extracted_messages": 0,
                    "batches_processed": 0,
                    "error": "Phone number not provided for authorization",
                }

        try:
            # Get the channel entity
            channel = await client.get_entity(self.channel_username)

            # Get total message count
            # Note: This gets the last message ID which approximates total count
            total_count = 0
            first_message = None
            async for msg in client.iter_messages(channel, limit=1):
                first_message = msg
                total_count = msg.id
                break

            logger.info(
                f"📊 Channel {self.channel_username} has approximately "
                f"{total_count} messages (based on last message ID)"
            )

            extracted_count = 0
            batches_processed = 0
            messages_batch = []

            # Extract all messages in batches
            async for message in client.iter_messages(
                channel, limit=None  # No limit - get all messages
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
                    messages_batch.append(message_data)
                    extracted_count += 1

                    # Log progress every batch_size messages
                    if extracted_count % batch_size == 0:
                        batches_processed += 1
                        logger.info(
                            f"📥 Progress: {extracted_count} messages extracted "
                            f"({batches_processed} batches)"
                        )

            # Log final count
            batches_processed = (extracted_count // batch_size) + (
                1 if extracted_count % batch_size > 0 else 0
            )
            logger.info(
                f"✅ Extraction complete! Total: {extracted_count} messages "
                f"extracted in {batches_processed} batches"
            )

            return {
                "total_messages": total_count,
                "extracted_messages": extracted_count,
                "batches_processed": batches_processed,
                "batch_size": batch_size,
            }

        except Exception as e:
            logger.error(f"❌ Error extracting all messages: {e}")
            return {
                "total_messages": 0,
                "extracted_messages": 0,
                "batches_processed": 0,
                "error": str(e),
            }

    async def extract_recent_messages(
        self, hours: int = 24, webhook_url: Optional[str] = None
    ) -> list[Dict]:
        """
        Extract messages from the last N hours.
        Perfect for cron jobs to periodically fetch new messages.

        Args:
            hours: Number of hours to look back (default: 24)
            webhook_url: Optional webhook URL to forward messages to

        Returns:
            List of message dictionaries
        """
        messages = []
        client = await self._get_client()

        if not client.is_connected():
            await client.connect()

        if not await client.is_user_authorized():
            if self.phone:
                await client.start(phone=self.phone)
            else:
                logger.error("Phone number not provided for authorization")
                return messages

        try:
            from datetime import timedelta, timezone

            # Calculate the time threshold (timezone-aware)
            time_threshold = datetime.now(timezone.utc) - timedelta(hours=hours)
            logger.info(
                f"🔍 Fetching messages from {self.channel_username} "
                f"since {time_threshold.isoformat()}"
            )

            # Iterate through messages until we hit the time threshold
            async for message in client.iter_messages(
                self.channel_username, limit=None
            ):
                # Stop if message is older than threshold
                if message.date < time_threshold:
                    break

                if message.text:
                    message_data = {
                        "id": message.id,
                        "text": message.text,
                        "created_at": message.date.isoformat(),
                        "sender_id": message.sender_id,
                    }
                    messages.append(message_data)

                    # Optionally forward to webhook
                    if webhook_url:
                        try:
                            async with httpx.AsyncClient(timeout=10) as client:
                                response = await client.post(
                                    webhook_url, json=message_data
                                )
                                response.raise_for_status()
                                logger.info(
                                    f"✅ Forwarded message {message.id} " f"to webhook"
                                )
                        except Exception as e:
                            logger.error(
                                f"❌ Failed to forward message {message.id}: " f"{e}"
                            )

            logger.info(
                f"✅ Extracted {len(messages)} messages from last {hours} hours"
            )
            return messages

        except Exception as e:
            logger.error(f"❌ Error extracting recent messages: {e}")
            return messages
        # No finally block - keep connection alive for singleton

    async def extract_and_save_recent_messages(self, hours: int = 24) -> list[Dict]:
        """
        Extract messages from the last N hours and save them to database.
        Designed for cron jobs - handles full lifecycle including DB writes.

        Args:
            hours: Number of hours to look back (default: 24)

        Returns:
            List of processed message dictionaries
        """
        messages = []
        client = await self._get_client()

        if not client.is_connected():
            await client.connect()

        if not await client.is_user_authorized():
            if self.phone:
                await client.start(phone=self.phone)
            else:
                logger.error("Phone number not provided for authorization")
                return messages

        try:
            from datetime import timedelta, timezone
            from etl.pub.weather_alerts_pipeline import (
                WeatherAlertsPipeline,
            )

            # Calculate the time threshold (timezone-aware)
            time_threshold = datetime.now(timezone.utc) - timedelta(hours=hours)
            logger.info(
                f"🔍 Fetching messages from {self.channel_username} "
                f"since {time_threshold.isoformat()}"
            )

            # Initialize pipeline for processing
            config = {
                "continue_on_error": True,
                "weather_processing": {},
                "location_geocoding": {},
                "database_write": {},
            }
            pipeline = WeatherAlertsPipeline(
                config=config, db_table="PUB_weather_alerts"
            )

            # Iterate through messages until we hit the time threshold
            raw_messages = []
            async for message in client.iter_messages(
                self.channel_username, limit=None
            ):
                # Stop if message is older than threshold
                if message.date < time_threshold:
                    break

                if message.text:
                    message_data = {
                        "id": message.id,
                        "text": message.text,
                        "created_at": message.date.isoformat(),
                        "sender_id": message.sender_id,
                    }
                    raw_messages.append(message_data)

            logger.info(f"📥 Extracted {len(raw_messages)} messages from Telegram")

            # Process all messages through the pipeline
            if raw_messages:
                logger.info("🔄 Processing messages through pipeline...")
                result = await pipeline.process_weather_alerts(raw_messages)
                messages = raw_messages
                logger.info(
                    f"✅ Successfully processed and saved " f"{len(messages)} messages"
                )
            else:
                logger.info("ℹ️  No new messages found in the time range")

            return messages

        except Exception as e:
            logger.error(f"❌ Error in extract_and_save_recent_messages: {e}")
            return messages
        # No finally block - keep connection alive for singleton

    async def start_live_monitoring(self):
        """Monitor channel for new messages"""
        url = SERVER_URL or "http://localhost:8000"
        WEBHOOK_URL = f"{url}/weather-alerts/webhook"

        client = await self._get_client()

        try:
            # Start the client with phone parameter - this handles authentication automatically
            await client.start(
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
        @client.on(events.NewMessage(chats=self.channel_username))
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
        await client.run_until_disconnected()

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

    def get_credentials_from_storage(self) -> None:
        """Retrieve stored credentials for Telegram client from Supabase.

        Downloads the session file named 'session.session_{phone_number}' from
        Supabase storage and stores it as 'session.session' in the backend
        directory.
        """
        try:
            if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
                logger.error("Missing Supabase configuration")
                return

            # Initialize Supabase client
            supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

            # Check if phone number is available
            if not self.phone:
                logger.error("Phone number not available")
                return

            # Clean phone number (remove any non-numeric characters except +)
            clean_phone = (
                self.phone.replace(" ", "")
                .replace("-", "")
                .replace("(", "")
                .replace(")", "")
            )
            if clean_phone.startswith("+"):
                clean_phone = clean_phone[1:]  # Remove the + sign

            # Construct the session filename in storage
            session_filename = f"session.session_{clean_phone}"
            logger.info(f"Attempting to download session file: " f"{session_filename}")

            # Download the session file from Supabase storage
            response = supabase.storage.from_(PUB_CREDENTIALS_BUCKET).download(
                session_filename
            )

            if response:
                # Use /tmp directory for session file in serverless environments
                # (read-only filesystem except /tmp in Vercel, AWS Lambda, etc.)
                session_file_path = os.path.join("/tmp", "session.session")

                # Write the downloaded content to session.session
                with open(session_file_path, "wb") as f:
                    f.write(response)

                logger.info(
                    f"Session file successfully downloaded and "
                    f"stored at: {session_file_path}"
                )
            else:
                logger.warning(
                    f"Session file {session_filename} not found " f"in storage"
                )

        except Exception as e:
            logger.error(f"Error retrieving session from storage: {e}")
            # Don't raise the exception, just log it as function returns None


weather_alerts = WeatherAlerts()

if __name__ == "__main__":
    # Run historical extraction
    scraper = WeatherAlerts()
    asyncio.run(scraper.extract_existing_messages(limit=1))

    # Run live monitoring
    # asyncio.run(monitor_new_messages())
