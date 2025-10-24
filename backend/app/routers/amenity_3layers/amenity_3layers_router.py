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

def to_geojson(data):
    """
    Convert Supabase data to GeoJSON with validation.
    """
    if not data:
        return {
            "type": "FeatureCollection",
            "features": []
        }
    
    features = []
    
    for item in data:
        try:
            # Validate lat/lon exist and are valid numbers
            if "lat" not in item or "lon" not in item:
                print(f"Warning: Skipping item without lat/lon: {item.get('id')}")
                continue
            
            lat = item["lat"]
            lon = item["lon"]
            
            # Skip null values
            if lat is None or lon is None:
                print(f"Warning: Skipping item with null coordinates: {item.get('id')}")
                continue
            
            # Convert to float and validate range
            lat = float(lat)
            lon = float(lon)
            
            if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
                print(f"Warning: Invalid coordinates for item {item.get('id')}: lat={lat}, lon={lon}")
                continue
            
            feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [lon, lat]  # GeoJSON is [longitude, latitude]
                },
                "properties": {k: v for k, v in item.items() if k not in ["lon", "lat"]}
            }
            features.append(feature)
            
        except (ValueError, TypeError) as e:
            print(f"Error processing item {item.get('id')}: {e}")
            continue
    
    return {
        "type": "FeatureCollection",
        "features": features
    }
    
# # get all amenity data
# @router.get("/")
# async def get_all_amenities():  
#     try:
#         result = db.table("amenity_3layers").select("*").execute()

#         if result.data:
#             return {"data": result.data, "count": len(result.data)}
#         else:
#             return {"data": [], "count": 0}
            
#     except Exception as e:
#         logger.error(f"❌ Error fetching amenity_3layers data: {e}")
#         raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


######################
### json responses ###
######################

# get all amenity data based on columns
@router.get("/")
async def get_all_amenities():
    selected_columns = [
        "amenity_id",
        "amenity_type",
        "amenity_name",
        "postal_code", 
        "lon", 
        "lat",
        "amenity_planning_area_id",
        "amenity_subzone_id",
        "road_name"
    ]

    try:
        result = db.table("amenity_3layers").select(*selected_columns).execute()

        return handle_response(result)
            
    except Exception as e:
        logger.error(f"❌ Error fetching amenity_3layers data: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    
# get amenity data by planning area
@router.get("/planning-area/{planning_area}")
async def get_amenities_by_planning_area(planning_area: str):  
    planning_area = clean_string(planning_area)
    try:
        # Query amenity by planning area
        result = db.table("amenity_3layers").select("*").eq("planning_area", planning_area).execute()
        if not result.data:
            raise HTTPException(
                status_code=404,
                detail=f"Planning area '{planning_area}' not found in planning_area records. Please check the spelling and try again."
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
        result = db.table("amenity_3layers").select("*").eq("subzone", subzone).execute()
        if not result.data:
            raise HTTPException(
                status_code=404,
                detail=f"Subzone '{subzone}' not found in subzone records. Please check the spelling and try again."
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

#########################
### geojson responses ###
#########################

# get all amenity data as geojson
@router.get("/geojson")
async def get_all_amenities_geojson():
    selected_columns = [
        "amenity_id",
        "amenity_type",
        "amenity_name",
        "postal_code", 
        "lon", 
        "lat",
        "amenity_planning_area_id",
        "amenity_subzone_id",
        "road_name"
    ]

    try:
        result = db.table("amenity_3layers").select(*selected_columns).execute()

        if result.data:
            geojson = to_geojson(result.data)
            return geojson
        else:
            return {"type": "FeatureCollection", "features": []}
            
    except Exception as e:
        logger.error(f"❌ Error fetching amenity_3layers data: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")