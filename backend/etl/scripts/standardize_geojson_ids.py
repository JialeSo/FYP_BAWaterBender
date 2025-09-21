"""Standardize GeoJSON identifiers and attach hierarchical references.

This script normalizes the `id` fields across the planning area, subzone, and
road network GeoJSON layers so that:

* Planning areas receive sequential numeric IDs.
* Subzones receive sequential numeric IDs and inherit their parent planning area ID.
* Road network features receive sequential numeric IDs and inherit both their
  parent subzone ID and planning area ID via spatial lookup.

The script overwrites the input GeoJSON files in place by default.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

from numbers import Integral

from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree

ID_PAD_WIDTH = 6

PLANNING_AREA_PATH = Path(__file__).resolve().parents[1] / "data" / "planning_area.geojson"
SUBZONE_PATH = Path(__file__).resolve().parents[1] / "data" / "subzone_area.geojson"
ROAD_NETWORK_PATH = Path(__file__).resolve().parents[1] / "data" / "road_network.geojson"


def load_geojson(path: Path) -> Dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_geojson(data: Dict, path: Path) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def assign_planning_area_ids(planning_data: Dict) -> Dict[str, str]:
    """Assign sequential IDs to planning areas and return lookup by name."""

    name_to_id: Dict[str, str] = {}
    for idx, feature in enumerate(planning_data.get("features", []), start=1):
        feature_id_int = idx
        feature_id = str(feature_id_int).zfill(ID_PAD_WIDTH)
        props = feature.setdefault("properties", {})
        props.pop("id", None)
        props.pop("planning_area_id", None)
        props["PA_ID"] = feature_id
        name = props.get("PLN_AREA_N")
        if name:
            name_to_id[name.upper()] = feature_id
    return name_to_id


def assign_subzone_ids(subzone_data: Dict, planning_lookup: Dict[str, str]) -> Tuple[Dict[str, str], List[BaseGeometry]]:
    """Assign sequential IDs to subzones and attach planning area references."""

    subzone_geoms: List[BaseGeometry] = []
    subzone_id_lookup: Dict[str, str] = {}

    for idx, feature in enumerate(subzone_data.get("features", []), start=1):
        feature_id_int = idx
        feature_id = str(feature_id_int).zfill(ID_PAD_WIDTH)
        props = feature.setdefault("properties", {})
        props.pop("id", None)
        props.pop("subzone_id", None)
        props.pop("planning_area_id", None)
        props["SZ_ID"] = feature_id

        planning_name = props.get("PLN_AREA_N")
        planning_id = None
        if planning_name:
            planning_id = planning_lookup.get(planning_name.upper())
        if planning_id is not None:
            props["PA_ID"] = planning_id
        else:
            props["PA_ID"] = None

        subzone_name = props.get("SUBZONE_N")
        if subzone_name:
            subzone_id_lookup[subzone_name.upper()] = feature_id

        geometry = feature.get("geometry")
        subzone_geoms.append(shape(geometry) if geometry else None)

    return subzone_id_lookup, subzone_geoms


def build_subzone_spatial_index(
    subzone_geoms: Iterable[BaseGeometry],
) -> Tuple[STRtree | None, List[BaseGeometry], List[int], Dict[int, int]]:
    """Create a spatial index for subzone geometries.

    Returns the STRtree, alongside parallel lists of geometries and their
    corresponding indices into the original subzone feature list. This works for
    both Shapely 1.x (returns geometry objects) and Shapely 2.x (returns integer
    indexes) when querying the STRtree.
    """

    geometries: List[BaseGeometry] = []
    feature_indexes: List[int] = []
    geom_lookup: Dict[int, int] = {}

    for idx, geom in enumerate(subzone_geoms):
        if geom is None or geom.is_empty:
            continue
        geometries.append(geom)
        feature_indexes.append(idx)
        geom_lookup[id(geom)] = len(geometries) - 1

    if not geometries:
        return None, [], [], {}

    tree = STRtree(geometries)
    return tree, geometries, feature_indexes, geom_lookup


def assign_road_network_ids(
    road_data: Dict,
    subzone_data: Dict,
    subzone_geoms: List[BaseGeometry],
    subzone_lookup: Dict[str, str],
) -> None:
    """Assign IDs to road network features and inherit subzone/planning IDs."""

    tree, indexed_geoms, feature_indexes, geom_lookup = build_subzone_spatial_index(subzone_geoms)
    subzone_features = subzone_data.get("features", [])

    for feature in road_data.get("features", []):
        props = feature.setdefault("properties", {})
        props.pop("id", None)
        props.pop("road_network_id", None)
        props.pop("subzone_id", None)
        props.pop("planning_area_id", None)

        unique_id = props.get("UNIQUE_ID")
        rn_id = str(unique_id).zfill(ID_PAD_WIDTH) if unique_id is not None else None
        props["RN_ID"] = rn_id

        geom = feature.get("geometry")
        shapely_geom = shape(geom) if geom else None

        matched_subzone_id = None
        matched_planning_id = None

        if shapely_geom and tree:
            candidates = tree.query(shapely_geom)
            best_overlap = 0.0
            best_subzone_feature_idx = None

            for candidate in candidates:
                if isinstance(candidate, BaseGeometry):
                    candidate_idx = geom_lookup.get(id(candidate))
                    if candidate_idx is None:
                        continue
                    candidate_geom = candidate
                elif isinstance(candidate, Integral):
                    candidate_idx = int(candidate)
                    if candidate_idx >= len(indexed_geoms):
                        continue
                    candidate_geom = indexed_geoms[candidate_idx]
                else:
                    continue

                overlap = candidate_geom.intersection(shapely_geom).length
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_subzone_feature_idx = feature_indexes[candidate_idx]

            if best_subzone_feature_idx is not None:
                subzone_feature = subzone_features[best_subzone_feature_idx]
                subzone_props = subzone_feature.get("properties", {})
                matched_subzone_id = subzone_props.get("SZ_ID")
                matched_planning_id = subzone_props.get("PA_ID")

        props["SZ_ID"] = matched_subzone_id
        props["PA_ID"] = matched_planning_id


def standardize_ids(
    planning_path: Path,
    subzone_path: Path,
    road_path: Path,
) -> None:
    planning_data = load_geojson(planning_path)
    subzone_data = load_geojson(subzone_path)
    road_data = load_geojson(road_path)

    planning_lookup = assign_planning_area_ids(planning_data)
    subzone_lookup, subzone_geoms = assign_subzone_ids(subzone_data, planning_lookup)
    assign_road_network_ids(road_data, subzone_data, subzone_geoms, subzone_lookup)

    save_geojson(planning_data, planning_path)
    save_geojson(subzone_data, subzone_path)
    save_geojson(road_data, road_path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Standardize GeoJSON IDs and add hierarchy metadata")
    parser.add_argument("--planning-area", type=Path, default=PLANNING_AREA_PATH, help="Path to planning area GeoJSON")
    parser.add_argument("--subzone-area", type=Path, default=SUBZONE_PATH, help="Path to subzone GeoJSON")
    parser.add_argument("--road-network", type=Path, default=ROAD_NETWORK_PATH, help="Path to road network GeoJSON")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    standardize_ids(args.planning_area, args.subzone_area, args.road_network)
    print("Standardized IDs for planning area, subzone, and road network layers.")


if __name__ == "__main__":
    main()
