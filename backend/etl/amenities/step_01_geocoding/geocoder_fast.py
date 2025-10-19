"""
Fast Geocoding for Singapore Amenities
=======================================

Simple and fast geocoding that:
1. Uses postal code lookup from onemap_postal_codes.csv
2. Does bulk spatial joins for planning areas and subzones
3. Skips slow road network matching (done in Step 3 instead)

This is 100x faster than the old row-by-row approach.
"""

from pathlib import Path
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point
import warnings

try:
    from core.naming import infer_amenity_name
except ImportError:  # pragma: no cover - fallback when executed as script
    from backend.etl.amenities.core.naming import infer_amenity_name

# Suppress GeoPandas CRS warnings
warnings.filterwarnings('ignore', message='.*geographic CRS.*')


def fast_geocode(
    input_geojson: Path,
    output_csv: Path,
    planning_geojson: Path,
    subzone_geojson: Path,
    road_network_geojson: Path = None,
    postal_codes_csv: Path = None,
) -> pd.DataFrame:
    """
    Fast geocoding using bulk operations.

    Args:
        input_geojson: Path to consolidated amenities GeoJSON
        output_csv: Path to save geocoded CSV
        planning_geojson: Path to planning areas GeoJSON
        subzone_geojson: Path to subzones GeoJSON
        road_network_geojson: Optional path to road network GeoJSON
        postal_codes_csv: Optional path to postal code reference CSV

    Returns:
        Geocoded DataFrame
    """
    print("Loading amenities...")
    # Load amenities as GeoDataFrame
    amenities_gdf = gpd.read_file(input_geojson)
    print(f"  Loaded {len(amenities_gdf):,} amenities")

    # Ensure CRS is WGS84
    if amenities_gdf.crs is None:
        amenities_gdf = amenities_gdf.set_crs("EPSG:4326")
    else:
        amenities_gdf = amenities_gdf.to_crs("EPSG:4326")

    # Extract lat/lon from geometry if not already present
    if 'lat' not in amenities_gdf.columns or 'lon' not in amenities_gdf.columns:
        print("Extracting lat/lon from geometry...")
        # Handle different geometry types (Point, Polygon, LineString, etc.)
        # Use centroid for non-Point geometries
        centroids = amenities_gdf.geometry.centroid
        amenities_gdf['lon'] = centroids.x
        amenities_gdf['lat'] = centroids.y

    # Load planning areas
    print("Loading planning areas...")
    planning_gdf = gpd.read_file(planning_geojson).to_crs("EPSG:4326")
    print(f"  Loaded {len(planning_gdf):,} planning areas")

    # Load subzones
    print("Loading subzones...")
    subzone_gdf = gpd.read_file(subzone_geojson).to_crs("EPSG:4326")
    print(f"  Loaded {len(subzone_gdf):,} subzones")

    # Spatial join with planning areas (BULK operation - fast!)
    print("Joining with planning areas...")
    amenities_gdf = gpd.sjoin(
        amenities_gdf,
        planning_gdf[['PLN_AREA_N', 'geometry']],
        how='left',
        predicate='within'
    )
    amenities_gdf = amenities_gdf.rename(columns={'PLN_AREA_N': 'planning_area'})

    # Drop index_right column from spatial join
    if 'index_right' in amenities_gdf.columns:
        amenities_gdf = amenities_gdf.drop(columns=['index_right'])

    # Spatial join with subzones (BULK operation - fast!)
    print("Joining with subzones...")
    amenities_gdf = gpd.sjoin(
        amenities_gdf,
        subzone_gdf[['SUBZONE_N', 'geometry']],
        how='left',
        predicate='within'
    )
    amenities_gdf = amenities_gdf.rename(columns={'SUBZONE_N': 'subzone'})

    # Drop index_right column from spatial join
    if 'index_right' in amenities_gdf.columns:
        amenities_gdf = amenities_gdf.drop(columns=['index_right'])

    # Join with road network to find nearest road
    if road_network_geojson and Path(road_network_geojson).exists():
        print("Finding nearest roads...")
        roads_gdf = gpd.read_file(road_network_geojson).to_crs("EPSG:4326")
        print(f"  Loaded {len(roads_gdf):,} road segments")

        # Use sjoin_nearest to find closest road for each amenity
        amenities_gdf = gpd.sjoin_nearest(
            amenities_gdf,
            roads_gdf[['RD_NAME', 'geometry']],
            how='left',
            max_distance=0.01,  # ~1km max distance
            distance_col='road_distance'
        )

        # Keep only first match per amenity (remove duplicates from equidistant roads)
        amenities_gdf = amenities_gdf.drop_duplicates(subset=['amenity_id'], keep='first')

        # Rename and clean up
        if 'RD_NAME' in amenities_gdf.columns:
            # Use road network road name if amenity road_name is missing
            amenities_gdf['road_name'] = amenities_gdf['road_name'].fillna(
                amenities_gdf['RD_NAME']
            )
            amenities_gdf = amenities_gdf.drop(columns=['RD_NAME'])

        # Drop index_right from spatial join
        if 'index_right' in amenities_gdf.columns:
            amenities_gdf = amenities_gdf.drop(columns=['index_right'])

    # Load postal code reference if available
    if postal_codes_csv and Path(postal_codes_csv).exists():
        print("Loading postal code reference...")
        postal_df = pd.read_csv(postal_codes_csv, dtype={'postal': str})

        # Clean postal codes (ensure 6 digits)
        amenities_gdf['postal_code'] = amenities_gdf['postal_code'].astype(str).str.zfill(6)
        postal_df['postal'] = postal_df['postal'].astype(str).str.zfill(6)

        # Merge to get additional postal code metadata
        amenities_gdf = amenities_gdf.merge(
            postal_df[['postal', 'building', 'address', 'road_name']],
            left_on='postal_code',
            right_on='postal',
            how='left',
            suffixes=('', '_postal')
        )

        # Use postal road_name if amenity road_name is missing
        if 'road_name_postal' in amenities_gdf.columns:
            amenities_gdf['road_name'] = amenities_gdf['road_name'].fillna(
                amenities_gdf['road_name_postal']
            )
            amenities_gdf = amenities_gdf.drop(columns=['road_name_postal'])

        # Drop duplicate postal column
        if 'postal' in amenities_gdf.columns:
            amenities_gdf = amenities_gdf.drop(columns=['postal'])

    # Convert to DataFrame (drop geometry for CSV output)
    print("Finalizing...")
    df = pd.DataFrame(amenities_gdf.drop(columns='geometry'))

    # Reorder columns for clarity
    priority_cols = [
        'amenity_id', 'amenity_type', 'amenity_name',
        'planning_area', 'subzone', 'road_name', 'postal_code',
        'lat', 'lon', 'geom_type', 'source_file'
    ]
    other_cols = [col for col in df.columns if col not in priority_cols]
    final_cols = [col for col in priority_cols if col in df.columns] + other_cols
    df = df[final_cols]

    name_series = df['amenity_name'].fillna('').astype(str).str.strip()
    missing_mask = name_series.eq('')
    missing_count = int(missing_mask.sum())
    if missing_count:
        print(f"  • Filling amenity_name for {missing_count:,} records without labels...")
        df.loc[missing_mask, 'amenity_name'] = df[missing_mask].apply(
            lambda row: infer_amenity_name(
                row.to_dict(),
                source_file=row.get('source_file'),
            ),
            axis=1,
        )
        remaining = df['amenity_name'].fillna('').astype(str).str.strip().eq('').sum()
        if remaining:
            print(f"  ⚠ {remaining:,} amenities still missing amenity_name after fallback")
        else:
            print("  ✓ All amenities now have amenity_name (post-geocoding)")
    else:
        print("  ✓ All amenities already had amenity_name")

    # Save to CSV
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_csv, index=False)
    print(f"✓ Saved {len(df):,} geocoded amenities to {output_csv}")

    return df


if __name__ == "__main__":
    # For standalone testing
    from pathlib import Path

    BASE_DIR = Path(__file__).resolve().parent.parent
    DATA_DIR = (BASE_DIR / "../data").resolve()

    df = fast_geocode(
        input_geojson=DATA_DIR / "amenities_consolidated.geojson",
        output_csv=DATA_DIR / "01_amenities_geocoded.csv",
        planning_geojson=DATA_DIR / "geojson" / "planning_area.geojson",
        subzone_geojson=DATA_DIR / "geojson" / "subzone_area.geojson",
        postal_codes_csv=DATA_DIR / "onemap_postal_codes.csv",
    )

    print(f"\nGeocoded {len(df):,} amenities")
    print(f"Planning areas found: {df['planning_area'].notna().sum():,}")
    print(f"Subzones found: {df['subzone'].notna().sum():,}")
