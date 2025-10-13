# Create top-level API router
from fastapi import APIRouter

from .weather_alerts.weather_alerts_router import (
    router as weather_alerts_router,
)

from .floods_3layers_router import router as flood3layers_router
from .amenity_3layers_router import router as amenity3layers_router

api_router = APIRouter(prefix="/api")

# Include weather alerts router
api_router.include_router(weather_alerts_router)
api_router.include_router(flood3layers_router)
api_router.include_router(amenity3layers_router)
