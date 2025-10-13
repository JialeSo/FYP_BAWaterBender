import logging
from fastapi import APIRouter, Request, HTTPException
from common.db import db

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/road-network", tags=["road-network"])  # Fixed: was "/weather-alerts"


# get all road network data
@router.get("/")
async def get_all_road_network_data():  
    try:
        result = db.table("road_network").select("*").execute()

        if result.data:
            return {"data": result.data, "count": len(result.data)}
        else:
            return {"data": [], "count": 0}
            
    except Exception as e:
        logger.error(f"❌ Error fetching road_network data: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")