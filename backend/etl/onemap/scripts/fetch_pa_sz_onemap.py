#!/usr/bin/env python3
"""
Fetch Planning Areas and Subzones from data.gov.sg APIs, clean attributes,
compute area (km^2), and population density when population is available.

Outputs:
- backend/etl/data/roadnetwork/pa_onemap.geojson
- backend/etl/data/roadnetwork/sz_onemap.geojson

Notes:
- Uses shared utilities from onemap_utils module
- Geodesic polygon area computed via spherical excess or GeoPandas if available
- Population fields are optional; if absent, density remains null
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Import all utilities from the utils module
from onemap_utils import (
    fetch_by_poll_download,
    load_pa_lookup,
    load_sz_lookup,
    load_population_data,
    process_geojson,
    save_geojson,
)


def main() -> int:
    """Main entry point for fetching and processing PA and SZ data."""
    # Resolve paths
    root = Path(__file__).resolve().parents[4]
    out_dir = root / "backend" / "etl" / "data" / "roadnetwork"
    out_dir.mkdir(parents=True, exist_ok=True)

    pa_lookup_path = root / "backend" / "etl" / "data" / "amenities" / "planning_area_lookup.csv"
    sz_lookup_path = root / "backend" / "etl" / "data" / "amenities" / "subzone_lookup.csv"
    singstat_path = root / "backend" / "etl" / "data" / "onemap" / "respopagesexfa2025.csv"

    # Dataset IDs from env or defaults
    pa_dataset_id = os.environ.get("PA_DATASET_ID", "d_4765db0e87b9c86336792efe8a1f7a66")
    sz_dataset_id = os.environ.get("SZ_DATASET_ID", "d_8594ae9ff96d0c708bc2af633048edfb")

    # Load lookups once
    print("Loading lookups and population data...")
    pa_lookup = load_pa_lookup(pa_lookup_path)
    sz_lookup = load_sz_lookup(sz_lookup_path)
    pa_pop, sz_pop = load_population_data(singstat_path)
    print(f"  Loaded {len(pa_lookup)} PA IDs from lookup")
    print(f"  Loaded {len(sz_lookup)} SZ IDs from lookup")
    print(f"  Loaded population data: {len(pa_pop)} PAs, {len(sz_pop)} SZs")

    # Fetch Planning Areas
    print("\nFetching Planning Areas via poll-download...")
    try:
        pa_raw = fetch_by_poll_download(pa_dataset_id)
        print(f"  Fetched {len(pa_raw.get('features', []))} raw PA features")
    except Exception as e:
        print(f"Failed to fetch Planning Areas: {e}")
        return 1

    # Fetch Subzones
    print("\nFetching Subzones via poll-download...")
    try:
        sz_raw = fetch_by_poll_download(sz_dataset_id)
        print(f"  Fetched {len(sz_raw.get('features', []))} raw SZ features")
    except Exception as e:
        print(f"Failed to fetch Subzones: {e}")
        return 1

    # Process Planning Areas
    print("\nProcessing Planning Areas...")
    try:
        pa_clean = process_geojson(pa_raw, "pa", pa_lookup, sz_lookup, pa_pop, sz_pop)
        print(f"  Processed {len(pa_clean.get('features', []))} PA features")
    except Exception as e:
        print(f"Failed to process Planning Areas: {e}")
        import traceback
        traceback.print_exc()
        return 1

    # Process Subzones
    print("\nProcessing Subzones...")
    try:
        sz_clean = process_geojson(sz_raw, "sz", pa_lookup, sz_lookup, pa_pop, sz_pop)
        print(f"  Processed {len(sz_clean.get('features', []))} SZ features")
    except Exception as e:
        print(f"Failed to process Subzones: {e}")
        import traceback
        traceback.print_exc()
        return 1

    # Save outputs to both backend and frontend
    print("\nSaving outputs...")

    # Backend paths
    backend_pa_output = out_dir / "planning_area.geojson"
    backend_sz_output = out_dir / "subzone_area.geojson"

    # Frontend paths
    frontend_dir = root / "frontend" / "public" / "map"
    frontend_dir.mkdir(parents=True, exist_ok=True)
    frontend_pa_output = frontend_dir / "planning_area.geojson"
    frontend_sz_output = frontend_dir / "subzone_area.geojson"

    # Save Planning Area files
    save_geojson(backend_pa_output, pa_clean)
    save_geojson(frontend_pa_output, pa_clean)

    # Save Subzone files
    save_geojson(backend_sz_output, sz_clean)
    save_geojson(frontend_sz_output, sz_clean)

    print(f"\n✓ Backend:")
    print(f"    {backend_pa_output}")
    print(f"    {backend_sz_output}")
    print(f"\n✓ Frontend:")
    print(f"    {frontend_pa_output}")
    print(f"    {frontend_sz_output}")
    print("\nDone! All files updated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
