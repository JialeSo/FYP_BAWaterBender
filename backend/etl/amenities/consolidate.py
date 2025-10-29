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
import uuid
from collections import ChainMap, Counter
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

from backend.etl.amenities.core.naming import infer_amenity_name

# Paths
SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR.parent.parent / "data"
GEOJSON_DIR = DATA_DIR / "geojson"
AMENITIES_DIR = DATA_DIR / "amenities"

# Input files
OSM_ONEMAP_FILE = AMENITIES_DIR / "osm_onemap_matched.json"

# Output file
OUTPUT_FILE = DATA_DIR / "amenities_consolidated.geojson"

# Files to skip
SKIP_FILES = [
    'all_amenities.geojson',      # Aggregated
    'arcgis_amenities.geojson',   # Aggregated
    'planning_area.geojson',      # Reference layer
    'subzone_area.geojson',       # Reference layer
    'road_network.geojson',       # Reference layer
]

NAME_FILL_STATS = {
    "geojson": Counter(),
    "osm": Counter(),
}


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


def generate_amenity_id() -> str:
    """Generate unique amenity ID."""
    return str(uuid.uuid4())


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

    amenity_type = _normalise_amenity_type(props, source_file)

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

    return {
        'type': 'Feature',
        'geometry': geom,
        'properties': {
            'amenity_id': props.get('amenity_id') or generate_amenity_id(),
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


def load_geojson_files() -> List[Dict]:
    """Load all GeoJSON files from geojson/ directory."""
    print("\nLoading GeoJSON amenity files...")

    features = []
    file_count = 0
    feature_count = 0

    geojson_files = sorted(GEOJSON_DIR.glob("*.geojson"))

    for geojson_file in geojson_files:
        # Skip files in skip list
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

    # 1. Load GeoJSON files
    geojson_features = load_geojson_files()
    all_features.extend(geojson_features)
    print(f"\nGeoJSON subtotal: {len(geojson_features):,} features")

    # 2. Load OSM OnEMap data
    osm_features = load_osm_onemap()
    all_features.extend(osm_features)
    print(f"OSM OnEMap subtotal: {len(osm_features):,} features")

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


def save_consolidated(geojson_data: Dict, output_file: Path) -> None:
    """Save consolidated GeoJSON to file."""
    print(f"\nSaving consolidated data to: {output_file}")

    output_file.parent.mkdir(parents=True, exist_ok=True)

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(geojson_data, f)

    file_size = output_file.stat().st_size / 1024 / 1024
    print(f"  ✓ Saved {file_size:.1f} MB")


def consolidate_amenities(output_file: Path = OUTPUT_FILE) -> Dict:
    """
    Main entry point for amenities consolidation.

    Args:
        output_file: Path to save consolidated GeoJSON

    Returns:
        Dictionary containing consolidated GeoJSON data
    """
    consolidated_geojson = consolidate_all()
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
