"""
Reusable Spatial Geocoding Utilities
======================================

Provides spatial join functions for geocoding amenities/locations to:
- Planning Areas (pa_id)
- Subzones (sz_id)
- Road Network (rn_id)

Used by amenities, ACRA, floods, and other ETL pipelines.
"""

import logging
from pathlib import Path
from typing import Optional, Union

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

logger = logging.getLogger(__name__)


def add_three_layer_geocoding(
    df: pd.DataFrame,
    lat_col: str = "latitude",
    lon_col: str = "longitude",
    planning_geojson: Optional[Path] = None,
    subzone_geojson: Optional[Path] = None,
    road_network_geojson: Optional[Path] = None,
) -> pd.DataFrame:
    """
    Add three-layer geocoding (planning area, subzone, road network) to a DataFrame.

    This function performs spatial joins to enrich location data with:
    - pa_id: Planning Area ID
    - planning_area: Planning Area name
    - sz_id: Subzone ID
    - subzone: Subzone name
    - rn_id: Road Network ID
    - road_name: Road name (from nearest road segment)

    Args:
        df: DataFrame with latitude/longitude columns
        lat_col: Name of latitude column (default: "latitude")
        lon_col: Name of longitude column (default: "longitude")
        planning_geojson: Path to planning areas GeoJSON
        subzone_geojson: Path to subzones GeoJSON
        road_network_geojson: Path to road network GeoJSON

    Returns:
        DataFrame with added geocoding columns (pa_id, sz_id, rn_id, etc.)

    Example:
        >>> df = pd.DataFrame({
        ...     'name': ['Business A'],
        ...     'latitude': [1.2897],
        ...     'longitude': [103.8501]
        ... })
        >>> df = add_three_layer_geocoding(
        ...     df,
        ...     planning_geojson=Path('planning_area.geojson'),
        ...     subzone_geojson=Path('subzone_area.geojson')
        ... )
        >>> print(df[['name', 'pa_id', 'sz_id']])
    """
    if df.empty:
        logger.warning("Empty DataFrame provided to spatial geocoding")
        return df

    # Check if lat/lon columns exist and have valid data
    if lat_col not in df.columns or lon_col not in df.columns:
        logger.warning(f"Latitude/longitude columns not found: {lat_col}, {lon_col}")
        return df

    # Filter to rows with valid coordinates
    valid_coords = df[lat_col].notna() & df[lon_col].notna()
    if not valid_coords.any():
        logger.warning("No valid coordinates found for spatial geocoding")
        return df

    logger.info(f"Starting three-layer geocoding for {valid_coords.sum():,} records with coordinates...")

    # Create a lookup key for unique coordinates (including postal_code if available)
    df_work = df.copy()
    if 'postal_code' in df_work.columns:
        df_work['_coord_key'] = (
            df_work['postal_code'].astype(str) + '|' +
            df_work[lat_col].astype(str) + '|' +
            df_work[lon_col].astype(str)
        )
    else:
        df_work['_coord_key'] = (
            df_work[lat_col].astype(str) + '|' +
            df_work[lon_col].astype(str)
        )

    # Get unique coordinates only (to avoid redundant spatial joins)
    logger.info(f"  Identifying unique coordinate locations...")
    unique_coords = df_work[valid_coords].drop_duplicates(subset=['_coord_key']).copy()
    logger.info(f"  Found {len(unique_coords):,} unique locations from {valid_coords.sum():,} total records")

    # Convert unique coordinates to GeoDataFrame
    logger.info(f"  Converting unique locations to GeoDataFrame...")
    geometries = []
    for idx, row in unique_coords.iterrows():
        lat = row[lat_col]
        lon = row[lon_col]
        try:
            lat_f = float(lat)
            lon_f = float(lon)
            geometries.append(Point(lon_f, lat_f))
        except (ValueError, TypeError):
            geometries.append(None)

    gdf = gpd.GeoDataFrame(
        unique_coords,
        geometry=geometries,
        crs="EPSG:4326"
    )

    # Remove rows with no geometry
    valid_geom_count = gdf.geometry.notna().sum()
    gdf = gdf[gdf.geometry.notna()]
    logger.info(f"  Valid geometries created: {valid_geom_count:,}")

    # 1. Spatial join with Planning Areas
    if planning_geojson and planning_geojson.exists():
        logger.info("  • Joining with planning areas...")
        planning_gdf = gpd.read_file(planning_geojson).to_crs("EPSG:4326")

        # Perform spatial join
        gdf = gpd.sjoin(
            gdf,
            planning_gdf[['PLN_AREA_N', 'PA_ID', 'geometry']],
            how='left',
            predicate='within'
        )

        # Rename columns
        gdf = gdf.rename(columns={
            'PLN_AREA_N': 'planning_area',
            'PA_ID': 'pa_id'
        })

        # Clean up join artifacts
        if 'index_right' in gdf.columns:
            gdf = gdf.drop(columns=['index_right'])

        # Deduplicate (spatial join can create duplicates)
        gdf = gdf.drop_duplicates(subset=['_coord_key'], keep='first')

        matched = gdf['pa_id'].notna().sum()
        logger.info(f"    ✓ Matched {matched:,} unique locations to planning areas")
    else:
        logger.info("  • Skipping planning area join (file not provided or missing)")
        gdf['planning_area'] = None
        gdf['pa_id'] = None

    # 2. Spatial join with Subzones
    if subzone_geojson and subzone_geojson.exists():
        logger.info("  • Joining with subzones...")
        subzone_gdf = gpd.read_file(subzone_geojson).to_crs("EPSG:4326")

        # Perform spatial join
        gdf = gpd.sjoin(
            gdf,
            subzone_gdf[['SUBZONE_N', 'SZ_ID', 'geometry']],
            how='left',
            predicate='within'
        )

        # Rename columns
        gdf = gdf.rename(columns={
            'SUBZONE_N': 'subzone',
            'SZ_ID': 'sz_id'
        })

        # Clean up join artifacts
        if 'index_right' in gdf.columns:
            gdf = gdf.drop(columns=['index_right'])

        # Deduplicate (spatial join can create duplicates)
        gdf = gdf.drop_duplicates(subset=['_coord_key'], keep='first')

        matched = gdf['sz_id'].notna().sum()
        logger.info(f"    ✓ Matched {matched:,} unique locations to subzones")
    else:
        logger.info("  • Skipping subzone join (file not provided or missing)")
        gdf['subzone'] = None
        gdf['sz_id'] = None

    # 3. Spatial join with Road Network (nearest road)
    if road_network_geojson and road_network_geojson.exists():
        logger.info("  • Finding nearest roads...")
        roads_gdf = gpd.read_file(road_network_geojson).to_crs("EPSG:4326")

        # Prepare road columns
        road_cols = ['geometry']
        if 'name' in roads_gdf.columns:
            road_cols.insert(0, 'name')
        if 'RN_ID' in roads_gdf.columns:
            road_cols.insert(0, 'RN_ID')

        # Perform nearest join
        gdf = gpd.sjoin_nearest(
            gdf,
            roads_gdf[road_cols],
            how='left',
            max_distance=0.01,  # ~1km max distance
            distance_col='road_distance'
        )

        # Rename and handle road columns
        if 'RN_ID' in gdf.columns:
            gdf = gdf.rename(columns={'RN_ID': 'rn_id'})
        else:
            gdf['rn_id'] = None

        # Handle road names
        if 'name' in gdf.columns:
            if 'road_name' not in gdf.columns:
                gdf = gdf.rename(columns={'name': 'road_name'})
            else:
                # Merge road names if both exist
                gdf['road_name'] = gdf['road_name'].fillna(gdf['name'])
                gdf = gdf.drop(columns=['name'])

        # Deduplicate (sjoin_nearest can create multiple matches)
        gdf = gdf.drop_duplicates(subset=['_coord_key'], keep='first')

        # Clean up join artifacts
        if 'index_right' in gdf.columns:
            gdf = gdf.drop(columns=['index_right'])
        if 'road_distance' in gdf.columns:
            gdf = gdf.drop(columns=['road_distance'])

        matched = gdf['rn_id'].notna().sum()
        logger.info(f"    ✓ Matched {matched:,} unique locations to road network")
    else:
        logger.info("  • Skipping road network join (file not provided or missing)")
        gdf['rn_id'] = None
        if 'road_name' not in gdf.columns:
            gdf['road_name'] = None

    # Convert back to regular DataFrame (keep only geocoding columns and _coord_key)
    geocode_cols = ['_coord_key', 'pa_id', 'planning_area', 'sz_id', 'subzone', 'rn_id']
    if 'road_name' in gdf.columns:
        geocode_cols.append('road_name')

    geocoded_df = pd.DataFrame(gdf[[col for col in geocode_cols if col in gdf.columns]])

    # Convert ID columns to integers (handle NaN properly)
    for id_col in ['pa_id', 'sz_id']:
        if id_col in geocoded_df.columns:
            geocoded_df[id_col] = pd.to_numeric(geocoded_df[id_col], errors='coerce')
            geocoded_df[id_col] = geocoded_df[id_col].astype('Int64')  # Nullable integer type

    # Convert rn_id to integer (if numeric)
    if 'rn_id' in geocoded_df.columns:
        geocoded_df['rn_id'] = pd.to_numeric(geocoded_df['rn_id'], errors='coerce')
        geocoded_df['rn_id'] = geocoded_df['rn_id'].astype('Int64')  # Nullable integer type

    # Merge geocoded results back to original DataFrame
    logger.info(f"  Merging geocoded results back to all {len(df_work):,} records...")
    result_df = df_work.merge(
        geocoded_df,
        on='_coord_key',
        how='left',
        suffixes=('', '_geocoded')
    )

    # Handle columns that might exist in both original and geocoded data
    for col in ['pa_id', 'planning_area', 'sz_id', 'subzone', 'rn_id', 'road_name']:
        if f'{col}_geocoded' in result_df.columns:
            # Use geocoded value, fall back to original if it exists
            if col in df.columns:
                result_df[col] = result_df[f'{col}_geocoded'].fillna(result_df[col])
            else:
                result_df[col] = result_df[f'{col}_geocoded']
            result_df = result_df.drop(columns=[f'{col}_geocoded'])
        elif col not in result_df.columns and col in geocoded_df.columns:
            # Column doesn't exist yet, it will come from merge
            pass

    # Remove temporary coordinate key
    result_df = result_df.drop(columns=['_coord_key'])

    logger.info("✓ Three-layer geocoding complete")

    return result_df


def get_default_geojson_paths() -> dict:
    """
    Get default paths to GeoJSON reference files.

    Returns:
        Dictionary with keys: planning_geojson, subzone_geojson, road_network_geojson
    """
    base_dir = Path(__file__).resolve().parents[1] / "data"

    return {
        'planning_geojson': base_dir / "roadnetwork" / "planning_area.geojson",
        'subzone_geojson': base_dir / "roadnetwork" / "subzone_area.geojson",
        'road_network_geojson': base_dir / "roadnetwork" / "road_network_final.geojson",
    }
