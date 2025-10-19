"""
OD Flow-Based Accessibility Computation
========================================

This module computes accessibility metrics using Origin-Destination (OD) flow data
from LTA DataMall to weight demand in PySAL accessibility models.

Key Features:
-------------
- Uses actual passenger flows as demand weights (instead of population estimates)
- Implements gravity model, 2SFCA, and E2SFCA with OD-weighted demand
- Aggregates accessibility to subzones and planning areas
- Integrates with existing PySAL-based accessibility engine
- Supports multi-modal analysis (train + bus)

Theory:
-------
Traditional accessibility models use population as demand proxy:
    A_i = Σ_j (S_j * f(d_ij)) / (Σ_k P_k * f(d_kj))

OD-enhanced models use actual travel flows:
    A_i = Σ_j (S_j * f(d_ij)) / (Σ_k T_kj * f(d_kj))

where:
- A_i = accessibility at origin i
- S_j = supply at destination j (amenities)
- T_kj = actual trips from k to j (from OD data)
- f(d) = distance decay function

This provides more accurate demand estimates based on revealed travel behavior.

Usage:
------
    from step_04_accessibility_analysis import ODAccessibilityEngine

    # Initialize engine
    engine = ODAccessibilityEngine(
        subzones_geojson="data/geojson/subzone_area.geojson",
        planning_areas_geojson="data/geojson/planning_area.geojson"
    )

    # Load OD data
    od_train = client.fetch_od_train(date="202403")
    od_bus = client.fetch_od_bus(date="202403")

    # Compute OD-based accessibility
    results = engine.compute_with_od_flows(
        amenities=amenities_gdf,
        od_train=od_train,
        od_bus=od_bus,
        model="2sfca"
    )
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Literal, Dict
import warnings

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import Point

from .compute_pysal import (
    SpatialAccessEngine,
    AccessibilityResult,
    AccessibilityConfig,
    DecayFunctions,
)
from .od_geocoder import ODGeocoder


@dataclass
class ODAccessibilityConfig:
    """Configuration for OD-based accessibility analysis."""

    # Aggregation level
    aggregation_level: Literal["subzone", "planning_area", "h3"] = "subzone"

    # H3 resolution (if using H3 aggregation)
    h3_resolution: int = 9

    # Time filtering
    time_periods: Optional[list[str]] = None  # None = all hours, or ["7", "8", "9"] for peak
    day_types: Optional[list[str]] = None  # None = all, or ["WEEKDAY"] or ["WEEKEND"]

    # Mode weights (for combining train + bus)
    train_weight: float = 1.0
    bus_weight: float = 1.0

    # Distance decay
    decay_function: str = "power"
    decay_beta: float = 2.0
    max_distance_km: float = 10.0


class ODAccessibilityEngine:
    """
    Accessibility engine that uses OD flow data to weight demand in accessibility models.

    This engine extends the standard PySAL accessibility engine by:
    1. Using actual passenger flows as demand weights
    2. Aggregating flows to spatial units (subzones, planning areas, H3)
    3. Computing accessibility with flow-weighted demand
    """

    def __init__(
        self,
        subzones_geojson: Optional[Path] = None,
        planning_areas_geojson: Optional[Path] = None,
        config: Optional[ODAccessibilityConfig] = None,
        lta_client: Optional[object] = None,
    ):
        """
        Initialize OD-based accessibility engine.

        Args:
            subzones_geojson: Path to subzone boundaries
            planning_areas_geojson: Path to planning area boundaries
            config: Optional configuration
            lta_client: Optional LTA API client for fetching bus stop data
        """
        self.config = config or ODAccessibilityConfig()

        # Initialize geocoder
        self.geocoder = ODGeocoder(
            subzones_geojson=subzones_geojson,
            planning_areas_geojson=planning_areas_geojson,
            lta_client=lta_client,
        )

        # Initialize spatial access engine
        self.engine = SpatialAccessEngine(
            decay_function=self.config.decay_function,
            beta=self.config.decay_beta,
            max_distance_km=self.config.max_distance_km,
        )

        # Load spatial boundaries
        self.subzones = None
        if subzones_geojson:
            self.subzones = gpd.read_file(subzones_geojson).to_crs("EPSG:4326")

        self.planning_areas = None
        if planning_areas_geojson:
            self.planning_areas = gpd.read_file(planning_areas_geojson).to_crs("EPSG:4326")

    def _filter_od_data(
        self,
        od_df: pd.DataFrame,
    ) -> pd.DataFrame:
        """
        Filter OD data by time period and day type.

        Args:
            od_df: OD DataFrame with TIME_PER_HOUR and DAY_TYPE columns

        Returns:
            Filtered DataFrame
        """
        df = od_df.copy()

        # Filter by time period
        if self.config.time_periods:
            df = df[df["TIME_PER_HOUR"].astype(str).isin(self.config.time_periods)]

        # Filter by day type
        if self.config.day_types:
            df = df[df["DAY_TYPE"].isin(self.config.day_types)]

        return df

    def _compute_demand_from_od(
        self,
        od_train: Optional[pd.DataFrame] = None,
        od_bus: Optional[pd.DataFrame] = None,
    ) -> gpd.GeoDataFrame:
        """
        Compute demand at each spatial unit from OD flow data.

        This aggregates all trips *arriving at* each destination (destination-based demand).

        Args:
            od_train: Train OD data
            od_bus: Bus OD data

        Returns:
            GeoDataFrame with demand at each spatial unit
        """
        all_demands = []

        # Process train OD data
        if od_train is not None and not od_train.empty:
            print("  Processing train OD data...")

            # Filter by time/day
            train_filtered = self._filter_od_data(od_train)

            # Geocode
            train_geocoded = self.geocoder.geocode_train_od(train_filtered)

            # Aggregate to spatial units
            if self.config.aggregation_level == "subzone":
                train_agg = self.geocoder.aggregate_to_subzones(train_geocoded)
                # Sum arrivals (destination demand)
                train_demand = train_agg.groupby("dest_subzone")["TOTAL_TRIPS"].sum().reset_index()
                train_demand.columns = ["spatial_unit", "demand"]
            elif self.config.aggregation_level == "planning_area":
                train_agg = self.geocoder.aggregate_to_planning_areas(train_geocoded)
                train_demand = train_agg.groupby("dest_planning_area")["TOTAL_TRIPS"].sum().reset_index()
                train_demand.columns = ["spatial_unit", "demand"]
            else:
                raise ValueError(f"Unsupported aggregation level: {self.config.aggregation_level}")

            train_demand["demand"] *= self.config.train_weight
            all_demands.append(train_demand)

            print(f"    ✓ Train demand: {len(train_demand)} spatial units, {train_demand['demand'].sum():,.0f} total trips")

        # Process bus OD data
        if od_bus is not None and not od_bus.empty:
            print("  Processing bus OD data...")

            # Filter
            bus_filtered = self._filter_od_data(od_bus)

            # Geocode
            bus_geocoded = self.geocoder.geocode_bus_od(bus_filtered)

            # Aggregate
            if self.config.aggregation_level == "subzone":
                bus_agg = self.geocoder.aggregate_to_subzones(bus_geocoded)
                bus_demand = bus_agg.groupby("dest_subzone")["TOTAL_TRIPS"].sum().reset_index()
                bus_demand.columns = ["spatial_unit", "demand"]
            elif self.config.aggregation_level == "planning_area":
                bus_agg = self.geocoder.aggregate_to_planning_areas(bus_geocoded)
                bus_demand = bus_agg.groupby("dest_planning_area")["TOTAL_TRIPS"].sum().reset_index()
                bus_demand.columns = ["spatial_unit", "demand"]

            bus_demand["demand"] *= self.config.bus_weight
            all_demands.append(bus_demand)

            print(f"    ✓ Bus demand: {len(bus_demand)} spatial units, {bus_demand['demand'].sum():,.0f} total trips")

        # Combine train and bus demands
        if not all_demands:
            raise ValueError("No OD data provided")

        combined_demand = pd.concat(all_demands, ignore_index=True)

        # Aggregate (sum demands for units appearing in both modes)
        combined_demand = combined_demand.groupby("spatial_unit")["demand"].sum().reset_index()

        print(f"  ✓ Combined demand: {len(combined_demand)} spatial units, {combined_demand['demand'].sum():,.0f} total trips")

        # Join with geometries
        if self.config.aggregation_level == "subzone":
            spatial_units = self.subzones.copy()
            spatial_units = spatial_units.rename(columns={"SUBZONE_N": "spatial_unit"})
        elif self.config.aggregation_level == "planning_area":
            spatial_units = self.planning_areas.copy()
            spatial_units = spatial_units.rename(columns={"PLN_AREA_N": "spatial_unit"})

        # Merge
        demand_gdf = spatial_units.merge(combined_demand, on="spatial_unit", how="left")
        demand_gdf["demand"] = demand_gdf["demand"].fillna(0)

        return demand_gdf

    def compute_with_od_flows(
        self,
        amenities: gpd.GeoDataFrame,
        od_train: Optional[pd.DataFrame] = None,
        od_bus: Optional[pd.DataFrame] = None,
        model: Literal["hansen", "2sfca", "e2sfca"] = "hansen",
        capacity_col: str = "importance_score",
    ) -> Dict[str, pd.DataFrame]:
        """
        Compute accessibility using OD flow data as demand weights.

        Args:
            amenities: GeoDataFrame of amenity locations with capacity/importance
            od_train: Train OD DataFrame from LTA DataMall
            od_bus: Bus OD DataFrame from LTA DataMall
            model: Accessibility model ("hansen", "2sfca", "e2sfca")
            capacity_col: Column in amenities representing supply/capacity

        Returns:
            Dictionary with:
            - "accessibility_scores": GeoDataFrame with accessibility by spatial unit
            - "demand_distribution": GeoDataFrame with demand by spatial unit
            - "amenity_ratios": DataFrame with supply-to-demand ratios per amenity
        """
        print(f"\n{'='*70}")
        print(f"Computing OD Flow-Based Accessibility")
        print(f"{'='*70}\n")
        print(f"Model: {model}")
        print(f"Aggregation level: {self.config.aggregation_level}")

        # Step 1: Compute demand from OD flows
        print("\nStep 1: Computing demand from OD flows...")
        demand_gdf = self._compute_demand_from_od(od_train=od_train, od_bus=od_bus)

        # Step 2: Compute accessibility with OD-weighted demand
        print(f"\nStep 2: Computing {model} accessibility...")

        # Ensure amenities are in same CRS
        amenities = amenities.to_crs("EPSG:4326")

        if model == "hansen":
            # Hansen gravity model (doesn't use demand)
            result = self.engine.hansen_gravity_model(
                origins=demand_gdf,
                amenities=amenities,
                capacity_col=capacity_col,
            )
            accessibility_scores = result

        elif model in ["2sfca", "e2sfca"]:
            # Two-step FCA models (use demand)
            if model == "2sfca":
                result = self.engine.two_step_fca(
                    origins=demand_gdf,
                    amenities=amenities,
                    capacity_col=capacity_col,
                    demand_col="demand",
                    catchment_size=self.config.max_distance_km,
                )
            else:  # e2sfca
                result = self.engine.enhanced_2sfca(
                    origins=demand_gdf,
                    amenities=amenities,
                    capacity_col=capacity_col,
                    demand_col="demand",
                )

            accessibility_scores = result

        else:
            raise ValueError(f"Unknown model: {model}")

        # Prepare output
        output_gdf = demand_gdf.copy()
        output_gdf["accessibility_score"] = accessibility_scores

        # Statistics
        print(f"\n{'='*70}")
        print(f"Results Summary")
        print(f"{'='*70}\n")
        print(f"Spatial units analyzed: {len(output_gdf):,}")
        print(f"Total demand (trips): {output_gdf['demand'].sum():,.0f}")
        print(f"Amenities: {len(amenities):,}")
        print(f"\nAccessibility scores:")
        print(f"  Mean:   {accessibility_scores.mean():.4f}")
        print(f"  Median: {np.median(accessibility_scores):.4f}")
        print(f"  Min:    {accessibility_scores.min():.4f}")
        print(f"  Max:    {accessibility_scores.max():.4f}")
        print(f"  Std:    {accessibility_scores.std():.4f}")

        # Identify low-accessibility areas
        low_threshold = np.percentile(accessibility_scores[accessibility_scores > 0], 25)
        low_access = output_gdf[output_gdf["accessibility_score"] < low_threshold]
        print(f"\nLow-accessibility areas (bottom 25%):")
        print(f"  Count: {len(low_access):,}")
        if not low_access.empty and "spatial_unit" in low_access.columns:
            print(f"  Examples: {low_access['spatial_unit'].head(5).tolist()}")

        return {
            "accessibility_scores": output_gdf,
            "demand_distribution": demand_gdf,
            "model": model,
            "config": self.config,
        }

    def compare_models_with_od(
        self,
        amenities: gpd.GeoDataFrame,
        od_train: Optional[pd.DataFrame] = None,
        od_bus: Optional[pd.DataFrame] = None,
        models: list[str] = ["hansen", "2sfca", "e2sfca"],
        capacity_col: str = "importance_score",
    ) -> Dict[str, Dict]:
        """
        Compare multiple accessibility models using same OD flow data.

        Args:
            amenities: Amenity locations
            od_train: Train OD data
            od_bus: Bus OD data
            models: List of models to compare
            capacity_col: Amenity capacity column

        Returns:
            Dictionary mapping model name to results
        """
        results = {}

        for model in models:
            print(f"\n{'='*70}")
            print(f"Model: {model.upper()}")
            print(f"{'='*70}")

            result = self.compute_with_od_flows(
                amenities=amenities,
                od_train=od_train,
                od_bus=od_bus,
                model=model,
                capacity_col=capacity_col,
            )

            results[model] = result

        # Compare results
        print(f"\n{'='*70}")
        print(f"Model Comparison")
        print(f"{'='*70}\n")

        comparison_df = pd.DataFrame({
            model: {
                "mean": results[model]["accessibility_scores"]["accessibility_score"].mean(),
                "median": results[model]["accessibility_scores"]["accessibility_score"].median(),
                "std": results[model]["accessibility_scores"]["accessibility_score"].std(),
                "min": results[model]["accessibility_scores"]["accessibility_score"].min(),
                "max": results[model]["accessibility_scores"]["accessibility_score"].max(),
            }
            for model in models
        }).T

        print(comparison_df)

        return results

    def export_results(
        self,
        results: Dict,
        output_dir: Path,
        prefix: str = "od_accessibility",
    ) -> None:
        """
        Export accessibility results to files.

        Args:
            results: Results dictionary from compute_with_od_flows
            output_dir: Output directory
            prefix: Filename prefix
        """
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        # Export accessibility scores
        accessibility_gdf = results["accessibility_scores"]
        output_file = output_dir / f"{prefix}_scores.geojson"
        accessibility_gdf.to_file(output_file, driver="GeoJSON")
        print(f"  ✓ Exported accessibility scores: {output_file}")

        # Export as CSV (without geometry)
        csv_file = output_dir / f"{prefix}_scores.csv"
        accessibility_df = pd.DataFrame(accessibility_gdf.drop(columns="geometry"))
        accessibility_df.to_csv(csv_file, index=False)
        print(f"  ✓ Exported accessibility CSV: {csv_file}")

        # Export demand distribution
        demand_gdf = results["demand_distribution"]
        demand_file = output_dir / f"{prefix}_demand.geojson"
        demand_gdf.to_file(demand_file, driver="GeoJSON")
        print(f"  ✓ Exported demand distribution: {demand_file}")


__all__ = [
    "ODAccessibilityEngine",
    "ODAccessibilityConfig",
]
