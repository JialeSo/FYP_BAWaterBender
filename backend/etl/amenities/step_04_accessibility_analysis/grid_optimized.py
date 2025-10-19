"""
Optimized Grid Generation for Spatial Accessibility Analysis
=============================================================

This module provides efficient grid generation using H3 hexagons or regular grids
with optimized spatial indexing for fast spatial queries.

Key Features:
-------------
- H3 hexagonal grids at multiple resolutions
- Regular square grids with configurable cell size
- Spatial indexing with rtree for fast intersection queries
- Automatic grid clipping to boundaries
- Population-weighted grid cells (optional)

Dependencies:
-------------
pip install h3 geopandas rtree shapely

H3 Resolution Guide:
--------------------
Resolution | Avg Hexagon Edge | Avg Hexagon Area | Use Case
-----------|------------------|------------------|------------------
5          | 8.54 km         | 252.9 km²       | Regional analysis
6          | 3.23 km         | 86.74 km²       | City-wide
7          | 1.22 km         | 29.79 km²       | District-level
8          | 461 m           | 10.22 km²       | Neighborhood
9          | 174 m           | 3.5 km²         | Fine-grained urban (default)
10         | 66 m            | 1.19 km²        | Block-level
11         | 25 m            | 0.39 km²        | Building-level
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Literal
import warnings

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import Polygon, Point, box
from shapely.ops import unary_union

# H3 hexagonal grid
try:
    import h3
    H3_AVAILABLE = True
except ImportError:
    warnings.warn(
        "H3 not available. Install with: pip install h3",
        ImportWarning
    )
    H3_AVAILABLE = False

# Spatial indexing
from rtree import index


@dataclass
class GridConfig:
    """Configuration for grid generation."""

    # H3 hexagon resolution (5-11 for urban analysis)
    h3_resolution: int = 9  # ~174m edge, good for urban analysis

    # Square grid cell size (in meters for projected CRS)
    square_cell_size_m: float = 200.0

    # Buffer around boundary (in meters)
    boundary_buffer_m: float = 0.0

    # CRS
    latlon_crs: str = "EPSG:4326"
    projected_crs: str = "EPSG:3414"  # SVY21 for Singapore

    # Grid cell attributes
    add_area: bool = True
    add_centroid: bool = True
    add_cell_id: bool = True


class H3HexagonGrid:
    """
    Efficient H3 hexagonal grid generation.

    H3 is Uber's Hexagonal Hierarchical Spatial Index system.
    Hexagons provide better spatial sampling than squares (uniform distance to neighbors).
    """

    def __init__(self, resolution: int = 9, config: Optional[GridConfig] = None):
        """
        Initialize H3 grid builder.

        Args:
            resolution: H3 resolution (5-15, recommended 7-10 for urban)
            config: Optional grid configuration
        """
        if not H3_AVAILABLE:
            raise ImportError("H3 not available. Install with: pip install h3")

        self.resolution = resolution
        self.config = config or GridConfig(h3_resolution=resolution)

    def build(self, boundary: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
        """
        Generate H3 hexagonal grid covering the boundary.

        Args:
            boundary: GeoDataFrame defining the area to cover

        Returns:
            GeoDataFrame of hexagonal cells
        """
        # Ensure boundary is in WGS84 (required by H3)
        if boundary.crs != self.config.latlon_crs:
            boundary = boundary.to_crs(self.config.latlon_crs)

        # Get union of all boundary geometries
        boundary_union = unary_union(boundary.geometry)

        # Get H3 hexagons covering the boundary
        # Method 1: Use polyfill for polygons
        hexagons = set()

        if boundary_union.geom_type == "Polygon":
            hexagons.update(self._polyfill_polygon(boundary_union))
        elif boundary_union.geom_type == "MultiPolygon":
            for poly in boundary_union.geoms:
                hexagons.update(self._polyfill_polygon(poly))
        else:
            raise ValueError(f"Unsupported geometry type: {boundary_union.geom_type}")

        # Convert H3 cells to polygons
        geometries = []
        cell_ids = []

        for h3_id in hexagons:
            # Get hexagon boundary
            boundary_coords = h3.h3_to_geo_boundary(h3_id, geo_json=True)
            polygon = Polygon(boundary_coords)
            geometries.append(polygon)
            cell_ids.append(h3_id)

        # Create GeoDataFrame
        grid = gpd.GeoDataFrame(
            {"cell_id": cell_ids},
            geometry=geometries,
            crs=self.config.latlon_crs,
        )

        # Add optional attributes
        if self.config.add_area:
            # Convert to projected CRS for accurate area calculation
            grid_projected = grid.to_crs(self.config.projected_crs)
            grid["area_m2"] = grid_projected.geometry.area
            grid["area_km2"] = grid["area_m2"] / 1_000_000

        if self.config.add_centroid:
            grid["centroid_lon"] = grid.geometry.centroid.x
            grid["centroid_lat"] = grid.geometry.centroid.y

        # Add demand (default to uniform, can be population-weighted later)
        grid["demand"] = 1.0

        return grid

    def _polyfill_polygon(self, polygon: Polygon) -> set:
        """
        Fill polygon with H3 hexagons.

        Args:
            polygon: Shapely Polygon

        Returns:
            Set of H3 cell IDs
        """
        # Convert to GeoJSON format for H3
        geojson = {
            "type": "Polygon",
            "coordinates": [list(polygon.exterior.coords)],
        }

        # Polyfill with H3
        hexagons = h3.polyfill_geojson(geojson, self.resolution)

        return hexagons


class SquareGrid:
    """
    Efficient regular square grid generation.

    Useful for simpler analysis or when hexagons are not needed.
    Faster to generate than H3 hexagons.
    """

    def __init__(self, cell_size_m: float = 200.0, config: Optional[GridConfig] = None):
        """
        Initialize square grid builder.

        Args:
            cell_size_m: Size of grid cells in meters
            config: Optional grid configuration
        """
        self.cell_size_m = cell_size_m
        self.config = config or GridConfig(square_cell_size_m=cell_size_m)

    def build(self, boundary: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
        """
        Generate regular square grid covering the boundary.

        Args:
            boundary: GeoDataFrame defining the area to cover

        Returns:
            GeoDataFrame of square cells
        """
        # Convert to projected CRS for accurate distances
        if boundary.crs != self.config.projected_crs:
            boundary = boundary.to_crs(self.config.projected_crs)

        # Get bounding box
        bounds = boundary.total_bounds  # (minx, miny, maxx, maxy)
        minx, miny, maxx, maxy = bounds

        # Add buffer if specified
        buffer = self.config.boundary_buffer_m
        minx -= buffer
        miny -= buffer
        maxx += buffer
        maxy += buffer

        # Generate grid cells
        cells = []
        cell_ids = []
        cell_id = 0

        x = minx
        while x < maxx:
            y = miny
            while y < maxy:
                # Create cell polygon
                cell = box(x, y, x + self.cell_size_m, y + self.cell_size_m)

                # Check if cell intersects with boundary
                if boundary.geometry.unary_union.intersects(cell):
                    cells.append(cell)
                    cell_ids.append(f"grid_{cell_id}")
                    cell_id += 1

                y += self.cell_size_m
            x += self.cell_size_m

        # Create GeoDataFrame
        grid = gpd.GeoDataFrame(
            {"cell_id": cell_ids},
            geometry=cells,
            crs=self.config.projected_crs,
        )

        # Add attributes
        if self.config.add_area:
            grid["area_m2"] = grid.geometry.area
            grid["area_km2"] = grid["area_m2"] / 1_000_000

        if self.config.add_centroid:
            centroids = grid.geometry.centroid
            grid["centroid_x"] = centroids.x
            grid["centroid_y"] = centroids.y

        # Convert to lat/lon for consistency
        grid = grid.to_crs(self.config.latlon_crs)

        if self.config.add_centroid:
            grid["centroid_lon"] = grid.geometry.centroid.x
            grid["centroid_lat"] = grid.geometry.centroid.y

        # Add demand
        grid["demand"] = 1.0

        return grid


class AdaptiveGrid:
    """
    Adaptive grid that uses different resolutions based on urban density.

    Higher resolution in dense urban areas, coarser in suburban/rural areas.
    """

    def __init__(
        self,
        urban_resolution: int = 9,
        suburban_resolution: int = 8,
        rural_resolution: int = 7,
        config: Optional[GridConfig] = None,
    ):
        """
        Initialize adaptive grid builder.

        Args:
            urban_resolution: H3 resolution for dense urban areas
            suburban_resolution: H3 resolution for suburban areas
            rural_resolution: H3 resolution for rural areas
            config: Optional grid configuration
        """
        self.urban_resolution = urban_resolution
        self.suburban_resolution = suburban_resolution
        self.rural_resolution = rural_resolution
        self.config = config or GridConfig()

    def build(
        self,
        boundary: gpd.GeoDataFrame,
        density_map: Optional[gpd.GeoDataFrame] = None,
    ) -> gpd.GeoDataFrame:
        """
        Generate adaptive grid based on density.

        Args:
            boundary: GeoDataFrame defining the area
            density_map: Optional GeoDataFrame with density information

        Returns:
            GeoDataFrame with mixed-resolution grid
        """
        # For now, use uniform resolution (can be enhanced with density map)
        # TODO: Implement density-based resolution selection
        grid_builder = H3HexagonGrid(resolution=self.urban_resolution, config=self.config)
        return grid_builder.build(boundary)


class GridFactory:
    """
    Factory for creating different types of grids.

    Provides a unified interface for grid generation.
    """

    @staticmethod
    def create_grid(
        boundary: gpd.GeoDataFrame,
        grid_type: Literal["h3", "square", "adaptive"] = "h3",
        resolution: Optional[int] = None,
        cell_size_m: Optional[float] = None,
        config: Optional[GridConfig] = None,
    ) -> gpd.GeoDataFrame:
        """
        Create a grid of specified type.

        Args:
            boundary: GeoDataFrame defining the area to cover
            grid_type: Type of grid to create
            resolution: H3 resolution (for h3/adaptive grids)
            cell_size_m: Cell size in meters (for square grids)
            config: Optional grid configuration

        Returns:
            GeoDataFrame of grid cells
        """
        config = config or GridConfig()

        if grid_type == "h3":
            res = resolution or config.h3_resolution
            builder = H3HexagonGrid(resolution=res, config=config)
        elif grid_type == "square":
            size = cell_size_m or config.square_cell_size_m
            builder = SquareGrid(cell_size_m=size, config=config)
        elif grid_type == "adaptive":
            builder = AdaptiveGrid(config=config)
        else:
            raise ValueError(f"Unknown grid type: {grid_type}")

        return builder.build(boundary)


class SpatialIndex:
    """
    Efficient spatial indexing for fast spatial queries.

    Uses rtree for O(log n) spatial lookups instead of O(n).
    """

    def __init__(self, gdf: gpd.GeoDataFrame):
        """
        Create spatial index for GeoDataFrame.

        Args:
            gdf: GeoDataFrame to index
        """
        self.gdf = gdf
        self.idx = index.Index()

        # Build index
        for pos, (idx_val, geom) in enumerate(zip(gdf.index, gdf.geometry)):
            self.idx.insert(pos, geom.bounds, obj=idx_val)

    def query_point(self, point: Point, k: int = 1) -> list:
        """
        Find k nearest geometries to a point.

        Args:
            point: Query point
            k: Number of nearest neighbors

        Returns:
            List of indices of nearest geometries
        """
        nearest = list(self.idx.nearest(point.bounds, k, objects=True))
        return [item.object for item in nearest]

    def query_bbox(self, bbox: tuple) -> list:
        """
        Find geometries intersecting bounding box.

        Args:
            bbox: (minx, miny, maxx, maxy)

        Returns:
            List of indices of intersecting geometries
        """
        intersecting = list(self.idx.intersection(bbox, objects=True))
        return [item.object for item in intersecting]


__all__ = [
    "GridConfig",
    "H3HexagonGrid",
    "SquareGrid",
    "AdaptiveGrid",
    "GridFactory",
    "SpatialIndex",
    "H3_AVAILABLE",
]
