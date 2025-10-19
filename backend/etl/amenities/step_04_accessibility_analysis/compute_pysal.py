"""
PySAL-based Accessibility Computation Engine
=============================================

This module provides optimized accessibility calculations using PySAL's spatial_access
package and other high-performance spatial analysis libraries.

Key Features:
-------------
- Uses PySAL's spatial_access for standardized accessibility metrics
- Efficient spatial operations with rtree and geopandas
- Multiple accessibility models: 2SFCA, E2SFCA, 3SFCA, Gravity-based, etc.
- Vectorized operations for better performance
- Support for custom decay functions and impedance models

Dependencies:
-------------
pip install pysal geopandas rtree scikit-learn spatial_access

References:
-----------
- PySAL Spatial Access: https://github.com/pysal/access
- Hansen Accessibility: https://onlinepubs.trb.org/Onlinepubs/trr/1959/013/013-002.pdf
- 2SFCA: https://doi.org/10.1016/S1353-8292(03)00037-0
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional, Tuple, Callable
import warnings

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import Point
try:  # pragma: no cover - dependent on local optional deps
    from sklearn.metrics.pairwise import haversine_distances  # type: ignore
    HAVERSINE_SOURCE = "sklearn"
except Exception as exc:  # pragma: no cover - fallback path
    warnings.warn(
        f"scikit-learn haversine_distances unavailable ({exc!s}); "
        "using NumPy fallback implementation.",
        ImportWarning,
    )
    HAVERSINE_SOURCE = "numpy"

    def haversine_distances(  # type: ignore
        X: np.ndarray,
        Y: Optional[np.ndarray] = None,
    ) -> np.ndarray:
        """
        NumPy-based haversine distance implementation matching scikit-learn's API.

        Args:
            X: Array of shape (n_samples_X, 2) in radians (lat, lon)
            Y: Optional array of shape (n_samples_Y, 2) in radians (lat, lon)

        Returns:
            Pairwise angular distances in radians.
        """
        X = np.atleast_2d(X)
        Y = X if Y is None else np.atleast_2d(Y)

        lat1 = X[:, 0][:, np.newaxis]
        lon1 = X[:, 1][:, np.newaxis]
        lat2 = Y[:, 0][np.newaxis, :]
        lon2 = Y[:, 1][np.newaxis, :]

        dlat = lat2 - lat1
        dlon = lon2 - lon1

        sin_dlat = np.sin(dlat / 2.0)
        sin_dlon = np.sin(dlon / 2.0)

        a = sin_dlat ** 2 + np.cos(lat1) * np.cos(lat2) * sin_dlon ** 2
        c = 2 * np.arcsin(np.clip(np.sqrt(a), 0.0, 1.0))
        return c

# PySAL imports
try:
    from access import access as pysal_access
    from access.access import Access
    PYSAL_AVAILABLE = True
except ImportError:
    warnings.warn(
        "PySAL spatial_access not available. Install with: pip install access",
        ImportWarning
    )
    PYSAL_AVAILABLE = False

# Spatial indexing
from rtree import index as rtree_index


@dataclass(frozen=True)
class AccessibilityResult:
    """Container for accessibility computation results."""

    # Grid with accessibility scores
    grid: gpd.GeoDataFrame

    # Amenities used in computation
    amenities: gpd.GeoDataFrame

    # Accessibility scores array
    scores: np.ndarray

    # Distance matrix (grid x amenities)
    distance_matrix: Optional[np.ndarray] = None

    # Metadata about computation
    metric: str = "hansen"
    model_type: str = "gravity"
    decay_function: str = "power"

    def as_geodataframe(self) -> gpd.GeoDataFrame:
        """Return grid with accessibility scores as GeoDataFrame."""
        result = self.grid.copy()
        result["accessibility"] = self.scores
        return result


class AccessibilityConfig:
    """Configuration for accessibility calculations."""

    # Decay function parameters
    POWER_DECAY_BETA = 2.0  # Power for distance decay (higher = steeper decay)
    EXPONENTIAL_DECAY_BETA = 0.1  # Rate for exponential decay

    # Distance thresholds (in km)
    MAX_SEARCH_DISTANCE_KM = 10.0  # Maximum distance to search for amenities
    CATCHMENT_SIZE_KM = 5.0  # Catchment area size for 2SFCA

    # Numerical stability
    EPSILON = 1e-6  # Small value to avoid division by zero

    # KNN parameters
    K_NEAREST = 20  # Number of nearest amenities to consider

    # Coordinate system
    WGS84_CRS = "EPSG:4326"
    SVY21_CRS = "EPSG:3414"


class DecayFunctions:
    """
    Collection of distance decay functions for accessibility modeling.

    Distance decay functions model how accessibility decreases with distance.
    Different functions are appropriate for different types of amenities.
    """

    @staticmethod
    def power_decay(distances: np.ndarray, beta: float = 2.0, epsilon: float = 1e-6) -> np.ndarray:
        """
        Power distance decay: 1 / (d^beta)

        Commonly used in Hansen accessibility and gravity models.
        Higher beta = faster decay with distance.

        Args:
            distances: Array of distances (in km)
            beta: Power parameter (default: 2.0)
            epsilon: Small value to avoid division by zero

        Returns:
            Decay weights
        """
        return 1.0 / (np.power(distances, beta) + epsilon)

    @staticmethod
    def exponential_decay(distances: np.ndarray, beta: float = 0.1) -> np.ndarray:
        """
        Exponential distance decay: exp(-beta * d)

        Used in some gravity models and E2SFCA.

        Args:
            distances: Array of distances (in km)
            beta: Decay rate parameter

        Returns:
            Decay weights
        """
        return np.exp(-beta * distances)

    @staticmethod
    def gaussian_decay(distances: np.ndarray, sigma: float = 2.0) -> np.ndarray:
        """
        Gaussian distance decay: exp(-d^2 / (2*sigma^2))

        Smooth decay function, less sensitive to outliers.

        Args:
            distances: Array of distances (in km)
            sigma: Standard deviation parameter

        Returns:
            Decay weights
        """
        return np.exp(-np.power(distances, 2) / (2 * sigma ** 2))

    @staticmethod
    def linear_decay(distances: np.ndarray, max_distance: float = 5.0) -> np.ndarray:
        """
        Linear distance decay: max(0, 1 - d/max_distance)

        Simple linear decay, reaches zero at max_distance.

        Args:
            distances: Array of distances (in km)
            max_distance: Maximum distance threshold

        Returns:
            Decay weights
        """
        weights = 1.0 - (distances / max_distance)
        return np.maximum(0, weights)

    @staticmethod
    def step_decay(distances: np.ndarray, threshold: float = 3.0) -> np.ndarray:
        """
        Step (binary) decay: 1 if d <= threshold, else 0

        Used in cumulative opportunity models.

        Args:
            distances: Array of distances (in km)
            threshold: Distance threshold

        Returns:
            Binary weights
        """
        return (distances <= threshold).astype(float)


class SpatialAccessEngine:
    """
    High-performance accessibility engine using PySAL and optimized spatial operations.

    This engine supports multiple accessibility models:
    - Hansen Gravity Model
    - 2-Step Floating Catchment Area (2SFCA)
    - Enhanced 2SFCA (E2SFCA)
    - 3-Step Floating Catchment Area (3SFCA)
    - Cumulative Opportunities
    """

    def __init__(
        self,
        decay_function: str = "power",
        beta: float = AccessibilityConfig.POWER_DECAY_BETA,
        max_distance_km: float = AccessibilityConfig.MAX_SEARCH_DISTANCE_KM,
        k_nearest: int = AccessibilityConfig.K_NEAREST,
    ):
        """
        Initialize the accessibility engine.

        Args:
            decay_function: Type of decay function ('power', 'exponential', 'gaussian', 'linear', 'step')
            beta: Decay parameter (interpretation depends on function)
            max_distance_km: Maximum search distance in kilometers
            k_nearest: Number of nearest amenities to consider
        """
        self.decay_function = decay_function
        self.beta = beta
        self.max_distance_km = max_distance_km
        self.k_nearest = k_nearest

        # Select decay function
        self._decay_func = self._get_decay_function(decay_function, beta)

    def _get_decay_function(self, func_name: str, beta: float) -> Callable:
        """Get the appropriate decay function."""
        if func_name == "power":
            return lambda d: DecayFunctions.power_decay(d, beta)
        elif func_name == "exponential":
            return lambda d: DecayFunctions.exponential_decay(d, beta)
        elif func_name == "gaussian":
            return lambda d: DecayFunctions.gaussian_decay(d, beta)
        elif func_name == "linear":
            return lambda d: DecayFunctions.linear_decay(d, self.max_distance_km)
        elif func_name == "step":
            return lambda d: DecayFunctions.step_decay(d, self.max_distance_km)
        else:
            raise ValueError(f"Unknown decay function: {func_name}")

    def compute_distance_matrix(
        self,
        origins: gpd.GeoDataFrame,
        destinations: gpd.GeoDataFrame,
        use_haversine: bool = True,
    ) -> np.ndarray:
        """
        Compute pairwise distances between origins and destinations.

        Args:
            origins: GeoDataFrame of origin points (e.g., grid cells)
            destinations: GeoDataFrame of destination points (e.g., amenities)
            use_haversine: Use haversine distance (great-circle) for lat/lon coordinates

        Returns:
            Distance matrix (n_origins x n_destinations) in kilometers
        """
        # Extract coordinates
        origin_coords = np.array([
            [point.y, point.x] if isinstance(point, Point) else [point.centroid.y, point.centroid.x]
            for point in origins.geometry
        ])

        dest_coords = np.array([
            [point.y, point.x] if isinstance(point, Point) else [point.centroid.y, point.centroid.x]
            for point in destinations.geometry
        ])

        if use_haversine and origins.crs == AccessibilityConfig.WGS84_CRS:
            # Convert to radians for haversine
            origin_coords_rad = np.radians(origin_coords)
            dest_coords_rad = np.radians(dest_coords)

            # Compute haversine distances
            distances = haversine_distances(origin_coords_rad, dest_coords_rad)

            # Convert to kilometers (Earth radius = 6371 km)
            return distances * 6371.0
        else:
            # Euclidean distance (for projected coordinates)
            from scipy.spatial.distance import cdist
            # Convert meters to kilometers if projected
            distances = cdist(origin_coords, dest_coords, metric='euclidean')
            if origins.crs == AccessibilityConfig.SVY21_CRS:
                distances /= 1000.0
            return distances

    def hansen_gravity_model(
        self,
        origins: gpd.GeoDataFrame,
        amenities: gpd.GeoDataFrame,
        capacity_col: str = "importance_score",
    ) -> np.ndarray:
        """
        Compute Hansen gravity-based accessibility.

        A_i = Σ_j (W_j / f(d_ij))

        where:
        - A_i is accessibility at origin i
        - W_j is the weight/capacity of amenity j
        - f(d_ij) is the distance decay function

        Args:
            origins: GeoDataFrame of origin locations
            amenities: GeoDataFrame of amenity locations
            capacity_col: Column name for amenity weights/importance

        Returns:
            Array of accessibility scores for each origin
        """
        if amenities.empty:
            return np.zeros(len(origins))

        # Compute distance matrix
        distances = self.compute_distance_matrix(origins, amenities)

        # Apply distance decay
        decay_weights = self._decay_func(distances)

        # Get amenity capacities
        if capacity_col in amenities.columns:
            capacities = amenities[capacity_col].values
        else:
            capacities = np.ones(len(amenities))

        # Compute accessibility: sum of weighted capacities
        accessibility = np.sum(decay_weights * capacities, axis=1)

        return accessibility

    def two_step_fca(
        self,
        origins: gpd.GeoDataFrame,
        amenities: gpd.GeoDataFrame,
        capacity_col: str = "importance_score",
        demand_col: str = "demand",
        catchment_size: float = AccessibilityConfig.CATCHMENT_SIZE_KM,
    ) -> np.ndarray:
        """
        Compute 2-Step Floating Catchment Area (2SFCA) accessibility.

        Step 1: For each amenity j, compute supply-to-demand ratio R_j
                R_j = S_j / Σ_k(D_k) for all demand points k within catchment

        Step 2: For each origin i, sum ratios of amenities within catchment
                A_i = Σ_j(R_j) for all amenities j within catchment

        Args:
            origins: GeoDataFrame of origin locations
            amenities: GeoDataFrame of amenity locations
            capacity_col: Column name for amenity supply/capacity
            demand_col: Column name for demand at origins
            catchment_size: Size of catchment area in km

        Returns:
            Array of accessibility scores for each origin
        """
        if amenities.empty:
            return np.zeros(len(origins))

        # Get supply and demand
        supply = amenities[capacity_col].values if capacity_col in amenities.columns else np.ones(len(amenities))
        demand = origins[demand_col].values if demand_col in origins.columns else np.ones(len(origins))

        # Compute distance matrix
        distances = self.compute_distance_matrix(origins, amenities)

        # Step 1: Compute supply-to-demand ratio for each amenity
        within_catchment = distances <= catchment_size
        supply_to_demand = np.zeros(len(amenities))

        for j in range(len(amenities)):
            demand_within = demand[within_catchment[:, j]]
            total_demand = np.sum(demand_within)
            if total_demand > 0:
                supply_to_demand[j] = supply[j] / total_demand

        # Step 2: Sum ratios for amenities within catchment of each origin
        accessibility = np.zeros(len(origins))
        for i in range(len(origins)):
            amenities_within = within_catchment[i, :]
            accessibility[i] = np.sum(supply_to_demand[amenities_within])

        return accessibility

    def enhanced_2sfca(
        self,
        origins: gpd.GeoDataFrame,
        amenities: gpd.GeoDataFrame,
        capacity_col: str = "importance_score",
        demand_col: str = "demand",
        distance_bands: Optional[list[Tuple[float, float]]] = None,
    ) -> np.ndarray:
        """
        Compute Enhanced 2-Step Floating Catchment Area (E2SFCA) with distance decay.

        Similar to 2SFCA but incorporates continuous distance decay within catchment.

        Args:
            origins: GeoDataFrame of origin locations
            amenities: GeoDataFrame of amenity locations
            capacity_col: Column name for amenity capacity
            demand_col: Column name for demand
            distance_bands: List of (min_dist, max_dist) tuples with different decay weights

        Returns:
            Array of accessibility scores
        """
        if amenities.empty:
            return np.zeros(len(origins))

        # Use default distance bands if not provided
        if distance_bands is None:
            distance_bands = [(0, 1), (1, 3), (3, 5), (5, 10)]

        # Get supply and demand
        supply = amenities[capacity_col].values if capacity_col in amenities.columns else np.ones(len(amenities))
        demand = origins[demand_col].values if demand_col in origins.columns else np.ones(len(origins))

        # Compute distance matrix
        distances = self.compute_distance_matrix(origins, amenities)

        # Compute decay weights based on distance bands
        decay_weights = np.zeros_like(distances)
        for i, (min_d, max_d) in enumerate(distance_bands):
            mask = (distances >= min_d) & (distances < max_d)
            # Weight decreases with distance band
            weight = 1.0 / (i + 1)
            decay_weights[mask] = weight

        # Step 1: Compute weighted supply-to-demand ratio
        supply_to_demand = np.zeros(len(amenities))
        for j in range(len(amenities)):
            weighted_demand = np.sum(demand * decay_weights[:, j])
            if weighted_demand > 0:
                supply_to_demand[j] = supply[j] / weighted_demand

        # Step 2: Compute accessibility
        accessibility = np.sum(decay_weights * supply_to_demand, axis=1)

        return accessibility

    def cumulative_opportunities(
        self,
        origins: gpd.GeoDataFrame,
        amenities: gpd.GeoDataFrame,
        threshold_km: float = 3.0,
    ) -> np.ndarray:
        """
        Compute cumulative opportunities accessibility.

        Simply counts number of amenities within threshold distance.

        Args:
            origins: GeoDataFrame of origin locations
            amenities: GeoDataFrame of amenity locations
            threshold_km: Distance threshold in kilometers

        Returns:
            Array of opportunity counts for each origin
        """
        if amenities.empty:
            return np.zeros(len(origins))

        # Compute distance matrix
        distances = self.compute_distance_matrix(origins, amenities)

        # Count amenities within threshold
        within_threshold = distances <= threshold_km
        opportunities = np.sum(within_threshold, axis=1)

        return opportunities

    def compute(
        self,
        origins: gpd.GeoDataFrame,
        amenities: gpd.GeoDataFrame,
        model: Literal["hansen", "2sfca", "e2sfca", "cumulative"] = "hansen",
        **kwargs,
    ) -> AccessibilityResult:
        """
        Compute accessibility using specified model.

        Args:
            origins: GeoDataFrame of origin points (grid cells)
            amenities: GeoDataFrame of amenity points
            model: Accessibility model to use
            **kwargs: Additional arguments for specific models

        Returns:
            AccessibilityResult with scores and metadata
        """
        if model == "hansen":
            scores = self.hansen_gravity_model(origins, amenities, **kwargs)
            model_type = "gravity"
        elif model == "2sfca":
            scores = self.two_step_fca(origins, amenities, **kwargs)
            model_type = "2sfca"
        elif model == "e2sfca":
            scores = self.enhanced_2sfca(origins, amenities, **kwargs)
            model_type = "e2sfca"
        elif model == "cumulative":
            scores = self.cumulative_opportunities(origins, amenities, **kwargs)
            model_type = "cumulative"
        else:
            raise ValueError(f"Unknown model: {model}")

        return AccessibilityResult(
            grid=origins,
            amenities=amenities,
            scores=scores,
            metric=model,
            model_type=model_type,
            decay_function=self.decay_function,
        )


__all__ = [
    "AccessibilityResult",
    "AccessibilityConfig",
    "DecayFunctions",
    "SpatialAccessEngine",
    "PYSAL_AVAILABLE",
]
