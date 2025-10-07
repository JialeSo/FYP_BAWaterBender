"""Command-line entry point for the flood-to-road segment matcher."""

from __future__ import annotations

import argparse
import sys
from dataclasses import replace
from pathlib import Path
import matplotlib.pyplot as plt
import geopandas as gpd
from matplotlib.patches import Patch

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:  # ensure project imports work when executed directly
    sys.path.append(str(REPO_ROOT))

from backend.etl.flood_road_segment_matching import (  # noqa: E402
    FloodRoadMatchResults,
    FloodRoadMatchingConfig,
    FloodRoadSegmentMatcher,
)

# Add this function after the existing helper functions
def _create_visualization(
    results: FloodRoadMatchResults,
    output_dir: Path,
    *,
    basemap_path: Path | None = None,
) -> None:
    """Create and save visualization plots of the matched segments."""
    if results.matched.empty:
        print("No matched results to visualize")
        return

    # Convert to GeoDataFrame if not already
    if hasattr(results.matched, 'geometry'):
        gdf = results.matched
    else:
        # Assume segment_geom column contains the geometry
        gdf = gpd.GeoDataFrame(results.matched, geometry='segment_geom')
    
    # Align CRS with basemap if provided
    basemap_gdf = None
    if basemap_path and basemap_path.exists():
        basemap_gdf = gpd.read_file(basemap_path)
        if basemap_gdf.crs is None:
            basemap_gdf = basemap_gdf.set_crs(gdf.crs or "EPSG:4326")
        elif gdf.crs and basemap_gdf.crs != gdf.crs:
            basemap_gdf = basemap_gdf.to_crs(gdf.crs)
        elif not gdf.crs and basemap_gdf.crs:
            gdf = gdf.set_crs(basemap_gdf.crs)

    # Create the plot
    fig, ax = plt.subplots(1, 1, figsize=(15, 15))

    if basemap_gdf is not None:
        # Plot the Singapore base map boundary beneath the segments
        basemap_gdf.boundary.plot(ax=ax, color='lightgray', linewidth=0.8, alpha=0.6, label='Singapore outline')

    # Plot road segments
    gdf.plot(ax=ax, color='red', linewidth=2, alpha=0.7, label='Flood-affected road segments')
    
    # Plot start/end points if available
    if 'start_on_line_geom' in gdf.columns:
        start_points = gdf['start_on_line_geom'].dropna()
        if not start_points.empty:
            start_gdf = gpd.GeoDataFrame(geometry=start_points)
            start_gdf.plot(ax=ax, color='green', markersize=50, alpha=0.8, label='Start points')
    
    if 'end_on_line_geom' in gdf.columns:
        end_points = gdf['end_on_line_geom'].dropna()
        if not end_points.empty:
            end_gdf = gpd.GeoDataFrame(geometry=end_points)
            end_gdf.plot(ax=ax, color='blue', markersize=50, alpha=0.8, label='End points')
    
    # Styling
    ax.set_title('Flood-Affected Road Segments', fontsize=16, fontweight='bold')
    ax.set_xlabel('Longitude')
    ax.set_ylabel('Latitude')
    ax.grid(True, alpha=0.3)
    ax.set_aspect('equal', adjustable='datalim')
    ax.legend()

    # Save the plot
    plot_path = output_dir / "flood_road_segments_visualization.png"
    plt.savefig(plot_path, dpi=300, bbox_inches='tight')
    print(f"Visualization saved to: {plot_path}")
    
    # Show the plot if running interactively
    plt.show()

def _resolve_output_path(config: FloodRoadMatchingConfig, output: Path | None, fmt: str) -> Path:
    if output:
        return output
    extension = "geojson" if fmt == "geojson" else "parquet"
    return config.roads_path.parent / f"flood_road_segments.{extension}"


def _resolve_unmatched_path(config: FloodRoadMatchingConfig, output: Path | None) -> Path:
    if output:
        return output
    return config.roads_path.parent / "flood_road_segments_unmatched.csv"


def _write_results(results: FloodRoadMatchResults, output_path: Path, fmt: str) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if fmt == "geojson":
        results.save_matched(output_path)
    elif fmt == "parquet":
        results.matched.to_parquet(output_path, index=False)
    else:  # pragma: no cover - safeguarded by argparse choices
        raise ValueError(f"Unsupported output format: {fmt}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Match PUB flood alerts to road network segments")
    parser.add_argument("--roads", type=Path, help="Path to the road network GeoJSON")
    parser.add_argument("--floods", type=Path, help="Path to the floods CSV input")
    parser.add_argument(
        "--plot",
        action="store_true",
        help="Generate and save visualization plots"
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Destination for matched segments (default: data/flood_road_segments.geojson)",
    )
    parser.add_argument(
        "--unmatched-output",
        type=Path,
        help="Optional CSV path for unmatched diagnostics (default: data/flood_road_segments_unmatched.csv)",
    )
    parser.add_argument(
        "--output-format",
        choices=("geojson", "parquet"),
        default="geojson",
        help="File format used when writing matched segments",
    )
    parser.add_argument(
        "--max-records",
        type=int,
        default=None,
        help="Optional limit on the number of matched rows to persist",
    )
    args = parser.parse_args()

    default_config = FloodRoadMatchingConfig()
    resolved_config = replace(
        default_config,
        roads_path=args.roads if args.roads else default_config.roads_path,
        floods_path=args.floods if args.floods else default_config.floods_path,
    )

    matcher = FloodRoadSegmentMatcher(resolved_config)
    results = matcher.run()

    if args.max_records is not None:
        results = FloodRoadMatchResults(
            matched=results.matched.head(args.max_records),
            unmatched=results.unmatched,
        )

    output_path = _resolve_output_path(resolved_config, args.output, args.output_format)
    _write_results(results, output_path, args.output_format)

    unmatched_path = _resolve_unmatched_path(resolved_config, args.unmatched_output)
    if not results.unmatched.empty:
        unmatched_path.parent.mkdir(parents=True, exist_ok=True)
        results.save_unmatched(unmatched_path)

    print(
        "Flood road segment matching complete.\n"
        f"  Matched records: {len(results.matched)}\n"
        f"  Unmatched diagnostics written: {len(results.unmatched)}\n"
        f"  Matched segments saved to: {output_path}",
    )
    if not results.unmatched.empty:
        print(f"  Unmatched summary saved to: {unmatched_path}")
    if args.plot:
        output_dir = output_path.parent
        basemap_path = resolved_config.roads_path.parent / "planning_area.geojson"
        if not basemap_path.exists():
            basemap_path = None
        _create_visualization(results, output_dir, basemap_path=basemap_path)


if __name__ == "__main__":  # pragma: no cover - script entry point
    main()
