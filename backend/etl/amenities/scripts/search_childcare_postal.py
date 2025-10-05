#!/usr/bin/env python3
"""Lookup OneMap address details for a childcare postal code."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import pandas as pd
import requests

CHILDCARE_PATH = Path(__file__).resolve().parents[2] / "data" / "geojson_layers" / "childcare_clean.geojson"
ONEMAP_URL = "https://www.onemap.gov.sg/api/common/elastic/search"
ONEMAP_TOKEN = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjo4Mzk3LCJmb3JldmVyIjpmYWxzZSwiaXNzIjoiT25lTWFwIiwiaWF0IjoxNzU5MjQ0NTQ1LCJuYmYiOjE3NTkyNDQ1NDUsImV4cCI6MTc1OTUwMzc0NSwianRpIjoiNzBhNDAwZjItMmFiNi00NjAwLWIyZGItN2QyZGM1ODFjYjYyIn0.xTi7kYrKgxF9TaUObFqecgH_4eIVZcixQiEyLBfil-xsUaXr690e9A2s-TH5Sx-n56NunvC_fS_O8_0u4bTG_VZNGYX6e1EYZzHGOsBYlo1o-2jiC9Uai1S-yNmmCFTYDfXfyVVOM5BuVaTkUybWx-jT7uWusDA4opWbOePQJy8YlY28-VjkQ3S6cgrzYBfhP2ox7uS4rWlrelgKupDy-Y_gXZJMUph0BCYJ8JFLs1jMV4T3eB9R7D28CYuCW3ZQJKYOdbBdV7Y7T4riFa5benWjZr5EcKmLV7m-Y9rzrYlS3aPNiHEu8c6hLLtcIWTMCTvfaFjuj5ut0pc1a1s2dA"


def load_childcare_postals() -> pd.DataFrame:
    with CHILDCARE_PATH.open("r", encoding="utf-8") as fh:
        data = json.load(fh)

    records = []
    for feature in data.get("features", []):
        props = feature.get("properties", {})
        postal = props.get("ADDRESSPOSTALCODE")
        if postal is not None:
            postal = str(postal).replace(".0", "").strip()
            postal = postal.zfill(6) if postal else None
        records.append(
            {
                "amenity_name": props.get("NAME") or props.get("Name"),
                "postal": postal,
            }
        )

    df = pd.DataFrame(records)
    return df.dropna(subset=["postal"])


def query_onemap(postal_code: str, token: str) -> dict:
    params = {
        "searchVal": postal_code,
        "returnGeom": "Y",
        "getAddrDetails": "Y",
        "pageNum": 1,
    }
    headers = {"Authorization": token}
    response = requests.get(ONEMAP_URL, params=params, headers=headers, timeout=30)
    response.raise_for_status()
    return response.json()


def run_batch(*, postal_limit: int | None, output_path: Path, token: str, sleep_seconds: float) -> None:
    data = load_childcare_postals()
    unique_postals = sorted(data["postal"].dropna().unique())
    if postal_limit is not None:
        unique_postals = unique_postals[:postal_limit]

    total = len(unique_postals)
    print(f"Processing {total} childcare postal codes...")

    results: list[dict[str, object]] = []
    for idx, postal in enumerate(unique_postals, start=1):
        status = "ok"
        try:
            response = query_onemap(postal, token)
            results.append({"postal": postal, "response": response})
        except requests.HTTPError as exc:
            results.append({"postal": postal, "error": str(exc)})
            status = "error"

        if idx % 20 == 0 or idx == total:
            print(f"  {idx}/{total} processed (postal {postal}, status: {status})")

        if sleep_seconds > 0 and idx < total:
            time.sleep(sleep_seconds)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"Saved batch results to {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Query OneMap for childcare postal code info.")
    parser.add_argument("postal", nargs="?", help="Postal code to query (6 digits).")
    parser.add_argument("--token", help="Override the built-in OneMap API token.")
    parser.add_argument("--all", action="store_true", help="Query OneMap for every childcare postal code.")
    parser.add_argument("--output", default="childcare_postal_onemap.json", help="Output file for batch mode (JSON).")
    parser.add_argument("--sleep", type=float, default=0.3, help="Delay between batch requests (seconds).")
    parser.add_argument("--limit", type=int, help="Maximum number of postals to process in batch mode.")
    args = parser.parse_args()

    token = args.token or ONEMAP_TOKEN
    if not token:
        print("Missing OneMap token (hardcoded token was empty and no override provided).", file=sys.stderr)
        sys.exit(1)

    if args.all:
        run_batch(postal_limit=args.limit, output_path=Path(args.output), token=token, sleep_seconds=args.sleep)
        return

    if not args.postal:
        print("Please provide a postal code or use --all for batch mode.", file=sys.stderr)
        sys.exit(1)

    postal = args.postal.strip()
    data = load_childcare_postals()
    match = data[data["postal"] == postal]
    if match.empty:
        print(f"Postal {postal} not found in childcare dataset; querying OneMap anyway.")
    else:
        print("Matching childcare entries:")
        for _, row in match.iterrows():
            print(f"- {row['amenity_name']} (postal: {row['postal']})")

    print("\nOneMap response:")
    result = query_onemap(postal, token)
    print(result)


if __name__ == "__main__":
    main()
