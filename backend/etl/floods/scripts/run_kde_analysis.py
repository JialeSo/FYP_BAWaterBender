from pathlib import Path
import os
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[4]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

if "MPLCONFIGDIR" not in os.environ:
    mpl_cache = Path(tempfile.gettempdir()) / "mplconfig"
    mpl_cache.mkdir(parents=True, exist_ok=True)
    os.environ["MPLCONFIGDIR"] = str(mpl_cache)

from backend.etl.floods.analysis.kde_analysis import FloodKDEAnalyzer, KDEParameters


def main() -> None:
    analyzer = FloodKDEAnalyzer()

    params = KDEParameters(bandwidth_m=600.0, kernel="gaussian", grid_size=250, distance_unit="km")
    surface = analyzer.compute_surface(params)

    analyzer.plot_surface(
        surface,
        title=f"Flood KDE (bandwidth={params.bandwidth_m} m, kernel={params.kernel})",
        show=True,
    )

    stats = analyzer.clark_evans()
    print("Clark–Evans diagnostics:")
    for key, value in stats.items():
        print(f"  {key}: {value:.3f}")

    pa_summary = analyzer.summary_by_planning_area(surface).head(10)
    print("\nTop planning areas by flood intensity:")
    print(pa_summary)

    subzone_summary = analyzer.summary_by_subzone(surface, planning_filter="Woodlands").head(10)
    print("\nWoodlands subzones by flood intensity:")
    print(subzone_summary)

    road_summary = analyzer.summary_by_road(surface).head(10)
    print("\nRoad segments by flood intensity:")
    print(road_summary)


if __name__ == "__main__":
    main()
