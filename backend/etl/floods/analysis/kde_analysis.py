"""Flood kernel density analysis utilities with configurable sections for ETL pipelines."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import math
import warnings

import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from pointpats import PointPattern
from scipy.spatial import cKDTree
from shapely.geometry import Point, Polygon
from shapely.prepared import prep

from .spatiotemporal_floods import (
    DEFAULT_PROJECTED_CRS,
    DEFAULT_LATLON_CRS,
    FloodDatasetPaths,
    SingaporeFloodData,
)

warnings.filterwarnings("ignore")


# -----------------------
# CONFIG
# -----------------------

MODULE_DIR = Path(__file__).resolve().parent
DATA_ROOT = MODULE_DIR.parent / "data"
SUPPORTED_KERNELS = {"gaussian", "tophat", "epanechnikov", "cosine"}
DEFAULT_GRID_SIZE = 300


# -----------------------
# DATA CACHES
# -----------------------

_SUBZONE_CACHE: Dict[Tuple[str, str], gpd.GeoDataFrame] = {}
_ROAD_NETWORK_CACHE: Dict[Tuple[str, str], gpd.GeoDataFrame] = {}


def _load_subzones(path: Path, target_crs: str) -> gpd.GeoDataFrame:
    key = (path.resolve().as_posix(), target_crs)
    if key not in _SUBZONE_CACHE:
        _SUBZONE_CACHE[key] = gpd.read_file(path).to_crs(target_crs)
    return _SUBZONE_CACHE[key].copy()


def _load_roads(path: Path, target_crs: str) -> gpd.GeoDataFrame:
    key = (path.resolve().as_posix(), target_crs)
    if key not in _ROAD_NETWORK_CACHE:
        _ROAD_NETWORK_CACHE[key] = gpd.read_file(path).to_crs(target_crs)
    return _ROAD_NETWORK_CACHE[key].copy()


# -----------------------
# HELPERS
# -----------------------


@dataclass(frozen=True)
class DistanceScaler:
    """Utility for converting between coordinate units when running KDE."""

    factor: float
    label: str

    @staticmethod
    def from_unit(unit: str) -> "DistanceScaler":
        unit = unit.lower()
        if unit in {"m", "meter", "meters"}:
            return DistanceScaler(1.0, "m")
        if unit in {"km", "kilometer", "kilometers"}:
            return DistanceScaler(1000.0, "km")
        raise ValueError("distance unit must be 'm' or 'km'")

    def scale(self, coords: np.ndarray) -> np.ndarray:
        return coords / self.factor


@dataclass(frozen=True)
class KDEParameters:
    """Configuration for a single KDE run."""

    bandwidth_m: float
    kernel: str = "gaussian"
    grid_size: int = DEFAULT_GRID_SIZE
    distance_unit: str = "km"

    def validate(self) -> None:
        if self.kernel not in SUPPORTED_KERNELS:
            raise ValueError(f"kernel must be one of {sorted(SUPPORTED_KERNELS)}")
        if self.grid_size < 10:
            raise ValueError("grid_size must be at least 10")
        if self.bandwidth_m <= 0:
            raise ValueError("bandwidth_m must be positive")
        DistanceScaler.from_unit(self.distance_unit)  # validation only


@dataclass
class DensitySurface:
    """Holds KDE outputs on a regular grid."""

    probability: np.ndarray
    intensity: np.ndarray
    mask: np.ndarray
    grid_x: np.ndarray
    grid_y: np.ndarray
    scale_factor: float
    unit_label: str
    bandwidth: float
    kernel: str

    def cell_dimensions(self) -> Tuple[float, float]:
        dx = float(np.mean(np.diff(self.grid_x[0, :])))
        dy = float(np.mean(np.diff(self.grid_y[:, 0])))
        return dx, dy

    def cell_area_scaled(self) -> float:
        dx, dy = self.cell_dimensions()
        return (dx / self.scale_factor) * (dy / self.scale_factor)

    def to_geodataframe(self) -> gpd.GeoDataFrame:
        dx, dy = self.cell_dimensions()
        half_dx = dx / 2.0
        half_dy = dy / 2.0
        min_x = self.grid_x.min()
        max_x = self.grid_x.max()
        min_y = self.grid_y.min()
        max_y = self.grid_y.max()

        polygons: List[Polygon] = []
        rows: List[Dict[str, float]] = []
        n_rows, n_cols = self.intensity.shape

        for i in range(n_rows):
            for j in range(n_cols):
                intensity_value = self.intensity[i, j]
                if not math.isfinite(float(intensity_value)):
                    continue
                x = self.grid_x[i, j]
                y = self.grid_y[i, j]
                x0 = max(min_x, x - half_dx)
                x1 = min(max_x, x + half_dx)
                y0 = max(min_y, y - half_dy)
                y1 = min(max_y, y + half_dy)
                polygons.append(Polygon([(x0, y0), (x1, y0), (x1, y1), (x0, y1)]))
                rows.append({
                    "intensity": float(intensity_value),
                    "probability": float(self.probability[i, j]),
                })

        gdf = gpd.GeoDataFrame(rows, geometry=polygons, crs=DEFAULT_PROJECTED_CRS)
        cell_area = self.cell_area_scaled()
        gdf["cell_area_sq_%s" % self.unit_label] = cell_area
        gdf["expected_events"] = gdf["intensity"] * cell_area
        gdf["bandwidth_%s" % self.unit_label] = self.bandwidth / self.scale_factor
        gdf["kernel"] = self.kernel
        return gdf


# -----------------------
# DATA ACCESS LAYER
# -----------------------


class FloodDataRepository:
    """Lazily loads flood events and spatial boundaries."""

    def __init__(self, dataset_paths: FloodDatasetPaths | None = None, target_crs: str = DEFAULT_PROJECTED_CRS) -> None:
        self.paths = dataset_paths or FloodDatasetPaths(base_dir=DATA_ROOT)
        self.target_crs = target_crs
        self._data = SingaporeFloodData(self.paths, target_crs)

    def flood_events(self) -> gpd.GeoDataFrame:
        return self._data.floods()

    def planning_area(self) -> gpd.GeoDataFrame:
        return self._data.planning_area()

    def planning_union(self) -> gpd.GeoDataFrame:
        return self._data.planning_area_union()

    def subzones(self) -> gpd.GeoDataFrame:
        path = self.paths.base_dir / "subzone_area.geojson"
        return _load_subzones(path, self.target_crs)

    def road_network(self) -> gpd.GeoDataFrame:
        path = self.paths.base_dir / "road_network.geojson"
        return _load_roads(path, self.target_crs)


# -----------------------
# KDE BUILDING BLOCKS
# -----------------------


class KDEGridBuilder:
    """Creates a regular mesh covering the extent of an area."""

    def __init__(self, grid_size: int = DEFAULT_GRID_SIZE) -> None:
        self.grid_size = grid_size

    def build(self, geometry: gpd.GeoSeries) -> Tuple[np.ndarray, np.ndarray, np.ndarray, gpd.GeoSeries]:
        xmin, ymin, xmax, ymax = geometry.total_bounds
        x_vals = np.linspace(xmin, xmax, self.grid_size)
        y_vals = np.linspace(ymin, ymax, self.grid_size)
        xx, yy = np.meshgrid(x_vals, y_vals)
        grid_coords = np.vstack([xx.ravel(), yy.ravel()]).T
        return xx, yy, grid_coords, geometry


class KDEEstimator:
    """Manual radial KDE estimator normalised for 2D surfaces."""

    @staticmethod
    def radial_kernel(distances: np.ndarray, bandwidth: float, kernel: str) -> np.ndarray:
        if kernel == "gaussian":
            return np.exp(-0.5 * (distances / bandwidth) ** 2)
        if kernel == "tophat":
            return np.where(distances <= bandwidth, 1.0, 0.0)
        if kernel == "epanechnikov":
            mask = distances <= bandwidth
            out = np.zeros_like(distances)
            out[mask] = 1 - (distances[mask] / bandwidth) ** 2
            return out
        if kernel == "cosine":
            mask = distances <= bandwidth
            out = np.zeros_like(distances)
            out[mask] = np.cos((np.pi / 2) * distances[mask] / bandwidth)
            return out
        raise ValueError(f"Unsupported kernel: {kernel}")

    def evaluate(
        self,
        coords: np.ndarray,
        grid_coords: np.ndarray,
        bandwidth: float,
        kernel: str,
        scale_factor: float,
    ) -> Tuple[np.ndarray, np.ndarray]:
        tree = cKDTree(coords)
        dists, _ = tree.query(grid_coords, k=len(coords), distance_upper_bound=bandwidth * 5)
        dists = np.where(np.isfinite(dists), dists, bandwidth * 5)
        kernel_vals = self.radial_kernel(dists, bandwidth, kernel)
        norm = 1.0 / (2 * np.pi * (bandwidth / scale_factor) ** 2)
        intensity = kernel_vals.sum(axis=1) * norm
        probability = intensity / intensity.sum()
        return probability, intensity


class KDEPlotter:
    """Matplotlib plotting utilities for KDE surfaces."""

    def __init__(self, cmap: str = "viridis") -> None:
        self.cmap = cmap

    def plot_surface(
        self,
        surface: DensitySurface,
        planning_area: gpd.GeoDataFrame,
        flood_points: gpd.GeoDataFrame,
        title: str,
        *,
        show: bool = True,
    ) -> plt.Figure:
        fig, ax = plt.subplots(figsize=(10, 8))
        im = ax.imshow(
            surface.intensity,
            origin="lower",
            extent=[surface.grid_x.min(), surface.grid_x.max(), surface.grid_y.min(), surface.grid_y.max()],
            cmap=self.cmap,
        )
        planning_area.boundary.plot(ax=ax, color="white", linewidth=0.5)
        flood_points.plot(ax=ax, color="black", markersize=5, alpha=0.5)
        ax.set_title(title)
        ax.set_axis_off()
        fig.colorbar(im, ax=ax, label=f"Intensity per sq {surface.unit_label}")
        if show:
            plt.show()
        return fig


# -----------------------
# ANALYZER
# -----------------------


class FloodKDEAnalyzer:
    """High-level interface for computing and summarising flood KDE surfaces."""

    def __init__(
        self,
        repository: Optional[FloodDataRepository] = None,
        *,
        grid_builder: Optional[KDEGridBuilder] = None,
        estimator: Optional[KDEEstimator] = None,
        plotter: Optional[KDEPlotter] = None,
    ) -> None:
        self.repository = repository or FloodDataRepository()
         
        self.grid_builder = grid_builder or KDEGridBuilder()
        self.estimator = estimator or KDEEstimator()
        self.plotter = plotter or KDEPlotter()

    def compute_surface(self, params: KDEParameters) -> DensitySurface:
        params.validate()
        floods = self.repository.flood_events()
        if floods.empty:
            raise ValueError("No flood events available for KDE computation")

        coords = np.vstack([floods.geometry.x.values, floods.geometry.y.values]).T
        scaler = DistanceScaler.from_unit(params.distance_unit)
        scaled_coords = scaler.scale(coords)

        planning = self.repository.planning_area()
        xx, yy, grid_coords, geom = self.grid_builder.build(planning.geometry)
        scaled_grid = scaler.scale(grid_coords)

        prob, intensity = self.estimator.evaluate(
            scaled_coords,
            scaled_grid,
            params.bandwidth_m / scaler.factor,
            params.kernel,
            scaler.factor,
        )

        mask = self._grid_mask(grid_coords, geom)
        mask_grid = mask.reshape(xx.shape)
        prob_grid = np.where(mask_grid, prob.reshape(xx.shape), np.nan)
        intensity_grid = np.where(mask_grid, intensity.reshape(xx.shape), np.nan)

        return DensitySurface(
            probability=prob_grid,
            intensity=intensity_grid,
            mask=mask_grid,
            grid_x=xx,
            grid_y=yy,
            scale_factor=scaler.factor,
            unit_label=scaler.label,
            bandwidth=params.bandwidth_m,
            kernel=params.kernel,
        )

    def _grid_mask(self, grid_coords: np.ndarray, geometry: gpd.GeoSeries) -> np.ndarray:
        study_union = geometry.unary_union
        prepared = prep(study_union)
        return np.array([prepared.contains(Point(xy)) for xy in grid_coords])

    def plot_surface(self, surface: DensitySurface, title: str, show: bool = True) -> plt.Figure:
        planning = self.repository.planning_area()
        points = self.repository.flood_events()
        return self.plotter.plot_surface(surface, planning, points, title, show=show)

    def clark_evans(self) -> Dict[str, float]:
        floods = self.repository.flood_events()
        coords = np.vstack([floods.geometry.x.values, floods.geometry.y.values]).T
        if len(coords) < 2:
            raise ValueError("Clark–Evans requires at least two events")

        if PointPattern is not None:
            pp = PointPattern(coords)
            nn_dists, _ = pp.knn(k=1)
            avg_nn = float(nn_dists.mean())
        else:
            tree = cKDTree(coords)
            dists, _ = tree.query(coords, k=2)
            avg_nn = float(dists[:, 1].mean())

        study_area = self.repository.planning_area().unary_union
        area = float(study_area.area)
        if area <= 0:
            raise ValueError("Study area has zero area")
        lambda_density = len(coords) / area
        expected_nn = 1.0 / (2.0 * math.sqrt(lambda_density))

        return {
            "observed_nn_m": avg_nn,
            "expected_nn_m": expected_nn,
            "clark_evans_r": avg_nn / expected_nn,
        }

    def summary_by_planning_area(self, surface: DensitySurface) -> pd.DataFrame:
        grid_gdf = surface.to_geodataframe()
        planning = self.repository.planning_area()[["PLN_AREA_N", "geometry"]]
        joined = gpd.sjoin(grid_gdf, planning, how="inner", predicate="intersects")
        summary = (
            joined.groupby("PLN_AREA_N")
            .agg(
                mean_intensity=("intensity", "mean"),
                max_intensity=("intensity", "max"),
                total_expected_events=("expected_events", "sum"),
            )
            .reset_index()
            .sort_values("mean_intensity", ascending=False)
        )
        summary.rename(columns={
            "mean_intensity": f"mean_intensity_per_sq_{surface.unit_label}",
            "max_intensity": f"max_intensity_per_sq_{surface.unit_label}",
        }, inplace=True)
        return summary

    def summary_by_subzone(self, surface: DensitySurface, planning_filter: Optional[str] = None) -> pd.DataFrame:
        grid_gdf = surface.to_geodataframe()
        subzones = self.repository.subzones()[["PLN_AREA_N", "SUBZONE_N", "geometry"]]
        if planning_filter:
            subzones = subzones[subzones["PLN_AREA_N"].str.contains(planning_filter, case=False, na=False)]
        joined = gpd.sjoin(grid_gdf, subzones, how="inner", predicate="intersects")
        summary = (
            joined.groupby(["PLN_AREA_N", "SUBZONE_N"])
            .agg(
                mean_intensity=("intensity", "mean"),
                max_intensity=("intensity", "max"),
                total_expected_events=("expected_events", "sum"),
            )
            .reset_index()
            .sort_values("mean_intensity", ascending=False)
        )
        summary.rename(columns={
            "mean_intensity": f"mean_intensity_per_sq_{surface.unit_label}",
            "max_intensity": f"max_intensity_per_sq_{surface.unit_label}",
        }, inplace=True)
        return summary

    def summary_by_road(self, surface: DensitySurface) -> pd.DataFrame:
        grid_gdf = surface.to_geodataframe()
        roads = self.repository.road_network()[["UNIQUE_ID", "RD_NAME", "geometry"]]
        joined = gpd.sjoin(grid_gdf, roads, how="inner", predicate="intersects")
        summary = (
            joined.groupby(["UNIQUE_ID", "RD_NAME"])
            .agg(
                mean_intensity=("intensity", "mean"),
                max_intensity=("intensity", "max"),
                total_expected_events=("expected_events", "sum"),
            )
            .reset_index()
            .sort_values("mean_intensity", ascending=False)
        )
        summary.rename(columns={
            "mean_intensity": f"mean_intensity_per_sq_{surface.unit_label}",
            "max_intensity": f"max_intensity_per_sq_{surface.unit_label}",
        }, inplace=True)
        return summary


__all__ = [
    "DistanceScaler",
    "KDEParameters",
    "DensitySurface",
    "FloodDataRepository",
    "KDEGridBuilder",
    "KDEEstimator",
    "KDEPlotter",
    "FloodKDEAnalyzer",
]
