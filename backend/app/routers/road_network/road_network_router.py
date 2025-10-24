import logging
from fastapi import APIRouter, Request, HTTPException
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
)  # Fixed: was "/weather-alerts"

def to_geojson(result: Any) -> Dict[str, Any]:
    """
    Convert DB query result to GeoJSON FeatureCollection.
    Handles geography/geometry columns from PostGIS.
    """
    rows: List[Dict] = getattr(result, "data", result) or []
    features: List[Dict] = []

    for row in rows:
        geom_value = (
            row.get("geom")
            or row.get("geometry")
            or row.get("the_geom")
            or row.get("geojson")
        )
        
        if geom_value is None:
            logger.debug(f"Skipping row {row.get('id', 'unknown')} - no geometry found")
            continue

        geom_obj = None

        # 1) Already a dict (GeoJSON)
        if isinstance(geom_value, dict) and geom_value.get("type"):
            geom_obj = geom_value

        # 2) String (JSON or WKT)
        elif isinstance(geom_value, str):
            # Try JSON first
            if geom_value.strip().startswith('{'):
                try:
                    parsed = json.loads(geom_value)
                    if isinstance(parsed, dict) and parsed.get("type"):
                        geom_obj = parsed
                except json.JSONDecodeError:
                    pass
            
            # Try WKT
            if geom_obj is None and _HAS_SHAPELY:
                try:
                    shap = wkt.loads(geom_value)
                    geom_obj = mapping(shap)
                except Exception as e:
                    logger.debug(f"Failed to parse WKT: {e}")

        # 3) Binary WKB (from geography/geometry column)
        elif _HAS_SHAPELY:
            try:
                # Handle memoryview, bytes, bytearray, or hex string
                if isinstance(geom_value, memoryview):
                    geom_bytes = bytes(geom_value)
                elif isinstance(geom_value, str) and all(c in '0123456789ABCDEFabcdef' for c in geom_value):
                    geom_bytes = bytes.fromhex(geom_value)
                else:
                    geom_bytes = bytes(geom_value)
                
                shap = wkb.loads(geom_bytes)
                geom_obj = mapping(shap)
            except Exception as e:
                logger.debug(f"Failed to parse WKB: {e}")

        if geom_obj is None:
            logger.warning(f"Skipping row {row.get('id', 'unknown')} - could not parse geometry")
            continue

        # Build properties (exclude geometry fields)
        props = {
            k: v
            for k, v in row.items()
            if k.lower() not in ("geom", "geometry", "the_geom", "geojson", "wkt", "srid", "epsg", "geom_srid")
        }

        features.append({
            "type": "Feature",
            "geometry": geom_obj,
            "properties": props
        })

    return {
        "type": "FeatureCollection",
        "features": features,
        "count": len(features)
    }

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

# get road network data as GeoJSON
@router.get("/geojson")
async def get_road_network_geojson():
    try:
        result = db.table("road_network").select("*").execute()
        geojson = to_geojson(result)
        return geojson

    except Exception as e:
        logger.error(f"❌ Error fetching road_network GeoJSON: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
