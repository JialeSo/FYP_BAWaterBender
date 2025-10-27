#!/usr/bin/env python3
"""
Amenities ETL Pipeline Test Runner
===================================

This script provides an easy interface to run and test the amenities pipeline
with different configurations and visualize the outputs.

Usage:
------
    # Run full pipeline
    python run_pipeline.py

    # Run specific steps
    python run_pipeline.py --steps 3 4

    # Quick test (accessibility only, single category)
    python run_pipeline.py --quick

    # Test new PySAL accessibility with custom config
    python run_pipeline.py --test-accessibility --model 2sfca

    # Show outputs
    python run_pipeline.py --show-outputs
"""

import argparse
import sys
from pathlib import Path
from typing import Optional

# Add parent directories to path
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent.parent))
sys.path.insert(0, str(SCRIPT_DIR))


def run_full_pipeline(steps: Optional[list] = None, plot: bool = True):
    """Run the complete amenities ETL pipeline."""
    print("\n" + "="*80)
    print("RUNNING AMENITIES ETL PIPELINE")
    print("="*80 + "\n")

    from pipeline import main as pipeline_main
    import sys

    # Build arguments
    args = ["pipeline.py"]
    if steps:
        args.extend(["--steps"] + [str(s) for s in steps])
    else:
        args.append("--all")

    if plot:
        args.append("--plot")
    else:
        args.append("--no-plot")

    # Replace sys.argv and run
    old_argv = sys.argv
    sys.argv = args
    try:
        pipeline_main()
    finally:
        sys.argv = old_argv


def quick_accessibility_test(
    category: str = "healthcare_facilities",
    model: str = "hansen",
    plot: bool = True,
):
    """Run quick accessibility analysis test."""
    print("\n" + "="*80)
    print("QUICK ACCESSIBILITY TEST")
    print("="*80 + "\n")
    print(f"Category: {category}")
    print(f"Model: {model}")
    print(f"Plot: {plot}\n")

    try:
        # Try new PySAL-based implementation
        from step_04_accessibility_analysis.service_pysal import quick_analysis
        import numpy as np

        print("Using: PySAL-based implementation (optimized)\n")

        result = quick_analysis(
            category=category,
            model=model,
            plot=plot,
        )

        print("\n" + "-"*80)
        print("RESULTS SUMMARY")
        print("-"*80)
        print(f"Grid cells: {len(result.grid):,}")
        print(f"Amenities: {len(result.amenities):,}")
        print(f"\nAccessibility Scores:")
        print(f"  Mean:     {result.scores.mean():.2f}")
        print(f"  Median:   {np.median(result.scores):.2f}")
        print(f"  Std Dev:  {result.scores.std():.2f}")
        print(f"  Min:      {result.scores.min():.2f}")
        print(f"  Max:      {result.scores.max():.2f}")
        print("-"*80 + "\n")

        return result

    except ImportError as e:
        print(f"⚠ PySAL implementation not available: {e}")
        print("→ Trying legacy implementation...\n")

        # Fall back to legacy
        from step_04_accessibility_analysis import AmenityAccessibilityService

        service = AmenityAccessibilityService()
        results, summary = service.analyze_citywide(
            categories=[category],
            metric=model if model == "hansen" else "distance",
            plot=plot,
        )

        print("\n" + "-"*80)
        print("RESULTS SUMMARY (Legacy)")
        print("-"*80)
        print(summary)
        print("-"*80 + "\n")

        return results


def test_accessibility_models():
    """Compare different accessibility models."""
    print("\n" + "="*80)
    print("COMPARING ACCESSIBILITY MODELS")
    print("="*80 + "\n")

    try:
        from step_04_accessibility_analysis import AccessibilityService
        import numpy as np

        service = AccessibilityService()

        print("Running models: hansen, 2sfca, e2sfca, cumulative\n")

        results = service.compare_models(
            category="healthcare_facilities",
            models=["hansen", "2sfca", "e2sfca", "cumulative"],
        )

        print("\n" + "-"*80)
        print("MODEL COMPARISON")
        print("-"*80)
        print(f"{'Model':<15} {'Mean':<10} {'Median':<10} {'Std Dev':<10} {'Min':<10} {'Max':<10}")
        print("-"*80)

        for model_name, result in results.items():
            scores = result.scores
            print(
                f"{model_name:<15} "
                f"{scores.mean():<10.2f} "
                f"{np.median(scores):<10.2f} "
                f"{scores.std():<10.2f} "
                f"{scores.min():<10.2f} "
                f"{scores.max():<10.2f}"
            )

        print("-"*80 + "\n")

        return results

    except ImportError as e:
        print(f"✗ PySAL-based models not available: {e}")
        print("  Install with: pip install h3 rtree scikit-learn\n")
        return None


def show_outputs():
    """Display information about pipeline outputs."""
    print("\n" + "="*80)
    print("PIPELINE OUTPUTS")
    print("="*80 + "\n")

    from core.config import Config
    config = Config()

    output_files = [
        ("Step 1: Geocoded Amenities", config.paths.amenities_geocoded_csv),
        ("Step 2: Classified Amenities", config.paths.amenities_with_priority_csv),
        ("Step 3: Road Network Mapping (Final Output)", config.paths.amenities_3layers_csv),
        ("Step 4: Accessibility Grid", config.paths.accessibility_grid_csv),
        ("Step 4: Planning Accessibility Scores", config.paths.accessibility_planning_csv),
        ("Step 5: Planning Composite Scores", config.paths.accessibility_fusion_planning_csv),
        ("Step 5: Subzone Composite Scores", config.paths.accessibility_fusion_subzone_csv),
    ]

    print("Expected Output Files:")
    print("-"*80)

    for name, path in output_files:
        exists = "✓" if path.exists() else "✗"
        size = f"{path.stat().st_size / 1024:.1f} KB" if path.exists() else "N/A"
        print(f"{exists} {name}")
        print(f"  Path: {path}")
        print(f"  Size: {size}")

        if path.exists() and path.suffix == ".csv":
            import pandas as pd
            try:
                df = pd.read_csv(path, nrows=0)
                print(f"  Columns: {len(df.columns)}")
                import subprocess
                rows = subprocess.check_output(["wc", "-l", str(path)]).decode().split()[0]
                print(f"  Rows: {int(rows) - 1:,}")
            except Exception as e:
                print(f"  Error reading: {e}")

        print()

    # Check for accessibility outputs
    print("\nAccessibility Analysis Outputs:")
    print("-"*80)

    output_dir = config.paths.accessibility_grid_csv.parent
    if output_dir.exists():
        geojson_files = list(output_dir.glob("accessibility_*.geojson"))
        png_files = list(output_dir.glob("accessibility_*.png"))

        print(f"GeoJSON files: {len(geojson_files)}")
        for f in geojson_files:
            size = f.stat().st_size / 1024
            print(f"  ✓ {f.name} ({size:.1f} KB)")

        print(f"\nVisualization files: {len(png_files)}")
        for f in png_files:
            size = f.stat().st_size / 1024
            print(f"  ✓ {f.name} ({size:.1f} KB)")

        if png_files:
            print(f"\n💡 View visualizations at: {output_dir}")
    else:
        print("No accessibility outputs found. Run pipeline with --steps 4")

    print()


def visualize_outputs():
    """Create visualizations of pipeline outputs."""
    print("\n" + "="*80)
    print("VISUALIZING OUTPUTS")
    print("="*80 + "\n")

    try:
        import geopandas as gpd
        import matplotlib.pyplot as plt
        from core.config import Config

        config = Config()
        output_dir = config.paths.accessibility_grid_csv.parent

        # Find accessibility GeoJSON files
        geojson_files = list(output_dir.glob("accessibility_*.geojson"))

        if not geojson_files:
            print("No accessibility outputs found.")
            print("Run: python run_pipeline.py --steps 4\n")
            return

        print(f"Found {len(geojson_files)} accessibility results\n")

        for geojson_file in geojson_files[:3]:  # Limit to first 3
            print(f"Visualizing: {geojson_file.name}")

            # Read data
            gdf = gpd.read_file(geojson_file)

            # Create plot
            fig, ax = plt.subplots(1, 1, figsize=(12, 10))

            gdf.plot(
                column="accessibility",
                cmap="YlOrRd",
                legend=True,
                ax=ax,
                edgecolor="none",
                alpha=0.7,
            )

            category = geojson_file.stem.replace("accessibility_", "").replace("_", " ").title()
            ax.set_title(f"Accessibility: {category}", fontsize=16, fontweight="bold")
            ax.set_axis_off()

            # Save
            output_png = geojson_file.with_suffix(".png")
            plt.tight_layout()
            plt.savefig(output_png, dpi=300, bbox_inches="tight")
            plt.close()

            print(f"  ✓ Saved: {output_png.name}\n")

        print(f"Visualizations saved to: {output_dir}\n")

    except ImportError as e:
        print(f"✗ Visualization failed: {e}")
        print("  Install: pip install matplotlib\n")


def check_dependencies():
    """Check if required dependencies are installed."""
    print("\n" + "="*80)
    print("DEPENDENCY CHECK")
    print("="*80 + "\n")

    dependencies = {
        "Core": [
            ("geopandas", "geopandas"),
            ("pandas", "pandas"),
            ("numpy", "numpy"),
            ("shapely", "shapely.geometry"),
        ],
        "Step 03 (OSMnx)": [
            ("osmnx", "osmnx"),
            ("networkx", "networkx"),
        ],
        "Step 04 (PySAL - New)": [
            ("h3", "h3"),
            ("rtree", "rtree"),
            ("scikit-learn", "sklearn"),
            ("scipy", "scipy"),
        ],
        "Optional": [
            ("pysal-access", "access"),
            ("matplotlib", "matplotlib"),
            ("seaborn", "seaborn"),
        ],
    }

    all_ok = True

    for category, deps in dependencies.items():
        print(f"{category}:")
        for name, import_name in deps:
            try:
                __import__(import_name)
                print(f"  ✓ {name}")
            except ImportError:
                print(f"  ✗ {name} (not installed)")
                all_ok = False
        print()

    if all_ok:
        print("✓ All dependencies installed!\n")
    else:
        print("⚠ Some dependencies missing. Install with:")
        print("  pip install osmnx h3 rtree scikit-learn scipy matplotlib\n")

    return all_ok


def main():
    parser = argparse.ArgumentParser(
        description="Amenities ETL Pipeline Test Runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    # Mode selection
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--full",
        action="store_true",
        help="Run full pipeline (all steps)",
    )
    mode_group.add_argument(
        "--quick",
        action="store_true",
        help="Quick accessibility test (single category)",
    )
    mode_group.add_argument(
        "--test-accessibility",
        action="store_true",
        help="Test new PySAL-based accessibility",
    )
    mode_group.add_argument(
        "--compare-models",
        action="store_true",
        help="Compare different accessibility models",
    )
    mode_group.add_argument(
        "--show-outputs",
        action="store_true",
        help="Show pipeline output files",
    )
    mode_group.add_argument(
        "--visualize",
        action="store_true",
        help="Create visualizations from outputs",
    )
    mode_group.add_argument(
        "--check-deps",
        action="store_true",
        help="Check dependencies",
    )

    # Pipeline options
    parser.add_argument(
        "--steps",
        nargs="+",
        type=int,
        choices=[1, 2, 3, 4],
        help="Run specific pipeline steps",
    )
    parser.add_argument(
        "--no-plot",
        action="store_true",
        help="Skip visualizations",
    )

    # Accessibility options
    parser.add_argument(
        "--category",
        type=str,
        default="healthcare_facilities",
        help="Amenity category for quick test",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="hansen",
        choices=["hansen", "2sfca", "e2sfca", "cumulative"],
        help="Accessibility model to use",
    )

    args = parser.parse_args()

    # Default to full pipeline if no mode specified
    if not any([
        args.full, args.quick, args.test_accessibility,
        args.compare_models, args.show_outputs, args.visualize,
        args.check_deps, args.steps
    ]):
        args.full = True

    # Execute based on mode
    if args.check_deps:
        check_dependencies()

    elif args.show_outputs:
        show_outputs()

    elif args.visualize:
        visualize_outputs()

    elif args.quick or args.test_accessibility:
        quick_accessibility_test(
            category=args.category,
            model=args.model,
            plot=not args.no_plot,
        )

    elif args.compare_models:
        test_accessibility_models()

    elif args.full or args.steps:
        run_full_pipeline(
            steps=args.steps,
            plot=not args.no_plot,
        )

    print("\n✓ Done!\n")


if __name__ == "__main__":
    main()
