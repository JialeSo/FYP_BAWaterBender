from fastapi import APIRouter, HTTPException
from datetime import datetime
from typing import Dict, Any

# Local DB access
from common.db import db

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


@router.get("/keep-alive")
async def keep_alive() -> Dict[str, Any]:
    """
    Lightweight health endpoint that verifies basic connectivity to the
    flood data table. Returns success if the flood table can be queried.
    """
    try:
        # Try a small, inexpensive query to ensure the flood table is accessible.
        # We select the `id` column only to minimise payload.
        result = db.table("flood_3layers").select("id").execute()

        # supabase client returns a response with `.data` (list) on success
        data_count = len(result.data) if getattr(result, "data", None) else 0

        return {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "service": "FYP_BAWaterBender API",
            "flood_table_accessible": True,
            "flood_table_sample_count": data_count,
        }

    except Exception as e:
        # If the DB lookup fails, surface an error so monitoring can alert.
        raise HTTPException(
            status_code=500, detail=f"Flood table access error: {str(e)}"
        )
