import logging
from fastapi import APIRouter, Request, HTTPException
from common.db import db

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/subzone", tags=["subzone"])  # Fixed: was "/weather-alerts"


# get all subzone data
@router.get("/")
async def get_all_subzone_data():  
    try:
        result = db.table("subzone").select("*").execute()

        if result.data:
            return {"data": result.data, "count": len(result.data)}
        else:
            return {"data": [], "count": 0}
            
    except Exception as e:
        logger.error(f"❌ Error fetching subzone data: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")