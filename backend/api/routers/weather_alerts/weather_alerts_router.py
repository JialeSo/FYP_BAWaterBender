import logging
from fastapi import APIRouter, Request, HTTPException
from api.controllers.weather_alerts_controller import weather_alerts_controller

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/weather-alerts", tags=["weather-alerts"])


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


@router.post("/process")
async def process_weather_alerts(request: Request):
    """Endpoint for processing weather alerts through the pipeline.

    Accepts single message or array of messages.
    """
    try:
        data = await request.json()

        if isinstance(data, list):
            # Process multiple alerts
            result = await weather_alerts_controller.process_multiple_alerts(data)
        else:
            # Process single alert
            result = await weather_alerts_controller.process_weather_alert(data)

        return result

    except Exception as e:
        logger.error(f"Error processing weather alerts: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error processing weather alerts: {str(e)}"
        )


@router.get("/pipeline/status")
async def get_pipeline_status():
    """Get the current status of the weather alerts pipeline."""
    try:
        status = weather_alerts_controller.get_pipeline_status()
        return status

    except Exception as e:
        logger.error(f"Error getting pipeline status: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error getting pipeline status: {str(e)}"
        )


@router.post("/pipeline/config")
async def set_pipeline_config(request: Request):
    """Set configuration for the weather alerts pipeline."""
    try:
        config = await request.json()
        weather_alerts_controller.set_pipeline_config(config)

        return {
            "status": "success",
            "message": "Pipeline configuration updated successfully",
        }

    except Exception as e:
        logger.error(f"Error setting pipeline config: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error setting pipeline config: {str(e)}"
        )
