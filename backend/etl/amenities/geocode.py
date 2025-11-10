"""
Fast Geocoding for Singapore Amenities
=======================================

Simple and fast geocoding that:
1. Uses postal code lookup from onemap_postal_codes.csv
2. Does bulk spatial joins for planning areas and subzones
3. Finds nearest road segments using spatial join
4. Outputs consistent column names: pa_id, sz_id
"""

import logging
from pathlib import Path
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point
import warnings

from backend.etl.amenities.core.naming import infer_amenity_name
from backend.etl.common.spatial_geocoding import (
    add_three_layer_geocoding,
    get_default_geojson_paths,
)

logger = logging.getLogger(__name__)

# Suppress GeoPandas CRS warnings
warnings.filterwarnings("ignore", message=".*geographic CRS.*")


def geocode_amenities(
    input_geojson: Path,
    output_csv: Path,
    planning_geojson: Path = None,
    subzone_geojson: Path = None,
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
        Geocoded DataFrame with columns: pa_id, sz_id
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
    if "lat" not in amenities_gdf.columns or "lon" not in amenities_gdf.columns:
        print("Extracting lat/lon from geometry...")
        # Handle different geometry types (Point, Polygon, LineString, etc.)
        # Use centroid for non-Point geometries
        centroids = amenities_gdf.geometry.centroid
        amenities_gdf["lon"] = centroids.x
        amenities_gdf["lat"] = centroids.y

    # Load planning areas (optional)
    planning_gdf = None
    if planning_geojson and Path(planning_geojson).exists():
        print("Loading planning areas...")
        planning_gdf = gpd.read_file(planning_geojson).to_crs("EPSG:4326")
        print(f"  Loaded {len(planning_gdf):,} planning areas")
    else:
        print("Skipping planning area join (file missing)")

    # Load subzones (optional)
    subzone_gdf = None
    if subzone_geojson and Path(subzone_geojson).exists():
        print("Loading subzones...")
        subzone_gdf = gpd.read_file(subzone_geojson).to_crs("EPSG:4326")
        print(f"  Loaded {len(subzone_gdf):,} subzones")
    else:
        print("Skipping subzone join (file missing)")

    # Three-layer spatial geocoding via common utility (prefer defaults if paths not provided)
    if not planning_geojson or not subzone_geojson:
        defaults = get_default_geojson_paths()
        planning_geojson = planning_geojson or defaults["planning_geojson"]
        subzone_geojson = subzone_geojson or defaults["subzone_geojson"]
        road_network_geojson = road_network_geojson or defaults["road_network_geojson"]

    print("Running three-layer spatial geocoding (planning area, subzone, road)...")
    amenities_gdf = add_three_layer_geocoding(
        amenities_gdf,
        lat_col="lat",
        lon_col="lon",
        planning_geojson=Path(planning_geojson) if planning_geojson else None,
        subzone_geojson=Path(subzone_geojson) if subzone_geojson else None,
        road_network_geojson=(
            Path(road_network_geojson) if road_network_geojson else None
        ),
    )

    # NOTE: Bus stops do not use postal codes. They have BusStopCode (5-digit identifier)
    # which should NOT be padded to create fake postal codes. Bus stops already get their
    # planning_area and subzone correctly via spatial joins above.

    # Load postal code reference if available and if amenities have a postal_code column
    if (
        postal_codes_csv
        and Path(postal_codes_csv).exists()
        and ("postal_code" in amenities_gdf.columns)
    ):
        print("Loading postal code reference...")
        postal_df = pd.read_csv(postal_codes_csv, dtype=str)
        postal_df.columns = [col.strip().lower() for col in postal_df.columns]

        if "postal" not in postal_df.columns:
            raise KeyError("Postal reference CSV must contain a 'postal' column")

        # Clean postal codes (ensure 6 digits) for non-bus-stops only.
        # Bus stops carry a 5-digit BusStopCode in 'postal_code' and must be preserved.
        is_bus = amenities_gdf.get(
            "amenity_type", pd.Series(index=amenities_gdf.index, dtype=str)
        )
        is_bus = is_bus.astype(str).str.lower().eq("bus_stops")
        pc_series = amenities_gdf["postal_code"].astype(str)
        extracted = pc_series.str.extract(r"(\d{6})", expand=False).fillna("")
        cleaned = extracted.apply(lambda x: x.zfill(6) if x.strip() else "")
        amenities_gdf.loc[~is_bus, "postal_code"] = cleaned[~is_bus]
        postal_df["postal"] = postal_df["postal"].astype(str).str.zfill(6)

        postal_df = postal_df.drop_duplicates(subset=["postal"])

        select_columns = ["postal"]
        for candidate in ["building", "address", "road_name"]:
            if candidate in postal_df.columns:
                select_columns.append(candidate)

        amenities_gdf = amenities_gdf.merge(
            postal_df[select_columns],
            left_on="postal_code",
            right_on="postal",
            how="left",
            suffixes=("", "_postal"),
        )

        postal_road_col = (
            "road_name_postal"
            if "road_name_postal" in amenities_gdf.columns
            else "road_name"
        )
        if postal_road_col in amenities_gdf.columns:
            amenities_gdf["road_name"] = amenities_gdf["road_name"].fillna(
                amenities_gdf[postal_road_col]
            )
            if postal_road_col != "road_name":
                amenities_gdf = amenities_gdf.drop(columns=[postal_road_col])

        if "postal" in amenities_gdf.columns:
            amenities_gdf = amenities_gdf.drop(columns=["postal"])
    elif postal_codes_csv and Path(postal_codes_csv).exists():
        print("Skipping postal reference merge (no postal_code column in amenities)")

    # Convert to DataFrame (drop geometry for CSV output)
    print("Finalizing...")
    base = amenities_gdf
    if "geometry" in base.columns:
        base = base.drop(columns="geometry")
    df = pd.DataFrame(base)

    # Ensure required columns exist even for empty inputs
    for col in [
        "amenity_id",
        "amenity_type",
        "amenity_name",
        "planning_area",
        "pa_id",
        "subzone",
        "sz_id",
        "road_name",
        "street_id",
        "postal_code",
        "lat",
        "lon",
        "geom_type",
        "source_file",
    ]:
        if col not in df.columns:
            df[col] = pd.Series(dtype="object")

    if "amenity_id" in df.columns:
        df = df.drop_duplicates(subset=["amenity_id"])

    # Reorder columns for clarity (use consistent names: pa_id, sz_id)
    priority_cols = [
        "amenity_id",
        "amenity_type",
        "amenity_name",
        "planning_area",
        "pa_id",
        "subzone",
        "sz_id",
        "road_name",
        "street_id",
        "postal_code",
        "lat",
        "lon",
        "geom_type",
        "source_file",
    ]
    other_cols = [col for col in df.columns if col not in priority_cols]
    final_cols = [col for col in priority_cols if col in df.columns] + other_cols
    df = df[final_cols]

    name_series = (
        df.get("amenity_name", pd.Series(index=df.index))
        .fillna("")
        .astype(str)
        .str.strip()
    )
    missing_mask = name_series.eq("")
    missing_count = int(missing_mask.sum())
    if missing_count:
        print(
            f"  • Filling amenity_name for {missing_count:,} records without labels..."
        )
        df.loc[missing_mask, "amenity_name"] = df[missing_mask].apply(
            lambda row: infer_amenity_name(
                row.to_dict(),
                source_file=row.get("source_file"),
            ),
            axis=1,
        )
        remaining = df["amenity_name"].fillna("").astype(str).str.strip().eq("").sum()
        if remaining:
            print(
                f"  ⚠ {remaining:,} amenities still missing amenity_name after fallback"
            )
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

    df = geocode_amenities(
        input_geojson=DATA_DIR / "amenities_consolidated.geojson",
        output_csv=DATA_DIR / "01_amenities_geocoded.csv",
        planning_geojson=DATA_DIR / "geojson" / "planning_area.geojson",
        subzone_geojson=DATA_DIR / "geojson" / "subzone_area.geojson",
        postal_codes_csv=DATA_DIR / "onemap_postal_codes.csv",
    )

    print(f"\nGeocoded {len(df):,} amenities")
    print(f"Planning areas found: {df['planning_area'].notna().sum():,}")
    print(f"Subzones found: {df['subzone'].notna().sum():,}")
