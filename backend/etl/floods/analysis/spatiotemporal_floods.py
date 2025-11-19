"""Object-oriented utilities for Singapore flood spatiotemporal analysis."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from shapely.geometry import Point
from shapely.prepared import prep
from sklearn.neighbors import KernelDensity

# -----------------------
# CONFIG
# -----------------------

DEFAULT_PROJECTED_CRS = "EPSG:3414"  # Singapore SVY21
DEFAULT_LATLON_CRS = "EPSG:4326"
DEFAULT_SPACE_BANDWIDTH = 800.0
DEFAULT_TIME_BANDWIDTH = 1.0
DEFAULT_GRID_SIZE = (120, 120)


# -----------------------
# DATASET PATH CACHES
# -----------------------

_PLANNING_AREA_CACHE: Dict[Tuple[str, str], gpd.GeoDataFrame] = {}
_PLANNING_UNION_CACHE: Dict[Tuple[str, str], gpd.GeoDataFrame] = {}
_FLOOD_EVENT_CACHE: Dict[Tuple[str, str], gpd.GeoDataFrame] = {}


def _load_planning_area(path: Path, target_crs: str) -> gpd.GeoDataFrame:
    key = (path.resolve().as_posix(), target_crs)
    if key not in _PLANNING_AREA_CACHE:
        _PLANNING_AREA_CACHE[key] = gpd.read_file(path).to_crs(target_crs)
    return _PLANNING_AREA_CACHE[key].copy()


def _load_planning_union(path: Path, target_crs: str) -> gpd.GeoDataFrame:
    key = (path.resolve().as_posix(), target_crs)
    if key not in _PLANNING_UNION_CACHE:
        area = _load_planning_area(path, target_crs)
        _PLANNING_UNION_CACHE[key] = area.dissolve().reset_index(drop=True)
    return _PLANNING_UNION_CACHE[key].copy()


def _load_flood_events(path: Path, target_crs: str, union_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    key = (path.resolve().as_posix(), target_crs)
    if key not in _FLOOD_EVENT_CACHE:
        df = pd.read_csv(path, parse_dates=["event_date"], infer_datetime_format=True)
        df = df.dropna(subset=["start_lng", "start_lat"])
        gdf = gpd.GeoDataFrame(
            df,
            geometry=gpd.points_from_xy(df["start_lng"], df["start_lat"], crs=DEFAULT_LATLON_CRS),
        ).to_crs(target_crs)
        study_geom = union_gdf.geometry.iloc[0]
        gdf = gdf[gdf.geometry.within(study_geom)].reset_index(drop=True)
        _FLOOD_EVENT_CACHE[key] = gdf
    return _FLOOD_EVENT_CACHE[key].copy()


@dataclass
class FloodDatasetPaths:
    """Container describing the flood and boundary dataset locations."""

    base_dir: Path = Path(__file__).resolve().parents[1] / "data"
    planning_area_filename: str = "planning_area.geojson"
    floods_filename: str = "floods.csv"

    @property
    def planning_area(self) -> Path:
        return self.base_dir / self.planning_area_filename

    @property
    def floods(self) -> Path:
        return self.base_dir / self.floods_filename


class SingaporeFloodData:
    """Loads and prepares Singapore planning area and flood GeoDataFrames."""

    def __init__(self, paths: FloodDatasetPaths = FloodDatasetPaths(), target_crs: str = DEFAULT_PROJECTED_CRS) -> None:
        self.paths = paths
        self.target_crs = target_crs

    def planning_area(self) -> gpd.GeoDataFrame:
        return _load_planning_area(self.paths.planning_area, self.target_crs)

    def planning_area_union(self) -> gpd.GeoDataFrame:
        return _load_planning_union(self.paths.planning_area, self.target_crs)

    def floods(self) -> gpd.GeoDataFrame:
        union = self.planning_area_union()
        floods = _load_flood_events(self.paths.floods, self.target_crs, union)
        if "event_date" in floods.columns:
            floods["year"] = pd.to_datetime(floods["event_date"], errors="coerce").dt.year
        elif "year" not in floods.columns:
            floods["year"] = pd.NaT
        floods = floods.dropna(subset=["year"]).reset_index(drop=True)
        floods["year"] = floods["year"].astype(int)
        return floods


class SpatiotemporalFloodAnalyzer:
    """Runs point plotting and spatiotemporal KDE for flood events."""

    def __init__(
        self,
        data: Optional[SingaporeFloodData] = None,
        *,
        space_bandwidth: float = DEFAULT_SPACE_BANDWIDTH,
        time_bandwidth: float = DEFAULT_TIME_BANDWIDTH,
        grid_size: Tuple[int, int] = DEFAULT_GRID_SIZE,
    ) -> None:
        self.data = data or SingaporeFloodData()
        self.space_bandwidth = space_bandwidth
        self.time_bandwidth = time_bandwidth
        self.grid_size = grid_size

        self._kde: Optional[KernelDensity] = None
        self._grid_xy: Optional[np.ndarray] = None
        self._grid_shape: Optional[Tuple[int, int]] = None
        self._grid_extents: Optional[Tuple[float, float, float, float]] = None
        self._union_geom = None

    # ------------------------------------------------------------------
    # Data helpers
    # ------------------------------------------------------------------
    @property
    def floods(self) -> gpd.GeoDataFrame:
        return self.data.floods()

    @property
    def planning_union(self) -> gpd.GeoDataFrame:
        return self.data.planning_area_union()

    # ------------------------------------------------------------------
    # Visualisation helpers
    # ------------------------------------------------------------------
    def plot_points(self, *, ax: Optional[plt.Axes] = None, title: str = "Flood Reports across Singapore") -> plt.Axes:
        if ax is None:
            fig, ax = plt.subplots(figsize=(8, 8))
        boundary = self.planning_union
        boundary.boundary.plot(ax=ax, color="grey", linewidth=0.8)
        self.floods.plot(ax=ax, markersize=8, color="#1f78b4", alpha=0.7)
        ax.set_title(title)
        ax.set_axis_off()
        return ax

    def plot_points_by_year(self, *, ncols: int = 3, figsize: Tuple[int, int] = (12, 12)) -> plt.Figure:
        years = sorted(self.floods["year"].unique())
        rows = int(np.ceil(len(years) / ncols))
        fig, axes = plt.subplots(rows, ncols, figsize=figsize)
        axes = np.array(axes).reshape(-1)
        boundary = self.planning_union

        for ax, year in zip(axes, years):
            boundary.boundary.plot(ax=ax, color="lightgrey", linewidth=0.7)
            self.floods.query("year == @year").plot(ax=ax, markersize=8, alpha=0.7)
            ax.set_title(f"Year {year}")
            ax.set_axis_off()

        for ax in axes[len(years):]:
            ax.set_visible(False)

        fig.suptitle("Flood Reports by Year", fontsize=16)
        fig.tight_layout()
        return fig

    # ------------------------------------------------------------------
    # KDE preparation and evaluation
    # ------------------------------------------------------------------
    def fit_kde(self) -> None:
        floods = self.floods
        coords = np.column_stack([floods.geometry.x, floods.geometry.y])
        years_numeric = floods["year"].to_numpy(dtype=float)

        samples = np.column_stack([
            coords[:, 0] / self.space_bandwidth,
            coords[:, 1] / self.space_bandwidth,
            years_numeric / self.time_bandwidth,
        ])

        kde = KernelDensity(kernel="gaussian", bandwidth=1.0)
        kde.fit(samples)

        union_geom = self.planning_union.geometry.iloc[0]
        minx, miny, maxx, maxy = union_geom.bounds
        nx, ny = self.grid_size
        xgrid = np.linspace(minx, maxx, nx)
        ygrid = np.linspace(miny, maxy, ny)
        xx, yy = np.meshgrid(xgrid, ygrid)
        xy = np.column_stack([xx.ravel(), yy.ravel()])

        self._kde = kde
        self._grid_xy = xy
        self._grid_shape = (ny, nx)
        self._grid_extents = (minx, maxx, miny, maxy)
        self._union_geom = union_geom
        self._prepared_union = prep(union_geom)

    def evaluate_year_slice(self, year: int) -> np.ndarray:
        if self._kde is None:
            self.fit_kde()

        assert self._kde is not None and self._grid_xy is not None
        assert self._grid_shape is not None and self._prepared_union is not None

        t = np.full(self._grid_xy.shape[0], year, dtype=float)
        features = np.column_stack([
            self._grid_xy[:, 0] / self.space_bandwidth,
            self._grid_xy[:, 1] / self.space_bandwidth,
            t / self.time_bandwidth,
        ])

        log_density = self._kde.score_samples(features)
        density = np.exp(log_density)

        mask = np.array([self._prepared_union.contains(Point(x, y)) for x, y in self._grid_xy])
        density[~mask] = np.nan
        return density.reshape(self._grid_shape)

    def plot_kde(
        self,
        years: Sequence[int],
        *,
        figsize: Tuple[int, int] = (15, 10),
        ncols: int = 3,
        cmap: str = "viridis",
    ) -> plt.Figure:
        if self._grid_extents is None:
            self.fit_kde()

        minx, maxx, miny, maxy = self._grid_extents
        rows = int(np.ceil(len(years) / ncols))
        fig, axes = plt.subplots(rows, ncols, figsize=figsize, sharex=True, sharey=True)
        axes = np.array(axes).reshape(-1)

        boundary = self.planning_union

        for ax, year in zip(axes, years):
            density = self.evaluate_year_slice(year)
            im = ax.imshow(
                density,
                origin="lower",
                extent=[minx, maxx, miny, maxy],
                cmap=cmap,
            )
            boundary.boundary.plot(ax=ax, color="white", linewidth=0.5)
            ax.set_title(f"KDE for {year}")
            ax.set_axis_off()

        for ax in axes[len(years):]:
            ax.set_visible(False)

        if len(years) > 0:
            cax = fig.add_axes([0.02, 0.2, 0.02, 0.6])
            fig.colorbar(im, cax=cax, label="Relative density")

        fig.tight_layout(rect=[0.08, 0.05, 1.0, 0.95])
        return fig

    # ------------------------------------------------------------------
    # Data export helpers
    # ------------------------------------------------------------------
    def kde_geodataframe(self, year: int) -> gpd.GeoDataFrame:
        """Return a GeoDataFrame of KDE intensity values for a given year."""

        if self._grid_extents is None or self._grid_shape is None:
            self.fit_kde()

        density = self.evaluate_year_slice(year)
        ny, nx = self._grid_shape
        minx, maxx, miny, maxy = self._grid_extents
        xgrid = np.linspace(minx, maxx, nx)
        ygrid = np.linspace(miny, maxy, ny)
        xx, yy = np.meshgrid(xgrid, ygrid)

        flat_density = density.ravel()
        mask = np.isfinite(flat_density)
        points = gpd.points_from_xy(xx.ravel()[mask], yy.ravel()[mask], crs=self.data.target_crs)

        return gpd.GeoDataFrame(
            {"year": year, "density": flat_density[mask]},
            geometry=points,
            crs=self.data.target_crs,
        )

    def summary_by_year(self) -> pd.DataFrame:
        floods = self.floods
        summary = (
            floods.groupby("year")
            .agg(event_count=("year", "size"))
            .reset_index()
            .sort_values("year")
        )
        return summary

    def summary_by_planning_area(self) -> pd.DataFrame:
        floods = self.floods
        planning = self.data.planning_area()
        joined = gpd.sjoin(floods, planning[["id", "PLN_AREA_N", "geometry"]], how="left", predicate="within")
        summary = (
            joined.groupby(["year", "PLN_AREA_N"])  # type: ignore[arg-type]
            .size()
            .reset_index(name="event_count")
            .rename(columns={"PLN_AREA_N": "planning_area"})
            .sort_values(["year", "planning_area"])
        )
        return summary


def default_analyzer() -> SpatiotemporalFloodAnalyzer:
    """Convenience factory mirroring the original notebook defaults."""

    return SpatiotemporalFloodAnalyzer()


def run_default_workflow(years: Optional[Sequence[int]] = None) -> Tuple[gpd.GeoDataFrame, plt.Figure, plt.Figure, plt.Figure]:
    """Execute the full workflow and return key artefacts for scripting use."""

    analyzer = default_analyzer()
    floods = analyzer.floods
    points_fig = analyzer.plot_points().figure
    facets_fig = analyzer.plot_points_by_year()

    if years is None:
        years = sorted(floods["year"].unique())

    kde_fig = analyzer.plot_kde(years)
    return floods, points_fig, facets_fig, kde_fig


__all__ = [
    "FloodDatasetPaths",
    "SingaporeFloodData",
    "SpatiotemporalFloodAnalyzer",
    "default_analyzer",
    "run_default_workflow",
]
