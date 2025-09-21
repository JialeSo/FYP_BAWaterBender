import pandas as pd
import geopandas as gpd

# --- File paths ---
AMENITIES_CSV        = "./geojson/amenities_with_importance_score.csv"
PLANNING_GEOJSON     = "./geojson/planning_area.geojson"
SUBZONE_GEOJSON      = "./geojson/subzone_area.geojson"
OUTPUT_CSV           = "./geojson/amenities_with_importance_score_enriched.csv"
OUTPUT_GEOJSON       = "./geojson/amenities_with_importance_score_enriched.geojson"

if __name__ == "__main__":
    # Load amenities
    amenities_df = pd.read_csv(AMENITIES_CSV, low_memory=False, dtype={"postal_code": str})
    amenities_df["postal_code"] = amenities_df["postal_code"].str.split(".").str[0].str.zfill(6)

    # Convert to GeoDataFrame
    amenities_gdf = gpd.GeoDataFrame(
        amenities_df,
        geometry=gpd.points_from_xy(amenities_df["lon"], amenities_df["lat"]),
        crs="EPSG:4326"
    )

    # Load boundaries
    planning_gdf = gpd.read_file(PLANNING_GEOJSON).to_crs("EPSG:4326")
    subzone_gdf  = gpd.read_file(SUBZONE_GEOJSON).to_crs("EPSG:4326")

    print(f"Running spatial joins for {len(amenities_gdf)} amenities...")

    # --- Join with planning areas ---
    enriched = gpd.sjoin(
        amenities_gdf,
        planning_gdf[["PLN_AREA_N", "geometry"]],
        how="left",
        predicate="within"
    ).rename(columns={"PLN_AREA_N": "planning_area"})
    enriched = enriched.drop(columns=["index_right"], errors="ignore")

    # --- Join with subzones ---
    enriched = gpd.sjoin(
        enriched,
        subzone_gdf[["SUBZONE_N", "geometry"]],
        how="left",
        predicate="within"
    ).rename(columns={"SUBZONE_N": "subzone"})
    enriched = enriched.drop(columns=["index_right"], errors="ignore")

    # --- Save CSV (road_name moved last) ---
    final_df = enriched.drop(columns="geometry")
    cols = [c for c in final_df.columns if c != "road_name"] + ["road_name"]
    final_df = final_df[cols]
    final_df.to_csv(OUTPUT_CSV, index=False)

    # --- Save GeoJSON ---
    enriched.to_file(OUTPUT_GEOJSON, driver="GeoJSON")

    # Show preview
    print("\n=== Enriched preview (first 10) ===")
    print(final_df[["amenity_name", "postal_code", "planning_area", "subzone", "road_name"]].head(10).to_string(index=False))

    print(f"\n✓ Enriched dataset saved → {OUTPUT_CSV}")
    print(f"✓ Enriched GeoJSON saved → {OUTPUT_GEOJSON}")
