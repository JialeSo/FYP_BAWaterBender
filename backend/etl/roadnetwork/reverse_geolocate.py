import pandas as pd
import geopandas as gpd
from shapely.geometry import Point
from pathlib import Path

# --- File paths ---
BASE = Path(__file__).resolve().parent
FLOOD_PRECIP_CSV     = BASE / "postal_codes_flood_precipitation_rows.csv"
PLANNING_GEOJSON     = BASE / "planning_area.geojson"   # use cleaned files
SUBZONE_GEOJSON      = BASE / "subzone_area.geojson"
ROAD_NETWORK_GEOJSON = BASE / "road_network.geojson"
OUTPUT_CSV           = BASE / "postal_codes_flood_precipitation_rows_v2.csv"


class SGReverseGeolocator:
    def __init__(self, flood_csv, planning_geojson, subzone_geojson, road_network_geojson):
        # Load flood dataset
        df = pd.read_csv(flood_csv)
        df["Postal_Code"] = df["Postal_Code"].astype(str).str.zfill(6)

        # Build GeoDataFrame from lat/lon
        self.flood_gdf = gpd.GeoDataFrame(
            df,
            geometry=gpd.points_from_xy(df["longitude"], df["latitude"]),
            crs="EPSG:4326"
        )
        # Load spatial boundaries
        self.planning_gdf = gpd.read_file(planning_geojson).to_crs("EPSG:4326")
        self.subzone_gdf  = gpd.read_file(subzone_geojson).to_crs("EPSG:4326")
        self.roads_gdf    = gpd.read_file(road_network_geojson).to_crs("EPSG:4326")

    def reverse_lookup(self, postal_code=None, lat=None, lon=None):
        pt = None
        row = None

        if lat is not None and lon is not None:
            pt = Point(float(lon), float(lat))
        elif postal_code:
            row = self.flood_gdf[self.flood_gdf["Postal_Code"] == str(postal_code).zfill(6)]
            if row.empty:
                return {"planning_area": None, "subzone": None, "street_name": None}
            pt = row.iloc[0].geometry
        else:
            return {"planning_area": None, "subzone": None, "street_name": None}

        # Planning area
        planning_area = None
        pa_match = self.planning_gdf[self.planning_gdf.contains(pt)]
        if not pa_match.empty:
            planning_area = pa_match.iloc[0].get("PLN_AREA_N")

        # Subzone
        subzone = None
        sz_match = self.subzone_gdf[self.subzone_gdf.contains(pt)]
        if not sz_match.empty:
            subzone = sz_match.iloc[0].get("SUBZONE_N")

        # Nearest road (EPSG:3414 for distance)
        street_name = None
        try:
            roads_proj = self.roads_gdf.to_crs("EPSG:3414")
            pt_proj = gpd.GeoSeries([pt], crs="EPSG:4326").to_crs("EPSG:3414").iloc[0]

            nearest_idx = roads_proj.distance(pt_proj).idxmin()
            street_name = roads_proj.loc[nearest_idx].get("RD_NAME")
        except Exception as e:
            print(f"Road lookup failed: {e}")

        return {
            "planning_area": planning_area,
            "subzone": subzone,
            "street_name": street_name
        }


# --------- Run for all rows ---------
if __name__ == "__main__":
    geo = SGReverseGeolocator(
        FLOOD_PRECIP_CSV,
        PLANNING_GEOJSON,
        SUBZONE_GEOJSON,
        ROAD_NETWORK_GEOJSON
    )

    flood_df = pd.read_csv(FLOOD_PRECIP_CSV)
    flood_df["Postal_Code"] = flood_df["Postal_Code"].astype(str).str.zfill(6)

    print(f"Running reverse lookup for {len(flood_df)} rows...")

    results = []
    for _, row in flood_df.iterrows():
        p = row["Postal_Code"]
        lat, lon = row["latitude"], row["longitude"]
        res = geo.reverse_lookup(postal_code=p, lat=lat, lon=lon)
        results.append(res)

    results_df = pd.DataFrame(results)
    enriched_df = pd.concat([flood_df, results_df], axis=1)

    enriched_df.to_csv(OUTPUT_CSV, index=False)
    print(f"✓ Enriched dataset saved → {OUTPUT_CSV}")
    print("Columns added: planning_area, subzone, street_name")
