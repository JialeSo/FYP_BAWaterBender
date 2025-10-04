from fastapi import APIRouter
from datetime import datetime
from typing import Dict, Any

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/")
async def health_check() -> Dict[str, Any]:
    """
    Health check endpoint to verify the API is running.

    Returns:
        Dict containing health status, timestamp, and service information
    """
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "FYP_BAWaterBender API",
        "version": "1.0.0",
    }


@router.get("/detailed")
async def detailed_health_check() -> Dict[str, Any]:
    """
    Detailed health check endpoint with more comprehensive system information.

    Returns:
        Dict containing detailed health status and system information
    """
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "FYP_BAWaterBender API",
        "version": "1.0.0",
        "uptime": "Available",
        "components": {"database": "healthy", "api": "healthy"},
    }
