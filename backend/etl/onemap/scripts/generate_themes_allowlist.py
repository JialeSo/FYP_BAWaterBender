#!/usr/bin/env python3
"""
Generate OneMap Themes Allowlist
--------------------------------

Fetches OneMap theme index (getAllThemesInfo?moreInfo=Y) with Authorization
and probes each theme via retrieveTheme to count results. Writes:

- backend/etl/data/onemap/onemap_themes_live.json (full index payload)
- backend/etl/data/onemap/retrieved_themes_live.csv (counts per theme)
- backend/etl/data/onemap/onemap_themes_allowlist.txt (querynames with count > 0)

Uses OneMapClient for auth. Requires ONE_MAP_USER/ONE_MAP_PASS (or ONEMAP_EMAIL/ONEMAP_EMAIL_PASSWORD).
Optionally accepts an --extents bbox to improve returns for extent-gated themes.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

from backend.etl.onemap.onemap_extended import OneMapClient
from backend.etl.amenities.consolidate import _compute_excluded_querynames


DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "onemap"


def fetch_all_themes(client: OneMapClient) -> List[Dict]:
    url = "https://www.onemap.gov.sg/api/public/themesvc/getAllThemesInfo"
    r = client.get_auth(url, params={"moreInfo": "Y"})
    r.raise_for_status()
    payload = r.json() if hasattr(r, "json") else {}
    themes = payload.get("Theme_Names", []) if isinstance(payload, dict) else []
    # Persist raw index for audit
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "onemap_themes_live.json").write_text(json.dumps(payload), encoding="utf-8")
    return themes


def probe_theme(client: OneMapClient, queryname: str, extents: Optional[str]) -> int:
    url = "https://www.onemap.gov.sg/api/public/themesvc/retrieveTheme"
    params = {"queryName": queryname}
    if extents:
        params["extents"] = extents
    try:
        r = client.get_auth(url, params=params)
        r.raise_for_status()
        js = r.json() if hasattr(r, "json") else {}
        rows = js.get("SrchResults", []) if isinstance(js, dict) else []
        return len(rows)
    except Exception:
        return 0


def main():
    ap = argparse.ArgumentParser(description="Generate OneMap themes allowlist by probing retrieveTheme counts")
    ap.add_argument("--extents", help="Optional bbox extents 'lat_min,lon_min,lat_max,lon_max'", default=None)
    args = ap.parse_args()

    client = OneMapClient()
    client.ensure_token()

    themes = fetch_all_themes(client)
    print(f"Fetched {len(themes)} themes from OneMap")

    excluded_qn = _compute_excluded_querynames()
    print(f"Excluded querynames (preconfigured): {len(excluded_qn)}")

    rows = []
    for idx, t in enumerate(themes, start=1):
        name = (t.get("THEMENAME") or "").strip()
        qn = (t.get("QUERYNAME") or "").strip()
        if not name or not qn:
            continue
        if qn in excluded_qn:
            rows.append({"themename": name, "queryname": qn, "count": 0, "excluded": True})
            continue
        cnt = probe_theme(client, qn, args.extents)
        rows.append({"themename": name, "queryname": qn, "count": cnt, "excluded": False})
        if idx % 10 == 0:
            print(f"  Probed {idx}/{len(themes)} themes…")

    # Persist CSV log
    df = pd.DataFrame(rows)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = DATA_DIR / "retrieved_themes_live.csv"
    df.to_csv(csv_path, index=False)
    print(f"Saved counts → {csv_path}")

    # Build allowlist (count > 0, not excluded)
    allow = df[(df["count"] > 0) & (~df["excluded"])]["queryname"].dropna().astype(str).str.strip().tolist()
    allowlist_path = DATA_DIR / "onemap_themes_allowlist.txt"
    allowlist_path.write_text("\n".join(sorted(set(allow))), encoding="utf-8")
    print(f"Saved allowlist ({len(set(allow)))} items) → {allowlist_path}")


if __name__ == "__main__":
    main()

