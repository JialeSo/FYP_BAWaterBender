import logging
from fastapi import APIRouter, Request
from etl.pub.weather_alerts import weather_alerts
from common.db import db

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/weather-alerts", tags=["weather-alerts"])


@router.post("/webhook")
async def weather_alerts_webhook(request: Request):
    data = await request.json()
    try:
        weather_alerts._save_message(db=db, message=data)
        return {"status": "ok"}
    except Exception as e:
        logger.error("❌ Error processing message:", e)
        return {"status": "error", "detail": str(e)}
