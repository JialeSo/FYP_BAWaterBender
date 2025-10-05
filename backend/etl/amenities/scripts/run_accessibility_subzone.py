from pathlib import Path
import argparse
import os
import sys
import tempfile


def _find_repo_root(start: Path) -> Path:
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

from backend.etl.amenities.amenity_accessibility_subzone import (
    SubzoneAmenityAccessibilityService,
)
from backend.etl.amenities.amenity_accessibility import (
    DEFAULT_SUBZONE_CATEGORIES,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run subzone-only amenity accessibility analysis without category grid charts."
    )
    parser.add_argument(
        "--subzones",
        nargs="+",
        required=True,
        help="Planning area or subzone selectors (case-insensitive, fuzzy matching supported).",
    )
    parser.add_argument(
        "--subzone-categories",
        nargs="+",
        help="Amenity categories to include for subzone analysis (default: standard subzone categories).",
    )
    parser.add_argument(
        "--metric",
        choices=["hansen", "distance"],
        default="hansen",
        help="Accessibility metric to compute (default: hansen)",
    )
    parser.add_argument(
        "--plot",
        action="store_true",
        help="Render matplotlib subzone maps for each selector.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    categories = tuple(args.subzone_categories) if args.subzone_categories else DEFAULT_SUBZONE_CATEGORIES

    service = SubzoneAmenityAccessibilityService()

    for selector in args.subzones:
        matches = service.detect_subzone(selector)
        planning_names = ", ".join(sorted(matches["PLN_AREA_N"].dropna().unique())) or "Unknown"
        subzone_names = ", ".join(sorted(matches["SUBZONE_N"].dropna().unique())) or "Unknown"
        print(f"\nMatched planning areas for '{selector}': {planning_names}")
        print(f"Matched subzones: {subzone_names}")

        _, summary = service.analyze_single_subzone(
            selector,
            categories=categories,
            metric=args.metric,
            plot=args.plot,
        )

        print(f"\nAccessibility summary for selector '{selector}':")
        print(summary)


if __name__ == "__main__":
    main()
