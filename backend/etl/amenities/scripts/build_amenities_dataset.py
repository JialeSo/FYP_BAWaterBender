#!/usr/bin/env python3
"""End-to-end amenities dataset builder.

This script consolidates the amenities ETL steps into a single entry point:

1. Load the latest baseline `amenities_3layers.csv` (preferring the backend copy,
   falling back to the frontend map asset).
2. Drop legacy rows for amenity types that will be rebuilt (`parkfacilities`,
   `preschools`, `tourist_attractions`, `hdb_buildings`, `hdb_points_shp`).
3. Extract fresh features from the source GeoJSON layers, cleaning HTML
   descriptions, deriving coordinates, planning/subzone IDs, and nearest road
   metadata.
4. Append the enriched rows and fill missing amenity names via the
   `onemap_postal_codes.csv` reference.
5. Persist the final, ordered dataset back to
   `backend/etl/data/amenities_3layers.csv` and mirror it to the frontend copy
   if present.

Running this script is the only step required to regenerate the consolidated
amenities dataset. No auxiliary CSV artefacts are produced.
"""

from __future__ import annotations

import html
import json
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class DatasetConfig:
    amenity_type: str
    filename: str
    name_keys: Tuple[str, ...]
    postal_keys: Tuple[str, ...] = ()


DATASETS: Tuple[DatasetConfig, ...] = (
    DatasetConfig(
        amenity_type="parkfacilities",
        filename="ParkFacilities.geojson",
        name_keys=("NAME", "Name", "CLASS", "CLASS_DESC"),
    ),
    DatasetConfig(
        amenity_type="preschools",
        filename="PreSchoolsLocation.geojson",
        name_keys=("CENTRE_NAME", "Name"),
    ),
    DatasetConfig(
        amenity_type="tourist_attractions",
        filename="TouristAttractions.geojson",
        name_keys=("PAGETITLE", "Name"),
        postal_keys=("POSTALCODE",),
    ),
)

REPLACE_TYPES = {cfg.amenity_type for cfg in DATASETS}
ADDITIONAL_REMOVALS = {"hdb_buildings", "hdb_points_shp"}

DESCRIPTION_PATTERN = re.compile(
    r"<tr[^>]*>\s*<th[^>]*>([^<]*)</th>\s*<td[^>]*>(.*?)</td>\s*</tr>",
    re.IGNORECASE | re.DOTALL,
)

AMENITY_CATEGORY_MAP: Dict[str, Tuple[str, float, float]] = {
    "parkfacilities": ("community_spaces", 4.0, 2.0),
    "preschools": ("education_institutions", 2.0, 4.0),
    "tourist_attractions": ("tourism", 5.0, 1.0),
}

IMPORTANCE_LABEL_BINS = [1, 2, 3, 5, 8, 25]
IMPORTANCE_LABELS = ["Negligible", "Low", "Moderate", "High", "Critical"]

OUTPUT_COLUMNS = [
    "amenity_id",
    "amenity_type",
    "amenity_name",
    "road_name",
    "postal_code",
    "geom_type",
    "lon",
    "lat",
    "source_file",
    "Shape__Area",
    "Shape__Length",
    "geometry_wkt",
    "geometry_geojson",
    "amenity_category",
    "amenity_priority",
    "amenity_weight",
    "importance_score",
    "importance_label",
    "planning_area",
    "subzone",
    "geometry_type",
    "geometry_coordinates",
    "nearest_road_1_id",
    "nearest_road_1_name",
    "nearest_road_2_id",
    "nearest_road_2_name",
    "nearest_road_3_id",
    "nearest_road_3_name",
    "nearest_road_4_id",
    "nearest_road_4_name",
    "amenity_planning_area_id",
    "amenity_subzone_id",
    "nearest_road_1_rn_id",
    "nearest_road_1_planning_area_id",
    "nearest_road_1_subzone_id",
    "nearest_road_2_rn_id",
    "nearest_road_2_planning_area_id",
    "nearest_road_2_subzone_id",
    "nearest_road_3_rn_id",
    "nearest_road_3_planning_area_id",
    "nearest_road_3_subzone_id",
    "nearest_road_4_rn_id",
    "nearest_road_4_planning_area_id",
    "nearest_road_4_subzone_id",
]

IDENTIFIER_COLUMNS = [
    "amenity_planning_area_id",
    "amenity_subzone_id",
    "nearest_road_1_id",
    "nearest_road_1_rn_id",
    "nearest_road_1_planning_area_id",
    "nearest_road_1_subzone_id",
    "nearest_road_2_id",
    "nearest_road_2_rn_id",
    "nearest_road_2_planning_area_id",
    "nearest_road_2_subzone_id",
    "nearest_road_3_id",
    "nearest_road_3_rn_id",
    "nearest_road_3_planning_area_id",
    "nearest_road_3_subzone_id",
    "nearest_road_4_id",
    "nearest_road_4_rn_id",
    "nearest_road_4_planning_area_id",
    "nearest_road_4_subzone_id",
]

# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------


def repo_root(start: Path) -> Path:
    for candidate in (start, *start.parents):
        if (candidate / "backend").is_dir():
            return candidate
    raise RuntimeError("Could not determine repository root")


def parse_description(description: Any) -> Tuple[str, Dict[str, str]]:
    if not isinstance(description, str) or not description.strip():
        return "", {}

    pairs: List[Tuple[str, str]] = []
    for key_raw, value_raw in DESCRIPTION_PATTERN.findall(description):
        key = html.unescape(key_raw).strip()
        value = html.unescape(value_raw).strip()
        if key:
            pairs.append((key, value))

    if not pairs:
        text = re.sub(r"<[^>]+>", "", description)
        return text.strip(), {}

    lines = [f"{k}: {v}" if v else f"{k}:" for k, v in pairs]
    mapping = {k: v for k, v in pairs if v}
    return "\n".join(lines), mapping


def compute_importance_label(score: Optional[float]) -> Optional[str]:
    if score is None or np.isnan(score):
        return None
    series = pd.cut(
        pd.Series([score]),
        bins=IMPORTANCE_LABEL_BINS,
        labels=IMPORTANCE_LABELS,
    )
    value = series.iloc[0]
    return None if pd.isna(value) else str(value)


def as_int_or_none(value: Any) -> Optional[int]:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def pick_first(values: Iterable[Optional[str]]) -> Optional[str]:
    for value in values:
        if value and str(value).strip():
            return str(value).strip()
    return None


def lookup_category(amenity_type: str) -> Tuple[str, float, float]:
    if amenity_type not in AMENITY_CATEGORY_MAP:
        raise KeyError(f"No category mapping for {amenity_type}")
    return AMENITY_CATEGORY_MAP[amenity_type]


def load_geojson_features(path: Path) -> List[Dict[str, Any]]:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    return data.get("features", [])


def derive_point_geometry(geometry: Dict[str, Any]) -> Tuple[BaseGeometry, float, float, str, str, str]:
    geom = shape(geometry)
    if geom.geom_type != "Point":
        geom = geom.centroid
    lon = float(geom.x)
    lat = float(geom.y)
    return (
        geom,
        lon,
        lat,
        geom.wkt,
        json.dumps(geometry),
        geometry.get("type", geom.geom_type),
    )


def normalize_coordinates(coords: Any) -> str:
    return json.dumps(coords)


def enrich_location(point_proj: BaseGeometry, planning_gdf: gpd.GeoDataFrame, subzone_gdf: gpd.GeoDataFrame) -> Tuple[Optional[str], Optional[int], Optional[str], Optional[int]]:
    planning_area = None
    planning_area_id = None
    matches = planning_gdf[planning_gdf.contains(point_proj)]
    if not matches.empty:
        planning_area = matches.iloc[0].get("PLN_AREA_N")
        planning_area_id = as_int_or_none(matches.iloc[0].get("PA_ID"))

    subzone = None
    subzone_id = None
    matches = subzone_gdf[subzone_gdf.contains(point_proj)]
    if not matches.empty:
        subzone = matches.iloc[0].get("SUBZONE_N")
        subzone_id = as_int_or_none(matches.iloc[0].get("SZ_ID"))

    return planning_area, planning_area_id, subzone, subzone_id


def nearest_roads(
    point_proj: BaseGeometry,
    roads_gdf: gpd.GeoDataFrame,
    roads_sindex,
    k: int = 4,
) -> List[Dict[str, Any]]:
    if roads_sindex is not None:
        candidate_idx: set[int] = set()
        radius = 50.0
        max_radius = 5000.0
        while len(candidate_idx) < k and radius <= max_radius:
            buffer_geom = point_proj.buffer(radius)
            candidate_idx.update(roads_sindex.query(buffer_geom))
            radius *= 2

        if not candidate_idx:
            candidate_idx = set(range(len(roads_gdf)))

        subset = roads_gdf.iloc[list(candidate_idx)].copy()
        subset["_dist"] = subset.geometry.distance(point_proj)
        nearest = subset.nsmallest(k, "_dist")
    else:
        distances = roads_gdf.geometry.distance(point_proj)
        nearest = roads_gdf.assign(_dist=distances).nsmallest(k, "_dist")

    results: List[Dict[str, Any]] = []
    for _, row in nearest.iterrows():
        results.append(
            {
                "id": as_int_or_none(row.get("UNIQUE_ID")),
                "name": row.get("RD_NAME"),
                "rn_id": as_int_or_none(row.get("RN_ID")),
                "pa_id": as_int_or_none(row.get("PA_ID")),
                "sz_id": as_int_or_none(row.get("SZ_ID")),
            }
        )

    while len(results) < k:
        results.append({"id": None, "name": None, "rn_id": None, "pa_id": None, "sz_id": None})
    return results


def clean_properties(props: Dict[str, Any], description_attrs: Dict[str, str], config: DatasetConfig) -> Tuple[Optional[str], Optional[str]]:
    name = pick_first(description_attrs.get(k) for k in config.name_keys)
    if not name:
        name = pick_first(props.get(k) for k in config.name_keys)

    postal = pick_first(description_attrs.get(k) for k in config.postal_keys)
    if not postal:
        postal = pick_first(props.get(k) for k in config.postal_keys)

    return name, postal


def load_onemap_mapping(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    df = pd.read_csv(path, dtype={"POSTAL": str})
    if df.empty:
        return {}

    def pick_name(row: pd.Series) -> Optional[str]:
        for key in ("AMENITY_NAME", "BUILDING", "ADDRESS"):
            value = row.get(key)
            if isinstance(value, str):
                cleaned = value.strip()
                if cleaned:
                    return cleaned
        return None

    df["POSTAL"] = df["POSTAL"].astype(str).str.strip().str.zfill(6)
    df["selected_name"] = df.apply(pick_name, axis=1)
    df = df.dropna(subset=["selected_name"]).drop_duplicates("POSTAL", keep="first")
    return df.set_index("POSTAL")["selected_name"].to_dict()


def normalize_postal_code(value: Any) -> Optional[str]:
    if pd.isna(value):
        return None
    if isinstance(value, str):
        digits = "".join(ch for ch in value if ch.isdigit())
        return digits.zfill(6)[-6:] if digits else None
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return None
    return f"{number:06d}"[-6:]


def fill_amenity_names_from_onemap(df: pd.DataFrame, mapping: Dict[str, str]) -> int:
    if not mapping or "amenity_name" not in df.columns or "postal_code" not in df.columns:
        return 0

    postal_series = df["postal_code"].apply(normalize_postal_code)
    missing_mask = df["amenity_name"].isna()
    candidates = postal_series.map(mapping)
    fill_mask = missing_mask & candidates.notna()
    df.loc[fill_mask, "amenity_name"] = candidates[fill_mask]
    return int(fill_mask.sum())


def pad_identifier_columns(df: pd.DataFrame, columns: Iterable[str]) -> pd.DataFrame:
    def pad_value(value: Any) -> Optional[str]:
        if pd.isna(value):
            return None
        text = str(value).strip()
        if not text:
            return None
        if text.isdigit():
            digits = text
        else:
            try:
                digits = str(int(float(text)))
            except (TypeError, ValueError):
                digits = "".join(ch for ch in text if ch.isdigit())
        if not digits:
            return None
        return digits.zfill(6)[-6:]

    for column in columns:
        if column in df.columns:
            df[column] = df[column].apply(pad_value).astype("string")
    return df


# ---------------------------------------------------------------------------
# Main ETL pipeline
# ---------------------------------------------------------------------------


def build_new_records(
    configs: Iterable[DatasetConfig],
    geojson_dir: Path,
    planning_gdf: gpd.GeoDataFrame,
    subzone_gdf: gpd.GeoDataFrame,
    roads_gdf: gpd.GeoDataFrame,
    roads_sindex,
) -> pd.DataFrame:
    records: List[Dict[str, Any]] = []

    for config in configs:
        features = load_geojson_features(geojson_dir / config.filename)
        for feature in features:
            properties = dict(feature.get("properties", {}))
            description_text, description_attrs = parse_description(properties.get("Description"))
            if description_text:
                properties["Description"] = description_text

            geometry = feature.get("geometry")
            if not geometry:
                continue
            point_geom, lon, lat, geometry_wkt, geometry_geojson, geom_type = derive_point_geometry(geometry)

            point_proj = gpd.GeoSeries([point_geom], crs="EPSG:4326").to_crs("EPSG:3414").iloc[0]

            amenity_name, postal_code = clean_properties(properties, description_attrs, config)
            if not amenity_name:
                identifier = properties.get("UNIQUEID") or properties.get("Name") or str(uuid.uuid4())
                amenity_name = f"{config.amenity_type.title()} {identifier}".strip()

            category, priority, weight = lookup_category(config.amenity_type)
            importance_score = (weight ** 2) / priority if priority else None
            importance_label = compute_importance_label(importance_score)

            planning_area, planning_area_id, subzone, subzone_id = enrich_location(point_proj, planning_gdf, subzone_gdf)
            roads = nearest_roads(point_proj, roads_gdf, roads_sindex, k=4)

            record = {
                "amenity_id": str(uuid.uuid4()),
                "amenity_type": config.amenity_type,
                "amenity_name": amenity_name,
                "road_name": roads[0]["name"],
                "postal_code": postal_code,
                "geom_type": geom_type,
                "lon": lon,
                "lat": lat,
                "source_file": config.filename,
                "Shape__Area": np.nan,
                "Shape__Length": np.nan,
                "geometry_wkt": geometry_wkt,
                "geometry_geojson": geometry_geojson,
                "amenity_category": category,
                "amenity_priority": priority,
                "amenity_weight": weight,
                "importance_score": importance_score,
                "importance_label": importance_label,
                "planning_area": planning_area,
                "subzone": subzone,
                "geometry_type": geom_type,
                "geometry_coordinates": normalize_coordinates(geometry.get("coordinates")),
                "nearest_road_1_id": roads[0]["id"],
                "nearest_road_1_name": roads[0]["name"],
                "nearest_road_2_id": roads[1]["id"],
                "nearest_road_2_name": roads[1]["name"],
                "nearest_road_3_id": roads[2]["id"],
                "nearest_road_3_name": roads[2]["name"],
                "nearest_road_4_id": roads[3]["id"],
                "nearest_road_4_name": roads[3]["name"],
                "amenity_planning_area_id": planning_area_id,
                "amenity_subzone_id": subzone_id,
                "nearest_road_1_rn_id": roads[0]["rn_id"],
                "nearest_road_1_planning_area_id": roads[0]["pa_id"],
                "nearest_road_1_subzone_id": roads[0]["sz_id"],
                "nearest_road_2_rn_id": roads[1]["rn_id"],
                "nearest_road_2_planning_area_id": roads[1]["pa_id"],
                "nearest_road_2_subzone_id": roads[1]["sz_id"],
                "nearest_road_3_rn_id": roads[2]["rn_id"],
                "nearest_road_3_planning_area_id": roads[2]["pa_id"],
                "nearest_road_3_subzone_id": roads[2]["sz_id"],
                "nearest_road_4_rn_id": roads[3]["rn_id"],
                "nearest_road_4_planning_area_id": roads[3]["pa_id"],
                "nearest_road_4_subzone_id": roads[3]["sz_id"],
            }

            if record["postal_code"]:
                digits = "".join(ch for ch in str(record["postal_code"]) if ch.isdigit())
                record["postal_code"] = digits.zfill(6) if digits else None

            records.append(record)

    return pd.DataFrame(records, columns=OUTPUT_COLUMNS)


def main() -> None:
    script_path = Path(__file__).resolve()
    root = repo_root(script_path)
    data_dir = root / "backend" / "etl" / "data"
    geojson_dir = data_dir / "geojson_layers"

    backend_path = data_dir / "amenities_3layers.csv"
    frontend_path = root / "frontend" / "public" / "map" / "amenities_3layers.csv"

    if backend_path.exists():
        base_path = backend_path
    elif frontend_path.exists():
        base_path = frontend_path
    else:
        raise FileNotFoundError("amenities_3layers.csv not found in backend or frontend paths")

    existing_df = pd.read_csv(base_path)

    removal_mask = existing_df["amenity_type"].isin(REPLACE_TYPES.union(ADDITIONAL_REMOVALS))
    removed_count = int(removal_mask.sum())
    if removed_count:
        existing_df = existing_df.loc[~removal_mask].reset_index(drop=True)

    print(f"Loaded base dataset from {base_path} with {len(existing_df)} rows after removing {removed_count} legacy entries")

    planning_gdf = gpd.read_file(data_dir / "planning_area.geojson").to_crs("EPSG:3414")
    subzone_gdf = gpd.read_file(data_dir / "subzone_area.geojson").to_crs("EPSG:3414")
    roads_gdf = gpd.read_file(data_dir / "road_network.geojson").to_crs("EPSG:3414")
    try:
        roads_sindex = roads_gdf.sindex
    except Exception:
        roads_sindex = None

    additions_df = build_new_records(DATASETS, geojson_dir, planning_gdf, subzone_gdf, roads_gdf, roads_sindex)
    print(f"Prepared {len(additions_df)} new amenity records")

    combined_df = pd.concat([existing_df, additions_df], ignore_index=True, sort=False)
    if "amenity_name" in combined_df.columns:
        combined_df["amenity_name"] = combined_df["amenity_name"].replace(r"^\s*$", pd.NA, regex=True)

    mapping = load_onemap_mapping(data_dir / "onemap_postal_codes.csv")
    filled = fill_amenity_names_from_onemap(combined_df, mapping)
    print(f"Filled {filled} amenity names via OneMap postal mapping")

    for col in OUTPUT_COLUMNS:
        if col not in combined_df.columns:
            combined_df[col] = pd.NA

    combined_df = combined_df[OUTPUT_COLUMNS]
    combined_df = pad_identifier_columns(combined_df, IDENTIFIER_COLUMNS)

    combined_df.to_csv(backend_path, index=False)
    if frontend_path.exists():
        combined_df.to_csv(frontend_path, index=False)

    print(f"Wrote consolidated dataset with {len(combined_df)} rows to {backend_path}")
    if frontend_path.exists():
        print(f"Mirrored dataset to {frontend_path}")


if __name__ == "__main__":
    main()
