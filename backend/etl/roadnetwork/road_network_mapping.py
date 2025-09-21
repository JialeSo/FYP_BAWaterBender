'''
This python script gets the total no. of flood events, total no. of amenities
and the breakdown count of each amenity type per unique amenity in Singapore

Steps:
1. Reads the GeoJSON (road_network.geojson)
2. Reads the amenities dataset (amenities.csv)
3. Reads the flood dataset (PUB_weather_alerts_with_postal_final.csv)
4. Normalizes road names for robust matching
5. Counts total amenities
6. Counts flood cases (start or end street match)
7. Breaks down amenities by type (one column per type)
'''
import json
import pandas as pd
import re
from pathlib import Path

# --- File paths ---
BASE = Path(__file__).resolve().parent
AMENITIES_CSV        = BASE / "geojson/amenities_with_importance_score.csv"
FLOODS_CSV           = BASE / "geojson/floods.csv"
ROAD_NETWORK_GEOJSON = BASE / "geojson/road_network.geojson"
OUTPUT_CSV           = BASE / "geojson/road_network_data.csv"

# --- Normalization helper ---
def normalize_road_name(name: str) -> str:
    if pd.isna(name):
        return ""
    name = name.upper().strip()
    replacements = {
        r"\bRD\b": "ROAD",
        r"\bRD.\b": "ROAD",
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


# --- Amenity types ---
AMENITY_TYPES = [
    "bus_depots", "bus_interchanges_terminals", "bus_stops", "childcare_clean",
    "chinese_temples", "churches", "community_clubs", "concert_halls", "courts",
    "fire_services", "hdb_buildings", "hdb_points_shp", "higher_education",
    "historic_sites", "hotels", "indian_temples", "kindergartens", "libraries",
    "moe_schools", "mosques", "mrt_station_exits", "other_institutions",
    "parkfacilities", "police", "post_offices", "preschools", "sikh_temples",
    "special_education", "sports_centres", "stadiums", "swimming_complex",
    "synagogues", "tourist_attractions"
]


# --- Main function ---
def summarize_roads(geojson_path, amenities_csv, flood_csv):
    # Load geojson
    with open(geojson_path, "r") as f:
        geo_data = json.load(f)
    
    # Extract unique road names
    road_names = {normalize_road_name(feature["properties"]["RD_NAME"]) 
                  for feature in geo_data["features"]}
    
    # Load datasets
    amenities = pd.read_csv(amenities_csv, dtype=str)  # force string to avoid dtype warnings
    floods = pd.read_csv(flood_csv, low_memory=False)  # scan full file for consistent dtypes
    
    # Normalize names
    amenities["road_name_norm"] = amenities["road_name"].apply(normalize_road_name)
    floods["start_norm"] = floods["start_street_name"].apply(normalize_road_name)
    floods["end_norm"] = floods["end_street_name"].apply(normalize_road_name)
    
    results = []
    
    for i, road in enumerate(sorted(road_names), start=1):
        road_data = {
            "RoadID": i,
            "RoadName": road,
        }
        
        # Total amenities (all types)
        total_amenities = amenities[amenities["road_name_norm"] == road].shape[0]
        road_data["NumberOfAmenities"] = total_amenities
        
        # Flood cases (start or end match)
        flood_cases = floods[
            (floods["start_norm"] == road) | (floods["end_norm"] == road)
        ].shape[0]
        road_data["TotalFloodCases"] = flood_cases
        
        # Amenity type breakdown
        for a_type in AMENITY_TYPES:
            count = amenities[
                (amenities["road_name_norm"] == road) & 
                (amenities["amenity_type"].str.lower() == a_type.lower())
            ].shape[0]
            road_data[a_type] = count
        
        results.append(road_data)
    
    return pd.DataFrame(results)


# --- Main ---
if __name__ == "__main__":
    df = summarize_roads(ROAD_NETWORK_GEOJSON, AMENITIES_CSV, FLOODS_CSV)
    
    print(df.head())              # preview first rows
    df.to_csv(OUTPUT_CSV, index=False)  # save results
    print(f"Road network summary saved to {OUTPUT_CSV}")
