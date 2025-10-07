"""Flood-to-road segment matching utilities for ETL pipelines.

This module refactors the original exploratory notebook into an object-oriented implementation that can be wired into automated ETL workflows. The primary entry
point is :class:`FloodRoadSegmentMatcher`, which loads the required road network and flood alert datasets, performs snapping and routing logic, and returns
GeoDataFrames ready for persistence.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, Iterator, List, Optional, Sequence, Tuple

import geopandas as gpd
import networkx as nx
import pandas as pd
from pyproj import Transformer
from shapely.geometry import GeometryCollection, LineString, MultiLineString, Point
from shapely.ops import linemerge, substring

try:  # Python 3.10+
    from itertools import pairwise
except ImportError:  # pragma: no cover - compatibility fallback
    def pairwise(iterable: Iterable):
        iterator = iter(iterable)
        prev = next(iterator, None)
        for item in iterator:
            if prev is None:
                prev = item
                continue
            yield prev, item
            prev = item


@dataclass(slots=True)
class FloodRoadMatchingConfig:
    """Configuration for flood-to-road segment matching."""

    roads_path: Path = Path(__file__).resolve().parent / "data" / "road_network.geojson"
    floods_path: Path = Path(__file__).resolve().parent / "data" / "old_datasets" / "floods.csv"
    wgs84: str = "EPSG:4326"
    local_crs: str = "EPSG:3414"
    snap_search_radii: Tuple[float, ...] = (30, 60, 120, 240, 480, 960)
    max_snap_distance_m: float = 150.0
    max_end_projection_distance_m: float = 500.0
    anchor_fallback_window_m: float = 150.0
    reported_location_distance_threshold_m: float = 800.0


@dataclass(slots=True)
class SnapResult:
    """Represents the result of snapping a point to the road network."""

    point: Point
    edge_id: int
    distance: float
    road_name: Optional[str]
    unique_id: Optional[str]


@dataclass
class FloodRoadMatchResults:
    """Container for matched and unmatched flood events."""

    matched: gpd.GeoDataFrame
    unmatched: pd.DataFrame

    def save_matched(self, path: Path, driver: str = "GeoJSON") -> None:
        """Persist matched segments to disk."""
        self.matched.to_file(path, driver=driver)

    def save_unmatched(self, path: Path) -> None:
        """Persist unmatched records for diagnostics."""
        self.unmatched.to_csv(path, index=False)


class RoadNetworkIndex:
    """Prepares spatial indices and helper structures for the road network."""

    ROAD_TYPE_SUFFIXES: Tuple[str, ...] = (
        " ROAD",
        " STREET",
        " AVENUE",
        " DRIVE",
        " LANE",
        " WAY",
        " EXPRESSWAY",
        " HIGHWAY",
        " CLOSE",
        " PLACE",
        " CRESCENT",
        " TERRACE",
        " BOULEVARD",
        " WALK",
        " LINK",
        " RISE",
        " PARK",
        " GROVE",
        " VIEW",
        " COURT",
        " GARDEN",
        " HILL",
        " LOOP",
        " HEIGHTS",
        " QUAY",
        " TRACK",
        " PARKWAY",
        " CIRCLE",
        " GREEN",
        " GATE",
        " CROSS",
    )

    ANCHOR_ABBREVIATIONS: Dict[str, str] = {
        "TPE": "TAMPINES EXPRESSWAY",
        "CTE": "CENTRAL EXPRESSWAY",
        "SLE": "SELETAR EXPRESSWAY",
        "KJE": "KRANJI EXPRESSWAY",
        "BKE": "BUKIT TIMAH EXPRESSWAY",
        "PIE": "PAN ISLAND EXPRESSWAY",
        "ECP": "EAST COAST PARKWAY",
        "KPE": "KALLANG PAYA LEBAR EXPRESSWAY",
        "MCE": "MARINA COASTAL EXPRESSWAY",
    }

    def __init__(self, config: FloodRoadMatchingConfig) -> None:
        self.config = config
        self.roads_wgs84: gpd.GeoDataFrame = gpd.GeoDataFrame()
        self.roads_local: gpd.GeoDataFrame = gpd.GeoDataFrame()
        self.route_components: Dict[str, List[LineString]] = {}
        self.route_metadata: Dict[str, pd.Series] = {}
        self.road_graph: nx.Graph = nx.Graph()
        self.edge_gdf: gpd.GeoDataFrame = gpd.GeoDataFrame()
        self.edge_sindex = None
        self.edge_id_to_nodes: Dict[int, Tuple[Tuple[float, float], Tuple[float, float]]] = {}
        self.base_edge_id: int = 0
        self.transformer_to_local = Transformer.from_crs(
            self.config.wgs84, self.config.local_crs, always_xy=True
        )
        self._load_road_data()
        self._prepare_named_routes()
        self._build_graph_index()

    # ------------------------------------------------------------------
    # Loading and preparation
    # ------------------------------------------------------------------
    def _load_road_data(self) -> None:
        roads = gpd.read_file(self.config.roads_path)
        if roads.crs is None:
            roads = roads.set_crs(self.config.wgs84)
        self.roads_wgs84 = roads.to_crs(self.config.wgs84)
        self.roads_local = roads.to_crs(self.config.local_crs)
        self.roads_wgs84["RD_NAME_NORM"] = self.roads_wgs84["RD_NAME"].fillna("").str.upper().str.strip()
        self.roads_local["RD_NAME_NORM"] = self.roads_wgs84["RD_NAME_NORM"]

    def _prepare_named_routes(self) -> None:
        route_components: Dict[str, List[LineString]] = {}
        route_metadata: Dict[str, pd.Series] = {}

        for name, group in self.roads_local.groupby("RD_NAME_NORM"):
            if group.empty:
                continue
            union_geom = group.geometry.unary_union
            components: List[LineString] = []
            if isinstance(union_geom, LineString):
                components = [union_geom]
            elif isinstance(union_geom, MultiLineString):
                components = [
                    geom
                    for geom in union_geom.geoms
                    if isinstance(geom, LineString) and not geom.is_empty
                ]
            else:
                parts: List[LineString] = []
                for geom in getattr(union_geom, "geoms", []):
                    if isinstance(geom, LineString):
                        parts.append(geom)
                    elif isinstance(geom, MultiLineString):
                        parts.extend(
                            [sub for sub in geom.geoms if isinstance(sub, LineString) and not sub.is_empty]
                        )
                if parts:
                    if len(parts) == 1:
                        components = parts
                    else:
                        merged = linemerge(MultiLineString(parts))
                        if isinstance(merged, LineString):
                            components = [merged]
                        elif isinstance(merged, MultiLineString):
                            components = [
                                geom
                                for geom in merged.geoms
                                if isinstance(geom, LineString) and not geom.is_empty
                            ]

            if not components:
                continue

            route_components[name] = components
            route_metadata[name] = self.roads_wgs84.loc[group.index].iloc[0]

        self.route_components = route_components
        self.route_metadata = route_metadata

    def _build_graph_index(self) -> None:
        graph = nx.Graph()
        edge_records = []
        edge_id = 0

        for row_idx, row in self.roads_local.iterrows():
            for line in self._iter_lines(row.geometry):
                coords = list(line.coords)
                for a, b in pairwise(coords):
                    if a == b:
                        continue
                    u = (round(float(a[0]), 3), round(float(a[1]), 3))
                    v = (round(float(b[0]), 3), round(float(b[1]), 3))
                    segment = LineString([a, b])
                    length = segment.length

                    if u not in graph:
                        graph.add_node(u, point=Point(a))
                    if v not in graph:
                        graph.add_node(v, point=Point(b))

                    if graph.has_edge(u, v):
                        continue

                    graph.add_edge(
                        u,
                        v,
                        length=length,
                        geometry=segment,
                        road_name=row.get("RD_NAME"),
                        unique_id=row.get("UNIQUE_ID"),
                    )
                    edge_records.append(
                        {
                            "edge_id": edge_id,
                            "u": u,
                            "v": v,
                            "geometry": segment,
                            "road_name": row.get("RD_NAME"),
                            "unique_id": row.get("UNIQUE_ID"),
                        }
                    )
                    edge_id += 1

        edge_gdf = gpd.GeoDataFrame(edge_records, geometry="geometry", crs=self.roads_local.crs)
        edge_gdf.set_index("edge_id", inplace=True)

        self.road_graph = graph
        self.edge_gdf = edge_gdf
        self.edge_sindex = edge_gdf.sindex
        self.edge_id_to_nodes = {idx: (row.u, row.v) for idx, row in edge_gdf.iterrows()}
        self.base_edge_id = int(edge_gdf.index.max() or 0)

    # ------------------------------------------------------------------
    # Geometry helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _iter_lines(geometry) -> List[LineString]:
        if geometry is None or geometry.is_empty:
            return []
        if isinstance(geometry, LineString):
            return [geometry]
        if isinstance(geometry, MultiLineString):
            return [geom for geom in geometry.geoms if isinstance(geom, LineString) and not geom.is_empty]
        parts: List[LineString] = []
        for geom in getattr(geometry, "geoms", []):
            parts.extend(RoadNetworkIndex._iter_lines(geom))
        return parts

    def to_local_point(self, lat: float, lng: float) -> Point:
        x, y = self.transformer_to_local.transform(lng, lat)
        return Point(x, y)

    def to_wgs84_geom(self, geom):
        if geom is None:
            return None
        geo = gpd.GeoSeries([geom], crs=self.config.local_crs).to_crs(self.config.wgs84)
        return geo.iloc[0]

    @staticmethod
    def oriented_substring(line: LineString, start_d: float, end_d: float) -> LineString:
        segment = substring(line, min(start_d, end_d), max(start_d, end_d))
        if segment.is_empty:
            return segment
        if start_d > end_d:
            segment = LineString(list(segment.coords)[::-1])
        return segment

    def extract_context_segment(self, line: LineString, centre_point: Point, *, window: float = 30.0) -> LineString:
        length = line.length
        centre_d = line.project(centre_point)
        low = max(centre_d - window, 0.0)
        high = min(centre_d + window, length)
        if math.isclose(low, high):
            high = min(low + window, length)
            low = max(high - window, 0.0)
        return self.oriented_substring(line, low, high)

    # ------------------------------------------------------------------
    # Road name helpers
    # ------------------------------------------------------------------
    @staticmethod
    def normalize_road_name(name: str) -> str:
        if not isinstance(name, str):
            return ""
        return " ".join(name.upper().split())

    def expand_road_alias(self, name: str) -> str:
        norm = self.normalize_road_name(name)
        return self.ANCHOR_ABBREVIATIONS.get(norm, norm)

    def _generate_route_name_variants(self, norm: str) -> List[str]:
        variants: List[str] = []
        if not norm:
            return variants
        variants.append(norm)
        has_suffix = any(norm.endswith(suffix) for suffix in self.ROAD_TYPE_SUFFIXES)
        if not has_suffix:
            for suffix in self.ROAD_TYPE_SUFFIXES:
                candidate = f"{norm} {suffix}"
                if candidate in self.route_components:
                    variants.append(candidate)
        return variants

    def resolve_route_name_candidates(self, value: Optional[str]) -> List[str]:
        norm = self.normalize_road_name(self.expand_road_alias(value or ""))
        if not norm:
            return []

        matches: List[str] = []
        for variant in self._generate_route_name_variants(norm):
            if variant in self.route_components and variant not in matches:
                matches.append(variant)

        if matches:
            return matches

        for name in self.route_components.keys():
            if norm in name or name in norm:
                if name not in matches:
                    matches.append(name)
        return matches

    def get_route_component_by_name(
        self,
        name: str,
        start_point: Optional[Point] = None,
        end_point: Optional[Point] = None,
    ) -> Tuple[Optional[LineString], Optional[pd.Series], Optional[List[LineString]]]:
        norm = self.normalize_road_name(name)
        components = self.route_components.get(norm)
        if not components:
            return None, None, None

        if start_point is None and end_point is None:
            selected = components[0]
        else:
            def score(component: LineString) -> float:
                score_val = 0.0
                if start_point is not None:
                    score_val += component.distance(start_point)
                if end_point is not None:
                    score_val += component.distance(end_point)
                return score_val

            selected = min(components, key=score)

        metadata = self.route_metadata.get(norm)
        return selected, metadata, components

    def split_related_road_tokens(self, text: Optional[str]) -> List[str]:
        if not isinstance(text, str) or not text.strip():
            return []

        working = text
        working = working.replace("/", ",").replace(";", ",")
        working = working.replace("(", ",").replace(")", ",")
        working = re.sub(
            r"\b(?:TOWARDS|TOWARD|BETWEEN|FROM|TO|NEAR|BEFORE|AFTER|LEADING TO|JUNCTION OF|INTERSECTION OF|EXIT)\b",
            " ",
            working,
            flags=re.IGNORECASE,
        )

        parts = re.split(r",|\band\b", working, flags=re.IGNORECASE)
        cleaned: List[str] = []
        for part in parts:
            candidate = re.sub(r"\s+", " ", part).strip(" -")
            if candidate:
                cleaned.append(candidate)
        return cleaned

    def extract_related_road_names(self, record) -> List[str]:
        parent_norm = self.normalize_road_name(getattr(record, "parent_road", ""))
        names: List[str] = []
        for attr in ("start_loc", "end_loc", "cleaned_location"):
            value = getattr(record, attr, None)
            for token in self.split_related_road_tokens(value):
                for match in self.resolve_route_name_candidates(token):
                    if not match:
                        continue
                    if match == parent_norm:
                        continue
                    if match not in names:
                        names.append(match)
        return names

    # ------------------------------------------------------------------
    # Anchor-based refinements
    # ------------------------------------------------------------------
    @staticmethod
    def _iter_points_from_intersection(geom) -> Iterator[Point]:
        if geom is None or geom.is_empty:
            return
        geom_type = geom.geom_type
        if geom_type == "Point":
            yield geom
        elif geom_type == "MultiPoint":
            for pt in geom.geoms:
                yield pt
        elif geom_type in {"LineString", "LinearRing"}:
            yield Point(geom.coords[0])
            yield Point(geom.coords[-1])
        elif geom_type == "MultiLineString":
            for line in geom.geoms:
                if not line.is_empty:
                    yield Point(line.coords[0])
                    yield Point(line.coords[-1])
        elif geom_type == "GeometryCollection":
            for part in geom.geoms:
                yield from RoadNetworkIndex._iter_points_from_intersection(part)

    def collect_anchor_positions(self, parent_route: LineString, anchor_names: Sequence[str]) -> List[float]:
        positions: List[float] = []
        seen: set[float] = set()
        for name in anchor_names:
            components = self.route_components.get(name)
            if not components:
                continue
            for comp in components:
                inter = parent_route.intersection(comp)
                if inter is None or inter.is_empty:
                    continue
                for point in self._iter_points_from_intersection(inter):
                    if point is None or point.is_empty:
                        continue
                    pos = parent_route.project(point)
                    key = round(pos, 3)
                    if key not in seen:
                        seen.add(key)
                        positions.append(pos)
        positions.sort()
        return positions

    def choose_segment_bounds(self, parent_route: LineString, positions: Sequence[float]) -> Optional[Tuple[float, float]]:
        if not positions:
            return None

        length = parent_route.length
        if len(positions) >= 2:
            start = max(min(positions), 0.0)
            end = min(max(positions), length)
            if math.isclose(start, end):
                half = min(self.config.anchor_fallback_window_m, length / 2.0)
                start = max(start - half, 0.0)
                end = min(end + half, length)
            return start, end

        pos = positions[0]
        half = min(self.config.anchor_fallback_window_m, length / 2.0)
        start = max(pos - half, 0.0)
        end = min(pos + half, length)
        if math.isclose(start, end):
            epsilon = min(self.config.anchor_fallback_window_m, length / 2.0 or self.config.anchor_fallback_window_m)
            start = max(pos - epsilon, 0.0)
            end = min(pos + epsilon, length)
        return start, end

    def refine_segment_with_named_anchors(
        self,
        record,
        parent_route: LineString,
        *,
        start_point: Optional[Point] = None,
        end_point: Optional[Point] = None,
        current_segment: Optional[LineString] = None,
        start_on_line: Optional[Point] = None,
        end_on_line: Optional[Point] = None,
    ) -> Optional[Dict[str, object]]:
        anchor_names = self.extract_related_road_names(record)
        if not anchor_names:
            return None

        positions = self.collect_anchor_positions(parent_route, anchor_names)
        if not positions:
            return None

        current_start_offset = None
        if (
            current_segment is not None
            and not current_segment.is_empty
            and start_on_line is not None
            and start_point is not None
        ):
            current_start_offset = start_on_line.distance(start_point)
            current_end_offset = (
                end_on_line.distance(end_point)
                if (end_on_line is not None and end_point is not None)
                else None
            )
            if current_start_offset is not None and current_start_offset <= self.config.reported_location_distance_threshold_m:
                if current_end_offset is None or current_end_offset <= self.config.reported_location_distance_threshold_m:
                    return None

        bounds = self.choose_segment_bounds(parent_route, positions)
        if not bounds:
            return None

        start_pos, end_pos = bounds
        new_segment = self.oriented_substring(parent_route, start_pos, end_pos)
        if new_segment is None or new_segment.is_empty:
            return None

        new_start = parent_route.interpolate(start_pos)
        new_end = parent_route.interpolate(end_pos)

        return {
            "segment": new_segment,
            "start_on_line": new_start,
            "end_on_line": new_end,
            "start_offset": new_start.distance(start_point) if start_point is not None else None,
            "end_offset": new_end.distance(end_point) if end_point is not None else None,
            "anchor_names": anchor_names,
        }

    # ------------------------------------------------------------------
    # Network helpers
    # ------------------------------------------------------------------
    def snap_point_to_network(self, point: Point, radii: Sequence[float] | None = None) -> Optional[SnapResult]:
        radii = radii or self.config.snap_search_radii
        for radius in radii:
            candidate_idx = list(self.edge_sindex.query(point.buffer(radius)))
            if not candidate_idx:
                continue
            best_idx = min(candidate_idx, key=lambda idx: self.edge_gdf.loc[idx, "geometry"].distance(point))
            edge_row = self.edge_gdf.loc[best_idx]
            line = edge_row.geometry
            snapped = line.interpolate(line.project(point))
            return SnapResult(
                point=snapped,
                edge_id=int(best_idx),
                distance=snapped.distance(point),
                road_name=edge_row.road_name,
                unique_id=edge_row.unique_id,
            )
        return None

    def ensure_edge_in_graph(self, graph: nx.Graph, edge_id: int) -> None:
        if edge_id not in self.edge_id_to_nodes:
            return
        u, v = self.edge_id_to_nodes[edge_id]
        edge_row = self.edge_gdf.loc[edge_id]
        line = edge_row.geometry
        if u not in graph:
            graph.add_node(u, point=Point(u))
        if v not in graph:
            graph.add_node(v, point=Point(v))
        if not graph.has_edge(u, v):
            graph.add_edge(
                u,
                v,
                length=line.length,
                geometry=line,
                road_name=edge_row.road_name,
                unique_id=edge_row.unique_id,
            )

    def split_edge_with_points(
        self,
        graph: nx.Graph,
        edge_id: int,
        snap_specs: Sequence[Tuple[str, Point]],
        next_edge_id: int,
        *,
        tolerance: float = 1e-6,
    ) -> Tuple[Dict[str, Tuple[float, float]], int]:
        if edge_id not in self.edge_id_to_nodes:
            return {}, next_edge_id

        self.ensure_edge_in_graph(graph, edge_id)
        edge_row = self.edge_gdf.loc[edge_id]
        line = edge_row.geometry
        u, v = self.edge_id_to_nodes[edge_id]
        u_point = graph.nodes[u].get("point", Point(u))
        v_point = graph.nodes[v].get("point", Point(v))

        entries: List[Tuple[float, Tuple[float, float], Point]] = [
            (line.project(u_point), u, u_point),
            (line.project(v_point), v, v_point),
        ]

        label_to_node: Dict[str, Tuple[float, float]] = {}
        created = False

        for label, snapped_point in snap_specs:
            if snapped_point.distance(u_point) <= tolerance:
                label_to_node[label] = u
            elif snapped_point.distance(v_point) <= tolerance:
                label_to_node[label] = v
            else:
                graph.add_node(label, point=snapped_point)
                entries.append((line.project(snapped_point), label, snapped_point))
                label_to_node[label] = label
                created = True

        if created and graph.has_edge(u, v):
            graph.remove_edge(u, v)

        if created:
            entries_sorted = sorted(entries, key=lambda item: item[0])
            for (d1, node1, _), (d2, node2, _) in pairwise(entries_sorted):
                if node1 == node2:
                    continue
                segment = self.oriented_substring(line, d1, d2)
                if segment.is_empty:
                    continue
                graph.add_edge(
                    node1,
                    node2,
                    length=segment.length,
                    geometry=segment,
                    road_name=edge_row.road_name,
                    unique_id=edge_row.unique_id,
                )
                next_edge_id += 1

        return label_to_node, next_edge_id

    def orient_linestring(
        self,
        line: LineString,
        start_point: Point,
        end_point: Point,
        tolerance: float = 1e-6,
    ) -> LineString:
        if line.is_empty:
            return line
        coords = list(line.coords)
        if Point(coords[0]).distance(start_point) <= tolerance and Point(coords[-1]).distance(end_point) <= tolerance:
            return line
        if Point(coords[0]).distance(end_point) <= tolerance and Point(coords[-1]).distance(start_point) <= tolerance:
            return LineString(coords[::-1])
        start_d = line.project(start_point)
        end_d = line.project(end_point)
        return self.oriented_substring(line, start_d, end_d)

    def assemble_path_geometry(self, graph: nx.Graph, node_path: Sequence[Tuple[float, float]]):
        segments: List[LineString] = []
        path_names: List[str] = []
        total_length = 0.0
        for u, v in pairwise(node_path):
            data = graph.get_edge_data(u, v)
            if not data:
                continue
            geom = data.get("geometry")
            if geom is None or geom.is_empty:
                continue
            start_point = graph.nodes[u]["point"]
            end_point = graph.nodes[v]["point"]
            oriented = self.orient_linestring(geom, start_point, end_point)
            if oriented.is_empty:
                continue
            segments.append(oriented)
            total_length += oriented.length
            name = data.get("road_name")
            if name:
                path_names.append(name)

        if not segments:
            return None, 0.0, []
        if len(segments) == 1:
            unique_names = list(dict.fromkeys(path_names))
            return segments[0], segments[0].length, unique_names

        merged = linemerge(segments)
        unique_names = list(dict.fromkeys(path_names))
        return merged, total_length, unique_names

    def collect_candidate_edge_ids(
        self,
        start_point: Point,
        end_point: Optional[Point] = None,
        *,
        base_radius: float = 150.0,
        max_radius: float = 2000.0,
    ) -> Tuple[set[int], float]:
        radius = base_radius
        while radius <= max_radius:
            area = start_point.buffer(radius)
            if end_point is not None:
                area = area.union(end_point.buffer(radius))
            candidate_idx = set(self.edge_sindex.query(area))
            if candidate_idx:
                return candidate_idx, radius
            radius *= 2
        return set(), max_radius

    def build_local_graph(self, candidate_edge_ids: Iterable[int]) -> nx.Graph:
        edge_keys = [self.edge_id_to_nodes[idx] for idx in candidate_edge_ids if idx in self.edge_id_to_nodes]
        if not edge_keys:
            return nx.Graph()
        return self.road_graph.edge_subgraph(edge_keys).copy()

    def compute_network_route(
        self,
        start_snap: SnapResult,
        end_snap: SnapResult,
        start_point: Point,
        end_point: Point,
        *,
        base_radius: float = 150.0,
        max_radius: float = 2000.0,
    ) -> Tuple[Optional[LineString], Optional[float], List[str], float]:
        radius = base_radius
        while radius <= max_radius:
            candidate_ids, _ = self.collect_candidate_edge_ids(
                start_point, end_point, base_radius=radius, max_radius=radius
            )
            candidate_ids.update({start_snap.edge_id, end_snap.edge_id})
            local_graph = self.build_local_graph(candidate_ids)
            self.ensure_edge_in_graph(local_graph, start_snap.edge_id)
            self.ensure_edge_in_graph(local_graph, end_snap.edge_id)

            if local_graph.number_of_edges() == 0:
                radius *= 2
                continue

            next_edge_id = self.base_edge_id + 1
            start_label = "start"
            end_label = "end"

            start_map, next_edge_id = self.split_edge_with_points(
                local_graph,
                start_snap.edge_id,
                [(start_label, start_snap.point)],
                next_edge_id,
            )
            end_map, next_edge_id = self.split_edge_with_points(
                local_graph,
                end_snap.edge_id,
                [(end_label, end_snap.point)],
                next_edge_id,
            )

            start_node = start_map.get(start_label)
            end_node = end_map.get(end_label)
            if start_node is None or end_node is None:
                radius *= 2
                continue

            try:
                node_path = nx.shortest_path(local_graph, start_node, end_node, weight="length")
            except nx.NetworkXNoPath:
                radius *= 2
                continue

            route_geom, route_length, route_names = self.assemble_path_geometry(local_graph, node_path)
            if route_geom is None or route_geom.is_empty:
                radius *= 2
                continue

            return route_geom, route_length, route_names, radius

        return None, None, [], max_radius


class FloodRoadSegmentMatcher:
    """High-level orchestration of flood-to-road segment matching."""

    def __init__(
        self,
        config: FloodRoadMatchingConfig = FloodRoadMatchingConfig(),
        *,
        floods_df: Optional[pd.DataFrame] = None,
        road_network: Optional[RoadNetworkIndex] = None,
    ) -> None:
        self.config = config
        self.network = road_network or RoadNetworkIndex(config)
        self._floods_df = floods_df

    # ------------------------------------------------------------------
    # Data accessors
    # ------------------------------------------------------------------
    @property
    def floods(self) -> pd.DataFrame:
        if self._floods_df is None:
            self._floods_df = pd.read_csv(self.config.floods_path)
        return self._floods_df

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def run(self) -> FloodRoadMatchResults:
        matches: List[Dict[str, object]] = []
        unmatched: List[Dict[str, object]] = []

        for record in self.floods.itertuples():
            match, unmatched_reasons = self._match_single_record(record)
            if match is not None:
                matches.append(match)
            if unmatched_reasons:
                unmatched.extend(unmatched_reasons)

        matched_gdf = gpd.GeoDataFrame(matches, geometry="segment_geom", crs=self.config.wgs84)
        unmatched_df = pd.DataFrame(unmatched)
        return FloodRoadMatchResults(matched=matched_gdf, unmatched=unmatched_df)

    # ------------------------------------------------------------------
    # Matching logic
    # ------------------------------------------------------------------
    def _match_single_record(self, record) -> Tuple[Optional[Dict[str, object]], List[Dict[str, object]]]:
        unmatched: List[Dict[str, object]] = []
        network = self.network
        config = self.config

        if math.isnan(record.start_lat) or math.isnan(record.start_lng):
            unmatched.append({"flood_id": record.id, "reason": "missing start coordinates"})
            return None, unmatched

        start_point_local = network.to_local_point(record.start_lat, record.start_lng)
        start_snap = network.snap_point_to_network(start_point_local)
        if start_snap is None:
            unmatched.append({
                "flood_id": record.id,
                "reason": "unable to snap start to road network",
            })
            return None, unmatched

        if start_snap.distance > config.max_snap_distance_m:
            unmatched.append({
                "flood_id": record.id,
                "reason": f"reported start is {start_snap.distance:.1f} m away from nearest road (> {config.max_snap_distance_m} m)",
            })
            return None, unmatched

        end_point_local = None
        end_snap = None
        if not math.isnan(getattr(record, "end_lat", math.nan)) and not math.isnan(getattr(record, "end_lng", math.nan)):
            end_point_local = network.to_local_point(record.end_lat, record.end_lng)
            end_snap = network.snap_point_to_network(end_point_local)
            if end_snap is None:
                unmatched.append({
                    "flood_id": record.id,
                    "reason": "unable to snap end to road network",
                })
                end_point_local = None

        segment_local = None
        road_geom_local = None
        road_name = None
        road_unique_id = None
        road_type = None
        start_on_line = start_snap.point
        end_on_line = end_snap.point if end_snap is not None else None
        start_offset = start_snap.distance
        end_offset = end_snap.distance if end_snap is not None else None
        end_segment_gap_m = None
        search_radius = None
        anchor_refinement = None

        parent_road = getattr(record, "parent_road", None)
        if isinstance(parent_road, str) and parent_road.strip():
            named_route, route_metadata, route_components = network.get_route_component_by_name(
                parent_road,
                start_point=start_point_local,
                end_point=end_point_local,
            )
            if named_route is not None:
                candidate_start_on_line = named_route.interpolate(named_route.project(start_point_local))
                candidate_start_offset = candidate_start_on_line.distance(start_point_local)

                candidate_end_on_line = None
                candidate_end_offset = None
                candidate_segment = None

                if end_point_local is not None:
                    candidate_end_on_line = named_route.interpolate(named_route.project(end_point_local))
                    candidate_end_offset = candidate_end_on_line.distance(end_point_local)
                    candidate_segment = RoadNetworkIndex.oriented_substring(
                        named_route,
                        named_route.project(candidate_start_on_line),
                        named_route.project(candidate_end_on_line),
                    )
                    if candidate_segment.is_empty:
                        candidate_segment = None
                full_route_geom = None
                if route_components:
                    if len(route_components) == 1:
                        full_route_geom = route_components[0]
                    else:
                        merged = linemerge(MultiLineString(route_components))
                        if not merged.is_empty:
                            full_route_geom = merged
                        else:
                            full_route_geom = MultiLineString(route_components)
                if candidate_segment is None:
                    if end_point_local is None and full_route_geom is not None:
                        candidate_segment = full_route_geom
                    else:
                        candidate_segment = network.extract_context_segment(
                            named_route, candidate_start_on_line, window=40.0
                        )

                named_route_valid = candidate_start_offset <= config.max_snap_distance_m and (
                    candidate_end_offset is None or candidate_end_offset <= config.max_snap_distance_m
                )

                if named_route_valid and candidate_segment is not None and not candidate_segment.is_empty:
                    refinement = network.refine_segment_with_named_anchors(
                        record,
                        named_route,
                        start_point=start_point_local,
                        end_point=end_point_local,
                        current_segment=candidate_segment,
                        start_on_line=candidate_start_on_line,
                        end_on_line=candidate_end_on_line,
                    )
                    if refinement is not None:
                        candidate_segment = refinement["segment"]
                        candidate_start_on_line = refinement["start_on_line"]
                        candidate_end_on_line = refinement["end_on_line"]
                        new_start_offset = refinement.get("start_offset")
                        if new_start_offset is not None:
                            candidate_start_offset = new_start_offset
                        new_end_offset = refinement.get("end_offset")
                        if new_end_offset is not None:
                            candidate_end_offset = new_end_offset
                        named_route_valid = candidate_start_offset <= config.max_snap_distance_m and (
                            candidate_end_offset is None or candidate_end_offset <= config.max_snap_distance_m
                        )
                        if named_route_valid:
                            anchor_refinement = refinement
                        else:
                            anchor_refinement = None

                if named_route_valid and candidate_segment is not None and not candidate_segment.is_empty:
                    segment_local = candidate_segment
                    start_on_line = candidate_start_on_line
                    start_offset = candidate_start_offset
                    end_on_line = candidate_end_on_line
                    end_offset = candidate_end_offset
                    road_geom_local = named_route
                    if route_metadata is not None:
                        road_name = route_metadata.get("RD_NAME") or parent_road
                        road_unique_id = route_metadata.get("UNIQUE_ID")
                        road_type = route_metadata.get("RD_TYP_CD")
                    else:
                        road_name = parent_road

        if (segment_local is None or segment_local.is_empty) and end_snap is not None and end_point_local is not None:
            network_route, route_length, route_names, radius_used = network.compute_network_route(
                start_snap,
                end_snap,
                start_point_local,
                end_point_local,
            )
            if network_route is not None and not network_route.is_empty:
                segment_local = network_route
                road_geom_local = network_route
                start_on_line = start_snap.point
                end_on_line = end_snap.point
                start_offset = start_snap.distance
                end_offset = end_snap.distance
                search_radius = radius_used
                if route_names:
                    road_name = " / ".join(dict.fromkeys(route_names))
                elif parent_road:
                    road_name = parent_road
                else:
                    road_name = start_snap.road_name
                if road_unique_id is None:
                    road_unique_id = start_snap.unique_id

        if segment_local is None or (segment_local.is_empty if segment_local is not None else True):
            base_line = network.edge_gdf.loc[start_snap.edge_id].geometry
            start_on_line = base_line.interpolate(base_line.project(start_snap.point))
            start_offset = start_on_line.distance(start_point_local)
            if end_point_local is not None:
                projection_distance = base_line.distance(end_point_local)
                if projection_distance <= config.max_end_projection_distance_m:
                    end_on_line = base_line.interpolate(base_line.project(end_point_local))
                    end_offset = end_on_line.distance(end_point_local)
                    segment_local = RoadNetworkIndex.oriented_substring(
                        base_line,
                        base_line.project(start_on_line),
                        base_line.project(end_on_line),
                    )
                    if segment_local.is_empty:
                        segment_local = None
                else:
                    end_on_line = None
                    end_offset = None
            if segment_local is None or segment_local.is_empty:
                segment_local = network.extract_context_segment(base_line, start_on_line, window=40.0)
                end_on_line = None
                if end_offset is None and end_snap is not None:
                    end_offset = end_snap.distance
            road_geom_local = base_line
            if road_name is None:
                road_name = start_snap.road_name or parent_road or record.location
            if road_unique_id is None:
                road_unique_id = start_snap.unique_id

        if segment_local is None or segment_local.is_empty:
            unmatched.append({"flood_id": record.id, "reason": "unable to derive road-aligned segment"})
            return None, unmatched

        if start_offset is None or start_offset > config.max_snap_distance_m:
            distance_desc = "unknown distance" if start_offset is None else f"{start_offset:.1f} m"
            unmatched.append({
                "flood_id": record.id,
                "reason": f"reported start is {distance_desc} from nearest road (> {config.max_snap_distance_m} m)",
            })
            return None, unmatched

        if end_offset is not None and end_offset > config.max_snap_distance_m:
            end_on_line = None
            end_offset = None

        road_geom_local = road_geom_local or segment_local
        segment_length_m = segment_local.length

        if end_point_local is not None and segment_local is not None:
            end_segment_gap_m = segment_local.distance(end_point_local)

        segment_geom_wgs84 = network.to_wgs84_geom(segment_local)
        road_geom_wgs84 = network.to_wgs84_geom(road_geom_local)
        start_on_line_wgs84 = network.to_wgs84_geom(start_on_line)
        end_on_line_wgs84 = network.to_wgs84_geom(end_on_line) if end_on_line is not None else None

        start_imputed_geom = None
        end_imputed_geom = None
        if anchor_refinement is not None:
            threshold = config.reported_location_distance_threshold_m
            if start_on_line_wgs84 is not None and start_offset is not None and start_offset > threshold:
                start_imputed_geom = start_on_line_wgs84
            if end_on_line_wgs84 is not None and end_offset is not None and end_offset > threshold:
                end_imputed_geom = end_on_line_wgs84

        start_imputed_lat = math.nan
        start_imputed_lng = math.nan
        if start_imputed_geom is not None:
            start_imputed_lat = start_imputed_geom.y
            start_imputed_lng = start_imputed_geom.x

        end_imputed_lat = math.nan
        end_imputed_lng = math.nan
        if end_imputed_geom is not None:
            end_imputed_lat = end_imputed_geom.y
            end_imputed_lng = end_imputed_geom.x

        anchor_names = anchor_refinement["anchor_names"] if anchor_refinement is not None else None

        return {
            "flood_id": record.id,
            "event_date": getattr(record, "event_date", None),
            "location": getattr(record, "location", None),
            "event": getattr(record, "event", None),
            "event_type": getattr(record, "event", None),
            "start_lat": getattr(record, "start_lat", None),
            "start_lng": getattr(record, "start_lng", None),
            "end_lat": getattr(record, "end_lat", None),
            "end_lng": getattr(record, "end_lng", None),
            "road_name": road_name,
            "road_unique_id": road_unique_id,
            "road_type": road_type,
            "search_radius_m": search_radius,
            "start_distance_m": start_offset,
            "end_distance_m": end_offset,
            "end_segment_gap_m": end_segment_gap_m,
            "segment_length_m": segment_length_m,
            "segment_geom": segment_geom_wgs84,
            "road_geom": road_geom_wgs84,
            "start_on_line_geom": start_on_line_wgs84,
            "end_on_line_geom": end_on_line_wgs84,
            "start_imputed_geom": start_imputed_geom,
            "start_imputed_lat": start_imputed_lat,
            "start_imputed_lng": start_imputed_lng,
            "start_location_imputed": start_imputed_geom is not None,
            "end_imputed_geom": end_imputed_geom,
            "end_imputed_lat": end_imputed_lat,
            "end_imputed_lng": end_imputed_lng,
            "end_location_imputed": end_imputed_geom is not None,
            "anchor_names": anchor_names,
        }, unmatched

    # ------------------------------------------------------------------
    # Visualisation helpers (optional)
    # ------------------------------------------------------------------
    def plot_match(self, results: FloodRoadMatchResults, flood_id: int, zoom: int = 16):
        """Return a Folium map highlighting a single matched flood event."""
        try:
            import folium
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("folium is required for plotting") from exc

        record = results.matched.loc[results.matched["flood_id"] == flood_id]
        if record.empty:
            raise ValueError(f"Flood id {flood_id} was not matched to a road segment")

        row = record.iloc[0]
        segment_geom = row.get("segment_geom")
        if segment_geom is None or segment_geom.is_empty:
            raise ValueError(f"Matched segment geometry missing for flood id {flood_id}")

        centre_point = row.get("start_on_line_geom")
        if centre_point is None or centre_point.is_empty:
            centre_point = segment_geom.interpolate(0.5, normalized=True)

        centre_lat = centre_point.y
        centre_lng = centre_point.x

        fmap = folium.Map(location=[centre_lat, centre_lng], zoom_start=zoom, tiles="cartodbpositron")

        road_geom = row.get("road_geom")
        if road_geom is not None and not road_geom.is_empty:
            folium.GeoJson(
                data=road_geom.__geo_interface__,
                name=f"Full road: {row['road_name']}",
                style_function=lambda _: {"color": "#888888", "weight": 4, "opacity": 0.5},
            ).add_to(fmap)

        folium.GeoJson(
            data=segment_geom.__geo_interface__,
            name=f"Flooded segment: {row['road_name']}",
            style_function=lambda _: {"color": "#1f78b4", "weight": 6},
        ).add_to(fmap)

        if pd.notna(row.get("start_lat")) and pd.notna(row.get("start_lng")):
            folium.Marker(
                location=[row["start_lat"], row["start_lng"]],
                popup="Reported start",
                icon=folium.Icon(color="red", icon="info-sign"),
            ).add_to(fmap)

        folium.Marker(
            location=[centre_lat, centre_lng],
            popup=f"Snapped start on {row['road_name']}",
            icon=folium.Icon(color="green", icon="play"),
        ).add_to(fmap)

        if pd.notna(row.get("end_lat")) and pd.notna(row.get("end_lng")):
            folium.Marker(
                location=[row["end_lat"], row["end_lng"]],
                popup="Reported end",
                icon=folium.Icon(color="red", icon="flag"),
            ).add_to(fmap)

        end_point = row.get("end_on_line_geom")
        if end_point is not None and not end_point.is_empty:
            folium.Marker(
                location=[end_point.y, end_point.x],
                popup=f"Snapped end on {row['road_name']}",
                icon=folium.Icon(color="green", icon="flag"),
            ).add_to(fmap)

        folium.LayerControl(collapsed=False).add_to(fmap)
        return fmap

    def plot_all_matches(
        self,
        results: FloodRoadMatchResults,
        *,
        max_records: int | None = None,
        zoom: int = 12,
        connect_reported: bool = True,
    ):
        """Render a Folium map with every matched flood road segment."""
        try:
            import folium
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("folium is required for plotting") from exc

        matched_gdf = results.matched
        if matched_gdf.empty:
            raise ValueError("matched GeoDataFrame is empty. Run the matcher first.")

        subset = matched_gdf if max_records is None else matched_gdf.head(max_records)
        subset = subset.dropna(subset=["start_on_line_geom"])
        if subset.empty:
            raise ValueError("No matched records with snapped start points available.")

        first_point = subset.iloc[0]["start_on_line_geom"]
        centre_lat, centre_lng = first_point.y, first_point.x

        fmap = folium.Map(location=[centre_lat, centre_lng], zoom_start=zoom, tiles="cartodbpositron")

        base_roads = getattr(self, "_base_roads_wgs84", None)
        if base_roads is None:
            base_roads = self.network.roads_wgs84
            self._base_roads_wgs84 = base_roads

        base_roads_layer = folium.FeatureGroup(name="Road network", show=True)
        folium.GeoJson(
            data=base_roads.__geo_interface__,
            name="Road network",
            style_function=lambda _: {"color": "#9e9e9e", "weight": 1.5, "opacity": 0.6},
        ).add_to(base_roads_layer)
        base_roads_layer.add_to(fmap)

        road_group = folium.FeatureGroup(name="Matched road geometries", show=False)
        segment_group = folium.FeatureGroup(name="Flooded segments", show=True)
        start_reported_group = folium.FeatureGroup(name="Reported start", show=True)
        end_reported_group = folium.FeatureGroup(name="Reported end", show=True)
        start_snapped_group = folium.FeatureGroup(name="Snapped start", show=True)
        end_snapped_group = folium.FeatureGroup(name="Snapped end", show=True)
        connectors_group = folium.FeatureGroup(name="Reported→Snapped connectors", show=connect_reported)

        for row in subset.itertuples():
            segment = row.segment_geom
            road_geom = getattr(row, "road_geom", None)
            if road_geom is not None and not road_geom.is_empty:
                folium.GeoJson(
                    data=road_geom.__geo_interface__,
                    name=f"Road {row.road_name}",
                    tooltip=f"Road {row.road_name}",
                    style_function=lambda _: {"color": "#9e9e9e", "weight": 1.5, "opacity": 0.4},
                ).add_to(road_group)

            if segment is None or segment.is_empty:
                continue

            event_type = getattr(row, "event_type", None) or getattr(row, "event", None)
            event_type_label = str(event_type or "flood")
            base_label = f"{event_type_label}, {row.flood_id}"
            road_name_value = getattr(row, "road_name", None)
            if road_name_value is None or pd.isna(road_name_value):
                road_name_value = None
            segment_label = f"{base_label} - {road_name_value}" if road_name_value else base_label
            style_spec = {
                "flash_flood": {"color": "#042f8d", "weight": 6.0},
                "flash_flood_risk": {"color": "#8da9e0", "weight": 3.0},
                "flash_flood_subsided": {"color": "#16edf0", "weight": 4.5},
            }.get(event_type, {"color": "#1f78b4", "weight": 3.75})
            segment_color = style_spec["color"]
            segment_weight = round(style_spec["weight"], 1)

            folium.GeoJson(
                data=segment.__geo_interface__,
                name=segment_label,
                tooltip=segment_label,
                style_function=lambda _, colour=segment_color, weight=segment_weight: {
                    "color": colour,
                    "weight": weight,
                    "opacity": 0.9,
                },
            ).add_to(segment_group)

            start_coord = None
            if not math.isnan(row.start_lat) and not math.isnan(row.start_lng):
                start_coord = (row.start_lat, row.start_lng)
                folium.CircleMarker(
                    location=start_coord,
                    radius=4,
                    color="#ffdf53",
                    fill=True,
                    fill_color="#ffdf53",
                    fill_opacity=0.85,
                    popup=f"{segment_label} reported start",
                ).add_to(start_reported_group)

            start_snapped = row.start_on_line_geom
            start_snapped_coord = None
            if start_snapped is not None and not start_snapped.is_empty:
                start_snapped_coord = (start_snapped.y, start_snapped.x)
                folium.CircleMarker(
                    location=start_snapped_coord,
                    radius=4,
                    color="#fcd71e",
                    fill=True,
                    fill_color="#fcd71e",
                    fill_opacity=0.9,
                    popup=f"{segment_label} snapped start",
                ).add_to(start_snapped_group)

            end_coord = None
            if not math.isnan(row.end_lat) and not math.isnan(row.end_lng):
                end_coord = (row.end_lat, row.end_lng)
                folium.CircleMarker(
                    location=end_coord,
                    radius=4,
                    color="#6b94fb",
                    fill=True,
                    fill_color="#ffdf53",
                    fill_opacity=0.85,
                    popup=f"{segment_label} reported end",
                ).add_to(end_reported_group)

            end_snapped = getattr(row, "end_on_line_geom", None)
            end_snapped_coord = None
            if end_snapped is not None and not end_snapped.is_empty:
                end_snapped_coord = (end_snapped.y, end_snapped.x)
                folium.CircleMarker(
                    location=end_snapped_coord,
                    radius=4,
                    color="#326bfd",
                    fill=True,
                    fill_color="#326bfd",
                    fill_opacity=0.9,
                    popup=f"{segment_label} snapped end",
                ).add_to(end_snapped_group)

            if connect_reported:
                if start_coord is not None and start_snapped_coord:
                    folium.PolyLine(
                        [start_coord, start_snapped_coord],
                        color="#ffdd32",
                        weight=2,
                        opacity=0.6,
                    ).add_to(connectors_group)
                if end_coord is not None and end_snapped_coord:
                    folium.PolyLine(
                        [end_coord, end_snapped_coord],
                        color="#2eaaf3",
                        weight=2,
                        opacity=0.6,
                    ).add_to(connectors_group)

        road_group.add_to(fmap)
        segment_group.add_to(fmap)
        start_snapped_group.add_to(fmap)
        end_snapped_group.add_to(fmap)
        start_reported_group.add_to(fmap)
        if len(end_reported_group._children) > 0:
            end_reported_group.add_to(fmap)
        if len(connectors_group._children) > 0:
            connectors_group.add_to(fmap)

        folium.LayerControl(collapsed=False).add_to(fmap)
        return fmap
