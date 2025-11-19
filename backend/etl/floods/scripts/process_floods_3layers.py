#!/usr/bin/env python3
"""
Process Floods Data with Amenities Pipeline Logic
==================================================

This script applies the same geocoding and road matching logic used for amenities
to the floods data, producing a floods_3layers.csv with pa_id, sz_id, and rn_id.

The script:
1. Loads floods CSV data with lat/lon coordinates
2. Uses spatial joins to match planning areas (pa_id) and subzones (sz_id)
3. Uses OSMnx road matching to find nearest road segments (rn_id)
4. Outputs floods_3layers.csv with the correct ID columns
"""

from pathlib import Path
import sys
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point

# Add project root (directory containing the 'backend' package) to sys.path
# This allows running the script directly via `python backend/etl/floods/scripts/process_floods_3layers.py`
PROJECT_ROOT = Path(__file__).resolve().parents[4]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Use the consolidated road network graph used by the amenities pipeline
from backend.etl.amenities.match_roads import RoadNetworkGraph


def process_floods_data(
    floods_csv: Path,
    planning_geojson: Path,
    subzone_geojson: Path,
    road_network_geojson: Path,
    output_csv: Path,
) -> pd.DataFrame:
    """
    Process floods data with geocoding and road matching.

    Args:
        floods_csv: Path to input floods CSV with lat/lon coordinates
        planning_geojson: Path to planning areas GeoJSON
        subzone_geojson: Path to subzones GeoJSON
        road_network_geojson: Path to road network GeoJSON
        output_csv: Path to save output CSV

    Returns:
        Processed DataFrame with pa_id, sz_id, rn_id
    """
    print("\n" + "="*70)
    print("FLOODS DATA PROCESSING - Using Amenities Pipeline Logic")
    print("="*70 + "\n")

    # Load floods data
    print(f"Loading floods data from {floods_csv.name}...")
    floods_df = pd.read_csv(floods_csv)

    # Normalize postal codes early to avoid float artifacts and preserve leading zeros
    def _normalize_postal_series(series: pd.Series) -> pd.Series:
        def _norm(val):
            if pd.isna(val):
                return None
            s = str(val).strip()
            if not s:
                return None
            # Strip any decimal component like '769093.0'
            if "." in s:
                s = s.split(".", 1)[0]
            # Keep only digits
            s = "".join(ch for ch in s if ch.isdigit())
            if not s:
                return None
            # Postal codes are 6 digits in SG – clamp and pad
            if len(s) > 6:
                s = s[-6:]
            return s.zfill(6)

        return series.apply(_norm)

    for _pc_col in ["start_postal_code", "end_postal_code"]:
        if _pc_col in floods_df.columns:
            floods_df[_pc_col] = _normalize_postal_series(floods_df[_pc_col])

    print(f"  Loaded {len(floods_df):,} flood events")

    # Check for required columns
    if 'start_lat' not in floods_df.columns or 'start_lng' not in floods_df.columns:
        raise ValueError("Floods CSV must contain 'start_lat' and 'start_lng' columns")

    # Load planning areas and subzones
    print("\nLoading planning areas...")
    planning_gdf = gpd.read_file(planning_geojson).to_crs("EPSG:4326")
    print(f"  Loaded {len(planning_gdf):,} planning areas")

    print("Loading subzones...")
    subzone_gdf = gpd.read_file(subzone_geojson).to_crs("EPSG:4326")
    print(f"  Loaded {len(subzone_gdf):,} subzones")

    # Load road network
    print("\nLoading road network...")
    network = RoadNetworkGraph(road_network_geojson)
    _, edges_gdf = network.load()
    # OSMnxAmenitySnapper not required; we use sjoin_nearest for floods (small N)

    # ========================================================================
    # PROCESS START LOCATIONS
    # ========================================================================
    print("\n" + "="*70)
    print("PROCESSING START LOCATIONS")
    print("="*70)

    # Create GeoDataFrame from START coordinates
    start_geometry = [Point(xy) for xy in zip(floods_df['start_lng'], floods_df['start_lat'])]
    start_gdf = gpd.GeoDataFrame(floods_df[['id', 'start_lat', 'start_lng']],
                                  geometry=start_geometry, crs="EPSG:4326")

    # Spatial joins for START location
    print("Joining START locations with planning areas...")
    start_gdf = gpd.sjoin(start_gdf, planning_gdf[['PA_ID', 'geometry']],
                          how='left', predicate='within')
    start_gdf = start_gdf.rename(columns={'PA_ID': 'start_pa_id'})
    if 'index_right' in start_gdf.columns:
        start_gdf = start_gdf.drop(columns=['index_right'])

    print("Joining START locations with subzones...")
    start_gdf = gpd.sjoin(start_gdf, subzone_gdf[['SZ_ID', 'geometry']],
                          how='left', predicate='within')
    start_gdf = start_gdf.rename(columns={'SZ_ID': 'start_sz_id'})
    if 'index_right' in start_gdf.columns:
        start_gdf = start_gdf.drop(columns=['index_right'])

    # Remove duplicates
    start_gdf = start_gdf.drop_duplicates(subset=['id'], keep='first')

    # Road matching for START location using nearest edge from edges_gdf
    print("Snapping START locations to road network and computing origin point...")
    start_nn = gpd.sjoin_nearest(
        start_gdf[['id', 'geometry']],
        edges_gdf[['geometry', 'road_id']],
        how='left',
        distance_col='edge_distance'
    )
    start_nn = start_nn.rename(columns={'index_right': 'edge_idx'})

    # Compute snapped point (origin) on the nearest road segment
    def _snap_point_to_edge(row):
        try:
            line = edges_gdf.loc[row['edge_idx'], 'geometry']
            pt = row['geometry']
            snapped = line.interpolate(line.project(pt))
            return snapped.y, snapped.x
        except Exception:
            return None, None

    origin_coords = start_nn.apply(lambda r: _snap_point_to_edge(r), axis=1, result_type='expand')
    start_nn['origin_lat'] = origin_coords[0]
    start_nn['origin_lng'] = origin_coords[1]

    # Also compute two offset points along the road at +/-100m from the origin (for visualization)
    # We use EPSG:3414 (meter-based projection) for accurate distance calculations
    start_nn = start_nn.merge(floods_df[['id', 'end_lat', 'end_lng']], on='id', how='left')

    def _offset_points(row, offset_m=100.0):
        """Compute offset points ±offset_m from origin using meter-based projection.

        Uses EPSG:3414 (Singapore's meter projection) for accurate interpolation,
        with clamping at segment boundaries. Default offset is 100m (balanced between
        visibility and clamping - 81% of segments < 100m will still clamp).
        """
        try:
            # Only synthesize when END coordinates are missing
            if pd.notna(row.get('end_lat')) and pd.notna(row.get('end_lng')):
                return None, None, None, None

            idx = row['edge_idx']
            if pd.isna(idx):
                return None, None, None, None

            line_wgs = edges_gdf.loc[idx, 'geometry']
            if line_wgs is None:
                return None, None, None, None

            # Convert to EPSG:3414 (Singapore meter-based projection) for accurate interpolation
            line_s = gpd.GeoSeries([line_wgs], crs='EPSG:4326').to_crs('EPSG:3414')

            # If origin snapped is missing, use original start point
            base_pt_wgs = row['geometry'] if pd.isna(row['origin_lat']) else Point(row['origin_lng'], row['origin_lat'])
            pt_s = gpd.GeoSeries([base_pt_wgs], crs='EPSG:4326').to_crs('EPSG:3414')

            line_m = line_s.iloc[0]
            pt_m = pt_s.iloc[0]

            # Find position along line in meters
            d = float(line_m.project(pt_m))

            # Clamp to segment boundaries (accept clamping)
            d1 = max(0.0, d - offset_m)
            d2 = min(float(line_m.length), d + offset_m)

            # Interpolate points in EPSG:3414
            p1_m = line_m.interpolate(d1)
            p2_m = line_m.interpolate(d2)

            # Convert back to WGS84
            p1_wgs = gpd.GeoSeries([p1_m], crs='EPSG:3414').to_crs('EPSG:4326').iloc[0]
            p2_wgs = gpd.GeoSeries([p2_m], crs='EPSG:3414').to_crs('EPSG:4326').iloc[0]

            return p1_wgs.y, p1_wgs.x, p2_wgs.y, p2_wgs.x
        except Exception:
            return None, None, None, None

    # 100 m offsets (balanced between visibility and clamping)
    offsets100 = start_nn.apply(lambda r: _offset_points(r, 100.0), axis=1, result_type='expand')
    start_nn['end100_a_lat'] = offsets100[0]  # Keep column names for compatibility
    start_nn['end100_a_lng'] = offsets100[1]
    start_nn['end100_b_lat'] = offsets100[2]
    start_nn['end100_b_lng'] = offsets100[3]

    # Derive integer start_rn_id from road_id like "R042218" -> 42218
    start_nn['start_rn_id'] = (
        start_nn['road_id'].astype(str).str.extract(r'(\d+)').fillna('0').astype(int)
    )

    # Remove duplicates from road matching (sjoin_nearest can create duplicates)
    start_nn = start_nn.drop_duplicates(subset=['id'], keep='first')

    # ========================================================================
    # COMPUTE ORIGIN POINT PA/SZ IDs (RN ID is same as start_rn_id)
    # ========================================================================
    print("Computing PA/SZ IDs for origin (snapped) points...")

    # Create GeoDataFrame from ORIGIN coordinates (snapped points on roads)
    origin_rows = start_nn[start_nn['origin_lat'].notna() & start_nn['origin_lng'].notna()].copy()
    if len(origin_rows) > 0:
        origin_geometry = [Point(xy) for xy in zip(origin_rows['origin_lng'], origin_rows['origin_lat'])]
        origin_gdf = gpd.GeoDataFrame(
            origin_rows[['id', 'origin_lat', 'origin_lng', 'start_rn_id']],
            geometry=origin_geometry,
            crs="EPSG:4326"
        )

        # Spatial join with Planning Areas
        print("  Joining origin points with planning areas...")
        origin_gdf = gpd.sjoin(
            origin_gdf, planning_gdf[['PA_ID', 'geometry']],
            how='left', predicate='within'
        )
        origin_gdf = origin_gdf.rename(columns={'PA_ID': 'origin_pa_id'})
        if 'index_right' in origin_gdf.columns:
            origin_gdf = origin_gdf.drop(columns=['index_right'])

        # Spatial join with Subzones
        print("  Joining origin points with subzones...")
        origin_gdf = gpd.sjoin(
            origin_gdf, subzone_gdf[['SZ_ID', 'geometry']],
            how='left', predicate='within'
        )
        origin_gdf = origin_gdf.rename(columns={'SZ_ID': 'origin_sz_id'})
        if 'index_right' in origin_gdf.columns:
            origin_gdf = origin_gdf.drop(columns=['index_right'])

        # Remove duplicates
        origin_gdf = origin_gdf.drop_duplicates(subset=['id'], keep='first')

        # Origin road ID is the same as start_rn_id (origin is snapped to that road)
        origin_gdf['origin_rn_id'] = origin_gdf['start_rn_id']

        # Merge origin IDs back to start_nn
        origin_ids_df = pd.DataFrame(origin_gdf.drop(columns='geometry'))
        origin_ids_df = origin_ids_df[['id', 'origin_pa_id', 'origin_sz_id', 'origin_rn_id']]

        start_nn = start_nn.merge(origin_ids_df, on='id', how='left')
    else:
        # No origin points, add empty columns
        start_nn['origin_pa_id'] = 0
        start_nn['origin_sz_id'] = 0
        start_nn['origin_rn_id'] = 0

    # Merge START results
    start_df = pd.DataFrame(start_gdf.drop(columns='geometry'))
    start_df = start_df.merge(
        start_nn[['id', 'start_rn_id', 'origin_lat', 'origin_lng',
                  'origin_pa_id', 'origin_sz_id', 'origin_rn_id',
                  'end100_a_lat', 'end100_a_lng', 'end100_b_lat', 'end100_b_lng']],
        on='id', how='left'
    )
    start_df = start_df[['id', 'start_pa_id', 'start_sz_id', 'start_rn_id',
                         'origin_lat', 'origin_lng', 'origin_pa_id', 'origin_sz_id', 'origin_rn_id',
                         'end100_a_lat', 'end100_a_lng', 'end100_b_lat', 'end100_b_lng']]

    # ========================================================================
    # PROCESS END LOCATIONS (if they exist)
    # ========================================================================
    print("\n" + "="*70)
    print("PROCESSING END LOCATIONS")
    print("="*70)

    # Check if we have end coordinates
    has_end_coords = floods_df['end_lat'].notna() & floods_df['end_lng'].notna()
    end_floods_df = floods_df[has_end_coords].copy()

    if len(end_floods_df) > 0:
        print(f"Found {len(end_floods_df)} floods with end locations")

        # Create GeoDataFrame from END coordinates
        end_geometry = [Point(xy) for xy in zip(end_floods_df['end_lng'], end_floods_df['end_lat'])]
        end_gdf = gpd.GeoDataFrame(end_floods_df[['id', 'end_lat', 'end_lng']],
                                    geometry=end_geometry, crs="EPSG:4326")

        # Spatial joins for END location
        print("Joining END locations with planning areas...")
        end_gdf = gpd.sjoin(end_gdf, planning_gdf[['PA_ID', 'geometry']],
                            how='left', predicate='within')
        end_gdf = end_gdf.rename(columns={'PA_ID': 'end_pa_id'})
        if 'index_right' in end_gdf.columns:
            end_gdf = end_gdf.drop(columns=['index_right'])

        print("Joining END locations with subzones...")
        end_gdf = gpd.sjoin(end_gdf, subzone_gdf[['SZ_ID', 'geometry']],
                            how='left', predicate='within')
        end_gdf = end_gdf.rename(columns={'SZ_ID': 'end_sz_id'})
        if 'index_right' in end_gdf.columns:
            end_gdf = end_gdf.drop(columns=['index_right'])

        # Remove duplicates
        end_gdf = end_gdf.drop_duplicates(subset=['id'], keep='first')

        # Road matching for END location using nearest edge
        print("Snapping END locations to road network...")
        end_nn = gpd.sjoin_nearest(
            end_gdf[['id', 'geometry']],
            edges_gdf[['geometry', 'road_id']],
            how='left',
            distance_col='edge_distance'
        )
        end_nn['end_rn_id'] = (
            end_nn['road_id'].astype(str).str.extract(r'(\d+)').fillna('0').astype(int)
        )

        # Remove duplicates from road matching (sjoin_nearest can create duplicates)
        end_nn = end_nn.drop_duplicates(subset=['id'], keep='first')

        # Merge END results
        end_df = pd.DataFrame(end_gdf.drop(columns='geometry'))
        end_df = end_df.merge(end_nn[['id', 'end_rn_id']], on='id', how='left')
        end_df = end_df[['id', 'end_pa_id', 'end_sz_id', 'end_rn_id']]
    else:
        print("No floods with end locations found")
        end_df = pd.DataFrame(columns=['id', 'end_pa_id', 'end_sz_id', 'end_rn_id'])

    # ========================================================================
    # MERGE START AND END DATA
    # ========================================================================
    print("\n" + "="*70)
    print("MERGING RESULTS")
    print("="*70)

    # Start with a fresh copy of the original floods data to preserve ALL columns
    df = floods_df.copy()

    # Drop old planning/subzone/road columns that we'll replace with new IDs
    cols_to_drop = [
        'start_planning_area', 'start_planning_area_id',
        'start_subzone', 'start_subzone_id',
        'start_street_name', 'start_street_id', 'nearest_road_1_id',
        'end_planning_area', 'end_planning_area_id',
        'end_subzone', 'end_subzone_id',
        'end_street_name', 'end_street_id'
    ]
    for col in cols_to_drop:
        if col in df.columns:
            df = df.drop(columns=[col])

    # Merge the new ID columns
    df = df.merge(start_df, on='id', how='left')
    if len(end_df) > 0:
        df = df.merge(end_df, on='id', how='left')
    else:
        df['end_pa_id'] = 0
        df['end_sz_id'] = 0
        df['end_rn_id'] = 0

    # Convert ID columns to integers
    id_columns = [
        'start_pa_id', 'start_sz_id', 'start_rn_id',
        'origin_pa_id', 'origin_sz_id', 'origin_rn_id',
        'end_pa_id', 'end_sz_id', 'end_rn_id'
    ]
    for col in id_columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0).astype(int)

    # Reorder columns with essential ones first
    essential_cols = [
        'id', 'text', 'event_date', 'location', 'event',
        'start_loc', 'end_loc', 'parent_road', 'cleaned_location',
        'start_lat', 'start_lng', 'start_postal_code',
        'start_pa_id', 'start_sz_id', 'start_rn_id',
        'origin_lat', 'origin_lng', 'origin_pa_id', 'origin_sz_id', 'origin_rn_id',
        'end100_a_lat', 'end100_a_lng', 'end100_b_lat', 'end100_b_lng',
        'end_lat', 'end_lng', 'end_postal_code',
        'end_pa_id', 'end_sz_id', 'end_rn_id',
    ]
    # Keep essential columns in order, then add any remaining columns
    final_cols = [col for col in essential_cols if col in df.columns]
    other_cols = [col for col in df.columns if col not in final_cols]
    df = df[final_cols + other_cols]

    # Final deduplication to ensure no duplicates (spatial joins can create duplicates)
    df = df.drop_duplicates(subset=['id'], keep='first')

    # Exclude subsided events from the exported CSV to match upload rules
    try:
        df = df[df['event'].astype(str).str.strip().str.lower() != 'flood_subsided']
    except Exception:
        pass

    # Save to CSV
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_csv, index=False)
    print(f"\n  ✓ Saved {len(df):,} flood events to {output_csv}")
    print(f"  Columns: {', '.join(df.columns.tolist()[:15])}...\n")

    # Print summary statistics
    print("Summary:")
    print(f"  Total flood events: {len(df):,}")
    print(f"  Events with START location data:")
    print(f"    - Planning area: {df['start_pa_id'].gt(0).sum():,}")
    print(f"    - Subzone: {df['start_sz_id'].gt(0).sum():,}")
    print(f"    - Road network: {df['start_rn_id'].gt(0).sum():,}")
    print(f"  Events with END location data:")
    print(f"    - Planning area: {df['end_pa_id'].gt(0).sum():,}")
    print(f"    - Subzone: {df['end_sz_id'].gt(0).sum():,}")
    print(f"    - Road network: {df['end_rn_id'].gt(0).sum():,}")
    print()

    return df


def main():
    """Main entry point."""
    # Define paths
    # Use the shared ETL data directory: backend/etl/data
    # From this script (backend/etl/floods/scripts), parents[2] == backend/etl
    BASE_DIR = Path(__file__).resolve().parents[2]
    DATA_DIR = BASE_DIR / "data"

    # Input paths
    floods_csv = DATA_DIR / "floods" / "floods_fixed.csv"
    planning_geojson = DATA_DIR / "geojson" / "planning_area.geojson"
    subzone_geojson = DATA_DIR / "geojson" / "subzone_area.geojson"
    road_network_geojson = DATA_DIR / "roadnetwork" / "road_network.geojson"

    # Output paths (save to backend/etl/data/floods/)
    output_dir = DATA_DIR / "floods"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_csv = output_dir / "floods_3layers.csv"

    # Check if input files exist
    missing_files = []
    for path in [floods_csv, planning_geojson, subzone_geojson, road_network_geojson]:
        if not path.exists():
            missing_files.append(str(path))

    if missing_files:
        print("ERROR: Missing required input files:")
        for f in missing_files:
            print(f"  - {f}")
        return

    # Process floods data
    process_floods_data(
        floods_csv=floods_csv,
        planning_geojson=planning_geojson,
        subzone_geojson=subzone_geojson,
        road_network_geojson=road_network_geojson,
        output_csv=output_csv,
    )

    print("Processing complete!")
    print(f"\nOutput saved to: {output_csv}")


if __name__ == "__main__":
    main()
