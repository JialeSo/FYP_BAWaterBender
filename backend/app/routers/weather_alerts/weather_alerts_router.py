import logging
from typing import Optional
from fastapi import APIRouter, Request, HTTPException, Header
from pydantic import BaseModel
from app.controllers.weather_alerts_controller import weather_alerts_controller

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/weather-alerts", tags=["weather-alerts"])


class WeatherAlertProcessResponse(BaseModel):
    """Response model for cron job endpoints"""

    success: bool
    message: str
    messages_processed: int


@router.post("/webhook")
async def weather_alerts_webhook(request: Request):
    """Webhook endpoint for receiving weather alert messages.

    Processes messages through the WeatherAlertsPipeline and saves to database.
    Throws an error if pipeline processing fails.
    """
    try:
        data = await request.json()
        msg_id = data.get("id", "unknown")
        logger.info(f"Received weather alert webhook: {msg_id}")

        # Process through the pipeline
        result = await weather_alerts_controller.process_weather_alert(data)
        return result

    except Exception as e:
        logger.error(f"Error processing weather alert: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to process weather alert message: {str(e)}"
        )


@router.get("/cron/recent-messages", response_model=WeatherAlertProcessResponse)
async def fetch_weather_alerts_cron(
    hours: int = 24,
):
    """
    Cron job endpoint to fetch and process weather alerts.

    Designed for Vercel Cron Jobs. Fetches messages from Telegram
    from the last N hours and processes them through the pipeline.

    Parameters:
    - hours: Number of hours to look back (default: 24)
    - authorization: Optional authorization header for security

    Returns:
    - JSON object with success status and message count

    Usage in vercel.json:
    ```json
    {
      "crons": [{
        "path": "/api/weather-alerts/cron",
        "schedule": "0 0 * * *"
      }]
    }
    ```
    """

    try:
        # Fetch and process through controller
        result = await weather_alerts_controller.fetch_and_process_recent_alerts(
            hours=hours
        )

        return WeatherAlertProcessResponse(
            success=result["status"] == "success",
            message=result["message"],
            messages_processed=result["messages_processed"],
        )

    except Exception as e:
        logger.error(f"❌ Cron job failed: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch weather alerts: {str(e)}"
        )


@router.post("/backfill-messages", response_model=WeatherAlertProcessResponse)
async def backfill_weather_alerts(
    limit: int = 100,
):
    """
    Endpoint to extract and load historical messages from Telegram to Supabase.

    Fetches the last N messages from the channel and processes them through
    the pipeline to save to the database. Useful for initial setup or backfilling data.

    Parameters:
    - limit: Number of messages to fetch (default: 100)

    Returns:
    - JSON object with success status and message count
    """

    try:
        # Fetch and process through controller
        result = await weather_alerts_controller.backfill_historical_alerts(limit=limit)

        return WeatherAlertProcessResponse(
            success=result["status"] == "success",
            message=result["message"],
            messages_processed=result["messages_processed"],
        )

    except Exception as e:
        logger.error(f"❌ Backfill failed: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to backfill weather alerts: {str(e)}"
        )


@router.get("/extract-messages")
async def extract_existing_messages(
    limit: int = 100,
):
    """
    GET endpoint to extract existing messages from Telegram channel.

    Fetches the last N messages from the Telegram channel and saves them to JSON files.
    This endpoint extracts messages without processing them through the pipeline.

    Parameters:
    - limit: Number of messages to fetch (default: 100)

    Returns:
    - JSON object with success status and extraction details
    """

    try:
        # Extract messages through controller
        result = await weather_alerts_controller.extract_existing_messages(limit=limit)

        return {
            "success": result["status"] == "success",
            "message": result["message"],
            "limit": result["limit"],
        }

    except Exception as e:
        logger.error(f"❌ Message extraction failed: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to extract messages: {str(e)}"
        )
