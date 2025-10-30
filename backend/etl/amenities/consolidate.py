#!/usr/bin/env python3
"""
Amenities Data Consolidation
=============================

Consolidates all amenity sources into a single GeoJSON file.

Sources:
--------
1. GeoJSON files in geojson/ folder (~18k features)
2. OSM OnEMap matched data (~28k features)
Total: ~46k features (will be deduplicated in later steps)
"""

import json
import os
import uuid
from collections import ChainMap, Counter
from pathlib import Path
from typing import Dict, List, Optional, Set

import pandas as pd
import time
import requests
from datetime import datetime, timezone
from dotenv import load_dotenv

from backend.etl.onemap.onemap_extended import OneMapClient

from backend.etl.amenities.core.naming import infer_amenity_name

# Paths
SCRIPT_DIR = Path(__file__).resolve().parent
# Use etl/data (not project-level data)
DATA_DIR = SCRIPT_DIR.parent / "data"
GEOJSON_DIR = DATA_DIR / "geojson"
AMENITIES_DIR = DATA_DIR / "amenities"

# Input files
OSM_ONEMAP_FILE = AMENITIES_DIR / "osm_onemap_matched.json"

# Output file
OUTPUT_FILE = DATA_DIR / "amenities_consolidated.geojson"

# Files to skip
SKIP_FILES = [
    'planning_area.geojson',      # Reference layer
    'subzone_area.geojson',       # Reference layer
    'road_network.geojson',       # Reference layer
]

# OneMap themes to EXCLUDE (exact matches on THEMENAME)
EXCLUDED_THEME_NAMES = {
    # Newly excluded per request
    "After Death Facilities",
    "Active Cemeteries",
    "Columbaria",
    "Dementia Friendly Go-To-Points (GTPs)",
    "Funeral Parlours",
    "IPPT In Your Community",
    "Licensed Premises for Liquors & Tabacco Products",
    "IPPT In Your Community",
    "Other PA Networks",
    "PCN Access Points",
    "Waste Disposal Site",
    "Water Ventures",
    "LTA Bicycle Rack",
    "Heritage Road Green Buffers",
    "NParks BBQ Pits",
    "Singapore Police Force - 32nd ASEAN Summit Shangri-La Hotel Special Zone",
    "Electoral Boundary 2006",
    "Electoral Boundary 2015",
    "Electoral Boundary 2011",
    "Singapore Police Force - 32nd ASEAN Summit Istana Special Zone",
    "Singapore Police Force - 32nd ASEAN Summit Istana Special Event Area",
    "Singapore Police Force - 32nd ASEAN Summit Shangri-La Hotel Special Event Area",
    "Singapore Coastal Habitats Map from High Resolution Satellite Imagery (2010/2011)",
    "CAAS Zones for Solar PV Consultation",
    "Areas with High Aedes Population",
    "Road Speed Limit",
    "LTA Road Construction Project (Unclassified)",
    "Strengthening Families Programme",
    "Singapore Police Force - PCG Offshore Islands",
    "Singapore Police Force - National Day Parade (NDP) 2022 Special Event Area",
    "Singapore Police Force - National Day Parade (NDP) 2022 Special Zone",
    "Licensed Premises for Motor Vehicles",
    "HDB Existing Building",
    "Licensed premises for petroleum products",
    "Heritage Trees",
    "Crematoria",
    "Inland Ash Scattering Gardens",
    "Dedicated Columbaria",
    "Singapore Police Force - National Day Parade (NDP) 2024 Special Zone",
    "Areas within Restricted Areas",
    "URA Parking Lot",
    "Liquor Control Zone under Public Order (Additional Temporary Measures) Act 2014",
    "Delivery waiting bay (bicycles)",
    "NParks Tracks",
    "Privately Owned Public Spaces (POPS)",
    "Singapore Police Force Digital Traffic Red Light Cameras",
    "Singapore Police Force Fixed Speed Cameras",
    "CareersConnect",
    "Community in Bloom (CIB)",
    "Park Connector Loop",
    "Areas within 5km of aerodromes",
    "HDB Roads Under Construction",
    "URA Project (PUBLIC)",
    "Zika Cluster",
    "LTA Road Camera",
    "Quit Centres",
    "Under-Construction Parks",
    "WaterSupplyConstruction",
    "HDB Cycling Paths Under-Construction",
    "SewerageConstruction",
    "Under-Construction Park Connectors",
    "Under-Construction Park Facilities",
    "Singapore Police Force - National Day Parade (NDP) 2025 Special Event Area",
    "Delivery waiting bay",
    "Areas within a Temporary Restricted Area",
    "Certificate Grading Info of Licensed Eating Establishments",
    "MCE KPE Speed Camera",
    "ABC Waters Construction",
    "Singapore Police Force - National Day Parade (NDP) 2025 Special Zone",
    "Liquor Control Zone(s) proclaimed under Liquor Control (Supply and Consumption) Act 2015",
    "Delivery waiting bay (motorcycles)",
    "Singapore Police Force - National Day Parade (NDP) 2024 Special Event Area",
    "Green Mark Buildings",
    "Historic Sites",
    "Dengue Clusters",
    "E-waste Recycling",
    "Singapore Police Force Mobile Speed Cameras",
    "Singapore Police Force Police Speed Laser Cameras",
    "Licensed Premises for Zero GST Goods",
    "LTA Rail Project Under Construction (Unclassified)",
    "NParks Car Park Lots",
    "Areas within Prohibited Areas",
    "Designated Smoking Areas",
    "Maxwell Chambers F&B map",
    "Singapore Police Force Red Light Cameras",
    "TradeNet Service Centres & Certified Vendors",
    "Tree Conservation Area",
    "HDB Car Park Information",
    "Vaccination_ JTVC",
    "Vaccination_PHPC",
    "No Smoking Zones",
    "Nature Reserves Gazette 2005",
    "Protected Area under Section 7 Air Navigation Act",
    "Singapore Police Force NPC Boundary",
    "Healthier Caterers",
    "Prohibited Drone flying areas at NParks Nature Reserves, Nature Parks and Gardens",
    "Areas within Danger Areas",
    "LTA Parking Standards Zone",
    "PA Headquarters",
    "JTC Temporary Occupation License",
    "Wolbachia Release Sites",
    "Wireless HotSpots",
    "Singapore Police Force - National Day Parade (NDP) 2023 Special Event Area",
    "Singapore Police Force - National Day Parade (NDP) 2023 Special Zone",
    "MOH JTVC",
    "HDB Neighbourhood Renewal Programme Proposed and Under-Construction (NRP)",
    "HDB Public Housing Building Under-Construction",
    "Estate Upgrading Programme (EUP) Works for OSP",
    "Drainage Construction",
    "HDB Lift Upgrading Programme Proposed and Under-Construction (LUP): ",
}

# OneMap themes to EXCLUDE (exact matches on QUERYNAME)
EXCLUDED_QUERYNAMES = {
    "Vaccination_Polyclinics",
    "crematoria",
    "ias",
    "columbaria",
    "aed_locations",
}

NAME_FILL_STATS = {
    "geojson": Counter(),
    "osm": Counter(),
}

# Broad Singapore-wide bbox extents (lat_min, lon_min, lat_max, lon_max)
SINGAPORE_EXTENTS = "1.2000,103.6000,1.4700,104.1000"


def _normalise_amenity_type(props: Dict, source_file: str) -> str:
    """Return amenity type using source file name as fallback."""
    value = props.get('amenity_type')
    if value:
        return str(value)
    return Path(source_file).stem


def _prepare_infer_context(
    amenity_type: str,
    road_name: str,
    postal_code: str,
    lon: Optional[float],
    lat: Optional[float],
) -> Dict:
    """Context dictionary passed to infer_amenity_name."""
    context = {
        'amenity_type': amenity_type,
        'road_name': road_name,
        'postal_code': postal_code,
    }
    if lon is not None:
        context['lon'] = lon
    if lat is not None:
        context['lat'] = lat
    return context


_ID_COUNTER = 0


def _next_int_id() -> int:
    """Generate a simple monotonically increasing integer id (per run)."""
    global _ID_COUNTER
    _ID_COUNTER += 1
    return _ID_COUNTER


def _coerce_int(value) -> Optional[int]:
    try:
        if value is None:
            return None
        s = str(value).strip()
        if s == "":
            return None
        return int(s)
    except Exception:
        return None


def generate_amenity_id(preferred: Optional[object] = None) -> int:
    """Return a unique integer amenity_id.

    - If preferred is a numeric string/int, use it.
    - Otherwise, return a per-run sequential integer.
    """
    as_int = _coerce_int(preferred)
    if as_int is not None:
        return as_int
    return _next_int_id()


def map_geojson_to_standard(feature: Dict, source_file: str) -> Dict:
    """
    Map GeoJSON feature to standard structure.

    Args:
        feature: GeoJSON feature
        source_file: Source filename

    Returns:
        Standardized feature dict
    """
    props = feature.get('properties', {})
    geom = feature.get('geometry', {})

    # Extract coordinates
    coords = geom.get('coordinates', [])
    if geom.get('type') == 'Point':
        lon, lat = coords[0], coords[1]
    elif coords:
        # For non-Point geometries, use first coordinate or centroid
        if isinstance(coords[0], list):
            lon, lat = coords[0][0], coords[0][1]
        else:
            lon, lat = coords[0], coords[1]
    else:
        lon, lat = None, None

    # Derive amenity_type. For HOT OSM exports, prefer standard OSM tags.
    amenity_type = _normalise_amenity_type(props, source_file)
    derived_from_osm = False
    try:
        src_lower = str(source_file).lower()
        if "hotosm" in src_lower or "osm" in src_lower:
            for key in [
                "amenity", "shop", "tourism", "leisure", "healthcare", "office",
                "craft", "public_transport", "railway", "highway", "man_made",
                "emergency", "aeroway", "aerialway"
            ]:
                val = props.get(key)
                if val not in (None, "", "null"):
                    amenity_type = str(val)
                    derived_from_osm = True
                    break
    except Exception:
        pass

    road_name = (
        props.get('road_name')
        or props.get('ROAD_NAME')
        or props.get('ADDRESSSTREETNAME')
        or ''
    )
    postal_code = (
        props.get('postal_code')
        or props.get('POSTAL')
        or props.get('POSTAL_CD')
        or props.get('ADDRESSPOSTALCODE')
        or ''
    )

    # Initial amenity name extraction before applying richer inference.
    amenity_name = (
        props.get('NAME') or
        props.get('name') or
        props.get('amenity_name') or
        props.get('Name') or
        ''
    )

    context = _prepare_infer_context(amenity_type, road_name, postal_code, lon, lat)
    if amenity_name:
        context['amenity_name'] = amenity_name

    inferred_name = infer_amenity_name(
        props,
        source_file=source_file,
        extra_context=context,
    )

    if not amenity_name or amenity_name != inferred_name:
        NAME_FILL_STATS["geojson"][amenity_type] += 1

    result = {
        'type': 'Feature',
        'geometry': geom,
        'properties': {
            'amenity_id': generate_amenity_id(props.get('amenity_id')),
            'amenity_type': amenity_type,
            'amenity_name': inferred_name,
            'road_name': road_name,
            'postal_code': postal_code,
            'geom_type': geom.get('type', 'Point'),
            'lon': lon,
            'lat': lat,
            'source_file': source_file,
        }
    }

    # If derived from OSM tags, expose a theme_queryname to aid classification
    if derived_from_osm:
        result['properties']['theme_queryname'] = amenity_type

    return result


def map_osm_to_standard(osm_record: Dict) -> Dict:
    """
    Map OSM OnEMap record to standard structure.

    Args:
        osm_record: OSM record from osm_onemap_matched.json

    Returns:
        Standardized GeoJSON feature
    """
    # Extract OnEMap data if available
    onemap_data = osm_record.get('onemap_data') or {}
    if not isinstance(onemap_data, dict):
        onemap_data = {}

    lon = osm_record.get('lon')
    lat = osm_record.get('lat')

    amenity_type = osm_record.get('amenity', 'unknown')

    properties = {
        'amenity_id': generate_amenity_id(),
        'amenity_type': amenity_type,
        'road_name': onemap_data.get('ROAD_NAME') or '',
        'postal_code': onemap_data.get('POSTAL') or '',
        'geom_type': 'Point',
        'lon': lon,
        'lat': lat,
        'source_file': 'osm_onemap_matched.json',
        # Keep OSM metadata
        'osm_type': osm_record.get('osm_type'),
        'osm_id': osm_record.get('osm_id'),
        'enrichment_status': osm_record.get('enrichment_status'),
    }

    name_context = {
        'amenity_name': osm_record.get('name') or '',
        'amenity_type': amenity_type,
        'road_name': properties['road_name'],
        'postal_code': properties['postal_code'],
        'lon': lon,
        'lat': lat,
    }

    inferred_name = infer_amenity_name(
        ChainMap(
            onemap_data,
            osm_record,
        ),
        source_file='osm_onemap_matched.json',
        extra_context=name_context,
    )

    if not name_context['amenity_name'] or name_context['amenity_name'] != inferred_name:
        NAME_FILL_STATS["osm"][amenity_type] += 1

    properties['amenity_name'] = inferred_name

    return {
        'type': 'Feature',
        'geometry': {
            'type': 'Point',
            'coordinates': [lon, lat]
        },
        'properties': properties,
    }


def load_geojson_files(include_only: Optional[set[str]] = None) -> List[Dict]:
    """Load selected GeoJSON files from geojson/ directory.

    If include_only is provided, only files with names in the set are loaded.
    """
    print("\nLoading GeoJSON amenity files...")

    features = []
    file_count = 0
    feature_count = 0

    geojson_files = sorted(GEOJSON_DIR.glob("*.geojson"))

    for geojson_file in geojson_files:
        # If include_only specified, skip anything not listed
        if include_only is not None and geojson_file.name not in include_only:
            continue
        # Skip reference files in skip list
        if geojson_file.name in SKIP_FILES:
            print(f"  ⊗ Skipping: {geojson_file.name}")
            continue

        try:
            with open(geojson_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            file_features = data.get('features', [])

            # Map each feature to standard structure
            for feature in file_features:
                mapped = map_geojson_to_standard(feature, geojson_file.name)
                features.append(mapped)

            file_count += 1
            feature_count += len(file_features)

            file_size = geojson_file.stat().st_size / 1024 / 1024
            print(f"  ✓ {geojson_file.name:<40} {len(file_features):>6,} features ({file_size:.1f} MB)")

        except Exception as e:
            print(f"  ✗ Error loading {geojson_file.name}: {e}")

    print(f"\n  Total: {file_count} files, {feature_count:,} features")
    return features


def load_osm_onemap() -> List[Dict]:
    """Load and map OSM OnEMap matched data."""
    print("\nLoading OSM OnEMap matched data...")

    if not OSM_ONEMAP_FILE.exists():
        print(f"  ⚠ File not found: {OSM_ONEMAP_FILE}")
        return []

    try:
        with open(OSM_ONEMAP_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)

        print(f"  Loaded {len(data):,} OSM records")

        # Map each record to standard structure
        features = []
        for record in data:
            mapped = map_osm_to_standard(record)
            features.append(mapped)

        file_size = OSM_ONEMAP_FILE.stat().st_size / 1024 / 1024
        print(f"  ✓ Mapped {len(features):,} OSM features to standard structure ({file_size:.1f} MB)")

        return features

    except Exception as e:
        print(f"  ✗ Error loading OSM data: {e}")
        import traceback
        traceback.print_exc()
        return []


def consolidate_all() -> Dict:
    """Consolidate all sources into single GeoJSON."""
    print("\n" + "="*80)
    print("CONSOLIDATING AMENITY DATA")
    print("="*80)

    NAME_FILL_STATS["geojson"].clear()
    NAME_FILL_STATS["osm"].clear()

    all_features = []

    # 1. Load local GeoJSON: only HOT OSM export (hotosm_new.geojson)
    geojson_features = load_geojson_files(include_only={"hotosm_new.geojson"})
    all_features.extend(geojson_features)
    print(f"\nGeoJSON subtotal: {len(geojson_features):,} features")

    # 2. OSM OnEMap matched data removed from pipeline

    # 3. Fetch from OneMap Themes API (authenticated)
    try:
        fetched = fetch_onemap_themes()
        all_features.extend(fetched)
        print(f"OneMap themes subtotal: {len(fetched):,} features")
    except Exception as e:
        print(f"  ✗ Error fetching OneMap themes: {e}")

    # 4. Fetch Bus Stops live from LTA DataMall (SLA API key)
    try:
        bus_features = fetch_bus_stops_datamall()
        all_features.extend(bus_features)
        print(f"BusStops (DataMall) subtotal: {len(bus_features):,} features")
    except Exception as e:
        print(f"  ✗ Error fetching BusStops (DataMall): {e}")

    print("\nAmenity name enrichment summary:")
    geojson_fills = NAME_FILL_STATS["geojson"]
    osm_fills = NAME_FILL_STATS["osm"]
    if geojson_fills:
        total_geojson = sum(geojson_fills.values())
        print(f"  • GeoJSON features patched: {total_geojson:,}")
        for amenity_type, count in geojson_fills.most_common(5):
            print(f"      - {amenity_type}: {count:,}")
    if osm_fills:
        total_osm = sum(osm_fills.values())
        print(f"  • OSM features patched: {total_osm:,}")
        for amenity_type, count in osm_fills.most_common(5):
            print(f"      - {amenity_type}: {count:,}")
    if not geojson_fills and not osm_fills:
        print("  • No missing amenity names detected.")

    remaining_missing = [
        feature
        for feature in all_features
        if not feature.get("properties", {}).get("amenity_name")
    ]
    if remaining_missing:
        missing_counts = Counter(
            feature.get("properties", {}).get("amenity_type", "<unknown>")
            for feature in remaining_missing
        )
        total_missing = len(remaining_missing)
        print(f"\n  ⚠ Remaining entries without amenity_name: {total_missing:,}")
        for amenity_type, count in missing_counts.most_common(5):
            print(f"      - {amenity_type}: {count:,}")
    else:
        print("  ✓ All amenities now have amenity_name values.")

    # Create consolidated GeoJSON
    consolidated = {
        'type': 'FeatureCollection',
        'features': all_features,
    }

    print("\n" + "-"*80)
    print(f"TOTAL CONSOLIDATED FEATURES: {len(all_features):,}")
    print("-"*80)

    return consolidated


def _extract_lat_lon(item: Dict) -> tuple[Optional[float], Optional[float]]:
    # Handle wide variety of OneMap field names
    lat_keys = [
        "LATITUDE", "Latitude", "LAT", "lat", "Lat", "Y",
        # Occasionally present
        "latitude", "y",
        # Address variants
        "Y_ADDR", "YCOORD", "Y_COORD", "Location_Latitude", "LOCATION_LATITUDE",
    ]
    lon_keys = [
        "LONGITUDE", "Longitude", "LONG", "Long", "LON", "lon", "Lon", "LNG", "Lng", "X",
        # Occasionally present
        "longitude", "x",
        # Address variants
        "X_ADDR", "XCOORD", "X_COORD", "Location_Longitude", "LOCATION_LONGITUDE",
    ]
    lat = None
    lon = None
    for k in lat_keys:
        if k in item and item[k] not in (None, ""):
            try:
                lat = float(item[k])
                break
            except Exception:
                pass
    for k in lon_keys:
        if k in item and item[k] not in (None, ""):
            try:
                lon = float(item[k])
                break
            except Exception:
                pass
    # Combined string like "lat,lon"
    if (lat is None or lon is None):
        for combo_key in ("LatLng", "LATLNG", "latlng", "location", "Location"):
            val = item.get(combo_key)
            if isinstance(val, str) and "," in val:
                try:
                    parts = [p.strip() for p in val.split(",")]
                    if len(parts) >= 2:
                        la = float(parts[0])
                        lo = float(parts[1])
                        lat = la
                        lon = lo
                        break
                except Exception:
                    pass
    # Very lightweight WKT POINT parser
    if (lat is None or lon is None):
        for wkt_key in ("SHAPE", "WKT", "GeomWKT"):
            val = item.get(wkt_key)
            if isinstance(val, str) and val.upper().startswith("POINT"):
                try:
                    inside = val[val.find("(")+1:val.find(")")]
                    lo, la = inside.replace(",", " ").split()
                    lon = float(lo)
                    lat = float(la)
                    break
                except Exception:
                    pass
    return lat, lon


def _parse_onemap_geometry(item: Dict) -> tuple[Optional[Dict], Optional[float], Optional[float]]:
    """Parse OneMap row geometry.

    Returns (geometry_dict, lon, lat). Geometry may be Point/LineString/Polygon.
    For non-Point geometries, lon/lat is the centroid (approx from first coordinate if centroid is heavy).
    """
    # 1) GeoJSON field (most reliable when present)
    gj = item.get("GeoJSON") or item.get("geojson")
    if isinstance(gj, dict):
        geom = gj.get("geometry") if "geometry" in gj else gj
        if isinstance(geom, dict) and geom.get("type") and geom.get("coordinates") is not None:
            coords = geom["coordinates"]
            # Some themes return coordinates as a JSON string; parse if needed
            if isinstance(coords, str):
                try:
                    coords = json.loads(coords)
                    geom = {**geom, "coordinates": coords}
                except Exception:
                    pass
            lon, lat = None, None
            try:
                if geom.get("type") == "Point" and isinstance(coords, (list, tuple)) and len(coords) >= 2:
                    lon, lat = float(coords[0]), float(coords[1])
                else:
                    # Take first numeric pair found as approx centroid
                    def _find_pair(obj):
                        if isinstance(obj, (list, tuple)):
                            if len(obj) >= 2 and all(isinstance(x, (int, float)) for x in obj[:2]):
                                return float(obj[0]), float(obj[1])
                            for ch in obj:
                                r = _find_pair(ch)
                                if r:
                                    return r
                        return None
                    pair = _find_pair(coords)
                    if pair:
                        lon, lat = pair
            except Exception:
                lon, lat = None, None
            return geom, lon, lat

    # 2) LatLng string (some polygon themes)
    latlng = item.get("LatLng") or item.get("latlng")
    if isinstance(latlng, str) and "[" in latlng and "," in latlng:
        try:
            coords = json.loads(latlng)
            # LatLng appears as list of [lon, lat] pairs in examples
            # Build a Polygon if it's a ring, else a LineString
            def _first_pair(obj):
                if isinstance(obj, list) and obj and isinstance(obj[0], (list, tuple)) and len(obj[0]) >= 2:
                    return float(obj[0][0]), float(obj[0][1])
                return None
            pair = _first_pair(coords)
            geom_type = "Polygon" if isinstance(coords, list) and coords and isinstance(coords[0], list) and isinstance(coords[0][0], (list, tuple)) else "LineString"
            geometry = {"type": geom_type, "coordinates": coords}
            lon, lat = (pair if pair else (None, None))
            return geometry, lon, lat
        except Exception:
            pass

    # 3) Fallback to loose lat/lon fields
    lat, lon = _extract_lat_lon(item)
    if lat is not None and lon is not None:
        return {"type": "Point", "coordinates": [lon, lat]}, lon, lat
    return None, None, None


def _extract_name(item: Dict, themename: str = "", queryname: str = "") -> str:
    """Best-effort amenity name extraction across varied OneMap schemas.

    Tries common fields and AED-specific fields before falling back to themename.
    """
    for key in (
        "NAME",
        "Name",
        "name",
        "DESCRIPTION",
        "Description",
        "AED_DESCRIPTION",
        "AEDDESCRIPTION",
        "ADDRESSBUILDINGNAME",
        "BUILDINGNAME",
    ):
        val = item.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    # As last resort, compose from theme and query
    base = themename or queryname or "Amenity"
    return str(base)


def _get_datamall_key() -> str:
    load_dotenv()
    key = (
        os.getenv("SLA_API_KEY")
        or os.getenv("LTA_API_KEY")
        or os.getenv("DATAMALL_API_KEY")
    )
    if not key:
        raise RuntimeError("Missing SLA/LTA DataMall API key (SLA_API_KEY / LTA_API_KEY / DATAMALL_API_KEY)")
    return key


def fetch_bus_stops_datamall(max_pages: Optional[int] = None, page_delay: float = 0.15) -> List[Dict]:
    """Fetch BusStops from DataMall and map to standard GeoJSON features."""
    key = _get_datamall_key()
    url = "https://datamall2.mytransport.sg/ltaodataservice/BusStops"
    headers = {"AccountKey": key, "accept": "application/json"}
    all_rows: List[Dict] = []
    skip = 0
    page = 0
    while True:
        page += 1
        if max_pages is not None and page > max_pages:
            break
        r = requests.get(url, headers=headers, params={"$skip": skip}, timeout=30)
        if r.status_code == 401:
            raise RuntimeError("Unauthorized BusStops request — check API key")
        r.raise_for_status()
        js = r.json() or {}
        rows = js.get("value") or []
        if not isinstance(rows, list):
            break
        all_rows.extend(rows)
        if len(rows) < 500:
            break
        skip += 500
        time.sleep(page_delay)

    # Map to standard features
    feats: List[Dict] = []
    for r in all_rows:
        try:
            lat = float(r.get("Latitude"))
            lon = float(r.get("Longitude"))
        except Exception:
            continue
        # BusStopCode is a 5-digit code (not a postal code) but we
        # store it in postal_code by design for bus stops (special case)
        bus_code = str(r.get("BusStopCode") or "").strip()
        props = {
            "amenity_id": generate_amenity_id(),
            # Normalize type to match the rest of the pipeline and FE
            "amenity_type": "bus_stops",
            "amenity_name": str(r.get("Description") or r.get("BusStopCode") or ""),
            "road_name": str(r.get("RoadName") or ""),
            # Keep BusStopCode as-is (5 digits); not a real postal
            "postal_code": bus_code,
            "geom_type": "Point",
            "lon": lon,
            "lat": lat,
            "source_file": "live:datamall_bus_stops",
        }
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": props,
        })
    return feats


def _load_themes_index() -> List[Dict]:
    idx_path = DATA_DIR / "onemap" / "onemap_themes.json"
    if not idx_path.exists():
        return []
    try:
        with open(idx_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and "Theme_Names" in data:
            return data["Theme_Names"]
        if isinstance(data, list):
            return data
    except Exception:
        pass
    return []


def _compute_excluded_querynames() -> set[str]:
    excluded = set(EXCLUDED_QUERYNAMES)
    idx = _load_themes_index()
    for t in idx:
        name = (t.get("THEMENAME") or t.get("themename") or "").strip()
        qn = (t.get("QUERYNAME") or t.get("queryname") or "").strip()
        if name in EXCLUDED_THEME_NAMES and qn:
            excluded.add(qn)
    return excluded


def _load_themes_allowlist() -> Set[str]:
    """Load optional allowlist of QUERYNAMEs to include.

    Supports either:
      - backend/etl/data/onemap/onemap_themes.json (list[str] or {"querynames": [...]})
      - backend/etl/data/onemap/onemap_themes_allowlist.txt (one queryname per line)
    """
    # Prefer JSON allowlist if present
    json_path = DATA_DIR / "onemap" / "onemap_themes.json"
    if json_path.exists():
        try:
            import json as _json
            data = _json.loads(json_path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return {str(x).strip() for x in data if str(x).strip()}
            if isinstance(data, dict):
                qns = data.get("querynames") or data.get("QueryNames") or data.get("QUERYNAMES")
                if isinstance(qns, list):
                    return {str(x).strip() for x in qns if str(x).strip()}
        except Exception:
            pass

    # Fallback to simple text allowlist
    txt_path = DATA_DIR / "onemap" / "onemap_themes_allowlist.txt"
    if txt_path.exists():
        try:
            items = [ln.strip() for ln in txt_path.read_text(encoding="utf-8").splitlines() if ln.strip()]
            return set(items)
        except Exception:
            pass
    return set()


def fetch_onemap_themes(
    page_delay: float = 0.15,
    *,
    save_layers: bool = True,
    layers_dir: Path | None = None,
    extents: Optional[str] = None,
    save_raw_rows: bool = True,
) -> List[Dict]:
    """Fetch amenities directly from OneMap Themes service.

    - Retrieves all themes with moreInfo=Y
    - Filters out excluded THEMENAMEs
    - Retrieves theme data for each remaining theme and maps to standard GeoJSON features
    """
    excluded_qn = _compute_excluded_querynames()
    client = OneMapClient()
    client.ensure_token()

    # Prefer local onemap_themes.json mapping if present; else fall back to API
    local_idx = _load_themes_index()
    if local_idx:
        themes = local_idx
        print(f"Loaded {len(themes)} themes from local onemap_themes.json")
    else:
        themes_url = "https://www.onemap.gov.sg/api/public/themesvc/getAllThemesInfo"
        r = client.get_auth(themes_url, params={"moreInfo": "Y"})
        try:
            r.raise_for_status()
            payload = r.json() if hasattr(r, "json") else {}
        except Exception:
            payload = {}
        themes = payload.get("Theme_Names", []) if isinstance(payload, dict) else []
        print(f"Found {len(themes)} OneMap themes (before exclusions)")

    features: List[Dict] = []
    retrieved_log: List[Dict] = []
    allow_qn = _load_themes_allowlist()
    # Prepare per-theme layer output directory if saving is enabled
    if save_layers:
        try:
            out_dir = layers_dir or (GEOJSON_DIR / "layers")
            out_dir.mkdir(parents=True, exist_ok=True)
        except Exception as _e:
            print(f"  ⚠ Failed to prepare layers dir: {out_dir if 'out_dir' in locals() else '<unset>'} => {_e}")
            save_layers = False
    for idx, t in enumerate(themes, start=1):
        themename = (t.get("THEMENAME") or "").strip()
        queryname = (t.get("QUERYNAME") or "").strip()
        if not themename or not queryname:
            continue
        # Exclude strictly by queryname (computed from local index + explicit list)
        if queryname in excluded_qn:
            continue
        # If allowlist exists, only include listed querynames
        if allow_qn and queryname not in allow_qn:
            continue
        # Retrieve theme items
        data_url = "https://www.onemap.gov.sg/api/public/themesvc/retrieveTheme"
        try:
            params = {"queryName": queryname, "moreInfo": "Y"}
            if extents:
                params["extents"] = extents
            resp = client.get_auth(data_url, params=params)
            resp.raise_for_status()
            data = resp.json() if hasattr(resp, "json") else {}
            rows = data.get("SrchResults", []) if isinstance(data, dict) else []
            # Fallback: if no rows returned and no explicit extents, try SG-wide extents once
            if not rows and not extents:
                params_fallback = {"queryName": queryname, "extents": SINGAPORE_EXTENTS, "moreInfo": "Y"}
                resp2 = client.get_auth(data_url, params=params_fallback)
                if resp2.status_code == 200:
                    data2 = resp2.json() if hasattr(resp2, "json") else {}
                    rows = data2.get("SrchResults", []) if isinstance(data2, dict) else []
        except Exception as ex:
            print(f"    ⚠ retrieveTheme failed for {queryname}: {ex}")
            rows = []
        # Record retrieval attempt for lookup table
        retrieved_log.append({
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "themename": themename,
            "queryname": queryname,
            "count": len(rows),
        })
        if idx % 10 == 0:
            print(f"  Processed {idx}/{len(themes)} themes… (last included: {themename})")
        # Optionally save raw rows for debugging
        if save_raw_rows:
            try:
                raw_dir = DATA_DIR / "onemap" / "raw"
                raw_dir.mkdir(parents=True, exist_ok=True)
                with open(raw_dir / f"{queryname}.json", "w", encoding="utf-8") as rf:
                    json.dump(rows, rf)
            except Exception:
                pass

        # Map rows to standard GeoJSON features
        per_theme_features: List[Dict] = []
        for item in rows:
            geometry, lon, lat = _parse_onemap_geometry(item)
            if geometry is None:
                continue
            name = _extract_name(item, themename, queryname)
            # Preserve rich description fields for better downstream classification
            description = (
                item.get("DESCRIPTION")
                or item.get("Description")
                or item.get("DESC")
                or item.get("ADDRESSBUILDINGNAME")
                or item.get("BUILDINGNAME")
                or ""
            )
            postal = (
                item.get("POSTAL") or item.get("ADDRESSPOSTALCODE") or item.get("POSTAL_CD") or ""
            )
            road = (
                item.get("ROAD_NAME") or item.get("ADDRESSSTREETNAME") or item.get("ROADNAME") or ""
            )
            # Unify AED theme ids under a common queryname for stable downstream mapping
            qn_norm = queryname.lower()
            if qn_norm in {"aed_locations", "public_access_aeds", "aeds"}:
                unified_type = "public_access_aeds"
            else:
                unified_type = queryname
            feat = {
                "type": "Feature",
                "geometry": geometry,
                "properties": {
                    "amenity_id": generate_amenity_id(),
                    # Standardise to QUERYNAME for amenity_type across pipeline (unified for AEDs)
                    "amenity_type": unified_type,
                    # Keep both for reference/debugging
                    "theme_name": themename,
                    "theme_queryname": unified_type,
                    "amenity_name": str(name),
                    "description": str(description),
                    "road_name": str(road),
                    "postal_code": str(postal),
                    "geom_type": geometry.get("type", "Point"),
                    "lon": float(lon) if lon is not None else None,
                    "lat": float(lat) if lat is not None else None,
                    "source_file": f"onemap_theme:{queryname}",
                },
            }
            features.append(feat)
            per_theme_features.append(feat)
        time.sleep(page_delay)
        # Optionally persist this theme as its own GeoJSON layer for inspection
        if save_layers:
            try:
                out_dir = layers_dir or (GEOJSON_DIR / "layers")
                out_path = out_dir / f"{queryname}.geojson"
                with open(out_path, "w", encoding="utf-8") as f:
                    json.dump({"type": "FeatureCollection", "features": per_theme_features}, f)
                print(f"  ↳ Saved layer: {out_path.name} ({len(per_theme_features):,} features)")
            except Exception as e:
                print(f"  ⚠ Failed to save layer for {queryname}: {e}")
    # Persist retrieved themes lookup table
    try:
        onemap_dir = DATA_DIR / "onemap"
        onemap_dir.mkdir(parents=True, exist_ok=True)
        out_csv = onemap_dir / "retrieved_themes.csv"
        new_df = pd.DataFrame(retrieved_log)
        if out_csv.exists():
            try:
                old_df = pd.read_csv(out_csv)
                merged = pd.concat([old_df, new_df], ignore_index=True)
            except Exception:
                merged = new_df
        else:
            merged = new_df
        merged.to_csv(out_csv, index=False)
    except Exception as e:
        print(f"  ⚠ Failed to write retrieved_themes.csv: {e}")

    return features


def save_consolidated(geojson_data: Dict, output_file: Path) -> None:
    """Save consolidated GeoJSON to file."""
    print(f"\nSaving consolidated data to: {output_file}")

    output_file.parent.mkdir(parents=True, exist_ok=True)

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(geojson_data, f)

    file_size = output_file.stat().st_size / 1024 / 1024
    print(f"  ✓ Saved {file_size:.1f} MB")


def consolidate_amenities(output_file: Path = OUTPUT_FILE, *, save: bool = True) -> Dict:
    """
    Main entry point for amenities consolidation.

    Args:
        output_file: Path to save consolidated GeoJSON

    Returns:
        Dictionary containing consolidated GeoJSON data
    """
    consolidated_geojson = consolidate_all()
    if save and output_file:
        save_consolidated(consolidated_geojson, output_file)
    return consolidated_geojson


def main():
    """Run consolidation as standalone script."""
    print("\n" + "="*80)
    print("STEP 00: AMENITIES DATA CONSOLIDATION")
    print("="*80)
    print(f"Data directory: {DATA_DIR}")
    print(f"GeoJSON directory: {GEOJSON_DIR}")
    print(f"Output file: {OUTPUT_FILE}")
    print("="*80)

    consolidated_geojson = consolidate_amenities()

    print("\n" + "="*80)
    print("✓ CONSOLIDATION COMPLETE")
    print("="*80)
    print(f"\nConsolidated file: {OUTPUT_FILE}")
    print(f"Total features: {len(consolidated_geojson['features']):,}")
    print("\nReady for Step 1 (Geocoding)")
    print("="*80 + "\n")


if __name__ == "__main__":
    main()
