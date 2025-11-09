#!/usr/bin/env python3
"""
Update PA_IDs in an existing PA GeoJSON by matching PLN_AREA_N to
backend/etl/data/amenities/planning_area_lookup.csv. Also removes known
unwanted KML metadata keys and ensures pretty-printed 2D GeoJSON.

Usage:
  python backend/etl/onemap/scripts/update_pa_ids.py \
    --path backend/backend/etl/data/roadnetwork/pa_onemap.geojson

If --path is omitted, the script tries the common locations in order:
  1) backend/backend/etl/data/roadnetwork/pa_onemap.geojson
  2) backend/etl/data/roadnetwork/pa_onemap.geojson
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Dict, Any


# Resolve to repository root (four levels up from this script)
ROOT = Path(__file__).resolve().parents[4]
LOOKUP_PATH = ROOT / "backend" / "etl" / "data" / "amenities" / "planning_area_lookup.csv"


UNWANTED_KEYS = {"Name", "Description", "PLN_AREA_C", "CA_IND", "REGION_N", "REGION_C", "INC_CRC", "FMEL_UPD_D"}


def load_lookup() -> Dict[str, int]:
    mapping: Dict[str, int] = {}
    with LOOKUP_PATH.open("r", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            name = (row.get("planning_area") or "").strip().upper()
            if not name:
                continue
            try:
                mapping[name] = int(row.get("pa_id"))
            except Exception:
                continue
    return mapping


def strip_z(geom: Dict[str, Any]) -> Dict[str, Any]:
    t = geom.get("type")
    c = geom.get("coordinates")
    if t == "Polygon" and isinstance(c, list):
        return {
            "type": "Polygon",
            "coordinates": [
                [[p[0], p[1]] for p in ring if isinstance(p, (list, tuple)) and len(p) >= 2]
                for ring in c
            ],
        }
    if t == "MultiPolygon" and isinstance(c, list):
        return {
            "type": "MultiPolygon",
            "coordinates": [
                [
                    [[p[0], p[1]] for p in ring if isinstance(p, (list, tuple)) and len(p) >= 2]
                    for ring in poly
                ]
                for poly in c
            ],
        }
    return geom


def process(path: Path) -> None:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    assert data.get("type") == "FeatureCollection"

    lookup = load_lookup()
    feats_out = []
    for f in data.get("features", []):
        if not isinstance(f, dict):
            continue
        geom = f.get("geometry") or {}
        props = dict(f.get("properties") or {})

        # Normalize PA name
        name = props.get("PLN_AREA_N") or props.get("pln_area_n") or props.get("NAME")
        if isinstance(name, str):
            name_u = name.strip().upper()
        else:
            name_u = None

        # Map PA_ID
        if name_u and name_u in lookup:
            props["PA_ID"] = lookup[name_u]

        # Drop unwanted keys
        for k in list(props.keys()):
            if k in UNWANTED_KEYS:
                props.pop(k, None)

        feats_out.append({
            "type": "Feature",
            "geometry": strip_z(geom) if isinstance(geom, dict) else geom,
            "properties": props,
        })

    payload = {"type": "FeatureCollection", "features": feats_out}
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)


def main() -> int:
    parser = argparse.ArgumentParser(description="Update PA_IDs in PA GeoJSON using lookup CSV")
    parser.add_argument("--path", type=str, default="", help="Path to pa_onemap.geojson to update")
    args = parser.parse_args()

    candidates = [
        Path(args.path),
        ROOT / "backend" / "backend" / "etl" / "data" / "roadnetwork" / "pa_onemap.geojson",
        ROOT / "backend" / "etl" / "data" / "roadnetwork" / "pa_onemap.geojson",
    ]
    target = None
    for p in candidates:
        if p and str(p) != "" and p.exists():
            target = p
            break
    if target is None:
        print("No pa_onemap.geojson found. Provide --path explicitly.")
        return 1
    process(target)
    print(f"✓ Updated {target} using {LOOKUP_PATH.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
