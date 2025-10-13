import logging
from fastapi import APIRouter, Request, HTTPException
from common.db import db

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/amenity-3layers", tags=["amenity-3layers"]) 

# helper functions
def clean_string(s): 
    return s.strip().upper() 

def handle_response(result):
    if result.data:
        return {"data": result.data, "count": len(result.data)}
    else:
        return {"data": [], "count": 0}
    
# get all amenity data
@router.get("/")
async def get_all_amenities():  
    try:
        result = db.table("amenity_3layers").select("*").execute()

        if result.data:
            return {"data": result.data, "count": len(result.data)}
        else:
            return {"data": [], "count": 0}
            
    except Exception as e:
        logger.error(f"❌ Error fetching amenity_3layers data: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    
# get amenity data by planning area
@router.get("/planning-area/{planning_area}")
async def get_amenities_by_planning_area(planning_area: str):  
    planning_area = clean_string(planning_area)
    try:
        filter_query = f"start_planning_area.eq.{planning_area},end_planning_area.eq.{planning_area}"

        # Query amenity by planning area
        result = db.table("amenity_3layers").select("*").or_(filter_query).execute()

        if not result.data:
            raise HTTPException(
                status_code=404,
                detail=f"Planning area '{planning_area}' not found in start_planning_area or end_planning_area. Please check the spelling and try again."
            )

        return handle_response(result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error fetching floods_3layers data by subzone: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

# get amenity data by subzone
@router.get("/subzone/{subzone}")
async def get_amenities_by_subzone(subzone: str):  
    subzone = clean_string(subzone)
    try:
        filter_query = f"start_subzone.eq.{subzone},end_subzone.eq.{subzone}"

        # Query amenity by subzone
        result = db.table("amenity_3layers").select("*").or_(filter_query).execute()

        if not result.data:
            raise HTTPException(
                status_code=404,
                detail=f"Subzone '{subzone}' not found in start_subzone or end_subzone records. Please check the spelling and try again."
            )

        return handle_response(result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error fetching amenity_3layers data by subzone: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

# get amenity data by nearest road name (checks all 3)
@router.get("/filter/nearest-road/{road_name}")
async def get_amenities_by_nearest_road(road_name: str):
    original_road_name = road_name
    road_name = clean_string(road_name)
    try:
        filter_query = f"nearest_road_1_name.eq.{road_name},nearest_road_2_name.eq.{road_name},nearest_road_3_name.eq.{road_name}"

        # Query amenity by nearest road name
        result = db.table("amenity_3layers").select("*").or_(filter_query).execute()
        
        if not result.data:
            raise HTTPException(
                status_code=404,
                detail=f"Road name '{original_road_name}' not found in nearest_road_1_name, nearest_road_2_name, and nearest_road_3_name. Please check the spelling and try again."
            )

        return handle_response(result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error fetching amenity_3layers data by nearest road name: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

# get amenity data by amenity_type
@router.get("/filter/amenity-type/{amenity_type}")  
async def get_amenities_by_amenity_type(amenity_type: str):
    original_amenity_type = amenity_type
    amenity_type = clean_string(amenity_type).lower()  # stored as lowercase in db
    try:
        result = db.table("amenity_3layers").select("*").eq("amenity_type", amenity_type).execute()
        
        if not result.data:
            raise HTTPException(
                status_code=404,
                detail=f"Amenity type '{original_amenity_type}' not found in amenity records. Please check the spelling and try again."
            )

        return handle_response(result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error fetching amenity_3layers data by amenity type: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

# get amenities by postal code
@router.get("/filter/postal-code/{postal_code}")
async def get_amenities_by_postal_code(postal_code: str):
        # check that postal code is a number
    if not postal_code.isdigit():
        raise HTTPException(status_code=400, detail="Invalid postal code format. Use numeric values only.")
    else:
        original_input = postal_code
        postal_code = str(postal_code)
    
    try:
        result = db.table("amenity_3layers").select("*").eq("postal_code", postal_code).execute()

        if not result.data:
            raise HTTPException(
                status_code=404,
                detail=f"Amenity records not found for postal code '{original_input}'. Please check the postal code and try again."
            )

        return handle_response(result)

    except Exception as e:
        logger.error(f"❌ Error fetching floods_3layers data by postal code: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

# footfall (pending)

# accessibility (pending)