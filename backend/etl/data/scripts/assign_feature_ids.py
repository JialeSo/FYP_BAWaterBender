"""Assign sequential feature identifiers to key GeoJSON datasets."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import geopandas as gpd


@dataclass(frozen=True)
class TargetFile:
    name: str
    path: Path
    prefix: str


TARGET_FILES: Iterable[TargetFile] = (
    TargetFile("planning_area", Path("backend/etl/data/planning_area.geojson"), "PA"),
    TargetFile("road_network", Path("backend/etl/data/road_network.geojson"), "RN"),
    TargetFile("subzone_area", Path("backend/etl/data/subzone_area.geojson"), "SZ"),
)


def assign_feature_ids(target: TargetFile) -> None:
    """Read a GeoJSON and assign a `feature_id` column with sequential IDs."""

    gdf = gpd.read_file(target.path)
    padding = max(2, len(str(len(gdf))))
    ids = [f"{target.prefix}_{idx+1:0{padding}d}" for idx in range(len(gdf))]

    gdf = gdf.copy()
    gdf["id"] = ids
    if "feature_id" in gdf.columns:
        gdf = gdf.drop(columns=["feature_id"])

    gdf.to_file(target.path, driver="GeoJSON")


def main() -> None:
    for target in TARGET_FILES:
        if not target.path.exists():
            raise FileNotFoundError(f"Missing target GeoJSON: {target.path}")
        assign_feature_ids(target)


if __name__ == "__main__":
    main()
