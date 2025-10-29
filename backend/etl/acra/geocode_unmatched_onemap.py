import os
import sys
import time
import argparse
from pathlib import Path
from typing import Optional

import pandas as pd
import requests

# Ensure project root on sys.path for absolute imports
THIS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = THIS_DIR.parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.etl.onemap.onemap_extended import get_token


def geocode_postal_one_map(postal: str, token: str) -> Optional[tuple[float, float]]:
    """Geocode via OneMap elastic search (token-only) for a postal code."""
    url = "https://www.onemap.gov.sg/api/common/elastic/search"
    params = {
        "searchVal": postal,
        "returnGeom": "Y",
        "getAddrDetails": "Y",
        "pageNum": 1,
    }
    headers = {"Authorization": token}
    r = requests.get(url, params=params, headers=headers, timeout=20)
    if r.status_code == 401:
        token = get_token()
        headers = {"Authorization": token}
        r = requests.get(url, params=params, headers=headers, timeout=20)
    r.raise_for_status()
    js = r.json() or {}
    results = js.get("results") or js.get("SearchResults") or []
    if results:
        first = results[0]
        lat = first.get("LATITUDE") or first.get("lat") or first.get("LAT")
        lon = first.get("LONGITUDE") or first.get("lon") or first.get("LNG")
        if lat and lon:
            return float(lat), float(lon)
    return None


def main():
    parser = argparse.ArgumentParser(description="Geocode unmatched ACRA rows via OneMap and merge back")
    parser.add_argument("--dir", default="backend/etl/acra/data", help="Working directory")
    parser.add_argument("--in", dest="infile", default="acra_unmatched_postal.csv", help="Unmatched input CSV filename")
    parser.add_argument("--out", dest="outfile", default="acra_unmatched_geocoded.csv", help="Output geocoded CSV filename")
    parser.add_argument("--merge-into", dest="merge_into", default="acra_all.csv", help="Combined CSV to merge into")
    parser.add_argument("--sleep", type=float, default=0.75, help="Sleep between API calls")
    args = parser.parse_args()

    workdir = Path(args.dir)
    unmatched_path = workdir / args.infile
    out_path = workdir / args.outfile
    merge_target = workdir / args.merge_into

    if not unmatched_path.exists():
        print(f"No unmatched file found at {unmatched_path}")
        return 0

    df = pd.read_csv(unmatched_path, dtype=str).fillna("")
    if df.empty:
        print("No unmatched rows to geocode.")
        return 0

    token = get_token()

    geocoded_rows = []
    calls = 0
    hits = 0
    misses = 0
    for i, row in df.iterrows():
        postal = str(row.get("postal_code", "")).strip()
        latlng = None
        if postal and len(postal) == 6 and postal.isdigit():
            try:
                latlng = geocode_postal_one_map(postal, token)
                calls += 1
            except Exception as e:
                latlng = None
        new = row.to_dict()
        if latlng:
            new["latitude"], new["longitude"] = latlng
            hits += 1
        else:
            misses += 1
        geocoded_rows.append(new)
        if args.sleep:
            time.sleep(args.sleep)

        if calls and (calls % 100 == 0):
            print(f"Progress: {calls} calls | hits={hits} | misses={misses}")

    out_df = pd.DataFrame(geocoded_rows)
    out_df.to_csv(out_path, index=False)
    print(f"Saved geocoded unmatched → {out_path} ({len(out_df)} rows)")
    print(f"Final: calls={calls} | hits={hits} | misses={misses}")

    # Merge back into combined CSV if present
    if merge_target.exists():
        all_df = pd.read_csv(merge_target, dtype=str)
        # Prefer geocoded lat/lon where blank in all_df
        all_df = all_df.merge(
            out_df[["uen", "latitude", "longitude"]],
            on="uen",
            how="left",
            suffixes=("", "_new"),
        )
        def choose(a, b):
            return b if (pd.isna(a) or a == "") and pd.notna(b) and b != "" else a
        all_df["latitude"] = [choose(a, b) for a, b in zip(all_df.get("latitude"), all_df.get("latitude_new"))]
        all_df["longitude"] = [choose(a, b) for a, b in zip(all_df.get("longitude"), all_df.get("longitude_new"))]
        if "latitude_new" in all_df.columns:
            all_df = all_df.drop(columns=[c for c in ["latitude_new", "longitude_new"] if c in all_df.columns])
        all_df.to_csv(merge_target, index=False)
        print(f"Merged geocoded values back into {merge_target}")
    else:
        print(f"Combined file not found for merge: {merge_target}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
