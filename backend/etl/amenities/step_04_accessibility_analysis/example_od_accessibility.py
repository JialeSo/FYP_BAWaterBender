#!/usr/bin/env python3
"""
Example: OD Flow-Based Accessibility Analysis
==============================================

This script demonstrates how to compute accessibility using Origin-Destination
passenger flow data from LTA DataMall.

Key Steps:
----------
1. Fetch OD data from LTA DataMall API (train and bus)
2. Geocode PT codes to coordinates
3. Aggregate flows to subzones/planning areas
4. Compute accessibility with OD-weighted demand
5. Compare with traditional population-based accessibility
6. Export and visualize results

Requirements:
-------------
- LTA DataMall API key (store as SLA_API_KEY in .env or environment variable)
- Internet connection (for API access)
- Subzone and planning area boundary files
- Amenity dataset with coordinates and importance scores

Usage:
------
    # Set API key (preferred: add to .env as SLA_API_KEY)
    export SLA_API_KEY="your-api-key-here"

    # Run analysis
    python example_od_accessibility.py --date 202403 --category healthcare_facilities

    # Compare models
    python example_od_accessibility.py --date 202403 --compare-models

    # Multi-modal analysis (train + bus)
    python example_od_accessibility.py --date 202403 --modes train bus
"""

import argparse
import os
from pathlib import Path

import geopandas as gpd
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("WARNING: python-dotenv not installed. Install with: pip install python-dotenv")

from step_04_accessibility_analysis import (
    LTAODClient,
    ODAccessibilityEngine,
    ODAccessibilityConfig,
    AccessibilityService,
    OD_AVAILABLE,
)


def main():
    parser = argparse.ArgumentParser(
        description="Compute OD flow-based accessibility",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument(
        "--date",
        type=str,
        default="202403",
        help="Date in YYYYMM format (e.g., 202403 for March 2024)",
    )
    parser.add_argument(
        "--category",
        type=str,
        default="healthcare_facilities",
        help="Amenity category to analyze",
    )
    parser.add_argument(
        "--modes",
        nargs="+",
        choices=["train", "bus"],
        default=["train", "bus"],
        help="Transit modes to include",
    )
    parser.add_argument(
        "--aggregation",
        type=str,
        choices=["subzone", "planning_area"],
        default="subzone",
        help="Spatial aggregation level",
    )
    parser.add_argument(
        "--model",
        type=str,
        choices=["hansen", "2sfca", "e2sfca"],
        default="hansen",
        help="Accessibility model (default: hansen)",
    )
    parser.add_argument(
        "--compare-models",
        action="store_true",
        help="Compare multiple accessibility models",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("output/od_accessibility"),
        help="Output directory for results",
    )
    parser.add_argument(
        "--api-key",
        type=str,
        help="LTA DataMall API key (or set SLA_API_KEY in .env file)",
    )

    args = parser.parse_args()

    # Check OD availability
    if not OD_AVAILABLE:
        print("ERROR: OD flow-based accessibility components not available.")
        print("Please ensure all dependencies are installed:")
        print("  pip install geopandas pandas requests h3 pysal python-dotenv")
        return 1

    # API key (priority: CLI arg > SLA_API_KEY from .env > LTA_API_KEY for backward compatibility)
    api_key = args.api_key or os.getenv("SLA_API_KEY") or os.getenv("LTA_API_KEY")
    if not api_key:
        print("ERROR: LTA DataMall API key required.")
        print("\nOptions:")
        print("  1. Add to .env file: SLA_API_KEY=your-api-key-here")
        print("  2. Pass via command line: --api-key your-api-key")
        print("  3. Set environment variable: export SLA_API_KEY=your-api-key")
        print("\nTo get an API key:")
        print("  Visit https://datamall.lta.gov.sg/content/datamall/en.html")
        print("  Create account and request API access")
        return 1

    print(f"\n{'='*70}")
    print("OD Flow-Based Accessibility Analysis")
    print(f"{'='*70}\n")
    print(f"Date: {args.date}")
    print(f"Category: {args.category}")
    print(f"Modes: {', '.join(args.modes)}")
    print(f"Aggregation: {args.aggregation}")
    print(f"Model: {args.model}")

    # Paths (adjust to your data locations)
    data_dir = Path("backend/etl/data")
    subzones_geojson = data_dir / "geojson" / "subzone_area.geojson"
    planning_areas_geojson = data_dir / "geojson" / "planning_area.geojson"
    amenities_csv = data_dir / "amenities" / "amenities_3layers.csv"

    # Validate paths
    for path in [subzones_geojson, planning_areas_geojson, amenities_csv]:
        if not path.exists():
            print(f"ERROR: Required file not found: {path}")
            return 1

    # Step 1: Fetch OD data
    print(f"\n{'='*70}")
    print("Step 1: Fetching OD Data from LTA DataMall")
    print(f"{'='*70}")

    client = LTAODClient(api_key=api_key)

    od_train = None
    od_bus = None

    if "train" in args.modes:
        try:
            od_train = client.fetch_od_train(date=args.date)
        except Exception as e:
            print(f"WARNING: Failed to fetch train OD data: {e}")

    if "bus" in args.modes:
        try:
            od_bus = client.fetch_od_bus(date=args.date)
        except Exception as e:
            print(f"WARNING: Failed to fetch bus OD data: {e}")

    if od_train is None and od_bus is None:
        print("ERROR: No OD data available. Check API key and date.")
        return 1

    # Step 2: Load amenities
    print(f"\n{'='*70}")
    print("Step 2: Loading Amenity Data")
    print(f"{'='*70}")

    amenities_df = pd.read_csv(amenities_csv)
    print(f"  Total amenities: {len(amenities_df):,}")

    # Filter by category
    if "amenity_category" in amenities_df.columns:
        category_mask = amenities_df["amenity_category"].str.lower().str.replace(" ", "_") == args.category.lower()
        amenities_filtered = amenities_df[category_mask].copy()
    else:
        print("  WARNING: No amenity_category column, using all amenities")
        amenities_filtered = amenities_df.copy()

    print(f"  Category '{args.category}': {len(amenities_filtered):,} amenities")

    # Convert to GeoDataFrame
    if "lon" in amenities_filtered.columns and "lat" in amenities_filtered.columns:
        geometry = gpd.points_from_xy(amenities_filtered["lon"], amenities_filtered["lat"])
        amenities_gdf = gpd.GeoDataFrame(amenities_filtered, geometry=geometry, crs="EPSG:4326")
    else:
        print("ERROR: Amenity data missing coordinates (lon/lat columns)")
        return 1

    # Step 3: Configure OD accessibility engine
    print(f"\n{'='*70}")
    print("Step 3: Configuring OD Accessibility Engine")
    print(f"{'='*70}")

    config = ODAccessibilityConfig(
        aggregation_level=args.aggregation,
        day_types=["WEEKDAY"],  # Focus on weekday patterns
        time_periods=None,  # All hours (for full daily accessibility)
        decay_function="power",
        decay_beta=2.0,
        max_distance_km=10.0,
    )

    od_engine = ODAccessibilityEngine(
        subzones_geojson=subzones_geojson,
        planning_areas_geojson=planning_areas_geojson,
        config=config,
        lta_client=client,
    )

    # Step 4: Compute OD-based accessibility
    if args.compare_models:
        print(f"\n{'='*70}")
        print("Step 4: Comparing Accessibility Models")
        print(f"{'='*70}")

        results = od_engine.compare_models_with_od(
            amenities=amenities_gdf,
            od_train=od_train,
            od_bus=od_bus,
            models=["hansen", "2sfca", "e2sfca"],
            capacity_col="importance_score",
        )

        # Export comparison
        comparison_output = args.output_dir / "model_comparison"
        comparison_output.mkdir(parents=True, exist_ok=True)

        for model, result in results.items():
            od_engine.export_results(
                result,
                output_dir=comparison_output,
                prefix=f"{args.category}_{model}",
            )

    else:
        print(f"\n{'='*70}")
        print("Step 4: Computing OD-Based Accessibility")
        print(f"{'='*70}")

        results = od_engine.compute_with_od_flows(
            amenities=amenities_gdf,
            od_train=od_train,
            od_bus=od_bus,
            model=args.model,
            capacity_col="importance_score",
        )

        # Export results
        od_engine.export_results(
            results,
            output_dir=args.output_dir,
            prefix=f"{args.category}_{args.model}",
        )

    # Step 5: Visualization
    print(f"\n{'='*70}")
    print("Step 5: Creating Visualizations")
    print(f"{'='*70}")

    if not args.compare_models:
        accessibility_gdf = results["accessibility_scores"]

        # Plot accessibility map
        fig, ax = plt.subplots(1, 1, figsize=(14, 10))

        accessibility_gdf.plot(
            column="accessibility_score",
            cmap="YlOrRd",
            legend=True,
            ax=ax,
            edgecolor="black",
            linewidth=0.3,
            alpha=0.7,
        )

        # Overlay amenities
        amenities_gdf.plot(
            ax=ax,
            color="blue",
            markersize=20,
            alpha=0.6,
            label="Amenities",
        )

        ax.set_title(
            f"OD Flow-Based Accessibility: {args.category.replace('_', ' ').title()}\n"
            f"Model: {args.model.upper()}, Date: {args.date}",
            fontsize=14,
            fontweight="bold",
        )
        ax.set_axis_off()
        ax.legend()

        # Save plot
        plot_file = args.output_dir / f"{args.category}_{args.model}_map.png"
        plt.tight_layout()
        plt.savefig(plot_file, dpi=300, bbox_inches="tight")
        print(f"  ✓ Map saved: {plot_file}")

        # Distribution histogram
        fig, ax = plt.subplots(1, 1, figsize=(10, 6))
        accessibility_gdf["accessibility_score"].hist(bins=50, ax=ax, edgecolor="black")
        ax.set_xlabel("Accessibility Score")
        ax.set_ylabel("Frequency")
        ax.set_title(f"Accessibility Distribution: {args.category}")
        ax.grid(alpha=0.3)

        hist_file = args.output_dir / f"{args.category}_{args.model}_histogram.png"
        plt.tight_layout()
        plt.savefig(hist_file, dpi=300, bbox_inches="tight")
        print(f"  ✓ Histogram saved: {hist_file}")

    print(f"\n{'='*70}")
    print("Analysis Complete!")
    print(f"{'='*70}\n")
    print(f"Results saved to: {args.output_dir}")

    return 0


if __name__ == "__main__":
    exit(main())
