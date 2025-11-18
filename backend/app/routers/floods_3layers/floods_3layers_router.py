from datetime import datetime
import logging
from fastapi import APIRouter, Request, HTTPException, UploadFile, File
from common.db import db
import csv
import io

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/flood-3layers", tags=["flood-3layers"])

# helper functions 
def validate_date(date_str):
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
        return True
    except ValueError:
        return False
    
def clean_string(s): 
    return s.strip().upper() 

def handle_response(result):
    if result.data:
        return {"data": result.data, "count": len(result.data)}
    else:
        return {"data": [], "count": 0}
    
def to_geojson(data):
    """
    Convert flood data to GeoJSON FeatureCollection format.
    Creates LineString features connecting start and end coordinates.
    """
    features = []
    
    for record in data:
        # Skip records without valid coordinates
        if not all([
            record.get('start_lat'),
            record.get('start_lng'),
            record.get('end_lat'),
            record.get('end_lng')
        ]):
            continue
        
        try:
            # Convert coordinates to float (end_lat and end_lng are text fields)
            start_lng = float(record['start_lng'])
            start_lat = float(record['start_lat'])
            end_lng = float(record['end_lng'])
            end_lat = float(record['end_lat'])
            
            # Determine geometry type based on whether start and end are the same
            if start_lng == end_lng and start_lat == end_lat:
                # Point geometry for single location floods
                geometry = {
                    "type": "Point",
                    "coordinates": [start_lng, start_lat]
                }
            else:
                # LineString geometry for floods spanning multiple locations
                geometry = {
                    "type": "LineString",
                    "coordinates": [
                        [start_lng, start_lat],
                        [end_lng, end_lat]
                    ]
                }
            
            # Build properties object with all relevant fields
            properties = {
                "id": record.get('id'),
                "event_date": record.get('event_date'),
                "location": record.get('location'),
                "event": record.get('event'),
                "parent_road": record.get('parent_road'),
                "start_postal_code": record.get('start_postal_code'),
                "end_postal_code": record.get('end_postal_code'),
                "start_planning_area": record.get('start_planning_area'),
                "start_subzone": record.get('start_subzone'),
                "start_street_name": record.get('start_street_name'),
                "end_planning_area": record.get('end_planning_area'),
                "end_subzone": record.get('end_subzone'),
                "end_street_name": record.get('end_street_name'),
            }
            
            # Create GeoJSON feature
            feature = {
                "type": "Feature",
                "geometry": geometry,
                "properties": properties
            }
            
            features.append(feature)
            
        except (ValueError, TypeError) as e:
            # Skip records with invalid coordinate data
            logger.warning(f"Skipping record {record.get('id')} due to invalid coordinates: {e}")
            continue
    
    # Return GeoJSON FeatureCollection
    return {
        "type": "FeatureCollection",
        "features": features
    }

##################
### GET ROUTES ###
##################

######################
### json responses ###
######################
# get all flood data
@router.get("/")
async def get_all_flood_data():     
    try:
        result = db.table("flood_3layers").select("*").execute()
        
        return handle_response(result)
        
    except Exception as e:
        logger.error(f"❌ Error fetching floods_3layers data: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    
# get flood data by planning area
@router.get("/filter/planning-area/{planning_area}")
async def get_floods_by_planning_area(planning_area: str):
    planning_area = clean_string(planning_area)
    try:
        filter_query = f"start_planning_area.eq.{planning_area},end_planning_area.eq.{planning_area}"

        # Query floods by planning area
        result = db.table("flood_3layers").select("*").or_(filter_query).execute()
        
        if not result.data:
            raise HTTPException(
                status_code=404, 
                detail=f"Planning area '{planning_area}' not found in flood records. Please check the spelling and try again."
            )

        return handle_response(result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error fetching floods_3layers data by subzone: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

# get flood data by subzone (checks both start and end)
@router.get("/filter/subzone/{subzone}")
async def get_floods_by_subzone(subzone: str):
    subzone = clean_string(subzone)
    try:
        filter_query = f"start_subzone.eq.{subzone},end_subzone.eq.{subzone}"
        
        # Query floods by subzone
        result = db.table("flood_3layers").select("*").or_(filter_query).execute()
        
        if not result.data:
            raise HTTPException(
                status_code=404, 
                detail=f"Subzone '{subzone}' not found in flood records. Please check the spelling and try again."
            )

        return handle_response(result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error fetching floods_3layers data by subzone: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    
# get floods in time period
@router.get("/filter/time-period/")
async def get_floods_in_time_period(start: str = None, end: str = None): 
    try:
        # validate date formats
        if start and not validate_date(start):
            raise HTTPException(status_code=400, detail="Invalid start date format. Use YYYY-MM-DD.")
        if end and not validate_date(end):
            raise HTTPException(status_code=400, detail="Invalid end date format. Use YYYY-MM-DD.")
        
        # scenario 1: if start and end date filled in
        if start and end: 
            # if start date is after end date, raise error
            if start > end:
                raise HTTPException(status_code=400, detail="Start date cannot be after end date.")
            # else return data between start and end date (inclusive)
            else: 
                result = db.table("flood_3layers").select("*").gte("event_date", start).lte("event_date", end).execute()
        
        # scenario 2: if end date not filled, return all data after start date
        elif start and not end: 
            result = db.table("flood_3layers").select("*").gte("event_date", start).execute()

        # scenario 3: if start date not filled, return all data before end date
        elif end and not start: 
            result = db.table("flood_3layers").select("*").lte("event_date", end).execute()

        # scenario 4: if neither start nor end date filled, raise error
        else:
            raise HTTPException(status_code=400, detail="Please provide at least a start or end date.")
        
        return handle_response(result)

    except Exception as e:
        logger.error(f"❌ Error fetching floods_3layers data in time period: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

# get floods by postal code 
@router.get("/filter/postal-code/{postal_code}/")
async def get_floods_by_postal_code(postal_code: str):
    # check that postal code is a number
    if not postal_code.isdigit():
        raise HTTPException(status_code=400, detail="Invalid postal code format. Use numeric values only.")
    else:
        original_input = postal_code
        postal_code = str(postal_code)

    try:
        filter_query = f"start_postal_code.eq.{postal_code},end_postal_code.eq.{postal_code}"
        result = db.table("flood_3layers").select("*").or_(filter_query).execute()

        if not result.data:
            raise HTTPException(
                status_code=404,
                detail=f"Flood records not found for postal code '{original_input}'. Please check the postal code and try again."
            )

        return handle_response(result)

    except Exception as e:
        logger.error(f"❌ Error fetching floods_3layers data by postal code: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

# get floods by street name
@router.get("/filter/street-name/{street_name}/")
async def get_floods_by_street_name(street_name: str):
    original_street_name = street_name
    street_name = clean_string(street_name)
    try:
        filter_query = f"start_street_name.eq.{street_name},end_street_name.eq.{street_name}"
        result = db.table("flood_3layers").select("*").or_(filter_query).execute()

        if not result.data:
            raise HTTPException(
                status_code=404,
                detail=f"Flood records not found for street name '{original_street_name}'. Please check the spelling and try again."
            )

        return handle_response(result)

    except Exception as e:
            logger.error(f"❌ Error fetching floods_3layers data by street name: {e}")
            raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    
#########################
### geojson responses ###
#########################
@router.get("/geojson/")
async def get_floods_geojson():     
    try:
        result = db.table("flood_3layers").select("*").execute()
        
        if not result.data:
            raise HTTPException(
                status_code=404,
                detail="No flood data found."
            )
        
        geojson = to_geojson(result.data)
        return geojson
        
    except Exception as e:
        logger.error(f"❌ Error fetching floods_3layers geojson data: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

######################
### POST ROUTES ######
######################

@router.post("/upload")
async def upload_flood_csv(file: UploadFile = File(...)):
    """
    Upload a CSV from the frontend, validate columns, run the floods ETL pipeline,
    replace flood_3layers_test table contents with the new dataset.
    On failure, attempt to restore the previous backup.
    """
    logger.info(f"Received upload: {file.filename}")

    # Read file
    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    # Validate CSV headers
    try:
        reader = csv.DictReader(io.StringIO(text))
        headers = reader.fieldnames or []
    except Exception as e:
        logger.error(f"Failed to parse CSV: {e}")
        raise HTTPException(status_code=400, detail="Invalid CSV file")

    required_columns = [
        "start_lat", "start_lng", "end_lat", "end_lng",
        "event_date", "location", "event",
        "parent_road", "start_postal_code", "end_postal_code",
        "start_planning_area", "start_subzone", "start_street_name",
        "end_planning_area", "end_subzone", "end_street_name"
    ]

    missing = [c for c in required_columns if c not in headers]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"CSV missing required columns: {', '.join(missing)}"
        )

    # Backup existing table
    try:
        existing = db.table("flood_3layers_test").select("*").execute()
        backup = existing.data or []
        logger.info(f"Backed up {len(backup)} existing records from flood_3layers_test")
    except Exception as e:
        logger.error(f"Failed to back up existing flood_3layers_test data: {e}")
        backup = []

    # Run pipeline to get new dataset (lazy import to avoid heavy ETL deps at app startup)
    try:
        try:
            from etl.floods.run_floods_pipeline import execute_floods_pipeline
        except Exception as import_err:
            logger.error(f"Floods ETL pipeline not available: {import_err}")
            raise HTTPException(
                status_code=500,
                detail="Floods ETL pipeline is not available in this deployment.",
            )

        new_data = await execute_floods_pipeline(table_name="flood_3layers_test")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Pipeline execution failed: {e}")
        raise HTTPException(status_code=500, detail=f"Pipeline failed: {str(e)}")

    # If pipeline did not return data, try to read directly from the table
    if not new_data:
        try:
            res = db.table("flood_3layers_test").select("*").execute()
            new_data = res.data or []
            logger.info(f"Fetched {len(new_data)} records from flood_3layers_test after pipeline run")
        except Exception as e:
            logger.error(f"Failed to fetch new data after pipeline run: {e}")
            raise HTTPException(status_code=500, detail="Failed to obtain new dataset after pipeline run")

    # Replace table contents with new_data, with contingency to restore backup on failure
    try:
        # wipe table
        db.table("flood_3layers_test").delete().execute()
        logger.info("Cleared flood_3layers_test table")

        # insert new data (if any)
        if new_data:
            db.table("flood_3layers_test").insert(new_data).execute()
            logger.info(f"Inserted {len(new_data)} new records into flood_3layers_test")

        return {
            "status": "success",
            "message": "Floods data uploaded and flood_3layers_test table updated successfully",
            "count": len(new_data)
        }

    except Exception as e:
        logger.error(f"Failed to replace flood_3layers_test table: {e}. Attempting to restore backup.")
        # Attempt restore
        try:
            db.table("flood_3layers_test").delete().execute()
            if backup:
                db.table("flood_3layers_test").insert(backup).execute()
                logger.info(f"Restored {len(backup)} backup records to flood_3layers_test")
            else:
                logger.info("No backup data to restore")
        except Exception as restore_err:
            logger.critical(f"Failed to restore backup after failed upload: {restore_err}")
            raise HTTPException(
                status_code=500,
                detail=f"Upload failed and backup restore also failed: {str(restore_err)}"
            )

        raise HTTPException(status_code=500, detail=f"Upload failed; backup restored. Error: {str(e)}")
