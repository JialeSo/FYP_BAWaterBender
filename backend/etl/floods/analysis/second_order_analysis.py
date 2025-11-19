"""Second-order spatial point pattern analysis utilities for flood events."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Tuple

import numpy as np
import pandas as pd
from scipy.spatial import KDTree, distance
from shapely.geometry import Point

from .kde_analysis import FloodDataRepository


# -----------------------
# CONFIG
# -----------------------

DEFAULT_MAX_RADIUS_M = 2000.0
DEFAULT_RADIUS_STEPS = 50
DEFAULT_CSR_SIMULATIONS = 99
DEFAULT_CSR_SEED = 42


@dataclass(frozen=True)
class SecondOrderParameters:
    """Configuration for second-order statistics."""

    max_radius_m: float = DEFAULT_MAX_RADIUS_M
    radius_steps: int = DEFAULT_RADIUS_STEPS
    csr_simulations: int = DEFAULT_CSR_SIMULATIONS
    csr_seed: Optional[int] = DEFAULT_CSR_SEED

    def radii(self) -> np.ndarray:
        if self.radius_steps < 2:
            raise ValueError("radius_steps must be at least 2")
        if self.max_radius_m <= 0:
            raise ValueError("max_radius_m must be positive")
        return np.linspace(0, self.max_radius_m, self.radius_steps)


class SecondOrderAnalyzer:
    """Computes G, F, K, and L functions with CSR envelopes."""

    def __init__(self, repository: Optional[FloodDataRepository] = None) -> None:
        self.repository = repository or FloodDataRepository()
        self._study_polygon = self.repository.planning_area().unary_union
        if self._study_polygon.is_empty:
            raise ValueError("Study area polygon is empty")

    def _event_coordinates(self) -> np.ndarray:
        floods = self.repository.flood_events()
        return np.vstack([floods.geometry.x.values, floods.geometry.y.values]).T

    def _area(self) -> float:
        return float(self._study_polygon.area)

    def _generate_csr_points(self, n: int, rng: np.random.Generator) -> np.ndarray:
        minx, miny, maxx, maxy = self._study_polygon.bounds
        points: list[Tuple[float, float]] = []
        attempts = 0
        while len(points) < n and attempts < n * 1000:
            x = rng.uniform(minx, maxx)
            y = rng.uniform(miny, maxy)
            if self._study_polygon.contains(Point(x, y)):
                points.append((x, y))
            attempts += 1
        if len(points) < n:
            raise RuntimeError("Failed to sample enough CSR points")
        return np.array(points)

    # ------------------------------------------------------------------
    # G-function (nearest neighbour of events)
    # ------------------------------------------------------------------

    def g_function(self, params: SecondOrderParameters) -> pd.DataFrame:
        coords = self._event_coordinates()
        if len(coords) < 2:
            raise ValueError("G-function requires at least two events")

        radii = params.radii()
        tree = KDTree(coords)
        dists, _ = tree.query(coords, k=2)
        nn_dists = dists[:, 1]
        observed = self._empirical_cdf(nn_dists, radii)

        lower, upper = self._g_function_envelope(coords, radii, params)
        return self._assemble_frame(radii, observed, lower, upper, "G")

    def _g_function_envelope(
        self, coords: np.ndarray, radii: np.ndarray, params: SecondOrderParameters
    ) -> Tuple[np.ndarray, np.ndarray]:
        rng = np.random.default_rng(params.csr_seed)
        sims = []
        for _ in range(params.csr_simulations):
            csr_coords = self._generate_csr_points(len(coords), rng)
            tree = KDTree(csr_coords)
            dists, _ = tree.query(csr_coords, k=2)
            nn = dists[:, 1]
            sims.append(self._empirical_cdf(nn, radii))
        sims_arr = np.vstack(sims)
        return np.quantile(sims_arr, 0.025, axis=0), np.quantile(sims_arr, 0.975, axis=0)

    # ------------------------------------------------------------------
    # F-function (empty space)
    # ------------------------------------------------------------------

    def f_function(self, params: SecondOrderParameters, sample_points: int = 5000) -> pd.DataFrame:
        coords = self._event_coordinates()
        radii = params.radii()
        rng = np.random.default_rng(params.csr_seed)
        query_pts = self._generate_csr_points(sample_points, rng)
        tree = KDTree(coords)
        dists, _ = tree.query(query_pts, k=1)
        observed = self._empirical_cdf(dists, radii)

        lower, upper = self._f_function_envelope(len(query_pts), sample_points, radii, params)
        return self._assemble_frame(radii, observed, lower, upper, "F")

    def _f_function_envelope(
        self, sample_points: int, query_points: int, radii: np.ndarray, params: SecondOrderParameters
    ) -> Tuple[np.ndarray, np.ndarray]:
        rng = np.random.default_rng(params.csr_seed)
        sims = []
        for _ in range(params.csr_simulations):
            csr_events = self._generate_csr_points(sample_points, rng)
            query_pts = self._generate_csr_points(query_points, rng)
            tree = KDTree(csr_events)
            dists, _ = tree.query(query_pts, k=1)
            sims.append(self._empirical_cdf(dists, radii))
        sims_arr = np.vstack(sims)
        return np.quantile(sims_arr, 0.025, axis=0), np.quantile(sims_arr, 0.975, axis=0)

    # ------------------------------------------------------------------
    # K and L functions (Ripley/Besag)
    # ------------------------------------------------------------------

    def k_function(self, params: SecondOrderParameters) -> pd.DataFrame:
        coords = self._event_coordinates()
        radii = params.radii()
        observed = self._ripley_k(coords, radii)
        lower, upper = self._k_function_envelope(coords, radii, params)
        return self._assemble_frame(radii, observed, lower, upper, "K")

    def l_function(self, params: SecondOrderParameters) -> pd.DataFrame:
        k_results = self.k_function(params)
        radii = k_results["radius_m"].to_numpy()
        l_values = np.sqrt(k_results["observed"].to_numpy() / np.pi) - radii
        lower = np.sqrt(k_results["lower"].to_numpy() / np.pi) - radii
        upper = np.sqrt(k_results["upper"].to_numpy() / np.pi) - radii
        df = k_results.copy()
        df["observed"] = l_values
        df["lower"] = lower
        df["upper"] = upper
        df["function"] = "L"
        return df

    def _ripley_k(self, coords: np.ndarray, radii: np.ndarray) -> np.ndarray:
        n = len(coords)
        if n < 2:
            raise ValueError("K-function requires at least two events")
        pairwise = distance.pdist(coords)
        hist_counts = np.array([np.sum(pairwise <= r) for r in radii])
        area = self._area()
        factor = area / (n * (n - 1)) * 2  # multiply by 2 to account for both i<j and j<i
        return factor * hist_counts

    def _k_function_envelope(
        self, coords: np.ndarray, radii: np.ndarray, params: SecondOrderParameters
    ) -> Tuple[np.ndarray, np.ndarray]:
        rng = np.random.default_rng(params.csr_seed)
        sims = []
        for _ in range(params.csr_simulations):
            csr_coords = self._generate_csr_points(len(coords), rng)
            sims.append(self._ripley_k(csr_coords, radii))
        sims_arr = np.vstack(sims)
        return np.quantile(sims_arr, 0.025, axis=0), np.quantile(sims_arr, 0.975, axis=0)

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _empirical_cdf(sample: np.ndarray, radii: np.ndarray) -> np.ndarray:
        return np.array([np.mean(sample <= r) for r in radii])

    @staticmethod
    def _assemble_frame(
        radii: np.ndarray, observed: np.ndarray, lower: np.ndarray, upper: np.ndarray, fn_name: str
    ) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "radius_m": radii,
                "observed": observed,
                "lower": lower,
                "upper": upper,
                "function": fn_name,
            }
        )


__all__ = ["SecondOrderParameters", "SecondOrderAnalyzer"]
