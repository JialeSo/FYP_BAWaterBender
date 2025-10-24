import logging
from fastapi import APIRouter, Request, HTTPException
from common.db import db

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/subzone", tags=["subzone"])  # Fixed: was "/weather-alerts"
def to_geojson(result: Any) -> Dict[str, Any]:
    """
    Convert DB query result (result.data or list of rows) to a GeoJSON FeatureCollection
    ensuring coordinates are in EPSG:4326 when possible.
    
    Handles:
      - geom as GeoJSON dict
      - geom as GeoJSON string
      - geom as WKT string (requires shapely)
      - geom as WKB bytes/hex (requires shapely)
    
    If a row contains an srid/epsg field and it's not 4326, shapely+pyproj will reproject.
    """
    rows: List[Dict] = getattr(result, "data", result) or []
    features: List[Dict] = []

    for row in rows:
        geom_value = (
            row.get("geom")
            or row.get("geometry")
            or row.get("the_geom")
            or row.get("geojson")
            or row.get("wkt")
        )
        if geom_value is None:
            # no geometry, skip
            logger.debug(f"Skipping row {row.get('id', 'unknown')} - no geometry found")
            continue

        geom_obj = None

        # 1) If it's already a geom dict (GeoJSON)
        if isinstance(geom_value, dict) and geom_value.get("type"):
            geom_obj = geom_value

        # 2) If it's a JSON string representing GeoJSON
        elif isinstance(geom_value, str):
            # try parse as JSON first
            try:
                parsed = json.loads(geom_value)
                if isinstance(parsed, dict) and parsed.get("type"):
                    geom_obj = parsed
                else:
                    # may be WKT (handled below)
                    geom_obj = None
            except json.JSONDecodeError:
                geom_obj = None

            # try WKT -> shapely -> geojson
            if geom_obj is None and _HAS_SHAPELY:
                try:
                    shap = wkt.loads(geom_value)
                    geom_obj = mapping(shap)
                except Exception as e:
                    logger.debug(f"Failed to parse WKT for row {row.get('id', 'unknown')}: {e}")
                    geom_obj = None

        # 3) If it's bytes or memoryview => try WKB (shapely)
        elif isinstance(geom_value, (bytes, bytearray, memoryview)) and _HAS_SHAPELY:
            try:
                shap = wkb.loads(bytes(geom_value))
                geom_obj = mapping(shap)
            except Exception as e:
                logger.debug(f"Failed to parse WKB for row {row.get('id', 'unknown')}: {e}")
                geom_obj = None

        # If still None, skip row
        if geom_obj is None:
            logger.warning(f"Skipping row {row.get('id', 'unknown')} - could not parse geometry")
            continue

        # attempt reprojection if shapely available and srid present and not 4326
        srid = None
        for key in ("srid", "epsg", "geom_srid"):
            if key in row and row.get(key):
                try:
                    srid = int(row.get(key))
                    break
                except (ValueError, TypeError):
                    srid = None

        if _HAS_SHAPELY and srid and srid != 4326:
            try:
                transformer = Transformer.from_crs(f"EPSG:{srid}", "EPSG:4326", always_xy=True)
                shap = shape(geom_obj)
                shap_t = shapely_transform(transformer.transform, shap)
                geom_obj = mapping(shap_t)
                logger.debug(f"Reprojected geometry from EPSG:{srid} to EPSG:4326 for row {row.get('id', 'unknown')}")
            except Exception as e:
                # if reprojection fails, continue with original geom_obj
                logger.warning(f"Failed to reproject from EPSG:{srid} to EPSG:4326 for row {row.get('id', 'unknown')}: {e}")
                pass

        # build properties excluding geometry/meta keys
        props = {
            k: v
            for k, v in row.items()
            if k.lower() not in ("geom", "geometry", "the_geom", "geojson", "wkt", "srid", "epsg", "geom_srid")
        }

        features.append({"type": "Feature", "geometry": geom_obj, "properties": props})

    return {"type": "FeatureCollection", "features": features, "count": len(features)}

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

# get subzone data as GeoJSON
@router.get("/geojson")
async def get_subzone_geojson():  
    try:
        result = db.table("subzone").select("*").execute()
        geojson = to_geojson(result)
        return geojson
            
    except Exception as e:
        logger.error(f"❌ Error fetching subzone GeoJSON: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")