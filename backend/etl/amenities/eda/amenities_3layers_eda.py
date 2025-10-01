#!/usr/bin/env python3
"""Lightweight EDA for the consolidated amenities dataset."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

DATA_FILENAME = "amenities_3layers.csv"


def load_data(data_path: Path) -> pd.DataFrame:
    df = pd.read_csv(data_path)
    if "amenity_name" in df.columns:
        df["amenity_name"] = df["amenity_name"].replace(r"^\s*$", pd.NA, regex=True)
    return df


def collect_missing_summary(df: pd.DataFrame) -> pd.DataFrame:
    missing_count = df.isna().sum()
    missing_pct = (missing_count / len(df) * 100).round(3)
    return (
        pd.DataFrame({"missing_count": missing_count, "missing_pct": missing_pct})
        .sort_values("missing_count", ascending=False)
        .reset_index()
        .rename(columns={"index": "column"})
    )


def write_summary_markdown(path: Path, row_count: int, missing_summary: pd.DataFrame, amenity_name_missing: int) -> None:
    top_missing = missing_summary.head(10)
    lines = [
        "# Amenities 3 Layers – Basic EDA",
        "",
        f"- Total rows: {row_count}",
        f"- Columns: {missing_summary['column'].nunique()}",
        f"- `amenity_name` missing: {amenity_name_missing}",
        "",
        "## Top columns by missing values",
    ]
    for _, row in top_missing.iterrows():
        lines.append(
            f"- `{row['column']}`: {int(row['missing_count'])} missing ({row['missing_pct']:.2f}%)"
        )
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    script_dir = Path(__file__).resolve().parent
    data_dir = script_dir.parents[1] / "data"
    data_path = data_dir / DATA_FILENAME

    df = load_data(data_path)
    missing_summary = collect_missing_summary(df)
    amenity_name_missing = int(df["amenity_name"].isna().sum()) if "amenity_name" in df.columns else 0

    output_dir = script_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    missing_summary.to_csv(output_dir / "amenities_3layers_missing_summary.csv", index=False)
    if "amenity_name" in df.columns:
        amenity_name_missing_df = df.loc[df["amenity_name"].isna()]
        amenity_name_missing_df.to_csv(output_dir / "amenity_name_missing_rows.csv", index=False)
        (
            amenity_name_missing_df.groupby("amenity_type").size().sort_values(ascending=False)
        ).rename("missing_count").to_csv(output_dir / "amenity_name_missing_by_type.csv")

    write_summary_markdown(
        output_dir / "amenities_3layers_eda_summary.md",
        len(df),
        missing_summary,
        amenity_name_missing,
    )


if __name__ == "__main__":
    main()
