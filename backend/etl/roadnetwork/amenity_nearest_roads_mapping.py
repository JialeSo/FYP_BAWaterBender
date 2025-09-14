'''
Steps:
1. Load amenities (lon/lat, road_name).
2. Load road network GeoJSON, extract geometries, and compute centroids 
   (or average centroids if a road has multiple segments).
3. Match each amenity's road_name to its corresponding RoadID for nearest_first_road_id.
   - If found, this "default" road is always ranked as first.
4. Compute geometric distance between the amenity location and all road centroids.
5. Sort roads by distance and select the 4 closest roads.
   - nearest_first_road_id: Amenity's default road (if matched), otherwise closest by distance.
   - nearest_second_road_id: Next closest road by distance.
   - nearest_third_road_id: Third closest.
   - nearest_fourth_road_id: Fourth closest.
6. Output includes both IDs and Names for the 4 nearest roads.
'''
import json
import pandas as pd
import re
from pathlib import Path
from shapely.geometry import shape, Point

# --- File paths ---
BASE = Path(__file__).resolve().parent
AMENITIES_CSV        = BASE / "geojson/amenities_with_importance_score.csv"
ROAD_NETWORK_GEOJSON = BASE / "geojson/road_network.geojson"
ROAD_NETWORK_DATA    = BASE / "geojson/road_network_data.csv"
OUTPUT_CSV           = BASE / "geojson/amenities_with_nearest_roads.csv"

# --- Normalization helper ---
def normalize_road_name(name: str) -> str:
    if pd.isna(name):
        return ""
    name = name.upper().strip()
    replacements = {
        r"\bRD\b": "ROAD",
        r"\bAVE\b": "AVENUE",
        r"\bST\b": "STREET",
        r"\bDR\b": "DRIVE",
        r"\bHWY\b": "HIGHWAY",
        r"\bCTR\b": "CENTRE",
        r"\bPL\b": "PLACE",
        r"\bBLVD\b": "BOULEVARD",
        r"\bCRES\b": "CRESCENT",
        r"\bPKWY\b": "PARKWAY",
        r"\bLN\b": "LANE",
    }
    for pattern, repl in replacements.items():
        name = re.sub(pattern, repl, name)
    return name


# --- Load road centroids ---
def load_roads_with_centroids(geojson_path, road_data_csv):
    with open(geojson_path, "r") as f:
        geo_data = json.load(f)

    # Compute centroids for each road feature
    road_geoms = {}
    for feature in geo_data["features"]:
        rd_name = normalize_road_name(feature["properties"]["RD_NAME"])
        geom = shape(feature["geometry"])
        centroid = geom.centroid
        if rd_name not in road_geoms:
            road_geoms[rd_name] = []
        road_geoms[rd_name].append(centroid)

    # Use average centroid if multiple segments exist
    road_centroids = {}
    for rd_name, geoms in road_geoms.items():
        xs = [g.x for g in geoms]
        ys = [g.y for g in geoms]
        road_centroids[rd_name] = Point(sum(xs) / len(xs), sum(ys) / len(ys))

    # Attach RoadID from road_network_data.csv
    road_data = pd.read_csv(road_data_csv)
    road_data["RoadNameNorm"] = road_data["RoadName"].apply(normalize_road_name)

    road_info = []
    for _, row in road_data.iterrows():
        name = row["RoadNameNorm"]
        if name in road_centroids:
            road_info.append({
                "RoadID": row["RoadID"],
                "RoadName": name,
                "centroid": road_centroids[name]
            })

    return pd.DataFrame(road_info)


# --- Main function ---
def map_amenities_to_roads(amenities_csv, roads_geojson, road_data_csv):
    amenities = pd.read_csv(amenities_csv, dtype=str)
    amenities["lon"] = amenities["lon"].astype(float)
    amenities["lat"] = amenities["lat"].astype(float)
    amenities["road_name_norm"] = amenities["road_name"].apply(normalize_road_name)

    roads = load_roads_with_centroids(roads_geojson, road_data_csv)

    results = []

    for _, amenity in amenities.iterrows():
        point = Point(amenity["lon"], amenity["lat"])
        road_name_norm = amenity["road_name_norm"]

        # --- Nearest first road by road_name match
        first_road_id, first_road_name = None, None
        match = roads[roads["RoadName"] == road_name_norm]
        if not match.empty:
            first_road_id = int(match.iloc[0]["RoadID"])
            first_road_name = match.iloc[0]["RoadName"]

        # --- Compute distances to all roads
        roads["dist"] = roads["centroid"].apply(lambda c: point.distance(c))
        nearest_roads = roads.sort_values("dist").head(4)

        # Assign nearest IDs and Names
        nearest_ids = list(nearest_roads["RoadID"].astype(int))
        nearest_names = list(nearest_roads["RoadName"])
        
        # Ensure the matched road_name is first
        if first_road_id and first_road_id in nearest_ids:
            idx = nearest_ids.index(first_road_id)
            nearest_ids.pop(idx)
            nearest_names.pop(idx)
            nearest_ids = [first_road_id] + nearest_ids
            nearest_names = [first_road_name] + nearest_names

        while len(nearest_ids) < 4:
            nearest_ids.append(None)
            nearest_names.append(None)

        results.append({
            "amenity_id": amenity["amenity_id"],
            "nearest_first_road_id": nearest_ids[0],
            "nearest_first_road_name": nearest_names[0],
            "nearest_second_road_id": nearest_ids[1],
            "nearest_second_road_name": nearest_names[1],
            "nearest_third_road_id": nearest_ids[2],
            "nearest_third_road_name": nearest_names[2],
            "nearest_fourth_road_id": nearest_ids[3],
            "nearest_fourth_road_name": nearest_names[3],
        })

    return pd.DataFrame(results)


# --- Example usage ---
if __name__ == "__main__":
    df = map_amenities_to_roads(AMENITIES_CSV, ROAD_NETWORK_GEOJSON, ROAD_NETWORK_DATA)
    print(df.head())
    df.to_csv(OUTPUT_CSV, index=False)
    print(f"Amenities with nearest roads saved to {OUTPUT_CSV}")
