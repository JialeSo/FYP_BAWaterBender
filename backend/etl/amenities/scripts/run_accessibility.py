from pathlib import Path
import argparse
import os
import sys
import tempfile

# Ensure the repository root is importable when running as a script
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

from backend.etl.amenities.amenity_accessibility_all import (
    AmenityAccessibilityAnalyzer,
    DEFAULT_SINGAPORE_CATEGORIES,
    DEFAULT_WOODLANDS_CATEGORIES,
    SubzoneAccessibilityAnalyzer,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run amenity accessibility analysis.")
    parser.add_argument(
        "--resolution",
        type=int,
        default=8,
        help="Hexagon resolution for accessibility calculation (default: 8)",
    )
    parser.add_argument(
        "--plot",
        action="store_true",
        help="Render matplotlib figures for each analysis step.",
    )
    parser.add_argument(
        "--subzones",
        nargs="+",
        default=["Woodlands"],
        help="One or more planning area names (case-insensitive substring match) for subzone analysis.",
    )
    parser.add_argument(
        "--sg-categories",
        nargs="+",
        help="Override the default island-wide amenity categories.",
    )
    parser.add_argument(
        "--subzone-categories",
        nargs="+",
        help="Override the default subzone amenity categories.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    analyzer = AmenityAccessibilityAnalyzer()

    sg_categories = (
        tuple(args.sg_categories)
        if args.sg_categories
        else DEFAULT_SINGAPORE_CATEGORIES
    )

    _, summary = analyzer.analyze_categories(
        sg_categories,
        resolution=args.resolution,
        plot=args.plot,
    )
    print("Singapore accessibility summary (planning area join included):")
    print(summary)

    subzone_categories = (
        tuple(args.subzone_categories)
        if args.subzone_categories
        else DEFAULT_WOODLANDS_CATEGORIES
    )

    subzone_analyzer = SubzoneAccessibilityAnalyzer(analyzer)
    for subzone in args.subzones:
        _, sub_summary = subzone_analyzer.analyze_categories(
            subzone_categories,
            subzone_name_filter=subzone,
            resolution=args.resolution,
            plot=args.plot,
        )
        print(f"\n{subzone} subzone accessibility summary across categories:")
        print(sub_summary)


if __name__ == "__main__":
    main()
