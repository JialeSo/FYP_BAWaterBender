"""
Road-based accessibility consolidation using Step 03 outputs.

This module transforms the OSMnx nearest-road mappings into consolidated
amenity and road-level datasets that are aligned with the original
`amenities_3layers.csv` structure. It aggregates amenities per road
segment and enriches each record with nearest road metadata, ensuring
Stage 04 produces a data-centric deliverable instead of static plots.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import geopandas as gpd
import networkx as nx
import numpy as np
import pandas as pd
import math
import warnings
from pyproj import Transformer
from shapely.geometry import LineString, Point

try:  # Optional PySAL Access integration (if installed by the user)
    from access.access import Access as PySALAccess  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    PySALAccess = None

# Default coordinate reference system for length calculations
SVY21_CRS = "EPSG:3414"
CELL_SIZE_METERS = 100.0
MAX_GRID_RADIUS = 20
MIN_DISTANCE_EPS = 1e-3
WGS84_CRS = "EPSG:4326"
DEFAULT_ACCESS_MODELS = ("hansen", "2sfca", "cumulative")


@dataclass(frozen=True)
class RoadAccessibilityPaths:
    """Container for all input/output paths required by the builder."""

    amenities_csv: Path
    nearest_roads_csv: Path
    road_network_geojson: Path
    output_amenities_csv: Path
    output_road_summary_csv: Path
    output_road_summary_geojson: Optional[Path] = None
    final_output_csv: Optional[Path] = None


class RoadAccessibilityBuilder:
    """Build consolidated amenity and road accessibility datasets."""

    def __init__(self, paths: RoadAccessibilityPaths) -> None:
        self.paths = paths
        self._amenities: pd.DataFrame | None = None
        self._nearest: pd.DataFrame | None = None
        self._roads: gpd.GeoDataFrame | None = None
        self._roads_lookup: pd.DataFrame | None = None

    # ------------------------------------------------------------------ #
    # Loading helpers
    # ------------------------------------------------------------------ #
    def _load_amenities(self) -> pd.DataFrame:
        amenities = pd.read_csv(self.paths.amenities_csv, low_memory=False)
        if "amenity_id" not in amenities.columns:
            raise KeyError("amenities dataset must contain 'amenity_id' column")
        return amenities

    def _load_nearest_roads(self) -> pd.DataFrame:
        nearest = pd.read_csv(self.paths.nearest_roads_csv, dtype=str, low_memory=False)
        return nearest

    def _load_roads(self) -> gpd.GeoDataFrame:
        roads = gpd.read_file(self.paths.road_network_geojson)
        required_columns = {"RN_ID", "RD_NAME", "PA_ID", "SZ_ID"}
        missing = required_columns.difference(roads.columns)
        if missing:
            raise KeyError(
                f"road network GeoJSON missing columns: {', '.join(sorted(missing))}"
            )
        return roads

    # ------------------------------------------------------------------ #
    # Lookup construction
    # ------------------------------------------------------------------ #
    def _build_road_lookup(self, roads: gpd.GeoDataFrame) -> pd.DataFrame:
        lookup = (
            roads[["RN_ID", "RD_NAME", "PA_ID", "SZ_ID"]]
            .drop_duplicates(subset=["RN_ID"])
            .set_index("RN_ID")
        )
        lookup.index = lookup.index.astype(str)
        lookup.rename(
            columns={
                "RD_NAME": "road_official_name",
                "PA_ID": "road_planning_area_id",
                "SZ_ID": "road_subzone_id",
            },
            inplace=True,
        )
        return lookup

    # ------------------------------------------------------------------ #
    # Primary processing
    # ------------------------------------------------------------------ #
    def _merge_nearest_roads(
        self, amenities: pd.DataFrame, nearest: pd.DataFrame
    ) -> pd.DataFrame:
        merged = amenities.merge(nearest, on="amenity_id", how="left")

        # Determine primary road using nearest candidates in order
        candidate_cols = [
            ("nearest_road_1_id", "nearest_road_1_name"),
            ("nearest_road_2_id", "nearest_road_2_name"),
            ("nearest_road_3_id", "nearest_road_3_name"),
            ("nearest_road_4_id", "nearest_road_4_name"),
        ]

        merged["primary_road_id"] = np.nan
        merged["primary_road_name"] = np.nan

        for road_id_col, road_name_col in candidate_cols:
            merged["primary_road_id"] = merged["primary_road_id"].fillna(
                merged[road_id_col]
            )
            merged["primary_road_name"] = merged["primary_road_name"].fillna(
                merged[road_name_col]
            )

        # Count number of matched candidate roads
        candidate_ids = [cid for cid, _ in candidate_cols]
        merged["road_match_count"] = merged[candidate_ids].notna().sum(axis=1)

        if "road_name_x" in merged.columns:
            merged.rename(columns={"road_name_x": "road_name"}, inplace=True)
        if "road_name_y" in merged.columns:
            if "primary_road_name" in merged.columns:
                merged["primary_road_name"] = merged["primary_road_name"].fillna(
                    merged["road_name_y"]
                )
            merged.drop(columns=["road_name_y"], inplace=True)

        if "postal_code" in merged.columns:
            series = merged["postal_code"].astype(str).str.strip()
            series = series.replace({"nan": "", "None": "", "NaN": ""})
            series = series.str.replace(r"\.0$", "", regex=True)
            mask_digits = series.str.isdigit()
            series.loc[mask_digits] = series.loc[mask_digits].str.zfill(6)
            merged["postal_code"] = series

        return merged

    def _enrich_with_roads(
        self,
        merged: pd.DataFrame,
        lookup: pd.DataFrame,
    ) -> pd.DataFrame:
        """Attach planning-area/subzone metadata for the primary road."""
        merged["primary_road_id_str"] = merged["primary_road_id"].astype(str)
        merged = merged.merge(
            lookup,
            left_on="primary_road_id_str",
            right_index=True,
            how="left",
        )
        merged.drop(columns=["primary_road_id_str"], inplace=True)
        if "road_official_name" in merged.columns:
            merged["primary_road_name"] = merged["primary_road_name"].fillna(
                merged["road_official_name"]
            )
        return merged

    def _compute_road_summary(
        self, merged: pd.DataFrame, roads: gpd.GeoDataFrame
    ) -> gpd.GeoDataFrame:
        """Aggregate amenity counts and statistics per road segment."""
        data = merged.dropna(subset=["primary_road_id"]).copy()
        if data.empty:
            columns = [
                "primary_road_id",
                "primary_road_name",
                "total_amenities",
            ]
            return gpd.GeoDataFrame(columns=columns, geometry=[])

        group_cols = ["primary_road_id"]
        summary = data.groupby(group_cols).agg(
            primary_road_name=("primary_road_name", "first"),
            road_planning_area_id=("road_planning_area_id", "first"),
            road_subzone_id=("road_subzone_id", "first"),
            total_amenities=("amenity_id", "count"),
            unique_amenity_types=("amenity_type", "nunique"),
            unique_categories=("amenity_category", "nunique")
            if "amenity_category" in data.columns
            else ("primary_road_name", "size"),
            average_importance=("importance_score", "mean")
            if "importance_score" in data.columns
            else ("amenity_id", "size"),
        )

        # Category-based counts
        if "amenity_category" in data.columns:
            category_counts = (
                data.groupby(["primary_road_id", "amenity_category"])
                .size()
                .unstack(fill_value=0)
            )
            summary = summary.join(category_counts, how="left")

        # Amenity-type counts (top N only to avoid very wide tables)
        type_counts = (
            data.groupby(["primary_road_id", "amenity_type"])
            .size()
            .unstack(fill_value=0)
        )
        summary = summary.join(type_counts, how="left", rsuffix="_type")

        # Attach geometry and length metadata
        roads_proj = roads.to_crs(SVY21_CRS)
        roads_proj["length_m"] = roads_proj.geometry.length

        road_geometry = roads_proj[["RN_ID", "RD_NAME", "geometry", "length_m"]].copy()
        road_geometry.rename(
            columns={
                "RN_ID": "primary_road_id",
                "RD_NAME": "primary_road_name_geom",
            },
            inplace=True,
        )
        road_geometry["primary_road_id"] = road_geometry["primary_road_id"].astype(str)

        summary = summary.reset_index()
        summary["primary_road_id"] = summary["primary_road_id"].astype(str)

        summary_gdf = summary.merge(
            road_geometry,
            on="primary_road_id",
            how="left",
        )

        summary_gdf.rename(
            columns={
                "primary_road_name_geom": "road_name_geodata",
                "length_m": "road_length_m",
            },
            inplace=True,
        )

        summary_gdf = gpd.GeoDataFrame(summary_gdf, geometry="geometry", crs=SVY21_CRS)
        summary_gdf = summary_gdf.to_crs("EPSG:4326")

        return summary_gdf

    def _normalise_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """Clean up column naming and ordering prior to persistence."""
        rename_map = {}
        if "road_name_x" in df.columns:
            rename_map["road_name_x"] = "road_name"
        if rename_map:
            df = df.rename(columns=rename_map)

        drop_candidates = [col for col in ["road_name_y"] if col in df.columns]
        if drop_candidates:
            df = df.drop(columns=drop_candidates)

        preferred_order: Iterable[str] = (
            "amenity_id",
            "amenity_type",
            "amenity_name",
            "amenity_category",
            "primary_road_id",
            "primary_road_name",
            "planning_area",
            "subzone",
            "road_name",
            "postal_code",
            "lat",
            "lon",
        )
        cols = list(df.columns)
        ordered = [col for col in preferred_order if col in df.columns]
        remaining = [col for col in cols if col not in ordered]
        df = df[ordered + remaining]
        return df

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #
    def build(self) -> Dict[str, Path]:
        """Execute the consolidation workflow and persist outputs."""
        amenities = self._load_amenities()
        nearest = self._load_nearest_roads()
        roads = self._load_roads()
        lookup = self._build_road_lookup(roads)

        merged = self._merge_nearest_roads(amenities, nearest)
        merged = self._enrich_with_roads(merged, lookup)
        merged = self._normalise_columns(merged)

        road_summary_gdf = self._compute_road_summary(merged, roads)

        # Persist amenity-level dataset
        self.paths.output_amenities_csv.parent.mkdir(parents=True, exist_ok=True)
        merged.to_csv(self.paths.output_amenities_csv, index=False)

        # Mirror to final output path if requested
        if self.paths.final_output_csv:
            self.paths.final_output_csv.parent.mkdir(parents=True, exist_ok=True)
            merged.to_csv(self.paths.final_output_csv, index=False)

        # Save road summary (CSV + GeoJSON)
        self.paths.output_road_summary_csv.parent.mkdir(parents=True, exist_ok=True)
        road_summary = pd.DataFrame(road_summary_gdf.drop(columns="geometry"))
        road_summary.to_csv(self.paths.output_road_summary_csv, index=False)

        if self.paths.output_road_summary_geojson:
            self.paths.output_road_summary_geojson.parent.mkdir(
                parents=True, exist_ok=True
            )
            road_summary_gdf.to_file(
                self.paths.output_road_summary_geojson, driver="GeoJSON"
            )

        return {
            "amenities_csv": self.paths.output_amenities_csv,
            "road_summary_csv": self.paths.output_road_summary_csv,
            "road_summary_geojson": self.paths.output_road_summary_geojson,
        }


def build_road_accessibility_dataset(paths: RoadAccessibilityPaths) -> Dict[str, Path]:
    """Convenience function for scripting usage."""
    builder = RoadAccessibilityBuilder(paths)
    return builder.build()


class RoadNetworkRouter:
    """Utility that builds a road graph and provides routing helpers."""

    def __init__(
        self,
        road_network_geojson: Path,
        *,
        cell_size: float = CELL_SIZE_METERS,
        max_radius: int = MAX_GRID_RADIUS,
    ) -> None:
        self.road_network_geojson = road_network_geojson
        self.cell_size = cell_size
        self.max_radius = max_radius

        self.graph = nx.Graph()
        self.transformer = Transformer.from_crs(WGS84_CRS, SVY21_CRS, always_xy=True)
        self.inverse_transformer = Transformer.from_crs(SVY21_CRS, WGS84_CRS, always_xy=True)

        self._node_lookup: Dict[Tuple[float, float], int] = {}
        self._grid: Dict[Tuple[int, int], List[int]] = defaultdict(list)

        self._build_graph()
        self._build_spatial_index()

    # ------------------------------------------------------------------
    # Graph construction helpers
    # ------------------------------------------------------------------
    def _build_graph(self) -> None:
        roads_ll = gpd.read_file(self.road_network_geojson).to_crs(WGS84_CRS)
        roads_proj = roads_ll.to_crs(SVY21_CRS)

        for idx, row in roads_ll.iterrows():
            geom_ll = row.geometry
            geom_proj = roads_proj.iloc[idx].geometry
            if geom_ll is None or geom_ll.is_empty:
                continue

            for line_ll, line_proj in self._iter_line_pairs(geom_ll, geom_proj):
                coords_ll = list(line_ll.coords)
                coords_proj = list(line_proj.coords)
                if len(coords_ll) < 2:
                    continue

                for start_idx in range(len(coords_ll) - 1):
                    lon1, lat1 = coords_ll[start_idx]
                    lon2, lat2 = coords_ll[start_idx + 1]
                    x1, y1 = coords_proj[start_idx]
                    x2, y2 = coords_proj[start_idx + 1]

                    length = math.hypot(x2 - x1, y2 - y1)
                    if length <= 0:
                        continue

                    u = self._get_or_create_node((lon1, lat1), (x1, y1))
                    v = self._get_or_create_node((lon2, lat2), (x2, y2))
                    if u == v:
                        continue

                    existing = self.graph.get_edge_data(u, v)
                    if existing is None or length < existing.get("length", math.inf):
                        self.graph.add_edge(
                            u,
                            v,
                            length=length,
                            rn_id=row.get("RN_ID"),
                            rd_name=row.get("RD_NAME"),
                        )

    def _iter_line_pairs(self, geom_ll, geom_proj):
        if geom_ll.geom_type == "LineString":
            yield geom_ll, geom_proj
        elif geom_ll.geom_type == "MultiLineString":
            for part_ll, part_proj in zip(geom_ll.geoms, geom_proj.geoms):
                yield part_ll, part_proj

    def _get_or_create_node(
        self,
        lonlat: Tuple[float, float],
        proj: Tuple[float, float],
    ) -> int:
        key = (round(lonlat[0], 7), round(lonlat[1], 7))
        node_id = self._node_lookup.get(key)
        if node_id is None:
            node_id = len(self._node_lookup)
            self._node_lookup[key] = node_id
            self.graph.add_node(
                node_id,
                lon=key[0],
                lat=key[1],
                x_proj=proj[0],
                y_proj=proj[1],
            )
        return node_id

    def _build_spatial_index(self) -> None:
        self._grid.clear()
        for node, data in self.graph.nodes(data=True):
            cell_x = int(math.floor(data["x_proj"] / self.cell_size))
            cell_y = int(math.floor(data["y_proj"] / self.cell_size))
            self._grid[(cell_x, cell_y)].append(node)

    # ------------------------------------------------------------------
    # Mapping helpers
    # ------------------------------------------------------------------
    def nearest_node(self, lon: float, lat: float) -> Tuple[int, float]:
        x, y = self.transformer.transform(lon, lat)
        cell_x = int(math.floor(x / self.cell_size))
        cell_y = int(math.floor(y / self.cell_size))

        best_node: Optional[int] = None
        best_dist_sq = float("inf")

        for radius in range(self.max_radius + 1):
            found = False
            for dx in range(-radius, radius + 1):
                for dy in range(-radius, radius + 1):
                    cell = (cell_x + dx, cell_y + dy)
                    if cell not in self._grid:
                        continue
                    found = True
                    for node in self._grid[cell]:
                        data = self.graph.nodes[node]
                        dist_sq = (data["x_proj"] - x) ** 2 + (data["y_proj"] - y) ** 2
                        if dist_sq < best_dist_sq:
                            best_dist_sq = dist_sq
                            best_node = node
            if best_node is not None and found:
                break

        if best_node is None:
            for node, data in self.graph.nodes(data=True):
                dist_sq = (data["x_proj"] - x) ** 2 + (data["y_proj"] - y) ** 2
                if dist_sq < best_dist_sq:
                    best_dist_sq = dist_sq
                    best_node = node

        if best_node is None:
            raise ValueError("Unable to locate nearest road node for point")

        return best_node, math.sqrt(best_dist_sq)

    def map_dataframe(
        self,
        df: pd.DataFrame,
        *,
        lon_col: str,
        lat_col: str,
    ) -> pd.DataFrame:
        mapped_nodes: List[Optional[int]] = []
        snap_distances: List[float] = []

        for lon, lat in zip(df[lon_col], df[lat_col]):
            if pd.isna(lon) or pd.isna(lat):
                mapped_nodes.append(None)
                snap_distances.append(float("nan"))
                continue
            node, dist = self.nearest_node(float(lon), float(lat))
            mapped_nodes.append(node)
            snap_distances.append(dist)

        mapped = df.copy()
        mapped["graph_node"] = mapped_nodes
        mapped["snap_distance_m"] = snap_distances
        mapped = mapped.dropna(subset=["graph_node"]).copy()
        mapped["graph_node"] = mapped["graph_node"].astype(int)
        return mapped

    # ------------------------------------------------------------------
    # Routing helpers
    # ------------------------------------------------------------------
    def build_travel_matrix(
        self,
        origins: Dict[str, int],
        destinations: Dict[str, int],
        cutoff_m: float,
    ) -> pd.DataFrame:
        destination_lookup: Dict[int, List[str]] = defaultdict(list)
        for dest_id, node_id in destinations.items():
            destination_lookup[node_id].append(dest_id)

        records: List[Tuple[str, str, float]] = []
        for origin_id, origin_node in origins.items():
            lengths = nx.single_source_dijkstra_path_length(
                self.graph,
                origin_node,
                cutoff=cutoff_m,
                weight="length",
            )
            for node_id, distance in lengths.items():
                if node_id not in destination_lookup:
                    continue
                for dest_id in destination_lookup[node_id]:
                    records.append((origin_id, dest_id, float(distance)))

        return pd.DataFrame(records, columns=["origin_id", "amenity_id", "distance_m"])


class RoadAccessibilityAnalyzer:
    """Compute road-network-based accessibility metrics per amenity category."""

    def __init__(
        self,
        road_network_geojson: Path,
        subzones_geojson: Path,
        *,
        categories: Optional[Iterable[str]] = None,
        max_distance_km: float = 5.0,
        decay_beta: float = 2.0,
    ) -> None:
        self.router = RoadNetworkRouter(road_network_geojson)
        self.subzones_geojson = subzones_geojson
        self.categories = [
            c.strip().lower().replace(" ", "_") for c in categories
        ] if categories else None
        self.max_distance_km = max_distance_km
        self.max_distance_m = max_distance_km * 1000.0
        self.decay_beta = decay_beta
        self._pysal_access_cls = PySALAccess
        if PySALAccess is None and not getattr(self.__class__, "_warned_missing_pysal", False):
            warnings.warn(
                "PySAL Access package not available. Falling back to built-in accessibility implementation.",
                RuntimeWarning,
            )
            setattr(self.__class__, "_warned_missing_pysal", True)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def compute(self, amenities_df: pd.DataFrame) -> pd.DataFrame:
        demand_df = self._prepare_subzones()
        supply_df = self._prepare_amenities(amenities_df)

        if supply_df.empty:
            return pd.DataFrame(
                columns=[
                    "origin_id",
                    "subzone_name",
                    "planning_area",
                    "category",
                    "model",
                    "score",
                ]
            )

        travel_df = self._build_travel_matrix(demand_df, supply_df)
        results = self._compute_models(demand_df, supply_df, travel_df)
        return results

    # ------------------------------------------------------------------
    # Data preparation
    # ------------------------------------------------------------------
    def _prepare_subzones(self) -> pd.DataFrame:
        subzones = gpd.read_file(self.subzones_geojson).to_crs(WGS84_CRS)
        if "SUBZONE_N" not in subzones.columns or "SZ_ID" not in subzones.columns:
            raise KeyError("subzone GeoJSON missing required columns 'SUBZONE_N'/'SZ_ID'")

        centroids = subzones.geometry.centroid
        df = pd.DataFrame({
            "origin_id": subzones["SZ_ID"].astype(str),
            "subzone_name": subzones["SUBZONE_N"],
            "planning_area": subzones.get("PLN_AREA_N", ""),
            "lon": centroids.x,
            "lat": centroids.y,
        })
        df["demand"] = 1.0
        df = self.router.map_dataframe(df, lon_col="lon", lat_col="lat")
        return df

    def _prepare_amenities(self, amenities_df: pd.DataFrame) -> pd.DataFrame:
        df = amenities_df.copy()
        required_cols = {"amenity_id", "lat", "lon"}
        missing = required_cols.difference(df.columns)
        if missing:
            raise KeyError(
                f"amenities dataset missing required columns: {', '.join(sorted(missing))}"
            )

        df = df.dropna(subset=["amenity_id", "lat", "lon"]).copy()
        df["amenity_id"] = df["amenity_id"].astype(str)
        df["lat"] = pd.to_numeric(df["lat"], errors="coerce")
        df["lon"] = pd.to_numeric(df["lon"], errors="coerce")
        df = df.dropna(subset=["lat", "lon"])

        df["amenity_category_norm"] = (
            df.get("amenity_category", "")
            .astype(str)
            .str.strip()
            .str.lower()
            .str.replace(" ", "_")
        )

        df["capacity"] = pd.to_numeric(
            df.get("importance_score", 1.0), errors="coerce"
        ).fillna(1.0)
        df.loc[df["capacity"] <= 0, "capacity"] = 1.0

        df = self.router.map_dataframe(df, lon_col="lon", lat_col="lat")
        return df

    def _build_travel_matrix(
        self,
        demand_df: pd.DataFrame,
        supply_df: pd.DataFrame,
    ) -> pd.DataFrame:
        origin_nodes = demand_df.set_index("origin_id")["graph_node"].to_dict()
        destination_nodes = supply_df.set_index("amenity_id")["graph_node"].to_dict()
        travel_df = self.router.build_travel_matrix(
            origin_nodes,
            destination_nodes,
            cutoff_m=self.max_distance_m,
        )
        return travel_df

    # ------------------------------------------------------------------
    # Accessibility model computations
    # ------------------------------------------------------------------
    def _compute_models(
        self,
        demand_df: pd.DataFrame,
        supply_df: pd.DataFrame,
        travel_df: pd.DataFrame,
    ) -> Dict[str, pd.DataFrame]:
        demand_lookup = demand_df.set_index("origin_id")
        demand_lookup["demand"] = demand_lookup.get("demand", 1.0)

        categories_available = supply_df["amenity_category_norm"].dropna().unique()
        categories = (
            [c for c in self.categories if c in categories_available]
            if self.categories
            else sorted(categories_available)
        )

        results: List[Dict[str, object]] = []
        for category in categories:
            supply_cat = supply_df[supply_df["amenity_category_norm"] == category]
            if supply_cat.empty:
                continue

            travel_cat = travel_df[travel_df["amenity_id"].isin(supply_cat["amenity_id"])]
            if travel_cat.empty:
                zeros = pd.Series(0.0, index=demand_lookup.index)
                results.extend(self._series_to_records(zeros, category, "hansen"))
                results.extend(self._series_to_records(zeros, category, "2sfca"))
                results.extend(self._series_to_records(zeros, category, "cumulative"))
                continue

            supply_series = supply_cat.set_index("amenity_id")["capacity"]

            hansen = self._compute_hansen(
                travel_cat,
                supply_series,
                demand_lookup.index,
            )
            two_sfca = self._compute_two_stage_fca(
                travel_cat,
                supply_series,
                demand_lookup,
            )
            cumulative = self._compute_cumulative(travel_cat, demand_lookup.index)

            results.extend(self._series_to_records(hansen, category, "hansen"))
            results.extend(self._series_to_records(two_sfca, category, "2sfca"))
            results.extend(self._series_to_records(cumulative, category, "cumulative"))

        if not results:
            subzone_empty = pd.DataFrame(
                columns=[
                    "origin_id",
                    "subzone_name",
                    "planning_area",
                    "category",
                    "model",
                    "score",
                ]
            )
            planning_empty = pd.DataFrame(
                columns=["planning_area", "category", "model", "score"]
            )
            return {
                "subzone_long": subzone_empty,
                "planning_long": planning_empty,
                "subzone_wide": pd.DataFrame(),
                "planning_wide": pd.DataFrame(),
            }

        result_df = pd.DataFrame(results)
        result_df = result_df.merge(
            demand_lookup.reset_index()[
                ["origin_id", "subzone_name", "planning_area"]
            ],
            on="origin_id",
            how="left",
        )
        columns_subzone = [
            "origin_id",
            "subzone_name",
            "planning_area",
            "category",
            "model",
            "score",
        ]
        result_df = result_df[columns_subzone].sort_values(
            ["category", "model", "origin_id"]
        ).reset_index(drop=True)

        planning_long = (
            result_df.groupby(["planning_area", "category", "model"])["score"]
            .mean()
            .reset_index()
        )

        subzone_wide = self._pivot_scores(
            result_df, key_col="subzone_name", prefix="subzone_access"
        )
        planning_wide = self._pivot_scores(
            planning_long, key_col="planning_area", prefix="planning_access"
        )

        return {
            "subzone_long": result_df,
            "planning_long": planning_long,
            "subzone_wide": subzone_wide,
            "planning_wide": planning_wide,
        }

    def _compute_cumulative(
        self,
        travel_df: pd.DataFrame,
        base_index: Iterable[str],
    ) -> pd.Series:
        eligible = travel_df[travel_df["distance_m"] <= self.max_distance_m]
        cumulative = eligible.groupby("origin_id").size().astype(float)
        cumulative = cumulative.reindex(base_index, fill_value=0.0)
        return cumulative

    def _compute_two_stage_fca(
        self,
        travel_df: pd.DataFrame,
        supply_series: pd.Series,
        demand_lookup: pd.DataFrame,
    ) -> pd.Series:
        eligible = travel_df[travel_df["distance_m"] <= self.max_distance_m]
        if eligible.empty:
            return pd.Series(0.0, index=demand_lookup.index)

        demand_join = eligible.merge(
            demand_lookup["demand"],
            left_on="origin_id",
            right_index=True,
            how="left",
        )
        demand_join["demand"] = demand_join["demand"].fillna(1.0)

        demand_sum = demand_join.groupby("amenity_id")["demand"].sum()
        ratio = supply_series / demand_sum
        ratio = ratio.replace([np.inf, -np.inf], 0.0).fillna(0.0)

        step_two = demand_join.merge(
            ratio.rename("ratio"),
            left_on="amenity_id",
            right_index=True,
            how="left",
        )
        step_two["ratio"] = step_two["ratio"].fillna(0.0)

        scores = step_two.groupby("origin_id")["ratio"].sum()
        scores = scores.reindex(demand_lookup.index, fill_value=0.0)
        return scores

    def _compute_hansen(
        self,
        travel_df: pd.DataFrame,
        supply_series: pd.Series,
        base_index: Iterable[str],
    ) -> pd.Series:
        df = travel_df.copy()
        df["distance_km"] = df["distance_m"].astype(float) / 1000.0
        df = df[df["distance_km"] <= self.max_distance_km]
        if df.empty:
            return pd.Series(0.0, index=base_index)

        df["distance_km"] = df["distance_km"].clip(lower=MIN_DISTANCE_EPS)
        df["supply"] = df["amenity_id"].map(supply_series).fillna(1.0)
        df["weight"] = df["supply"] / np.power(df["distance_km"], self.decay_beta)

        scores = df.groupby("origin_id")["weight"].sum()
        scores = scores.reindex(base_index, fill_value=0.0)
        return scores

    @staticmethod
    def _series_to_records(series: pd.Series, category: str, model: str) -> List[Dict[str, object]]:
        series = series.fillna(0.0)
        return [
            {
                "origin_id": idx,
                "category": category,
                "model": model,
                "score": float(value),
            }
            for idx, value in series.items()
        ]

    @staticmethod
    def _pivot_scores(
        df: pd.DataFrame,
        *,
        key_col: str,
        prefix: str,
    ) -> pd.DataFrame:
        if df.empty:
            return pd.DataFrame()

        pivot = (
            df.pivot_table(
                index=[key_col, "category"],
                columns="model",
                values="score",
                fill_value=0.0,
            )
            .rename_axis(None, axis=1)
            .reset_index()
        )

        flattened_cols = [key_col, "category_norm"]
        model_cols = []
        for col in pivot.columns[2:]:
            model_cols.append(f"{prefix}_{col}")
        pivot.columns = flattened_cols + model_cols
        return pivot
