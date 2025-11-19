#!/usr/bin/env python3
"""
Shared utilities for OneMap data fetching and processing.

Simple function-based utilities for:
- HTTP fetching from data.gov.sg APIs
- Geodesic area calculations
- PA/SZ lookup management
- GeoJSON processing and normalization
"""

from __future__ import annotations

import csv
import json
import math
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests

try:
    import geopandas as gpd  # type: ignore
except ImportError:
    gpd = None  # type: ignore


# Constants
EARTH_RADIUS_M = 6371008.8  # Mean Earth radius (spherical approximation)
UNWANTED_KEYS = {
    "Name", "Description", "PLN_AREA_C", "CA_IND",
    "REGION_N", "REGION_C", "INC_CRC", "FMEL_UPD_D"
}

# Cached lookups
_PA_LOOKUP_CACHE: Optional[Dict[str, int]] = None
_SZ_LOOKUP_CACHE: Optional[Dict[str, int]] = None
_PA_POP_CACHE: Optional[Dict[str, int]] = None
_SZ_POP_CACHE: Optional[Dict[str, int]] = None
_HTTP_SESSION: Optional[requests.Session] = None


# -------------------------
# HTTP Utilities
# -------------------------

def get_http_session() -> requests.Session:
    """Get or create HTTP session with API key headers."""
    global _HTTP_SESSION
    if _HTTP_SESSION is None:
        _HTTP_SESSION = requests.Session()
        _HTTP_SESSION.headers.update({"referer": "https://colab.research.google.com"})

        api_key = (
            os.environ.get("DATA_GOV_API_KEY")
            or os.environ.get("DATA_GOV_SG_API_KEY")
            or os.environ.get("API_KEY")
        )
        if api_key:
            _HTTP_SESSION.headers.update({
                "x-api-key": api_key,
                "X-API-Key": api_key,
                "api-key": api_key,
            })
    return _HTTP_SESSION


def http_get_json(url: str, timeout: int = 60) -> Any:
    """Fetch JSON from URL."""
    resp = get_http_session().get(url, timeout=timeout)
    resp.raise_for_status()
    ctype = resp.headers.get("content-type", "").lower()
    if "application/json" in ctype or resp.text.strip().startswith("{"):
        return resp.json()
    try:
        return json.loads(resp.text)
    except Exception:
        raise RuntimeError(f"Expected JSON from {url}, got Content-Type={ctype}")


def http_get_text(url: str, timeout: int = 120) -> str:
    """Fetch text from URL."""
    resp = get_http_session().get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.text


def fetch_by_poll_download(dataset_id: str) -> Dict[str, Any]:
    """Fetch dataset via poll-download endpoint."""
    poll_url = f"https://api-open.data.gov.sg/v1/public/api/datasets/{dataset_id}/poll-download"
    polled = http_get_json(poll_url)
    if not isinstance(polled, dict) or polled.get("code") != 0:
        raise RuntimeError(polled.get("errMsg") if isinstance(polled, dict) else "Poll failed")
    url = polled["data"]["url"]
    text = http_get_text(url)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise RuntimeError("Downloaded payload is not valid JSON/GeoJSON")


# -------------------------
# Area Calculations
# -------------------------

def _rad(deg: float) -> float:
    """Convert degrees to radians."""
    return deg * math.pi / 180.0


def _ring_area_spherical_sq_m(ring: Iterable[Tuple[float, float]]) -> float:
    """
    Compute signed area of a polygon ring on a sphere (in m^2).
    Uses spherical excess algorithm similar to turf.js.
    """
    coords = list(ring)
    if len(coords) < 3:
        return 0.0

    # Ensure closed ring
    if coords[0] != coords[-1]:
        coords.append(coords[0])

    area = 0.0
    for i in range(len(coords) - 1):
        lon1, lat1 = coords[i]
        lon2, lat2 = coords[i + 1]
        lon1r, lat1r = _rad(lon1), _rad(lat1)
        lon2r, lat2r = _rad(lon2), _rad(lat2)
        area += (lon2r - lon1r) * (2 + math.sin(lat1r) + math.sin(lat2r))

    return (area * (EARTH_RADIUS_M ** 2)) / 2.0


def polygon_area_sq_m(coords: List[List[List[float]]]) -> float:
    """Compute area for a Polygon geometry in square meters."""
    if not coords:
        return 0.0

    # First ring is outer, subsequent rings are holes
    outer = _ring_area_spherical_sq_m([(p[0], p[1]) for p in coords[0]])
    holes = sum(
        _ring_area_spherical_sq_m([(p[0], p[1]) for p in ring])
        for ring in coords[1:]
    )
    return abs(outer) - abs(holes)


def multipolygon_area_sq_m(coords: List[List[List[List[float]]]]) -> float:
    """Compute area for a MultiPolygon geometry in square meters."""
    return sum(polygon_area_sq_m(poly) for poly in coords)


def feature_area_km2(geometry: Dict[str, Any]) -> float:
    """Compute area for a GeoJSON geometry in square kilometers."""
    gtype = geometry.get("type")
    if gtype == "Polygon":
        m2 = polygon_area_sq_m(geometry.get("coordinates", []))
    elif gtype == "MultiPolygon":
        m2 = multipolygon_area_sq_m(geometry.get("coordinates", []))
    else:
        return 0.0
    return m2 / 1_000_000.0


# -------------------------
# Lookup Management
# -------------------------

def load_pa_lookup(lookup_path: Path) -> Dict[str, int]:
    """Load PA ID lookup from CSV (cached)."""
    global _PA_LOOKUP_CACHE
    if _PA_LOOKUP_CACHE is not None:
        return _PA_LOOKUP_CACHE

    mapping: Dict[str, int] = {}
    if not lookup_path.exists():
        _PA_LOOKUP_CACHE = mapping
        return mapping

    with lookup_path.open("r", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            try:
                name = (row.get("planning_area") or "").strip().upper()
                pa_id = int(row.get("pa_id")) if row.get("pa_id") else None
                if name and pa_id is not None:
                    mapping[name] = pa_id
            except Exception:
                continue

    _PA_LOOKUP_CACHE = mapping
    return mapping


def load_sz_lookup(lookup_path: Path) -> Dict[str, int]:
    """Load SZ ID lookup from CSV (cached)."""
    global _SZ_LOOKUP_CACHE
    if _SZ_LOOKUP_CACHE is not None:
        return _SZ_LOOKUP_CACHE

    mapping: Dict[str, int] = {}
    if not lookup_path.exists():
        _SZ_LOOKUP_CACHE = mapping
        return mapping

    with lookup_path.open("r", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            try:
                name = (row.get("subzone") or "").strip().upper()
                sz_id = int(row.get("sz_id")) if row.get("sz_id") else None
                if name and sz_id is not None:
                    mapping[name] = sz_id
            except Exception:
                continue

    _SZ_LOOKUP_CACHE = mapping
    return mapping


def load_population_data(singstat_path: Path) -> Tuple[Dict[str, int], Dict[str, int]]:
    """
    Load and aggregate SingStat population data (cached).
    Returns (pa_pop_map, sz_pop_map) with uppercase keys.
    """
    global _PA_POP_CACHE, _SZ_POP_CACHE
    if _PA_POP_CACHE is not None and _SZ_POP_CACHE is not None:
        return _PA_POP_CACHE, _SZ_POP_CACHE

    pa_map: Dict[str, int] = {}
    sz_map: Dict[str, int] = {}

    if not singstat_path.exists():
        _PA_POP_CACHE, _SZ_POP_CACHE = pa_map, sz_map
        return pa_map, sz_map

    # Find latest time value
    latest_time = None
    rows: List[Dict[str, str]] = []

    with singstat_path.open("r", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            rows.append(row)
            t = row.get("Time")
            if t and (latest_time is None or t > latest_time):
                latest_time = t

    # Aggregate for latest time
    for row in rows:
        if latest_time and row.get("Time") != latest_time:
            continue
        try:
            pa = (row.get("PA") or "").strip().upper()
            sz = (row.get("SZ") or "").strip().upper()
            pop = int((row.get("Pop") or "0").replace(",", "").strip())
        except Exception:
            continue

        if pa:
            pa_map[pa] = pa_map.get(pa, 0) + pop
        if sz:
            sz_map[sz] = sz_map.get(sz, 0) + pop

    _PA_POP_CACHE, _SZ_POP_CACHE = pa_map, sz_map
    return pa_map, sz_map


# -------------------------
# Geometry Utilities
# -------------------------

def strip_z_coords(geom: Dict[str, Any]) -> Dict[str, Any]:
    """Strip Z coordinates to produce 2D GeoJSON."""
    gtype = geom.get("type")
    coords = geom.get("coordinates")

    if gtype == "Polygon" and isinstance(coords, list):
        new_coords = []
        for ring in coords:
            new_ring = [[p[0], p[1]] for p in ring if isinstance(p, (list, tuple)) and len(p) >= 2]
            if new_ring:
                new_coords.append(new_ring)
        return {"type": "Polygon", "coordinates": new_coords}

    if gtype == "MultiPolygon" and isinstance(coords, list):
        new_mpoly = []
        for poly in coords:
            new_poly = []
            for ring in poly:
                new_ring = [[p[0], p[1]] for p in ring if isinstance(p, (list, tuple)) and len(p) >= 2]
                if new_ring:
                    new_poly.append(new_ring)
            if new_poly:
                new_mpoly.append(new_poly)
        return {"type": "MultiPolygon", "coordinates": new_mpoly}

    return geom


def parse_kml_description(desc: str) -> Dict[str, Any]:
    """Parse KML Description HTML to extract key-value pairs."""
    if not isinstance(desc, str) or "<th>" not in desc:
        return {}
    pairs = re.findall(r"<th>([^<]+)</th>\s*<td>([^<]*)</td>", desc)
    return {k.strip(): v.strip() for k, v in pairs}


# -------------------------
# Property Normalization
# -------------------------

def normalize_pa_properties(
    props: Dict[str, Any],
    geom: Dict[str, Any],
    pa_lookup: Dict[str, int],
    pa_pop: Dict[str, int]
) -> Dict[str, Any]:
    """Normalize Planning Area properties."""
    # Parse Description HTML if present
    desc = props.get("Description") or props.get("description")
    parsed = parse_kml_description(desc or "")

    # Extract and normalize name
    name = (
        props.get("PLN_AREA_N")
        or props.get("pln_area_n")
        or parsed.get("PLN_AREA_N")
        or props.get("NAME")
    )
    if isinstance(name, str):
        name = name.strip().upper()

    # Get or generate PA_ID
    pa_id = props.get("PA_ID") or props.get("pa_id")
    if not pa_id and name:
        # Try lookup first
        pa_id = pa_lookup.get(name)
        # Fallback to hash
        if not pa_id:
            pa_id = str(abs(hash(name)) % 10_000_000)

    # Calculate area
    area_km2 = props.get("area")
    if area_km2 is None:
        area_km2 = feature_area_km2(geom)

    # Get population
    population = props.get("population") or props.get("POPULATION")
    try:
        population = int(population) if population not in (None, "") else None
    except Exception:
        population = None

    # Try to get population from SingStat if not present
    if population is None and name:
        population = pa_pop.get(name)

    # Calculate density
    density = None
    if population is not None and area_km2 and area_km2 > 0:
        density = population / area_km2

    # Build cleaned properties
    cleaned = {
        **props,
        **(parsed if parsed else {}),
        "PLN_AREA_N": name,
        "PA_ID": pa_id,
        "area": round(area_km2, 6) if area_km2 else None,
        "population": population,
        "population_density": round(density, 6) if density is not None else None,
    }

    # Remove unwanted keys
    for k in UNWANTED_KEYS:
        cleaned.pop(k, None)

    return cleaned


def normalize_sz_properties(
    props: Dict[str, Any],
    geom: Dict[str, Any],
    pa_lookup: Dict[str, int],
    sz_lookup: Dict[str, int],
    sz_pop: Dict[str, int],
    next_sz_id_counter: Optional[Dict[str, int]] = None
) -> Dict[str, Any]:
    """Normalize Subzone properties."""
    # Parse Description HTML if present
    desc = props.get("Description") or props.get("description")
    parsed = parse_kml_description(desc or "")

    # Extract and normalize names
    subzone_n = (
        props.get("SUBZONE_N")
        or props.get("subzone_n")
        or parsed.get("SUBZONE_N")
        or props.get("NAME")
    )
    pln_area_n = (
        props.get("PLN_AREA_N")
        or props.get("pln_area_n")
        or parsed.get("PLN_AREA_N")
    )

    if isinstance(subzone_n, str):
        subzone_n = subzone_n.strip().upper()
    if isinstance(pln_area_n, str):
        pln_area_n = pln_area_n.strip().upper()

    # Get SZ_ID from lookup table based on subzone name
    sz_id = None
    if subzone_n:
        sz_id = sz_lookup.get(subzone_n)

    # If not found in lookup, assign a new unique ID
    if sz_id is None and next_sz_id_counter is not None:
        # Get next available ID (starts from max lookup ID + 1)
        sz_id = next_sz_id_counter['next']
        next_sz_id_counter['next'] += 1
        # Optionally cache it for consistency
        if subzone_n:
            sz_lookup[subzone_n] = sz_id

    # Get or map PA_ID
    pa_id = props.get("PA_ID") or props.get("pa_id")
    if not pa_id and pln_area_n:
        pa_id = pa_lookup.get(pln_area_n)

    # Calculate area
    area_km2 = props.get("area")
    if area_km2 is None:
        area_km2 = feature_area_km2(geom)

    # Get population
    population = props.get("population") or props.get("POPULATION")
    try:
        population = int(population) if population not in (None, "") else None
    except Exception:
        population = None

    # Try to get population from SingStat if not present
    if population is None and subzone_n:
        population = sz_pop.get(subzone_n)

    # Calculate density
    density = None
    if population is not None and area_km2 and area_km2 > 0:
        density = population / area_km2

    # Build cleaned properties in specific order
    # Only keep: SUBZONE_N, PLN_AREA_N, SZ_ID, PA_ID, area, population, population_density
    from collections import OrderedDict
    cleaned = OrderedDict([
        ("SUBZONE_N", subzone_n),
        ("PLN_AREA_N", pln_area_n),
        ("SZ_ID", sz_id),
        ("PA_ID", pa_id),
        ("area", round(area_km2, 6) if area_km2 else None),
        ("population", population),
        ("population_density", round(density, 6) if density is not None else None),
    ])

    return dict(cleaned)


# -------------------------
# GeoJSON Processing
# -------------------------

def process_geojson(
    payload: Dict[str, Any],
    kind: str,  # "pa" or "sz"
    pa_lookup: Dict[str, int],
    sz_lookup: Dict[str, int],
    pa_pop: Dict[str, int],
    sz_pop: Dict[str, int]
) -> Dict[str, Any]:
    """
    Process GeoJSON FeatureCollection.
    Uses GeoPandas if available for accurate area calculation in SVY21.
    """
    assert payload.get("type") == "FeatureCollection", "Expected GeoJSON FeatureCollection"
    features = payload.get("features", [])

    # Initialize counter for assigning new SZ_IDs (starts from max existing ID + 1)
    next_sz_id_counter = None
    if kind == "sz" and sz_lookup:
        max_id = max(sz_lookup.values()) if sz_lookup else 0
        next_sz_id_counter = {'next': max_id + 1}

    if gpd is not None:
        return _process_with_geopandas(features, kind, pa_lookup, sz_lookup, pa_pop, sz_pop, next_sz_id_counter)
    else:
        return _process_manual(features, kind, pa_lookup, sz_lookup, pa_pop, sz_pop, next_sz_id_counter)


def _process_with_geopandas(
    features: List[Dict[str, Any]],
    kind: str,
    pa_lookup: Dict[str, int],
    sz_lookup: Dict[str, int],
    pa_pop: Dict[str, int],
    sz_pop: Dict[str, int],
    next_sz_id_counter: Optional[Dict[str, int]] = None
) -> Dict[str, Any]:
    """Process using GeoPandas for accurate area calculation."""
    gdf = gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")

    try:
        # Project to SVY21 (EPSG:3414) for accurate area
        gdf = gdf.to_crs(epsg=3414)
        gdf["area"] = gdf.geometry.area / 1e6  # Convert to km²
    except Exception:
        # Fallback to WGS84 area
        gdf["area"] = None

    # Normalize based on type
    if kind == "pa":
        gdf = _normalize_pa_gdf(gdf, pa_lookup, pa_pop)
    else:
        gdf = _normalize_sz_gdf(gdf, pa_lookup, sz_lookup, sz_pop, next_sz_id_counter)

    # Convert back to WGS84 for output
    try:
        gdf_out = gdf.to_crs(epsg=4326)
    except Exception:
        gdf_out = gdf

    # Build output features
    features_out: List[Dict[str, Any]] = []
    for _, row in gdf_out.iterrows():
        geom = row.geometry.__geo_interface__ if row.geometry is not None else None
        if not geom:
            continue

        props = {
            k: (None if isinstance(row[k], float) and math.isnan(row[k]) else row[k])
            for k in gdf_out.columns if k != "geometry"
        }

        # Final normalization pass
        if kind == "pa":
            props = normalize_pa_properties(props, geom, pa_lookup, pa_pop)
        else:
            props = normalize_sz_properties(props, geom, pa_lookup, sz_lookup, sz_pop, next_sz_id_counter)

        features_out.append({"type": "Feature", "properties": props, "geometry": geom})

    return {"type": "FeatureCollection", "features": features_out}


def _process_manual(
    features: List[Dict[str, Any]],
    kind: str,
    pa_lookup: Dict[str, int],
    sz_lookup: Dict[str, int],
    pa_pop: Dict[str, int],
    sz_pop: Dict[str, int],
    next_sz_id_counter: Optional[Dict[str, int]] = None
) -> Dict[str, Any]:
    """Process without GeoPandas using geodesic area calculation."""
    out_features = []
    for feat in features:
        if not isinstance(feat, dict):
            continue
        geom = feat.get("geometry") or {}
        if geom.get("type") not in ("Polygon", "MultiPolygon"):
            continue

        props = feat.get("properties") or {}
        if kind == "pa":
            new_props = normalize_pa_properties(props, geom, pa_lookup, pa_pop)
        else:
            new_props = normalize_sz_properties(props, geom, pa_lookup, sz_lookup, sz_pop, next_sz_id_counter)

        out_features.append({"type": "Feature", "properties": new_props, "geometry": geom})

    return {"type": "FeatureCollection", "features": out_features}


def _normalize_pa_gdf(gdf, pa_lookup: Dict[str, int], pa_pop: Dict[str, int]):
    """Normalize GeoDataFrame for Planning Areas."""
    # Ensure columns exist
    if "PLN_AREA_N" not in gdf.columns:
        gdf["PLN_AREA_N"] = gdf.get("pln_area_n")
    if "PA_ID" not in gdf.columns:
        gdf["PA_ID"] = gdf.get("pa_id")

    # Fallback for missing PA_ID
    def get_pa_id(row):
        if row.get("PA_ID"):
            return row["PA_ID"]
        name = row.get("PLN_AREA_N")
        if name:
            name_u = str(name).strip().upper()
            return pa_lookup.get(name_u) or str(abs(hash(name_u)) % 10_000_000)
        return None

    gdf["PA_ID"] = gdf.apply(get_pa_id, axis=1)

    # Population and density
    def get_population(row):
        pop = row.get("population") or row.get("POPULATION")
        if pop is not None:
            try:
                return int(pop)
            except Exception:
                pass
        name = row.get("PLN_AREA_N")
        if name:
            return pa_pop.get(str(name).strip().upper())
        return None

    gdf["population"] = gdf.apply(get_population, axis=1)
    gdf["population_density"] = gdf.apply(
        lambda r: (r["population"] / r["area"])
        if (r.get("population") is not None and r.get("area") and r["area"] > 0)
        else None,
        axis=1,
    )

    return gdf


def _normalize_sz_gdf(gdf, pa_lookup: Dict[str, int], sz_lookup: Dict[str, int], sz_pop: Dict[str, int], next_sz_id_counter: Optional[Dict[str, int]] = None):
    """Normalize GeoDataFrame for Subzones."""
    # Ensure columns exist
    for col in ("SUBZONE_N", "PLN_AREA_N", "SUBZONE_NO", "PA_ID"):
        if col not in gdf.columns:
            gdf[col] = gdf.get(col.lower())

    # Get SZ_ID from lookup table based on subzone name
    def get_sz_id(row):
        sz_name = row.get("SUBZONE_N") or row.get("subzone_n")
        if sz_name:
            sz_name_u = str(sz_name).strip().upper()
            sz_id = sz_lookup.get(sz_name_u)
            if sz_id is not None:
                return sz_id

            # If not in lookup and counter provided, assign new ID
            if next_sz_id_counter is not None:
                new_id = next_sz_id_counter['next']
                next_sz_id_counter['next'] += 1
                sz_lookup[sz_name_u] = new_id  # Cache it
                return new_id

        # Should not reach here if name is present
        return None

    gdf["SZ_ID"] = gdf.apply(get_sz_id, axis=1)

    # Map PA_ID from lookup
    def get_pa_id(row):
        if row.get("PA_ID"):
            return row["PA_ID"]
        pa_name = row.get("PLN_AREA_N")
        if pa_name:
            return pa_lookup.get(str(pa_name).strip().upper())
        return None

    gdf["PA_ID"] = gdf.apply(get_pa_id, axis=1)

    # Population and density
    def get_population(row):
        pop = row.get("population") or row.get("POPULATION")
        if pop is not None:
            try:
                return int(pop)
            except Exception:
                pass
        sz_name = row.get("SUBZONE_N")
        if sz_name:
            return sz_pop.get(str(sz_name).strip().upper())
        return None

    gdf["population"] = gdf.apply(get_population, axis=1)
    gdf["population_density"] = gdf.apply(
        lambda r: (r["population"] / r["area"])
        if (r.get("population") is not None and r.get("area") and r["area"] > 0)
        else None,
        axis=1,
    )

    return gdf


# -------------------------
# File I/O
# -------------------------

def save_geojson(path: Path, payload: Dict[str, Any]) -> None:
    """Save GeoJSON to file with 2D coordinates."""
    if payload.get("type") == "FeatureCollection":
        feats = []
        for f in payload.get("features", []):
            if not isinstance(f, dict):
                continue
            geom = f.get("geometry")
            if isinstance(geom, dict):
                geom = strip_z_coords(geom)
            feats.append({
                "type": "Feature",
                "properties": f.get("properties", {}),
                "geometry": geom
            })
        payload = {"type": "FeatureCollection", "features": feats}

    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
