#!/usr/bin/env python3
"""
Upload Floods Data to Supabase
================================

This script uploads the floods_3layers.csv to Supabase.

Usage:
------
    # Upload floods data
    python backend/etl/scripts/upload_floods_3layers.py

    # Dry run (preview without uploading)
    python backend/etl/scripts/upload_floods_3layers.py --dry-run

    # Append mode (don't truncate existing data)
    python backend/etl/scripts/upload_floods_3layers.py --no-truncate
"""

import argparse
import os
import asyncio
import sys
from pathlib import Path

import pandas as pd
import numpy as np
import math
import json

# Add project root (directory containing the 'backend' package) to sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[4]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.etl.common import Pipeline, DatabaseWriteStage

# Allow overriding the target table via env; default to singular as requested
FLOODS_TABLE = os.getenv("FLOODS_TABLE", "flood_3layers")


def preview_csv(csv_path: Path, table_name: str) -> None:
    """Preview CSV file contents before upload."""
    print(f"\n{'='*70}")
    print(f"Preview: {table_name}")
    print(f"{'='*70}")
    print(f"File: {csv_path}")
    print(f"Size: {csv_path.stat().st_size / 1024:.1f} KB")

    df = pd.read_csv(csv_path)
    print(f"Rows: {len(df):,}")
    print(f"Columns: {list(df.columns)}")
    print(f"\nFirst 3 rows:")
    print(df.head(3).to_string(index=False))
    print()


def _upload_to_supabase_storage(
    local_path: Path,
    bucket: str,
    object_path: str,
    content_type: str = "application/octet-stream",
) -> None:
    """Upload a file to Supabase Storage with best-effort compatibility.

    Args:
        local_path: Path to the local file to upload
        bucket: Storage bucket name
        object_path: Path of the object within the bucket
        content_type: MIME type of the file (e.g., 'application/geo+json', 'text/csv')
    """
    from backend.config.config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    from supabase import create_client

    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    data = local_path.read_bytes()

    try:
        client.storage.from_(bucket).upload(
            object_path,
            data,
            {"content-type": content_type, "upsert": True},
        )
    except TypeError:
        client.storage.from_(bucket).upload(
            file=data,
            path=object_path,
            file_options={"contentType": content_type, "upsert": True},
        )


async def upload_floods_3layers(
    dry_run: bool = False,
    storage_only: bool = False,
    truncate: bool = True,
    no_geojson: bool = False,
    csv_path_override: Path | None = None,
    upload_storage: bool = False,
    storage_bucket: str | None = None,
    storage_path: str | None = None,
    upload_csv_storage: bool = False,
    storage_csv_path: str | None = None,
    unique_id: bool = False,
    start_id: int = 1,
    write_csv: bool = False,
    drop_flood_id: bool = False,
) -> None:
    """Upload floods_3layers.csv to Supabase and optionally emit GeoJSON.

    If ``csv_path_override`` is provided, that file is used instead of the
    default ``backend/etl/data/floods/floods_3layers.csv``.
    """
    csv_path = (
        csv_path_override
        if csv_path_override is not None
        else PROJECT_ROOT / "backend" / "etl" / "data" / "floods" / "floods_3layers.csv"
    )

    if not csv_path.exists():
        print(f"⚠ Error: {csv_path} not found.")
        print(f"  Run: python backend/etl/scripts/process_floods_3layers.py")
        raise FileNotFoundError(f"Missing required file: {csv_path}")

    preview_csv(csv_path, FLOODS_TABLE)

    # Read CSV (do this even in dry run to create GeoJSON)
    df = pd.read_csv(csv_path)

    # Filter out floods from planning areas 24, 27, and 31
    excluded_pa_ids = [24, 27, 31]
    original_count = len(df)

    # Filter based on either start_pa_id or end_pa_id
    if 'start_pa_id' in df.columns:
        df = df[~df['start_pa_id'].isin(excluded_pa_ids)]
    if 'end_pa_id' in df.columns:
        df = df[~df['end_pa_id'].isin(excluded_pa_ids)]

    filtered_count = original_count - len(df)

    if filtered_count > 0:
        print(f"🔍 Filtered out {filtered_count:,} flood events from planning areas {excluded_pa_ids}")
        print(f"   Remaining: {len(df):,} flood events\n")

    # Optionally drop flood_id column if present
    if drop_flood_id and 'flood_id' in df.columns:
        df = df.drop(columns=['flood_id'])
        print("🧹 Dropped 'flood_id' column from DataFrame")

    # Optionally generate a unique surrogate key column 'flood_id' (leave original 'id' untouched)
    if unique_id:
        if 'id' not in df.columns:
            raise ValueError("CSV is missing required 'id' column for unique-id generation")
        dup_count = int(df['id'].duplicated().sum())
        # Stable order: sort by event_date then existing id to keep determinism
        if 'event_date' in df.columns:
            df = df.sort_values(by=['event_date', 'id'], kind='stable').reset_index(drop=True)
        else:
            df = df.reset_index(drop=True)
        df['flood_id'] = np.arange(start_id, start_id + len(df))
        print(f"🆔 Created 'flood_id' sequential values starting at {start_id} (duplicate source ids found: {dup_count})")

    # Define columns to keep (matching the Supabase schema)
    columns_to_keep = [
        'id', 'text', 'event_date', 'location', 'event',
        'start_loc', 'end_loc', 'parent_road', 'cleaned_location',
        # Friendly names (will be merged below; keep if present)
        'start_planning_area', 'end_planning_area', 'start_subzone', 'end_subzone',
        'start_street_name', 'end_street_name',
        'start_lat', 'start_lng', 'start_postal_code',
        'start_pa_id', 'start_sz_id', 'start_rn_id', 'origin_lat', 'origin_lng',
        # Include 100m buffer columns if present
        'end100_a_lat', 'end100_a_lng', 'end100_b_lat', 'end100_b_lng',
        'end_lat', 'end_lng', 'end_postal_code',
        'end_pa_id', 'end_sz_id', 'end_rn_id',
    ]

    # Keep only the columns that exist in the dataframe
    existing_columns = [col for col in columns_to_keep if col in df.columns]
    df = df[existing_columns]

    # Ensure ID columns are integers (not floats)
    int_columns = ['id', 'start_pa_id', 'start_sz_id', 'start_rn_id', 'end_pa_id', 'end_sz_id', 'end_rn_id']
    for col in int_columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0).astype(int)

    # Ensure coordinate columns are floats
    float_columns = ['start_lat', 'start_lng', 'origin_lat', 'origin_lng', 'end_lat', 'end_lng']
    for col in float_columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    # Enrich with friendly names from lookup tables
    try:
        pa_lookup_path = PROJECT_ROOT / "backend" / "etl" / "data" / "planning_area_lookup.csv"
        sz_lookup_path = PROJECT_ROOT / "backend" / "etl" / "data" / "subzone_lookup.csv"
        if pa_lookup_path.exists():
            pa_lu = pd.read_csv(pa_lookup_path)
            if {"pa_id", "planning_area"}.issubset(pa_lu.columns):
                pa_map = dict(zip(pa_lu["pa_id"], pa_lu["planning_area"]))
                if "start_pa_id" in df.columns:
                    df["start_planning_area"] = df["start_pa_id"].map(pa_map)
                if "end_pa_id" in df.columns:
                    df["end_planning_area"] = df["end_pa_id"].map(pa_map)
        if sz_lookup_path.exists():
            sz_lu = pd.read_csv(sz_lookup_path)
            if {"sz_id", "subzone"}.issubset(sz_lu.columns):
                sz_map = dict(zip(sz_lu["sz_id"], sz_lu["subzone"]))
                if "start_sz_id" in df.columns:
                    df["start_subzone"] = df["start_sz_id"].map(sz_map)
                if "end_sz_id" in df.columns:
                    df["end_subzone"] = df["end_sz_id"].map(sz_map)
        # Ensure street name columns exist (may remain None if not derivable)
        for col in ["start_street_name", "end_street_name"]:
            if col not in df.columns:
                df[col] = None
    except Exception as e:
        print(f"  ⚠ Skipping friendly name enrichment: {e}")

    # Strict sanitize: replace NaN/Inf across the entire dataframe
    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.where(pd.notnull(df), None)

    # Force float columns to pure Python types and NULLs
    for col in float_columns:
        if col in df.columns:
            df[col] = df[col].astype(object)
            df.loc[df[col].isna(), col] = None

    def _sanitize_value(v):
        if isinstance(v, float):
            if math.isnan(v) or math.isinf(v):
                return None
            return v
        return v

    def _sanitize_record(rec: dict) -> dict:
        return {k: _sanitize_value(v) for k, v in rec.items()}

    records = [_sanitize_record(r) for r in df.to_dict(orient="records")]

    # Populate PostGIS geometry (EWKT, SRID=4326) for DB insert when table has a geometry column
    # Prefer origin_lon/lat if available; otherwise fall back to start_lon/lat
    populated_geom = 0
    for rec in records:
        lon = rec.get("origin_lng") if rec.get("origin_lng") is not None else rec.get("start_lng")
        lat = rec.get("origin_lat") if rec.get("origin_lat") is not None else rec.get("start_lat")
        if isinstance(lon, (int, float)) and isinstance(lat, (int, float)):
            rec["geom"] = f"SRID=4326;POINT({lon} {lat})"
            populated_geom += 1
        else:
            rec.pop("geom", None)
    if populated_geom:
        print(f"🧭 Prepared geometry for {populated_geom:,} flood points (EWKT, SRID=4326)")

    # Optionally write changes back to CSV (e.g., unique IDs applied)
    if write_csv:
        try:
            df.to_csv(csv_path, index=False)
            print(f"💾 Wrote transformed CSV back to {csv_path}")
        except Exception as e:
            print(f"  ⚠ Failed to write transformed CSV: {e}")

    # Validate JSON compatibility (no NaN/Inf)
    try:
        json.dumps(records, allow_nan=False)
    except ValueError as e:
        # Find and patch any lingering invalid values defensively
        fixed_records = []
        for rec in records:
            fixed = {}
            for k, v in rec.items():
                if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                    fixed[k] = None
                else:
                    fixed[k] = v
            fixed_records.append(fixed)
        records = fixed_records
        # If this still fails, let the exception raise with context
        json.dumps(records, allow_nan=False)

    print(f"📊 Total flood events: {len(records):,}")
    print(f"  Events with text data: {df['text'].notna().sum():,}")
    print(f"  Events with start_loc: {df['start_loc'].notna().sum():,}")
    print(f"  Events with end_loc: {df['end_loc'].notna().sum():,}")

    # Optional GeoJSON export (skip when --no-geojson)
    geojson_path: Path | None = None
    if not no_geojson:
        try:
            from shapely.geometry import Point
            import geopandas as gpd
            geojson_path = csv_path.parent / "floods_3layers.geojson"
            print(f"\n📍 Creating GeoJSON from coordinates...")
            geometry = [Point(xy) for xy in zip(df['start_lng'], df['start_lat'])]
            gdf = gpd.GeoDataFrame(df, geometry=geometry)
            # Force EPSG:4326 for GeoJSON per spec
            gdf = gdf.set_crs(4326, allow_override=True).to_crs(4326)
            gdf.to_file(geojson_path, driver="GeoJSON")
            print(f"  ✓ Saved GeoJSON to {geojson_path}\n")
        except Exception as e:
            print(f"  ⚠ Skipping GeoJSON export (dependency or write issue): {e}\n")

    # Optional upload of GeoJSON to Supabase Storage
    if upload_storage and geojson_path and geojson_path.exists():
        if dry_run and not storage_only:
            print("  ⚠ Skipping Storage upload in DRY RUN mode\n")
        else:
            bucket = storage_bucket or "public-assets"
            object_path = storage_path or "map/floods_3layers.geojson"
            try:
                print(f"☁️  Uploading GeoJSON to storage bucket '{bucket}' as '{object_path}'...")
                _upload_to_supabase_storage(geojson_path, bucket, object_path, content_type="application/geo+json")
                print("  ✓ Storage upload complete")
                from backend.config.config import SUPABASE_URL
                public_url = f"{SUPABASE_URL}/storage/v1/object/public/{bucket}/{object_path}"
                print(f"  🔗 Public URL (if bucket is public): {public_url}\n")
            except Exception as e:
                print(f"  ⚠ Failed to upload GeoJSON to Storage: {e}\n")

    # Optional upload of filtered CSV to Supabase Storage
    if upload_csv_storage:
        bucket = storage_bucket or "public-assets"
        object_path = storage_csv_path or "data/floods_3layers.csv"
        # Decide which CSV file to upload: the possibly transformed in-memory df
        # Write a temporary CSV beside the source to ensure upload file exists
        tmp_csv_path = csv_path.parent / "floods_3layers.filtered.csv"
        try:
            df.to_csv(tmp_csv_path, index=False)
            if dry_run:
                print(f"  ⚠ Skipping CSV Storage upload in DRY RUN mode (would upload {tmp_csv_path} to {bucket}/{object_path})\n")
            else:
                print(f"☁️  Uploading CSV to storage bucket '{bucket}' as '{object_path}'...")
                _upload_to_supabase_storage(tmp_csv_path, bucket, object_path, content_type="text/csv")
                print("  ✓ CSV Storage upload complete\n")
        except Exception as e:
            print(f"  ⚠ Failed to upload CSV to Storage: {e}\n")

    if dry_run or storage_only:
        print("🔍 DRY RUN - Skipping Supabase upload\n")
        return

    # Truncate existing table if requested
    if truncate:
        print(f"🗑️  Truncating existing '{FLOODS_TABLE}' table...")
        try:
            from backend.common.db import DatabaseConnection
            db = DatabaseConnection()
            client = db._get_connection()
            # Delete all existing rows
            client.table(FLOODS_TABLE).delete().neq('id', 0).execute()
            print(f"  ✓ Table truncated\n")
        except Exception as e:
            print(f"  ⚠ Warning: Could not truncate table: {e}\n")

    # Create pipeline with database write stage (no on_conflict so duplicates of source id insert as new rows)
    pipeline = Pipeline(
        name="Upload Flood 3 Layers",
        stages=[
            DatabaseWriteStage(
                table_name=FLOODS_TABLE,
                config={
                    "batch_size": 500,
                }
            )
        ]
    )

    print(f"📤 Uploading {len(records):,} records to Supabase table '{FLOODS_TABLE}'...")

    try:
        await pipeline.run(initial_data=records)
        print(f"✓ Successfully uploaded {len(records):,} records to '{FLOODS_TABLE}'\n")
    except Exception as e:
        print(f"✗ Failed to upload to table '{FLOODS_TABLE}': {e}\n")
        raise


async def main():
    parser = argparse.ArgumentParser(
        description="Upload floods data to Supabase",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview files without uploading"
    )
    parser.add_argument(
        "--storage-only",
        action="store_true",
        help="Generate and upload GeoJSON/CSV to Storage only; skip DB write",
    )
    parser.add_argument(
        "--no-truncate",
        action="store_true",
        help="Don't delete existing data before uploading (append mode)"
    )
    parser.add_argument(
        "--no-geojson",
        action="store_true",
        help="Skip generating GeoJSON file"
    )
    parser.add_argument(
        "--upload-storage",
        action="store_true",
        help="Upload generated GeoJSON to Supabase Storage",
    )
    parser.add_argument(
        "--upload-csv-storage",
        action="store_true",
        help="Upload filtered floods_3layers CSV to Supabase Storage",
    )
    parser.add_argument(
        "--storage-bucket",
        type=str,
        help="Supabase Storage bucket name (default: public-assets)",
    )
    parser.add_argument(
        "--storage-path",
        type=str,
        help="Object path within the bucket (default: map/floods_3layers.geojson)",
    )
    parser.add_argument(
        "--storage-csv-path",
        type=str,
        help="Object path within the bucket for the CSV (default: data/floods_3layers.csv)",
    )
    parser.add_argument(
        "--unique-id",
        action="store_true",
        help="Assign unique sequential IDs to 'id' and preserve original in 'source_id'",
    )
    parser.add_argument(
        "--start-id",
        type=int,
        default=1,
        help="Starting value for reassigned unique IDs (default: 1)",
    )
    parser.add_argument(
        "--write-csv",
        action="store_true",
        help="Write any transformations (e.g., unique IDs) back to the CSV file",
    )
    parser.add_argument(
        "--drop-flood-id",
        action="store_true",
        help="Remove 'flood_id' column from the CSV and GeoJSON output if present",
    )
    parser.add_argument(
        "--csv",
        type=str,
        help="Path to an existing floods_3layers CSV to upload from",
    )

    args = parser.parse_args()

    print("\n" + "="*70)
    print("FLOODS DATA UPLOAD TO SUPABASE")
    print("="*70)

    if args.dry_run:
        print("\n🔍 DRY RUN MODE - No data will be uploaded\n")

    try:
        truncate = not args.no_truncate
        await upload_floods_3layers(
            dry_run=args.dry_run,
            storage_only=args.storage_only,
            truncate=truncate,
            no_geojson=args.no_geojson,
            csv_path_override=Path(args.csv) if args.csv else None,
            upload_storage=args.upload_storage,
            storage_bucket=args.storage_bucket,
            storage_path=args.storage_path,
            upload_csv_storage=args.upload_csv_storage,
            storage_csv_path=args.storage_csv_path,
            unique_id=args.unique_id,
            start_id=args.start_id,
            write_csv=args.write_csv,
            drop_flood_id=args.drop_flood_id,
        )

        if not args.dry_run:
            print("="*70)
            print("✓ Upload completed successfully!")
            print("="*70 + "\n")

    except Exception as e:
        print(f"\n✗ Upload failed: {e}\n")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
