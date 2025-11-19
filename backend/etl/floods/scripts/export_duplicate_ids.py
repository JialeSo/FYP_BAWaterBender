#!/usr/bin/env python3
"""
Export duplicate flood event IDs from the merged PUB + Hui Ying CSV.

This is a small helper to inspect which `id` values appear more than once
in `PUB_and_huiying_flood.csv`, and to see the full rows that will be
collapsed by the deduplication logic in `process_floods_3layers.py`.

Usage (from repo root):
    python3 backend/etl/floods/scripts/export_duplicate_ids.py
"""

from pathlib import Path

import pandas as pd


def main() -> None:
    # Base data directory: backend/etl/data/floods
    base_dir = Path(__file__).resolve().parents[2] / "data" / "floods"
    input_csv = base_dir / "PUB_and_huiying_flood.csv"

    if not input_csv.exists():
        raise FileNotFoundError(f"Input CSV not found: {input_csv}")

    df = pd.read_csv(input_csv)

    if "id" not in df.columns:
        raise ValueError(f"'id' column not found in {input_csv}")

    # Find ids that appear more than once
    id_counts = df["id"].value_counts()
    dup_ids = id_counts[id_counts > 1].index.tolist()

    if not dup_ids:
        print("No duplicate ids found.")
        return

    # All rows whose id is duplicated
    dup_rows = df[df["id"].isin(dup_ids)].copy()
    dup_rows = dup_rows.sort_values(["id", "event_date", "event"], na_position="last")

    # Optional compact summary
    summary = (
        dup_rows.groupby("id")
        .agg(
            row_count=("id", "size"),
            distinct_events=("event", lambda s: ",".join(sorted(set(s.astype(str))))),
        )
        .reset_index()
        .sort_values("id")
    )

    output_rows = base_dir / "PUB_and_huiying_flood_duplicates.csv"
    output_summary = base_dir / "PUB_and_huiying_flood_duplicates_summary.csv"

    dup_rows.to_csv(output_rows, index=False)
    summary.to_csv(output_summary, index=False)

    print(f"Found {len(dup_ids)} ids with duplicates "
          f"({int(id_counts[id_counts > 1].sum())} rows).")
    print(f"- Full duplicate rows: {output_rows}")
    print(f"- Summary by id:      {output_summary}")


if __name__ == "__main__":
    main()

