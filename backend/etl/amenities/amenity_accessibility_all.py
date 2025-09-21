"""Amenity accessibility analysis utilities with an object-oriented API."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple

import math
import warnings

import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
from shapely.geometry import Point, Polygon

warnings.filterwarnings("ignore")

try:  # pragma: no cover - optional dependency
    import h3

    H3_AVAILABLE = True
except ImportError:  # pragma: no cover - optional dependency
    h3 = None
    H3_AVAILABLE = False

MODULE_DIR = Path(__file__).resolve().parent
DATA_DIR = MODULE_DIR.parent / "data"


def _resolve_dataset(filename: str) -> Path:
    """Return the first existing dataset path in known search locations."""

    candidates = [
        MODULE_DIR / "geojson" / filename,
        DATA_DIR / filename,
    ]

    for path in candidates:
        if path.exists():
            return path

    raise FileNotFoundError(
        f"Could not locate '{filename}'. Checked: {', '.join(str(p) for p in candidates)}"
    )
DEFAULT_CRS = "EPSG:3414"
DEFAULT_LATLON_CRS = "EPSG:4326"
DEFAULT_SINGAPORE_CATEGORIES: Tuple[str, ...] = (
    "transport_services",
    "essential_services",
    "community_spaces",
    "education_institutions",
    "retail_services",
)
DEFAULT_WOODLANDS_CATEGORIES: Tuple[str, ...] = (
    "transport_services",
    "essential_services",
    "community_spaces",
    "education_institutions",
    "tourism",
)


@dataclass(frozen=True)
class DatasetPaths:
    """Location of the spatial datasets used by the analysis."""

    amenities: Path = field(default_factory=lambda: _resolve_dataset("amenities_with_importance_score.geojson"))
    planning_area: Path = field(default_factory=lambda: _resolve_dataset("planning_area.geojson"))
    subzones: Path = field(default_factory=lambda: _resolve_dataset("subzone_area.geojson"))


class AmenityDataRepository:
    """Lazy loader for amenity, planning area, and subzone GeoDataFrames."""

    def __init__(self, paths: DatasetPaths = DatasetPaths(), target_crs: str = DEFAULT_CRS) -> None:
        self.paths = paths
        self.target_crs = target_crs
        self._amenities: Optional[gpd.GeoDataFrame] = None
        self._planning_area: Optional[gpd.GeoDataFrame] = None
        self._subzones: Optional[gpd.GeoDataFrame] = None

    def amenities(self) -> gpd.GeoDataFrame:
        if self._amenities is None:
            amenities = gpd.read_file(self.paths.amenities)
            self._amenities = amenities.to_crs(self.target_crs)
        return self._amenities.copy()

    def amenities_by_category(self, category: Optional[str]) -> gpd.GeoDataFrame:
        data = self.amenities()
        if category:
            data = data[data["amenity_category"] == category]
        return data

    def planning_area(self) -> gpd.GeoDataFrame:
        if self._planning_area is None:
            planning_area = gpd.read_file(self.paths.planning_area)
            self._planning_area = planning_area.to_crs(self.target_crs)
        return self._planning_area.copy()

    def subzones(self) -> gpd.GeoDataFrame:
        if self._subzones is None:
            subzones = gpd.read_file(self.paths.subzones)
            self._subzones = subzones.to_crs(self.target_crs)
        return self._subzones.copy()


class HexagonGridBuilder:
    """Creates a hexagon grid using H3 if available, otherwise a manual fallback."""

    def __init__(self, resolution: int = 8, manual_target: int = 3000, demand: float = 100.0) -> None:
        self.resolution = resolution
        self.manual_target = manual_target
        self.demand = demand

    def build(self, boundary_gdf: gpd.GeoDataFrame, *, resolution: Optional[int] = None,
              manual_target: Optional[int] = None) -> gpd.GeoDataFrame:
        resolution = resolution or self.resolution
        manual_target = manual_target or self.manual_target

        if H3_AVAILABLE:
            hexagons = self._build_with_h3(boundary_gdf, resolution)
            if not hexagons.empty:
                return hexagons
        return self._build_manually(boundary_gdf, manual_target)

    def _build_with_h3(self, boundary_gdf: gpd.GeoDataFrame, resolution: int) -> gpd.GeoDataFrame:
        boundary_latlon = boundary_gdf.to_crs(DEFAULT_LATLON_CRS)
        hexagons: List[dict] = []
        all_hex_ids: set = set()

        for geom in boundary_latlon.geometry:
            try:
                if hasattr(h3, "polygon_to_cells"):
                    hex_ids = h3.polygon_to_cells(geom.__geo_interface__, resolution)
                else:
                    if geom.geom_type == "Polygon":
                        hex_ids = h3.polyfill(geom.__geo_interface__, resolution)
                    elif geom.geom_type == "MultiPolygon":
                        hex_ids = []
                        for poly in geom.geoms:
                            hex_ids.extend(h3.polyfill(poly.__geo_interface__, resolution))
                    else:
                        hex_ids = []
                all_hex_ids.update(hex_ids)
            except Exception:
                return gpd.GeoDataFrame()

        for fid, h3_id in enumerate(all_hex_ids):
            try:
                if hasattr(h3, "cell_to_boundary"):
                    hex_boundary = h3.cell_to_boundary(h3_id, geo_json=True)
                else:
                    hex_boundary = h3.h3_to_geo_boundary(h3_id, geo_json=True)
                hex_boundary = [(lon, lat) for lat, lon in hex_boundary]
                polygon = Polygon(hex_boundary)
                if boundary_latlon.intersects(polygon).any():
                    hexagons.append({
                        "fid": fid,
                        "h3_id": h3_id,
                        "geometry": polygon,
                        "demand": self.demand,
                    })
            except Exception:
                continue

        if not hexagons:
            return gpd.GeoDataFrame()
        return gpd.GeoDataFrame(hexagons, crs=DEFAULT_LATLON_CRS).to_crs(DEFAULT_CRS)

    def _build_manually(self, boundary_gdf: gpd.GeoDataFrame, target_hexagons: int) -> gpd.GeoDataFrame:
        bounds = boundary_gdf.total_bounds
        total_area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
        hex_area = total_area / (target_hexagons * 1.2)
        hex_radius = math.sqrt(hex_area / (3 * math.sqrt(3) / 2))

        def create_pointy_top_hexagon(cx: float, cy: float, radius: float) -> Polygon:
            vertices = []
            for index in range(6):
                angle = (index * math.pi / 3) + (math.pi / 6)
                x = cx + radius * math.cos(angle)
                y = cy + radius * math.sin(angle)
                vertices.append((x, y))
            return Polygon(vertices)

        hexagons: List[dict] = []
        hex_id = 0
        width = hex_radius * math.sqrt(3)
        height = hex_radius * 1.5
        y = bounds[1]
        row = 0
        while y < bounds[3]:
            x = bounds[0]
            if row % 2 == 1:
                x += width / 2
            while x < bounds[2]:
                hex_geom = create_pointy_top_hexagon(x, y, hex_radius)
                if boundary_gdf.geometry.intersects(hex_geom).any():
                    hexagons.append({
                        "fid": hex_id,
                        "geometry": hex_geom,
                        "demand": self.demand,
                    })
                    hex_id += 1
                x += width
            y += height
            row += 1

        return gpd.GeoDataFrame(hexagons, crs=boundary_gdf.crs or DEFAULT_CRS)


class AccessibilityCalculator:
    """Computes distance matrices and Hansen accessibility metrics."""

    def __init__(self, k: int = 20, power: float = 2.0, epsilon: float = 0.01) -> None:
        self.k = k
        self.power = power
        self.epsilon = epsilon

    def distance_matrix(self, hexagons: gpd.GeoDataFrame, amenities: gpd.GeoDataFrame) -> Tuple[np.ndarray, np.ndarray]:
        if amenities.empty:
            n_hex = len(hexagons)
            dists = np.full((n_hex, 1), np.inf)
            idxs = np.zeros((n_hex, 1), dtype=int)
            return dists, idxs

        centroids = np.array([[point.x, point.y] for point in hexagons.geometry.centroid])
        amenity_points = amenities.geometry.apply(lambda g: g if isinstance(g, Point) else g.representative_point())
        amenity_coords = np.array([[point.x, point.y] for point in amenity_points])

        tree = cKDTree(amenity_coords)
        k = min(self.k, len(amenity_coords))
        dists, idxs = tree.query(centroids, k=k)

        if k == 1:
            dists = dists[:, np.newaxis]
            idxs = idxs[:, np.newaxis]

        return dists / 1000, idxs

    def hansen_accessibility(self, hexagons: gpd.GeoDataFrame, amenities: gpd.GeoDataFrame,
                              dists_km: np.ndarray, idxs: np.ndarray) -> np.ndarray:
        if amenities.empty:
            return np.zeros(len(hexagons))

        capacity = amenities["importance_score"].values
        demand = hexagons["demand"].values if "demand" in hexagons else np.ones(len(hexagons))
        accessibility = np.zeros(len(demand))

        for i in range(len(demand)):
            chosen_capacities = capacity[idxs[i]]
            chosen_distances = dists_km[i]
            mask = np.isfinite(chosen_distances) & (chosen_distances > 0)
            if not np.any(mask):
                accessibility[i] = 0.0
            else:
                accessibility[i] = np.sum(
                    chosen_capacities[mask] / (chosen_distances[mask] ** self.power + self.epsilon)
                )
        return accessibility

    def mean_distance(self, dists_km: np.ndarray) -> np.ndarray:
        with np.errstate(invalid="ignore"):
            return np.nanmean(dists_km, axis=1)


class AccessibilityPlotter:
    """Handles matplotlib visualisations for accessibility results."""

    def __init__(self, cmap: str = "cividis", scheme: str = "quantiles", quantiles: int = 10) -> None:
        self.cmap = cmap
        self.scheme = scheme
        self.quantiles = quantiles

    def category_grid(self, data: Sequence[Tuple[str, gpd.GeoDataFrame, gpd.GeoDataFrame]]) -> None:
        if not data:
            return
        rows = math.ceil(len(data) / 2)
        fig, axes = plt.subplots(rows, 2, figsize=(18, 5 * rows))
        axes = np.array(axes).flatten()

        for axis in axes[len(data):]:
            axis.axis("off")

        for axis, (category, hexagons, amenities) in zip(axes, data):
            hexagons.plot(
                column="accessibility",
                cmap=self.cmap,
                scheme=self.scheme,
                k=self.quantiles,
                legend=False,
                ax=axis,
                edgecolor="white",
                linewidth=0.05,
            )
            amenities.plot(ax=axis, markersize=1, alpha=0.2, marker=".", color="red")
            axis.set_title(f"Accessibility to {category.replace('_', ' ').title()}")
            axis.axis("off")

        plt.tight_layout()
        plt.show()

    def subzone_map(self, hexagons: gpd.GeoDataFrame, amenities: gpd.GeoDataFrame,
                    boundary: gpd.GeoDataFrame, title: str) -> None:
        fig, ax = plt.subplots(figsize=(12, 10))
        hexagons.plot(
            column="accessibility",
            cmap=self.cmap,
            scheme=self.scheme,
            k=self.quantiles,
            legend=True,
            edgecolor="white",
            linewidth=0.05,
            ax=ax,
        )
        amenities.plot(ax=ax, markersize=15, color="red", alpha=0.7, label="Amenities")
        boundary.boundary.plot(ax=ax, color="black", linewidth=0.8)

        xmin, ymin, xmax, ymax = boundary.total_bounds
        ax.set_xlim(xmin, xmax)
        ax.set_ylim(ymin, ymax)
        ax.set_title(title)
        ax.axis("off")
        ax.legend()

        plt.tight_layout()
        plt.show()


class AmenityAccessibilityAnalyzer:
    """Orchestrates end-to-end accessibility analysis for Singapore."""

    def __init__(self, repository: Optional[AmenityDataRepository] = None,
                 grid_builder: Optional[HexagonGridBuilder] = None,
                 calculator: Optional[AccessibilityCalculator] = None,
                 plotter: Optional[AccessibilityPlotter] = None) -> None:
        self.repository = repository or AmenityDataRepository()
        self.grid_builder = grid_builder or HexagonGridBuilder()
        self.calculator = calculator or AccessibilityCalculator()
        self.plotter = plotter or AccessibilityPlotter()

    def run_category(self, category: Optional[str] = None, *, resolution: Optional[int] = None,
                     metric: str = "hansen") -> Tuple[gpd.GeoDataFrame, gpd.GeoDataFrame, np.ndarray, np.ndarray]:
        amenities = self.repository.amenities_by_category(category)
        planning_area = self.repository.planning_area()

        if category and amenities.empty:
            return gpd.GeoDataFrame(), amenities, np.array([]), np.array([])

        hexagons = self.grid_builder.build(planning_area, resolution=resolution)
        if hexagons.empty:
            raise RuntimeError("Failed to generate hexagon grid; check H3 installation or fallback parameters.")

        dists_km, idxs = self.calculator.distance_matrix(hexagons, amenities)

        if metric == "hansen":
            accessibility = self.calculator.hansen_accessibility(hexagons, amenities, dists_km, idxs)
        elif metric == "distance":
            accessibility = self.calculator.mean_distance(dists_km)
        else:
            raise ValueError("metric must be 'hansen' or 'distance'")

        hexagons = hexagons.copy()
        hexagons["accessibility"] = accessibility
        return hexagons, amenities, accessibility, dists_km

    def analyze_categories(self, categories: Iterable[str], *, resolution: Optional[int] = None,
                           metric: str = "hansen", plot: bool = True) -> Tuple[List[Tuple[str, gpd.GeoDataFrame, gpd.GeoDataFrame]], pd.DataFrame]:
        results: List[Tuple[str, gpd.GeoDataFrame, gpd.GeoDataFrame]] = []
        summary_rows = []

        for category in categories:
            hexagons, amenities, accessibility, _ = self.run_category(category, resolution=resolution, metric=metric)
            if hexagons.empty:
                continue
            hexagons_with_regions = gpd.sjoin(
                hexagons,
                self.repository.planning_area(),
                how="left",
                predicate="intersects",
            )
            results.append((category, hexagons_with_regions, amenities))

            clean_acc = pd.Series(accessibility).replace([np.inf, -np.inf], np.nan).fillna(0)
            summary_rows.append({
                "Category": category,
                "Min": clean_acc.min(),
                "Max": clean_acc.max(),
                "Mean": clean_acc.mean(),
            })

        summary_df = pd.DataFrame(summary_rows)
        if plot and results:
            self.plotter.category_grid(results)
        return results, summary_df


class SubzoneAccessibilityAnalyzer:
    """Computes accessibility statistics for a filtered set of planning subzones."""

    def __init__(self, analyzer: Optional[AmenityAccessibilityAnalyzer] = None) -> None:
        self.analyzer = analyzer or AmenityAccessibilityAnalyzer()

    def run(self, *, category: Optional[str] = None, resolution: Optional[int] = None,
            subzone_name_filter: str = "Woodlands", metric: str = "hansen", plot: bool = True) -> Tuple[gpd.GeoDataFrame, pd.DataFrame]:
        repository = self.analyzer.repository
        amenities = repository.amenities_by_category(category)
        subzones = repository.subzones()

        mask = subzones["PLN_AREA_N"].str.contains(subzone_name_filter, case=False, na=False)
        selected_subzones = subzones[mask]
        if selected_subzones.empty:
            raise ValueError(f"No subzones found matching '{subzone_name_filter}'.")

        subzone_union = selected_subzones.unary_union

        if not amenities.empty:
            amenities = amenities[amenities.within(subzone_union)].copy()
            if amenities.empty:
                warnings.warn(
                    "No amenities intersect the selected subzone boundary; accessibility will be zero."
                )
        else:
            warnings.warn("No amenities found for the selected category; accessibility will be zero.")

        hexagons = self.analyzer.grid_builder.build(selected_subzones, resolution=resolution, manual_target=1500)
        if hexagons.empty:
            raise RuntimeError("Failed to generate hexagon grid for subzones.")

        hexagons = hexagons[hexagons.intersects(subzone_union)].copy()
        if hexagons.empty:
            raise RuntimeError("Generated hexagon grid does not intersect the selected subzone boundary.")
        hexagons["geometry"] = hexagons.geometry.intersection(subzone_union)
        hexagons = hexagons[~hexagons.geometry.is_empty]

        dists_km, idxs = self.analyzer.calculator.distance_matrix(hexagons, amenities)
        if metric == "hansen":
            accessibility = self.analyzer.calculator.hansen_accessibility(hexagons, amenities, dists_km, idxs)
        elif metric == "distance":
            accessibility = self.analyzer.calculator.mean_distance(dists_km)
        else:
            raise ValueError("metric must be 'hansen' or 'distance'")

        hexagons = hexagons.copy()
        hexagons["accessibility"] = accessibility

        hexagons_with_subzones = gpd.sjoin(
            hexagons,
            selected_subzones[["SUBZONE_N", "geometry"]],
            how="left",
            predicate="intersects",
        )

        summary = (
            hexagons_with_subzones.groupby("SUBZONE_N")["accessibility"]
            .agg(["min", "max", "mean"])
            .reset_index()
        )

        if plot:
            title = f"Accessibility in {subzone_name_filter} Subzones ({category.replace('_', ' ').title() if category else 'All Amenities'})"
            self.analyzer.plotter.subzone_map(hexagons_with_subzones, amenities, selected_subzones, title)

        return hexagons_with_subzones, summary

    def analyze_categories(self, categories: Iterable[str], *, resolution: Optional[int] = None,
                           subzone_name_filter: str = "Woodlands", metric: str = "hansen",
                           plot: bool = False) -> Tuple[List[gpd.GeoDataFrame], pd.DataFrame]:
        hexagon_results: List[gpd.GeoDataFrame] = []
        summaries: List[pd.DataFrame] = []

        for category in categories:
            hexagons, summary = self.run(
                category=category,
                resolution=resolution,
                subzone_name_filter=subzone_name_filter,
                metric=metric,
                plot=plot,
            )
            hexagons = hexagons.copy()
            hexagons["category"] = category
            summary = summary.copy()
            summary["Category"] = category

            hexagon_results.append(hexagons)
            summaries.append(summary)

        summary_df = pd.concat(summaries, ignore_index=True) if summaries else pd.DataFrame()
        return hexagon_results, summary_df


__all__ = [
    "DatasetPaths",
    "AmenityDataRepository",
    "HexagonGridBuilder",
    "AccessibilityCalculator",
    "AccessibilityPlotter",
    "AmenityAccessibilityAnalyzer",
    "SubzoneAccessibilityAnalyzer",
    "DEFAULT_SINGAPORE_CATEGORIES",
    "DEFAULT_WOODLANDS_CATEGORIES",
]
