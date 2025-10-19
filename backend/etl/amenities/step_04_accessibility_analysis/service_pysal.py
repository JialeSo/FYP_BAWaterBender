"""
PySAL-based Accessibility Analysis Service
===========================================

High-level service interface for spatial accessibility analysis using
PySAL and optimized spatial operations.

This service provides:
- Multiple accessibility models (Hansen, 2SFCA, E2SFCA, etc.)
- Efficient grid-based analysis
- Category-specific and subzone-specific analysis
- Visualization and export capabilities

Usage:
------
    from step_04_accessibility_analysis import AccessibilityService

    service = AccessibilityService()

    # Citywide analysis with Hansen gravity model
    results = service.analyze_citywide(
        categories=["healthcare_facilities", "transport_services"],
        model="hansen",
        decay_function="power"
    )

    # Subzone analysis with 2SFCA
    results = service.analyze_subzone(
        subzone="Downtown Core",
        categories=["essential_services"],
        model="2sfca"
    )
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Literal, Iterable
import warnings

import geopandas as gpd
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

from .compute_pysal import SpatialAccessEngine, AccessibilityResult, AccessibilityConfig
from .grid_optimized import GridFactory, GridConfig, H3_AVAILABLE
from .data import AmenityDataRepository, DatasetPaths


@dataclass
class AnalysisConfig:
    """Configuration for accessibility analysis."""

    # Grid settings
    grid_type: Literal["h3", "square"] = "h3"
    h3_resolution: int = 9
    square_cell_size_m: float = 200.0

    # Accessibility model
    model: Literal["hansen", "2sfca", "e2sfca", "cumulative"] = "hansen"
    decay_function: Literal["power", "exponential", "gaussian", "linear", "step"] = "power"
    decay_beta: float = 2.0
    max_distance_km: float = 10.0

    # Amenity settings
    capacity_col: str = "importance_score"
    demand_col: str = "demand"

    # Output settings
    output_dir: Optional[Path] = None
    save_results: bool = True
    create_plots: bool = True


class AccessibilityService:
    """
    High-level service for spatial accessibility analysis.

    This service orchestrates data loading, grid generation, accessibility
    computation, and result visualization.
    """

    def __init__(
        self,
        data_repository: Optional[AmenityDataRepository] = None,
        config: Optional[AnalysisConfig] = None,
    ):
        """
        Initialize the accessibility service.

        Args:
            data_repository: Optional custom data repository
            config: Optional analysis configuration
        """
        self.repository = data_repository or AmenityDataRepository()
        self.config = config or AnalysisConfig()

        # Initialize spatial access engine
        self.engine = SpatialAccessEngine(
            decay_function=self.config.decay_function,
            beta=self.config.decay_beta,
            max_distance_km=self.config.max_distance_km,
        )

    def _prepare_grid(self, boundary: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
        """
        Generate analysis grid for the given boundary.

        Args:
            boundary: GeoDataFrame defining the analysis area

        Returns:
            GeoDataFrame of grid cells
        """
        grid_config = GridConfig(
            h3_resolution=self.config.h3_resolution,
            square_cell_size_m=self.config.square_cell_size_m,
        )

        grid = GridFactory.create_grid(
            boundary=boundary,
            grid_type=self.config.grid_type,
            resolution=self.config.h3_resolution,
            cell_size_m=self.config.square_cell_size_m,
            config=grid_config,
        )

        return grid

    def _filter_amenities(
        self,
        amenities: gpd.GeoDataFrame,
        category: str,
    ) -> gpd.GeoDataFrame:
        """
        Filter amenities by category.

        Args:
            amenities: Full amenities GeoDataFrame
            category: Category to filter for

        Returns:
            Filtered GeoDataFrame
        """
        # Normalize category name
        category_normalized = category.lower().replace(" ", "_")

        # Filter
        if "amenity_category" in amenities.columns:
            mask = amenities["amenity_category"].str.lower().str.replace(" ", "_") == category_normalized
            filtered = amenities[mask].copy()
        else:
            warnings.warn(f"amenity_category column not found, returning all amenities")
            filtered = amenities.copy()

        return filtered

    def analyze_citywide(
        self,
        categories: Optional[Iterable[str]] = None,
        model: Optional[str] = None,
        **kwargs,
    ) -> dict[str, AccessibilityResult]:
        """
        Perform citywide accessibility analysis for multiple categories.

        Args:
            categories: List of amenity categories to analyze
            model: Accessibility model to use (overrides config)
            **kwargs: Additional arguments for the accessibility model

        Returns:
            Dictionary mapping category to AccessibilityResult
        """
        # Use default categories if not provided
        if categories is None:
            categories = [
                "healthcare_facilities",
                "transport_services",
                "essential_services",
                "education_institutions",
            ]

        # Load data
        print("Loading data...")
        amenities = self.repository.amenities
        planning_areas = self.repository.planning_areas

        # Generate citywide grid
        print("Generating analysis grid...")
        grid = self._prepare_grid(planning_areas)
        print(f"  ✓ Created {len(grid):,} grid cells")

        # Analyze each category
        results = {}
        model_to_use = model or self.config.model

        for category in categories:
            print(f"\nAnalyzing: {category}")

            # Filter amenities
            category_amenities = self._filter_amenities(amenities, category)
            print(f"  Amenities: {len(category_amenities):,}")

            if len(category_amenities) == 0:
                warnings.warn(f"No amenities found for category: {category}")
                continue

            # Compute accessibility
            result = self.engine.compute(
                origins=grid,
                amenities=category_amenities,
                model=model_to_use,
                capacity_col=self.config.capacity_col,
                demand_col=self.config.demand_col,
                **kwargs,
            )

            results[category] = result

            # Print statistics
            scores = result.scores
            print(f"  Accessibility scores:")
            print(f"    Mean:   {scores.mean():.2f}")
            print(f"    Median: {np.median(scores):.2f}")
            print(f"    Min:    {scores.min():.2f}")
            print(f"    Max:    {scores.max():.2f}")

        return results

    def analyze_subzone(
        self,
        subzone: str,
        categories: Optional[Iterable[str]] = None,
        model: Optional[str] = None,
        **kwargs,
    ) -> dict[str, AccessibilityResult]:
        """
        Perform accessibility analysis for a specific subzone.

        Args:
            subzone: Name of subzone to analyze
            categories: List of amenity categories
            model: Accessibility model to use
            **kwargs: Additional model arguments

        Returns:
            Dictionary mapping category to AccessibilityResult
        """
        # Use default categories if not provided
        if categories is None:
            categories = ["healthcare_facilities", "transport_services", "essential_services"]

        # Load data
        print(f"Analyzing subzone: {subzone}")
        amenities = self.repository.amenities
        subzones = self.repository.subzones

        # Filter to specific subzone
        subzone_boundary = subzones[
            subzones["SUBZONE_N"].str.upper() == subzone.upper()
        ].copy()

        if len(subzone_boundary) == 0:
            raise ValueError(f"Subzone not found: {subzone}")

        # Generate grid for subzone
        print("Generating analysis grid...")
        grid = self._prepare_grid(subzone_boundary)
        print(f"  ✓ Created {len(grid):,} grid cells")

        # Filter amenities to subzone area
        subzone_geom = subzone_boundary.geometry.unary_union
        amenities_in_subzone = amenities[amenities.geometry.within(subzone_geom)].copy()

        # Analyze each category
        results = {}
        model_to_use = model or self.config.model

        for category in categories:
            print(f"\nAnalyzing: {category}")

            # Filter by category
            category_amenities = self._filter_amenities(amenities_in_subzone, category)
            print(f"  Amenities: {len(category_amenities):,}")

            if len(category_amenities) == 0:
                warnings.warn(f"No amenities found for category: {category}")
                continue

            # Compute accessibility
            result = self.engine.compute(
                origins=grid,
                amenities=category_amenities,
                model=model_to_use,
                capacity_col=self.config.capacity_col,
                demand_col=self.config.demand_col,
                **kwargs,
            )

            results[category] = result

            # Statistics
            scores = result.scores
            print(f"  Accessibility scores:")
            print(f"    Mean:   {scores.mean():.2f}")
            print(f"    Median: {np.median(scores):.2f}")

        return results

    def compare_models(
        self,
        category: str,
        models: Optional[list[str]] = None,
    ) -> dict[str, AccessibilityResult]:
        """
        Compare different accessibility models for a single category.

        Args:
            category: Amenity category to analyze
            models: List of models to compare

        Returns:
            Dictionary mapping model name to result
        """
        if models is None:
            models = ["hansen", "2sfca", "e2sfca", "cumulative"]

        # Load data
        amenities = self.repository.amenities
        planning_areas = self.repository.planning_areas

        # Generate grid
        grid = self._prepare_grid(planning_areas)

        # Filter amenities
        category_amenities = self._filter_amenities(amenities, category)

        # Run each model
        results = {}
        for model in models:
            print(f"Running model: {model}")
            result = self.engine.compute(
                origins=grid,
                amenities=category_amenities,
                model=model,
                capacity_col=self.config.capacity_col,
                demand_col=self.config.demand_col,
            )
            results[model] = result

        return results

    def export_results(
        self,
        results: dict[str, AccessibilityResult],
        output_dir: Optional[Path] = None,
        format: Literal["geojson", "csv", "shapefile"] = "geojson",
    ) -> None:
        """
        Export accessibility results to files.

        Args:
            results: Dictionary of results to export
            output_dir: Output directory
            format: Output format
        """
        output_dir = output_dir or self.config.output_dir or Path("output/accessibility")
        output_dir.mkdir(parents=True, exist_ok=True)

        for category, result in results.items():
            filename = f"accessibility_{category}.{format}"
            filepath = output_dir / filename

            gdf = result.as_geodataframe()

            if format == "geojson":
                gdf.to_file(filepath, driver="GeoJSON")
            elif format == "csv":
                # Drop geometry for CSV
                df = pd.DataFrame(gdf.drop(columns="geometry"))
                df.to_csv(filepath, index=False)
            elif format == "shapefile":
                gdf.to_file(filepath)

            print(f"  ✓ Exported: {filepath}")

    def plot_results(
        self,
        results: dict[str, AccessibilityResult],
        output_dir: Optional[Path] = None,
        figsize: tuple = (12, 8),
    ) -> None:
        """
        Create visualizations for accessibility results.

        Args:
            results: Dictionary of results to plot
            output_dir: Output directory for plots
            figsize: Figure size (width, height)
        """
        output_dir = output_dir or self.config.output_dir or Path("output/accessibility")
        output_dir.mkdir(parents=True, exist_ok=True)

        for category, result in results.items():
            # Create figure
            fig, ax = plt.subplots(1, 1, figsize=figsize)

            # Plot grid with accessibility scores
            gdf = result.as_geodataframe()
            gdf.plot(
                column="accessibility",
                cmap="YlOrRd",
                legend=True,
                ax=ax,
                edgecolor="none",
                alpha=0.7,
            )

            # Plot amenities
            result.amenities.plot(
                ax=ax,
                color="blue",
                markersize=10,
                alpha=0.6,
                label="Amenities",
            )

            ax.set_title(f"Accessibility: {category.replace('_', ' ').title()}")
            ax.set_axis_off()
            ax.legend()

            # Save
            filepath = output_dir / f"accessibility_{category}.png"
            plt.tight_layout()
            plt.savefig(filepath, dpi=300, bbox_inches="tight")
            plt.close()

            print(f"  ✓ Plotted: {filepath}")


# Convenience function for quick analysis
def quick_analysis(
    category: str = "healthcare_facilities",
    model: str = "hansen",
    plot: bool = True,
) -> AccessibilityResult:
    """
    Perform quick accessibility analysis for a single category.

    Args:
        category: Amenity category
        model: Accessibility model
        plot: Whether to create visualization

    Returns:
        AccessibilityResult
    """
    service = AccessibilityService()
    results = service.analyze_citywide(categories=[category], model=model)

    if plot:
        service.plot_results(results)

    return results[category]


__all__ = [
    "AccessibilityService",
    "AnalysisConfig",
    "quick_analysis",
]
