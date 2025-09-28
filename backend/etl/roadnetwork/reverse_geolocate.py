import pandas as pd
import geopandas as gpd
from shapely.geometry import Point
from pathlib import Path

# --- File paths ---
BASE = Path(__file__).resolve().parent
FLOOD_PRECIP_CSV     = BASE / "../data/PUB_weather_alerts_clean.csv"
PLANNING_GEOJSON     = BASE / "../data/planning_area.geojson"
SUBZONE_GEOJSON      = BASE / "../data/subzone_area.geojson"
ROAD_NETWORK_GEOJSON = BASE / "../data/road_network.geojson"
OUTPUT_CSV           = BASE / "../data/floods.csv"

class SGReverseGeolocator:
    def __init__(self, flood_csv, planning_geojson, subzone_geojson, road_network_geojson):
        # Read CSV with postal codes as strings to preserve leading zeros
        df = pd.read_csv(flood_csv, dtype={
            "Postal_Code": str,
            "start_postal_code": str,
            "end_postal_code": str
        })

        # Clean postal codes
        for col in ["Postal_Code", "start_postal_code", "end_postal_code"]:
            if col in df.columns:
                df[col] = df[col].apply(self.clean_postal)

        # Create GeoDataFrame from main lat/lon if present
        if "latitude" in df.columns and "longitude" in df.columns:
            self.flood_gdf = gpd.GeoDataFrame(
                df,
                geometry=gpd.points_from_xy(df["longitude"], df["latitude"]),
                crs="EPSG:4326"
            )
        else:
            self.flood_gdf = gpd.GeoDataFrame(df)

        # Load spatial boundaries
        self.planning_gdf = gpd.read_file(planning_geojson).to_crs("EPSG:4326")
        self.subzone_gdf  = gpd.read_file(subzone_geojson).to_crs("EPSG:4326")
        self.roads_gdf    = gpd.read_file(road_network_geojson).to_crs("EPSG:4326")

    @staticmethod
    def clean_postal(x):
        if pd.notna(x):
            x_str = str(x).strip()
            if "." in x_str:  # if float-looking
                x_str = x_str.split(".")[0]
            digits = "".join(c for c in x_str if c.isdigit())
            return digits.zfill(6) if digits else ""
        return ""

    def reverse_lookup(self, postal_code=None, lat=None, lon=None):
        """Perform reverse lookup and return planning area, subzone, street name, and IDs."""
        pt = None

        # Prefer lat/lon
        if lat is not None and lon is not None and pd.notna(lat) and pd.notna(lon):
            pt = Point(float(lon), float(lat))
        elif postal_code and postal_code.strip() != "" and "Postal_Code" in self.flood_gdf.columns:
            row = self.flood_gdf[self.flood_gdf["Postal_Code"] == postal_code]
            if not row.empty:
                pt = row.iloc[0].geometry

        if pt is None or not pt.is_valid:
            return {
                "planning_area": "", "planning_area_id": "",
                "subzone": "", "subzone_id": "",
                "street_name": "", "street_id": ""
            }

        # Planning area
        planning_area, planning_area_id = "", ""
        match = self.planning_gdf[self.planning_gdf.contains(pt)]
        if not match.empty:
            planning_area = match.iloc[0].get("PLN_AREA_N", "")
            planning_area_id = match.iloc[0].get("PA_ID", "")   # <-- FIXED

        # Subzone
        subzone, subzone_id = "", ""
        match = self.subzone_gdf[self.subzone_gdf.contains(pt)]
        if not match.empty:
            subzone = match.iloc[0].get("SUBZONE_N", "")
            subzone_id = match.iloc[0].get("SZ_ID", "")         # <-- FIXED

        # Nearest road
        street_name, street_id = "", ""
        try:
            roads_proj = self.roads_gdf.to_crs("EPSG:3414")
            pt_proj = gpd.GeoSeries([pt], crs="EPSG:4326").to_crs("EPSG:3414").iloc[0]
            nearest_idx = roads_proj.distance(pt_proj).idxmin()
            street_name = roads_proj.loc[nearest_idx].get("RD_NAME", "")
            street_id   = roads_proj.loc[nearest_idx].get("RN_ID", "")  # <-- FIXED
        except Exception as e:
            print(f"Road lookup failed: {e}")

        return {
            "planning_area": planning_area, "planning_area_id": planning_area_id,
            "subzone": subzone, "subzone_id": subzone_id,
            "street_name": street_name, "street_id": street_id
        }


def process_location(row, prefix, postal_col, lat_col, lng_col, geo: SGReverseGeolocator):
    """Process a location (start or end) and return prefixed columns with IDs."""
    if all(col not in row or pd.isna(row[col]) or row[col] == "" for col in [postal_col, lat_col, lng_col]):
        return {
            f"{prefix}planning_area": "", f"{prefix}planning_area_id": "",
            f"{prefix}subzone": "", f"{prefix}subzone_id": "",
            f"{prefix}street_name": "", f"{prefix}street_id": ""
        }

    res = geo.reverse_lookup(
        postal_code=row.get(postal_col),
        lat=row.get(lat_col),
        lon=row.get(lng_col)
    )
    return {f"{prefix}{k}": v for k, v in res.items()}


# --------- Main ---------
if __name__ == "__main__":
    geo = SGReverseGeolocator(
        FLOOD_PRECIP_CSV,
        PLANNING_GEOJSON,
        SUBZONE_GEOJSON,
        ROAD_NETWORK_GEOJSON
    )

    # Read CSV with postal codes as strings
    flood_df = pd.read_csv(FLOOD_PRECIP_CSV, dtype={
        "Postal_Code": str,
        "start_postal_code": str,
        "end_postal_code": str
    })

    results = []
    for _, row in flood_df.iterrows():
        row_result = {}
        row_result.update(process_location(row, "start_", "start_postal_code", "start_lat", "start_lng", geo))
        row_result.update(process_location(row, "end_", "end_postal_code", "end_lat", "end_lng", geo))
        results.append(row_result)

    enriched_df = pd.concat([flood_df, pd.DataFrame(results)], axis=1)

    # Drop unwanted columns safely
    enriched_df = enriched_df.drop(columns=["created_at", "sender_id", "msg_id"], errors="ignore")

    # Save output
    enriched_df.to_csv(OUTPUT_CSV, index=False)
    print(f"Enriched dataset saved -> {OUTPUT_CSV}")
