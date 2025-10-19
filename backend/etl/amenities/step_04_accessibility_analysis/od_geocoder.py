"""
Origin-Destination Geocoder
============================

Maps LTA PT codes (bus stops and train stations) to geographic coordinates
and aggregates OD flows to spatial units (subzones, planning areas, H3 hexes).

This module:
- Geocodes bus stop codes using LTA Bus Stops API
- Geocodes train station codes using static train station data
- Performs spatial joins to aggregate flows to planning units
- Supports multiple aggregation levels (bus stop, station, subzone, planning area, H3)

Usage:
------
    from step_04_accessibility_analysis.od_geocoder import ODGeocoder

    geocoder = ODGeocoder(
        subzones_geojson="data/geojson/subzone_area.geojson",
        planning_areas_geojson="data/geojson/planning_area.geojson"
    )

    # Geocode OD data
    od_train_geocoded = geocoder.geocode_train_od(od_train_df)
    od_bus_geocoded = geocoder.geocode_bus_od(od_bus_df)

    # Aggregate to subzones
    subzone_flows = geocoder.aggregate_to_subzones(od_train_geocoded)
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Literal
import warnings

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import Point

try:
    import h3
    H3_AVAILABLE = True
except ImportError:
    H3_AVAILABLE = False
    warnings.warn("h3 library not available. Install with: pip install h3")


@dataclass
class ODGeocoderConfig:
    """Configuration for OD geocoding."""

    # Coordinate systems
    WGS84_CRS: str = "EPSG:4326"
    SVY21_CRS: str = "EPSG:3414"

    # H3 settings
    DEFAULT_H3_RESOLUTION: int = 9  # ~50m edge length

    # Train station data
    # Static mapping from common train station codes to coordinates
    # This can be replaced with actual station data from LTA
    TRAIN_STATIONS: dict = None


# Singapore MRT/LRT Station Codes and Coordinates
# Source: LTA DataMall static files
# Format: {station_code: (latitude, longitude, station_name)}
SINGAPORE_TRAIN_STATIONS = {
    # North-South Line (NS)
    "NS1": (1.4165, 103.7680, "Jurong East"),
    "NS2": (1.4053, 103.7480, "Bukit Batok"),
    "NS3": (1.3987, 103.7470, "Bukit Gombak"),
    "NS4": (1.3843, 103.7447, "Choa Chu Kang"),
    "NS5": (1.3722, 103.7449, "Yew Tee"),
    "NS7": (1.3498, 103.7492, "Kranji"),
    "NS8": (1.3362, 103.7650, "Marsiling"),
    "NS9": (1.3285, 103.7747, "Woodlands"),
    "NS10": (1.3150, 103.7651, "Admiralty"),
    "NS11": (1.3094, 103.7753, "Sembawang"),
    "NS13": (1.2873, 103.8315, "Yishun"),
    "NS14": (1.2759, 103.8434, "Khatib"),
    "NS15": (1.2620, 103.8485, "Yio Chu Kang"),
    "NS16": (1.2513, 103.8487, "Ang Mo Kio"),
    "NS17": (1.2335, 103.8477, "Bishan"),
    "NS18": (1.2239, 103.8435, "Braddell"),
    "NS19": (1.2169, 103.8389, "Toa Payoh"),
    "NS20": (1.2097, 103.8434, "Novena"),
    "NS21": (1.1990, 103.8438, "Newton"),
    "NS22": (1.1910, 103.8458, "Orchard"),
    "NS23": (1.1834, 103.8456, "Somerset"),
    "NS24": (1.1786, 103.8451, "Dhoby Ghaut"),
    "NS25": (1.1737, 103.8500, "City Hall"),
    "NS26": (1.1659, 103.8518, "Raffles Place"),
    "NS27": (1.1608, 103.8390, "Marina Bay"),
    "NS28": (1.1416, 103.8323, "Marina South Pier"),

    # East-West Line (EW)
    "EW1": (1.3000, 103.7900, "Pasir Ris"),
    "EW2": (1.3134, 103.7963, "Tampines"),
    "EW3": (1.3273, 103.8070, "Simei"),
    "EW4": (1.3340, 103.7421, "Tanah Merah"),
    "EW5": (1.3240, 103.7008, "Bedok"),
    "EW6": (1.3156, 103.6902, "Kembangan"),
    "EW7": (1.3116, 103.6790, "Eunos"),
    "EW8": (1.3009, 103.6558, "Paya Lebar"),
    "EW9": (1.2990, 103.6411, "Aljunied"),
    "EW10": (1.3017, 103.6286, "Kallang"),
    "EW11": (1.3008, 103.6184, "Lavender"),
    "EW12": (1.3032, 103.6044, "Bugis"),
    "EW13": (1.2967, 103.8518, "City Hall"),
    "EW14": (1.2834, 103.8518, "Raffles Place"),
    "EW15": (1.2765, 103.8459, "Tanjong Pagar"),
    "EW16": (1.2765, 103.8322, "Outram Park"),
    "EW17": (1.2867, 103.8183, "Tiong Bahru"),
    "EW18": (1.2908, 103.8039, "Redhill"),
    "EW19": (1.2933, 103.7875, "Queenstown"),
    "EW20": (1.2963, 103.7672, "Commonwealth"),
    "EW21": (1.3012, 103.7495, "Buona Vista"),
    "EW22": (1.3134, 103.7409, "Dover"),
    "EW23": (1.3337, 103.7421, "Clementi"),
    "EW24": (1.3518, 103.7498, "Jurong East"),
    "EW25": (1.3669, 103.7488, "Chinese Garden"),
    "EW26": (1.3797, 103.7443, "Lakeside"),
    "EW27": (1.3946, 103.7422, "Boon Lay"),
    "EW28": (1.4067, 103.7451, "Pioneer"),
    "EW29": (1.4149, 103.7463, "Joo Koon"),
    "EW30": (1.4266, 103.7480, "Gul Circle"),
    "EW31": (1.4406, 103.7425, "Tuas Crescent"),
    "EW32": (1.4549, 103.7380, "Tuas West Road"),
    "EW33": (1.4695, 103.7341, "Tuas Link"),

    # Circle Line (CC)
    "CC1": (1.1786, 103.8451, "Dhoby Ghaut"),
    "CC2": (1.1894, 103.8523, "Bras Basah"),
    "CC3": (1.1969, 103.8588, "Esplanade"),
    "CC4": (1.2104, 103.8629, "Promenade"),
    "CC5": (1.2277, 103.8607, "Nicoll Highway"),
    "CC6": (1.2403, 103.8607, "Stadium"),
    "CC7": (1.2518, 103.8628, "Mountbatten"),
    "CC8": (1.2662, 103.8626, "Dakota"),
    "CC9": (1.3009, 103.6558, "Paya Lebar"),
    "CC10": (1.3174, 103.8916, "MacPherson"),
    "CC11": (1.3265, 103.8970, "Tai Seng"),
    "CC12": (1.3336, 103.9052, "Bartley"),
    "CC13": (1.3506, 103.9104, "Serangoon"),
    "CC14": (1.3623, 103.9085, "Lorong Chuan"),
    "CC15": (1.2335, 103.8477, "Bishan"),
    "CC16": (1.2513, 103.8487, "Marymount"),
    "CC17": (1.3498, 103.7492, "Caldecott"),
    "CC19": (1.3180, 103.8437, "Botanic Gardens"),
    "CC20": (1.3112, 103.8377, "Farrer Road"),
    "CC21": (1.3061, 103.8270, "Holland Village"),
    "CC22": (1.3012, 103.7495, "Buona Vista"),
    "CC23": (1.2956, 103.7864, "one-north"),
    "CC24": (1.2869, 103.7964, "Kent Ridge"),
    "CC25": (1.2764, 103.8017, "Haw Par Villa"),
    "CC26": (1.2766, 103.8123, "Pasir Panjang"),
    "CC27": (1.2746, 103.8205, "Labrador Park"),
    "CC28": (1.2731, 103.8314, "Telok Blangah"),
    "CC29": (1.2715, 103.8434, "HarbourFront"),

    # Downtown Line (DT)
    "DT1": (1.3001, 103.7623, "Bukit Panjang"),
    "DT2": (1.3136, 103.7648, "Cashew"),
    "DT3": (1.3251, 103.7637, "Hillview"),
    "DT5": (1.3505, 103.7651, "Beauty World"),
    "DT6": (1.3590, 103.7745, "King Albert Park"),
    "DT7": (1.3659, 103.7839, "Sixth Avenue"),
    "DT8": (1.3715, 103.7959, "Tan Kah Kee"),
    "DT9": (1.3180, 103.8437, "Botanic Gardens"),
    "DT10": (1.3145, 103.8529, "Stevens"),
    "DT11": (1.3090, 103.8608, "Newton"),
    "DT12": (1.3017, 103.8634, "Little India"),
    "DT13": (1.2967, 103.8707, "Rochor"),
    "DT14": (1.2990, 103.8793, "Bugis"),
    "DT15": (1.2951, 103.8882, "Promenade"),
    "DT16": (1.2833, 103.8944, "Bayfront"),
    "DT17": (1.2678, 103.8999, "Downtown"),
    "DT18": (1.2595, 103.9068, "Telok Ayer"),
    "DT19": (1.2482, 103.9147, "Chinatown"),
    "DT20": (1.2383, 103.9203, "Fort Canning"),
    "DT21": (1.2278, 103.9258, "Bencoolen"),
    "DT22": (1.2200, 103.9305, "Jalan Besar"),
    "DT23": (1.2110, 103.9368, "Bendemeer"),
    "DT24": (1.2020, 103.9425, "Geylang Bahru"),
    "DT25": (1.1946, 103.9481, "Mattar"),
    "DT26": (1.1869, 103.9541, "MacPherson"),
    "DT27": (1.1794, 103.9601, "Ubi"),
    "DT28": (1.1726, 103.9659, "Kaki Bukit"),
    "DT29": (1.1650, 103.9712, "Bedok North"),
    "DT30": (1.1588, 103.9767, "Bedok Reservoir"),
    "DT31": (1.1528, 103.9820, "Tampines West"),
    "DT32": (1.1345, 103.9935, "Tampines"),
    "DT33": (1.1274, 104.0004, "Tampines East"),
    "DT34": (1.1197, 104.0081, "Upper Changi"),
    "DT35": (1.1106, 104.0155, "Expo"),

    # North-East Line (NE)
    "NE1": (1.2715, 103.8434, "HarbourFront"),
    "NE3": (1.2765, 103.8322, "Outram Park"),
    "NE4": (1.2867, 103.8440, "Chinatown"),
    "NE5": (1.3008, 103.8184, "Clarke Quay"),
    "NE6": (1.1786, 103.8451, "Dhoby Ghaut"),
    "NE7": (1.3032, 103.8531, "Little India"),
    "NE8": (1.3116, 103.8550, "Farrer Park"),
    "NE9": (1.3196, 103.8560, "Boon Keng"),
    "NE10": (1.3280, 103.8566, "Potong Pasir"),
    "NE11": (1.3363, 103.8566, "Woodleigh"),
    "NE12": (1.3506, 103.9104, "Serangoon"),
    "NE13": (1.3595, 103.9103, "Kovan"),
    "NE14": (1.3677, 103.9091, "Hougang"),
    "NE15": (1.3758, 103.9065, "Buangkok"),
    "NE16": (1.3834, 103.9067, "Sengkang"),
    "NE17": (1.3911, 103.9058, "Punggol"),
}


class ODGeocoder:
    """
    Geocodes Origin-Destination data and aggregates flows to spatial units.

    This class handles:
    - Mapping PT codes to coordinates (bus stops, train stations)
    - Spatial joins to planning units (subzones, planning areas)
    - Aggregation of OD flows to different spatial levels
    - H3 hexagon aggregation
    """

    def __init__(
        self,
        subzones_geojson: Optional[Path] = None,
        planning_areas_geojson: Optional[Path] = None,
        train_stations: Optional[dict] = None,
        lta_client: Optional[object] = None,
    ):
        """
        Initialize OD geocoder.

        Args:
            subzones_geojson: Path to subzone boundaries GeoJSON
            planning_areas_geojson: Path to planning area boundaries GeoJSON
            train_stations: Optional custom train station mapping
            lta_client: Optional LTAODClient instance for fetching bus stop data
        """
        self.config = ODGeocoderConfig()

        # Load spatial boundaries
        self.subzones = None
        if subzones_geojson:
            self.subzones = gpd.read_file(subzones_geojson).to_crs(self.config.WGS84_CRS)

        self.planning_areas = None
        if planning_areas_geojson:
            self.planning_areas = gpd.read_file(planning_areas_geojson).to_crs(self.config.WGS84_CRS)

        # Train station mapping
        self.train_stations = train_stations or SINGAPORE_TRAIN_STATIONS

        # Bus stop data (lazy loaded)
        self._bus_stops = None
        self.lta_client = lta_client

    def _load_bus_stops(self) -> gpd.GeoDataFrame:
        """Lazy load bus stop data from LTA API."""
        if self._bus_stops is None:
            if self.lta_client is None:
                raise ValueError(
                    "LTA client required to fetch bus stop data. "
                    "Provide lta_client parameter during initialization."
                )

            # Fetch bus stops from API
            bus_stops_df = self.lta_client.fetch_bus_stops()

            # Create GeoDataFrame
            geometry = [
                Point(row["Longitude"], row["Latitude"])
                for _, row in bus_stops_df.iterrows()
            ]

            self._bus_stops = gpd.GeoDataFrame(
                bus_stops_df,
                geometry=geometry,
                crs=self.config.WGS84_CRS,
            )

        return self._bus_stops

    def geocode_train_od(
        self,
        od_train_df: pd.DataFrame,
    ) -> gpd.GeoDataFrame:
        """
        Geocode train OD data by mapping station codes to coordinates.

        Args:
            od_train_df: DataFrame with columns:
                - ORIGIN_PT_CODE: Origin station code (e.g., "NS1")
                - DESTINATION_PT_CODE: Destination station code
                - TOTAL_TRIPS: Number of trips
                - Other columns preserved

        Returns:
            GeoDataFrame with origin and destination coordinates
        """
        df = od_train_df.copy()

        # Map origin station codes to coordinates
        df["origin_lat"] = df["ORIGIN_PT_CODE"].map(
            lambda code: self.train_stations.get(code, (None, None, None))[0]
        )
        df["origin_lon"] = df["ORIGIN_PT_CODE"].map(
            lambda code: self.train_stations.get(code, (None, None, None))[1]
        )
        df["origin_station_name"] = df["ORIGIN_PT_CODE"].map(
            lambda code: self.train_stations.get(code, (None, None, None))[2]
        )

        # Map destination station codes to coordinates
        df["dest_lat"] = df["DESTINATION_PT_CODE"].map(
            lambda code: self.train_stations.get(code, (None, None, None))[0]
        )
        df["dest_lon"] = df["DESTINATION_PT_CODE"].map(
            lambda code: self.train_stations.get(code, (None, None, None))[1]
        )
        df["dest_station_name"] = df["DESTINATION_PT_CODE"].map(
            lambda code: self.train_stations.get(code, (None, None, None))[2]
        )

        # Filter out unmapped stations
        valid_mask = (
            df["origin_lat"].notna() &
            df["origin_lon"].notna() &
            df["dest_lat"].notna() &
            df["dest_lon"].notna()
        )

        unmapped_count = (~valid_mask).sum()
        if unmapped_count > 0:
            unmapped_codes = set(
                df.loc[~valid_mask, "ORIGIN_PT_CODE"].tolist() +
                df.loc[~valid_mask, "DESTINATION_PT_CODE"].tolist()
            )
            warnings.warn(
                f"{unmapped_count:,} OD pairs have unmapped station codes: {unmapped_codes}"
            )

        df = df[valid_mask].copy()

        # Create geometry (use origin point as primary geometry)
        geometry = [Point(lon, lat) for lon, lat in zip(df["origin_lon"], df["origin_lat"])]

        gdf = gpd.GeoDataFrame(df, geometry=geometry, crs=self.config.WGS84_CRS)

        return gdf

    def geocode_bus_od(
        self,
        od_bus_df: pd.DataFrame,
    ) -> gpd.GeoDataFrame:
        """
        Geocode bus OD data by mapping bus stop codes to coordinates.

        Args:
            od_bus_df: DataFrame with columns:
                - ORIGIN_PT_CODE: Origin bus stop code
                - DESTINATION_PT_CODE: Destination bus stop code
                - TOTAL_TRIPS: Number of trips

        Returns:
            GeoDataFrame with origin and destination coordinates
        """
        df = od_bus_df.copy()

        # Load bus stops
        bus_stops = self._load_bus_stops()

        # Create lookup dictionary
        stop_lookup = {
            str(row["BusStopCode"]): {
                "lat": row["Latitude"],
                "lon": row["Longitude"],
                "name": row.get("Description", ""),
            }
            for _, row in bus_stops.iterrows()
        }

        # Map origin codes
        df["ORIGIN_PT_CODE"] = df["ORIGIN_PT_CODE"].astype(str)
        df["DESTINATION_PT_CODE"] = df["DESTINATION_PT_CODE"].astype(str)

        df["origin_lat"] = df["ORIGIN_PT_CODE"].map(lambda x: stop_lookup.get(x, {}).get("lat"))
        df["origin_lon"] = df["ORIGIN_PT_CODE"].map(lambda x: stop_lookup.get(x, {}).get("lon"))
        df["origin_stop_name"] = df["ORIGIN_PT_CODE"].map(lambda x: stop_lookup.get(x, {}).get("name"))

        # Map destination codes
        df["dest_lat"] = df["DESTINATION_PT_CODE"].map(lambda x: stop_lookup.get(x, {}).get("lat"))
        df["dest_lon"] = df["DESTINATION_PT_CODE"].map(lambda x: stop_lookup.get(x, {}).get("lon"))
        df["dest_stop_name"] = df["DESTINATION_PT_CODE"].map(lambda x: stop_lookup.get(x, {}).get("name"))

        # Filter valid
        valid_mask = (
            df["origin_lat"].notna() &
            df["origin_lon"].notna() &
            df["dest_lat"].notna() &
            df["dest_lon"].notna()
        )

        unmapped_count = (~valid_mask).sum()
        if unmapped_count > 0:
            warnings.warn(f"{unmapped_count:,} bus OD pairs could not be geocoded")

        df = df[valid_mask].copy()

        # Create geometry
        geometry = [Point(lon, lat) for lon, lat in zip(df["origin_lon"], df["origin_lat"])]
        gdf = gpd.GeoDataFrame(df, geometry=geometry, crs=self.config.WGS84_CRS)

        return gdf

    def aggregate_to_subzones(
        self,
        od_gdf: gpd.GeoDataFrame,
        flow_column: str = "TOTAL_TRIPS",
    ) -> pd.DataFrame:
        """
        Aggregate OD flows to subzone level.

        Args:
            od_gdf: Geocoded OD GeoDataFrame with origin/dest coordinates
            flow_column: Column containing flow volumes

        Returns:
            DataFrame with subzone-to-subzone flows
        """
        if self.subzones is None:
            raise ValueError("Subzone boundaries required. Provide subzones_geojson during init.")

        # Spatial join for origins
        origins_with_subzone = gpd.sjoin(
            od_gdf,
            self.subzones[["SUBZONE_N", "PLN_AREA_N", "geometry"]],
            how="left",
            predicate="within",
        )
        origins_with_subzone = origins_with_subzone.rename(
            columns={"SUBZONE_N": "origin_subzone", "PLN_AREA_N": "origin_planning_area"}
        )

        # Spatial join for destinations
        dest_points = od_gdf.copy()
        dest_points["geometry"] = [
            Point(lon, lat) for lon, lat in zip(od_gdf["dest_lon"], od_gdf["dest_lat"])
        ]

        dests_with_subzone = gpd.sjoin(
            dest_points,
            self.subzones[["SUBZONE_N", "PLN_AREA_N", "geometry"]],
            how="left",
            predicate="within",
        )
        dests_with_subzone = dests_with_subzone.rename(
            columns={"SUBZONE_N": "dest_subzone", "PLN_AREA_N": "dest_planning_area"}
        )

        # Combine
        combined = origins_with_subzone.copy()
        combined["dest_subzone"] = dests_with_subzone["dest_subzone"].values
        combined["dest_planning_area"] = dests_with_subzone["dest_planning_area"].values

        # Aggregate flows
        aggregated = combined.groupby(
            ["origin_subzone", "dest_subzone", "origin_planning_area", "dest_planning_area"],
            dropna=False,
        )[flow_column].sum().reset_index()

        return aggregated

    def aggregate_to_planning_areas(
        self,
        od_gdf: gpd.GeoDataFrame,
        flow_column: str = "TOTAL_TRIPS",
    ) -> pd.DataFrame:
        """
        Aggregate OD flows to planning area level.

        Args:
            od_gdf: Geocoded OD GeoDataFrame
            flow_column: Column containing flow volumes

        Returns:
            DataFrame with planning-area-to-planning-area flows
        """
        if self.planning_areas is None:
            raise ValueError("Planning area boundaries required.")

        # Spatial join for origins
        origins = gpd.sjoin(
            od_gdf,
            self.planning_areas[["PLN_AREA_N", "geometry"]],
            how="left",
            predicate="within",
        )
        origins = origins.rename(columns={"PLN_AREA_N": "origin_planning_area"})

        # Spatial join for destinations
        dest_points = od_gdf.copy()
        dest_points["geometry"] = [
            Point(lon, lat) for lon, lat in zip(od_gdf["dest_lon"], od_gdf["dest_lat"])
        ]

        dests = gpd.sjoin(
            dest_points,
            self.planning_areas[["PLN_AREA_N", "geometry"]],
            how="left",
            predicate="within",
        )

        # Combine and aggregate
        combined = origins.copy()
        combined["dest_planning_area"] = dests["PLN_AREA_N"].values

        aggregated = combined.groupby(
            ["origin_planning_area", "dest_planning_area"],
            dropna=False,
        )[flow_column].sum().reset_index()

        return aggregated

    def aggregate_to_h3(
        self,
        od_gdf: gpd.GeoDataFrame,
        resolution: int = 9,
        flow_column: str = "TOTAL_TRIPS",
    ) -> pd.DataFrame:
        """
        Aggregate OD flows to H3 hexagons.

        Args:
            od_gdf: Geocoded OD GeoDataFrame
            resolution: H3 resolution (default: 9, ~50m edge)
            flow_column: Flow volume column

        Returns:
            DataFrame with H3-to-H3 flows
        """
        if not H3_AVAILABLE:
            raise ImportError("h3 library required. Install with: pip install h3")

        df = od_gdf.copy()

        # Map to H3 cells
        df["origin_h3"] = df.apply(
            lambda row: h3.geo_to_h3(row["origin_lat"], row["origin_lon"], resolution),
            axis=1,
        )
        df["dest_h3"] = df.apply(
            lambda row: h3.geo_to_h3(row["dest_lat"], row["dest_lon"], resolution),
            axis=1,
        )

        # Aggregate
        aggregated = df.groupby(
            ["origin_h3", "dest_h3"]
        )[flow_column].sum().reset_index()

        return aggregated


__all__ = [
    "ODGeocoder",
    "ODGeocoderConfig",
    "SINGAPORE_TRAIN_STATIONS",
]
