#!/usr/bin/env python3
"""CLI to execute flood-aware amenity accessibility analysis and plots."""
from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path


def _find_repo_root(start: Path) -> Path:
    """Walk upwards until the directory containing the backend package is found."""
    for candidate in (start, *start.parents):
        if (candidate / "backend").is_dir():
            return candidate
    return start.parents[0]


ROOT = _find_repo_root(Path(__file__).resolve())
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

if "MPLCONFIGDIR" not in os.environ:
    mpl_cache = Path(tempfile.gettempdir()) / "mplconfig"
    mpl_cache.mkdir(parents=True, exist_ok=True)
    os.environ["MPLCONFIGDIR"] = str(mpl_cache)

from backend.etl.amenities.amenity_accessibility import AccessibilityPlotter
from backend.etl.floods.analysis.flood_aware_accessibility import (
    FloodAwareAccessibilityCalculator,
    FloodAwareAmenityAnalyzer,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run flood-aware amenity accessibility analysis with plotting."
    )
    parser.add_argument(
        "--categories",
        nargs="+",
        default=["essential_services"],
        help="Amenity categories to analyse (default: essential_services)",
    )
    parser.add_argument(
        "--resolution",
        type=int,
        default=8,
        help="Hexagon resolution (default: 8)",
    )
    parser.add_argument(
        "--flood-buffer",
        type=float,
        default=500.0,
        help="Buffer radius in metres around flood points (default: 500)",
    )
    parser.add_argument(
        "--flood-penalty-factor",
        type=float,
        default=1.5,
        help="Multiplier applied to travel distance when origins or amenities are flooded (default: 1.5)",
    )
    parser.add_argument(
        "--flood-exclusion",
        type=float,
        default=200.0,
        help="Distance (metres) inside which flooded amenities are treated as unavailable (default: 200)",
    )
    parser.add_argument(
        "--no-plot",
        action="store_true",
        help="Skip matplotlib visualisations and only print summary statistics.",
    )
    parser.add_argument(
        "--cmap",
        default="cividis",
        help="Matplotlib colormap for accessibility plots (default: cividis)",
    )
    parser.add_argument(
        "--scheme",
        default="quantiles",
        help="Classification scheme (requires mapclassify). Set to '' to disable (default: quantiles)",
    )
    parser.add_argument(
        "--quantiles",
        type=int,
        default=10,
        help="Number of classes when using a classification scheme (default: 10)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    scheme = args.scheme or None
    plotter = AccessibilityPlotter(cmap=args.cmap, scheme=scheme, quantiles=args.quantiles)
    calculator = FloodAwareAccessibilityCalculator(
        flood_penalty_factor=args.flood_penalty_factor,
        flood_exclusion_distance=args.flood_exclusion,
    )

    analyzer = FloodAwareAmenityAnalyzer(calculator=calculator, plotter=plotter)

    for category in args.categories:
        print(f"\n=== Flood-aware analysis for category: {category} ===")
        results = analyzer.analyze_flood_impact(
            category=category,
            resolution=args.resolution,
            flood_buffer=args.flood_buffer,
        )
        if not results:
            print("No results for this category. Check input data or category name.")
            continue

        print("Summary statistics:")
        print(results["summary_stats"].to_string(index=False))

        if not args.no_plot:
            analyzer.plot_flood_impact_comparison(results, category)


if __name__ == "__main__":
    main()
