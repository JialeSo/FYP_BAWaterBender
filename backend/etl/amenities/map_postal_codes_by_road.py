#!/usr/bin/env python3
"""Attach PA/SZ/RN identifiers to postal codes by matching on road names."""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd


DATA_DIR = Path(__file__).resolve().parents[1]
DEFAULT_POSTAL_PATH = DATA_DIR / "onemap_postal_codes.csv"
DEFAULT_ROAD_PATH = DATA_DIR / "road_network.geojson"
DEFAULT_OUTPUT = DATA_DIR / "onemap_postal_codes_with_road_ids.csv"


def normalise_name(series: pd.Series) -> pd.Series:
    return (
        series.fillna("")
        .str.upper()
        .str.replace("[\\s]+", " ", regex=True)
        .str.strip()
    )


def load_roads(path: Path) -> pd.DataFrame:
    import geopandas as gpd

    roads = gpd.read_file(path, columns=["RD_NAME", "RN_ID", "SZ_ID", "PA_ID"])
    roads["norm_name"] = normalise_name(roads["RD_NAME"])
    grouped = (
        roads.groupby("norm_name")
        .agg({
            "RN_ID": lambda x: sorted(set(filter(pd.notna, x))),
            "SZ_ID": lambda x: sorted(set(filter(pd.notna, x))),
            "PA_ID": lambda x: sorted(set(filter(pd.notna, x))),
        })
        .reset_index()
    )
    return grouped


def format_values(values: list[str | int]) -> str:
    if not values:
        return ""
    return ";".join(str(v) for v in values)


def attach_identifiers(postal_df: pd.DataFrame, road_lookup: pd.DataFrame) -> pd.DataFrame:
    lookup = road_lookup.set_index("norm_name")
    norm = normalise_name(postal_df["ROAD_NAME"])
    match = lookup.reindex(norm).reset_index(drop=True)

    for column in ("RN_ID", "SZ_ID", "PA_ID"):
        values = match[column].apply(lambda v: v if isinstance(v, list) else [])
        postal_df[f"road_{column.lower()}s_from_name"] = values.apply(format_values)
        postal_df[f"road_{column.lower()}_count"] = values.apply(len)

    postal_df["road_name_matched"] = norm
    return postal_df


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--postal", type=Path, default=DEFAULT_POSTAL_PATH)
    parser.add_argument("--roads", type=Path, default=DEFAULT_ROAD_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    postal_df = pd.read_csv(args.postal, dtype={"POSTAL": str})
    road_lookup = load_roads(args.roads)

    enriched = attach_identifiers(postal_df.copy(), road_lookup)
    enriched.to_csv(args.output, index=False)

    total = len(enriched)
    unmatched = (enriched["road_rn_ids_from_name"] == "").sum()
    print(f"Wrote {args.output} ({total:,} rows). Road matches missing for {unmatched:,} rows.")


if __name__ == "__main__":
    main()
