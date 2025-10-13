import logging
from fastapi import APIRouter, Request, HTTPException
from common.db import db

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/floods-3layers", tags=["floods-3layers"])  # Fixed: was "/weather-alerts"


@router.get("/")
async def get_all_flood_data():  # Removed unused Request parameter
    try:
        # Query the flood3layers table
        result = db.table("floods_3layers").select("*").execute()
        
        if result.data:
            return {"data": result.data, "count": len(result.data)}
        else:
            return {"data": [], "count": 0}
            
    except Exception as e:
        logger.error(f"❌ Error fetching flood3layers data: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")