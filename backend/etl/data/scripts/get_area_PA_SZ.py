import geopandas as gpd
import os

# Base directory
BASE_DIR = os.path.dirname(os.path.dirname(__file__))

# Input/Output files (same, since we overwrite)
planning_file = os.path.join(BASE_DIR, "planning_area.geojson")
subzone_file = os.path.join(BASE_DIR, "subzone_area.geojson")

def add_area(file_path, epsg=3414):
    """Read GeoJSON, reproject, add area in km2, and overwrite the file."""
    gdf = gpd.read_file(file_path)

    # Reproject to SVY21 (meters)
    gdf = gdf.to_crs(epsg=epsg)

    # Compute area in km2
    gdf["area_km2"] = gdf.geometry.area / 1_000_000

    # Overwrite the same file
    gdf.to_file(file_path, driver="GeoJSON")
    print(f"Overwritten with km2 area: {file_path}")

if __name__ == "__main__":
    add_area(planning_file)
    add_area(subzone_file)
