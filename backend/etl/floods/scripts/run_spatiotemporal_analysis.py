"""CLI for the spatiotemporal flood analyzer."""

from __future__ import annotations

from pathlib import Path
import argparse
import os
import sys
import tempfile

import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[4]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

if "MPLCONFIGDIR" not in os.environ:
    mpl_cache = Path(tempfile.gettempdir()) / "mplconfig"
    mpl_cache.mkdir(parents=True, exist_ok=True)
    os.environ["MPLCONFIGDIR"] = str(mpl_cache)

from backend.etl.floods.analysis.spatiotemporal_floods import (
    SpatiotemporalFloodAnalyzer,
    SingaporeFloodData,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run spatiotemporal KDE for Singapore floods")
    parser.add_argument("--years", nargs="*", type=int, help="Specific years to include in KDE plots")
    parser.add_argument(
        "--recent",
        type=int,
        help="Number of most recent years to plot if --years is not specified (default: all years)",
    )
    parser.add_argument(
        "--space-bandwidth",
        type=float,
        default=800.0,
        help="Spatial bandwidth in metres",
    )
    parser.add_argument(
        "--time-bandwidth",
        type=float,
        default=1.0,
        help="Temporal bandwidth in years",
    )
    parser.add_argument(
        "--grid-size",
        type=int,
        default=120,
        help="Number of grid cells per axis for KDE evaluation",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Directory to save generated figures (omit to display interactively)",
    )
    parser.add_argument(
        "--no-facets",
        action="store_true",
        help="Skip the per-year point facet plot",
    )
    parser.add_argument(
        "--no-kde",
        action="store_true",
        help="Skip KDE plotting",
    )
    parser.add_argument(
        "--export-kde-grid",
        action="store_true",
        help="Export KDE grids for each year as geospatial files",
    )
    parser.add_argument(
        "--kde-format",
        choices=["geojson", "gpkg", "parquet"],
        default="geojson",
        help="File format to use when exporting KDE grids",
    )
    parser.add_argument(
        "--export-summary",
        action="store_true",
        help="Write summary tables (per-year and per-planning-area) to CSV",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    data = SingaporeFloodData()
    analyzer = SpatiotemporalFloodAnalyzer(
        data=data,
        space_bandwidth=args.space_bandwidth,
        time_bandwidth=args.time_bandwidth,
        grid_size=(args.grid_size, args.grid_size),
    )

    floods = analyzer.floods
    points_ax = analyzer.plot_points()

    all_years = sorted(floods["year"].unique())
    if args.years:
        years = sorted(set(args.years))
    elif args.recent is None or args.recent <= 0:
        years = all_years
    else:
        years = all_years[-args.recent :]

    facets_fig = None
    if not args.no_facets:
        facets_fig = analyzer.plot_points_by_year()

    kde_fig = None
    if not args.no_kde:
        kde_fig = analyzer.plot_kde(years)

    if args.export_kde_grid or args.export_summary:
        if not args.output_dir:
            raise ValueError("--output-dir is required when exporting data products")

    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        points_ax.figure.savefig(args.output_dir / "flood_points.png", dpi=300)
        if facets_fig is not None:
            facets_fig.savefig(args.output_dir / "flood_points_by_year.png", dpi=300)
        if kde_fig is not None:
            kde_fig.savefig(args.output_dir / "flood_kde.png", dpi=300)

        if args.export_kde_grid:
            grids_dir = args.output_dir / "kde_grids"
            grids_dir.mkdir(parents=True, exist_ok=True)
            for year in years:
                gdf = analyzer.kde_geodataframe(year)
                if args.kde_format == "geojson":
                    gdf.to_file(grids_dir / f"kde_{year}.geojson", driver="GeoJSON")
                elif args.kde_format == "gpkg":
                    gdf.to_file(grids_dir / f"kde_{year}.gpkg", layer="kde", driver="GPKG")
                else:
                    try:
                        gdf.to_parquet(grids_dir / f"kde_{year}.parquet")
                    except (ImportError, ModuleNotFoundError, ValueError) as exc:
                        raise RuntimeError(
                            "Parquet export requires either 'pyarrow' or 'fastparquet'. "
                            "Please install one of those packages before using --kde-format parquet."
                        ) from exc

        if args.export_summary:
            summary_dir = args.output_dir / "summaries"
            summary_dir.mkdir(parents=True, exist_ok=True)
            analyzer.summary_by_year().to_csv(summary_dir / "flood_summary_year.csv", index=False)
            analyzer.summary_by_planning_area().to_csv(
                summary_dir / "flood_summary_planning_area.csv",
                index=False,
            )
    else:
        plt.show()


if __name__ == "__main__":
    main()
