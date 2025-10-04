# Create top-level API router
from fastapi import APIRouter

from .weather_alerts.weather_alerts_router import (
    router as weather_alerts_router,
)


api_router = APIRouter(prefix="/api")

# Include weather alerts router
api_router.include_router(weather_alerts_router)
