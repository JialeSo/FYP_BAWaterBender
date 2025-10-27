"""Configuration helpers for the amenities ETL pipeline."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass
class AmenityPaths:
    """Filesystem layout used by the amenities ETL stages."""

    # project_root points to FYP_BAWaterBender/ (4 levels up from config.py)
    project_root: Path = Path(__file__).resolve().parents[4]
    # data_dir is within backend/etl/data
    data_dir: Path = project_root / "backend" / "etl" / "data"

    raw_amenities_csv: Path = data_dir / "amenities_consolidated.geojson"
    consolidated_geojson: Path = data_dir / "amenities_consolidated.geojson"
    amenities_geocoded_csv: Path = data_dir / "01_amenities_geocoded.csv"
    amenities_with_priority_csv: Path = data_dir / "02_amenities_classified.csv"
    # Final output after Step 3 (includes road network mapping with renamed columns)
    amenities_3layers_csv: Path = project_root / "frontend" / "public" / "map" / "amenities_3layers.csv"
    amenities_final_csv: Path = project_root / "frontend" / "public" / "map" / "amenities_3layers.csv"
    # Also keep a copy under backend data directory
    amenities_3layers_data_csv: Path = data_dir / "amenities" / "amenities_3layers.csv"

    accessibility_grid_csv: Path = data_dir / "amenities" / "accessibility_grid.geojson"
    accessibility_planning_csv: Path = data_dir / "04_accessibility_planning.csv"
    accessibility_subzone_csv: Path = data_dir / "04_accessibility_subzone.csv"
    accessibility_fusion_planning_csv: Path = data_dir / "05_accessibility_planning_fusion.csv"
    accessibility_fusion_subzone_csv: Path = data_dir / "05_accessibility_subzone_fusion.csv"
    amenities_enriched_csv: Path = data_dir / "amenities" / "amenities_accessibility_enriched.csv"

    planning_areas_geojson: Path = data_dir / "geojson" / "planning_area.geojson"
    subzones_geojson: Path = data_dir / "geojson" / "subzone_area.geojson"
    road_network_geojson: Path = data_dir / "roadnetwork" / "road_network_final.geojson"
    postal_codes_csv: Path = data_dir / "onemap" / "onemap_postal_codes.csv"

    accessibility_output_dir: Path = data_dir / "amenities"


class Config:
    """Simple container exposing filesystem paths used by pipeline steps."""

    def __init__(self, paths: AmenityPaths | None = None) -> None:
        self.paths = paths or AmenityPaths()

    def copy(self, *, paths: AmenityPaths | None = None) -> "Config":
        """Return a shallow copy with optional path overrides."""

        return Config(paths=paths or self.paths)


__all__ = ["AmenityPaths", "Config"]
