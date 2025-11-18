import logging
from fastapi import APIRouter, Request, HTTPException, Query
from common.db import db
from typing import Any, Dict, List
import json
# try optional libs for reprojection / WKB handling
try:
    from shapely import wkb, wkt
    from shapely.geometry import shape, mapping
    from shapely.ops import transform as shapely_transform
    from pyproj import Transformer
    _HAS_SHAPELY = True
except ImportError:  # More specific than Exception
    _HAS_SHAPELY = False
# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/road-network", tags=["road-network"]
)  

def to_geojson(rows: List[Dict]) -> Dict[str, Any]:
    """
    Convert rows with GeoJSON geometry to FeatureCollection
    """
    features: List[Dict] = []

    for row in rows:
        # Look for the geojson field
        geom_value = row.get("geojson") or row.get("geom")
        
        if geom_value is None:
            logger.warning(f"Row {row.get('id')} has no geometry")
            continue

        geom_obj = None

        # Parse string to JSON if needed
        if isinstance(geom_value, str):
            try:
                geom_obj = json.loads(geom_value)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse geometry for row {row.get('id')}: {e}")
                continue
        elif isinstance(geom_value, dict):
            geom_obj = geom_value
        else:
            logger.warning(f"Unexpected geom type for row {row.get('id')}: {type(geom_value)}")
            continue

        # Build properties (exclude geometry fields)
        props = {
            k: v
            for k, v in row.items()
            if k not in ("geojson", "geom", "geometry")
        }

        features.append({
            "type": "Feature",
            "geometry": geom_obj,
            "properties": props
        })

    logger.info(f"Created {len(features)} features from {len(rows)} rows")
    return {
        "type": "FeatureCollection",
        "features": features,
        "count": len(features)
    }

# get all road network data (paginated to avoid Supabase timeouts)
@router.get("/")
async def get_all_road_network_data(
    limit: int = Query(5000, ge=1, le=50000),
    offset: int = Query(0, ge=0),
):
    try:
        end = offset + limit - 1
        logger.info(f"Fetching road_network rows range {offset}-{end}")

        query = db.table("road_network").select("*").range(offset, end)
        result = query.execute()

        if result.data:
            return {"data": result.data, "count": len(result.data)}
        else:
            return {"data": [], "count": 0}

    except Exception as e:
        logger.error(f"❌ Error fetching road_network data: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

# get road network data as GeoJSON
@router.get("/geojson")
async def get_road_network_geojson():
    try:
        # Query the view instead of the table
        result = db.table("road_network_geojson").select("*").execute()
        
        if result.data:
            return to_geojson(result.data)
        else:
            return {"type": "FeatureCollection", "features": [], "count": 0}

    except Exception as e:
        logger.error(f"❌ Error fetching road_network GeoJSON: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
