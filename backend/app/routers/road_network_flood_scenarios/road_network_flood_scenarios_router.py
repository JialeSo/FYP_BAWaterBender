import logging
from fastapi import APIRouter, Request, HTTPException
from common.db import db


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/road-network-flood-scenarios")

# get all subzone data
@router.get("/")
async def get_all_amenity_categories():  
    try:
        result = db.table("road_network_flood_scenarios").select("*").execute()

        if result.data:
            return {"data": result.data, "count": len(result.data)}
        else:
            return {"data": [], "count": 0}
            
    except Exception as e:
        logger.error(f"❌ Error fetching road network flood scenarios data: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")