#!/usr/bin/env python3
"""
Upload Amenities Data to Supabase
==================================

This script uploads the amenities_3layers.csv and amenity lookup tables
to Supabase using the common database connection.

Usage:
------
    # Upload all tables (amenities_3layers, amenity_category_lookup)
    python backend/etl/scripts/upload_amenities_to_supabase.py

    # Upload only amenities_3layers
    python backend/etl/scripts/upload_amenities_to_supabase.py --amenities-only

    # Upload only lookup tables
    python backend/etl/scripts/upload_amenities_to_supabase.py --lookups-only

    # Dry run (preview without uploading)
    python backend/etl/scripts/upload_amenities_to_supabase.py --dry-run
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

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PROJECT_ROOT))

from backend.etl.common import Pipeline, AmenitiesDatabaseWriteStage, DatabaseWriteStage


def _resolve_lookup_path(filename: str) -> Path:
    """Resolve lookup CSV path, trying data root then amenities subdir."""
    root = PROJECT_ROOT / "backend" / "etl" / "data" / filename
    if root.exists():
        return root
    alt = PROJECT_ROOT / "backend" / "etl" / "data" / "amenities" / filename
    return alt

# Allow overriding the target table via env; default to singular as requested
AMENITIES_TABLE = os.getenv("AMENITIES_TABLE", "amenity_3layers")


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


async def upload_amenity_category_lookup(dry_run: bool = False) -> None:
    """Upload amenity_category_lookup.csv to Supabase."""
    csv_path = _resolve_lookup_path("amenity_category_lookup.csv")

    if not csv_path.exists():
        print(f"⚠ Warning: {csv_path} not found. Skipping.")
        return

    preview_csv(csv_path, "amenity_category_lookup")

    if dry_run:
        print("🔍 DRY RUN - Skipping upload\n")
        return

    # Create pipeline with database write stage
    pipeline = Pipeline(
        name="Upload Amenity Category Lookup",
        stages=[
            DatabaseWriteStage(
                table_name="amenity_category_lookup",
                config={
                    "batch_size": 100,
                }
            )
        ]
    )

    # Read CSV and convert to records
    df = pd.read_csv(csv_path)
    records = df.to_dict(orient="records")

    print(f"📤 Uploading {len(records)} amenity categories to Supabase...")

    try:
        await pipeline.run(initial_data=records)
        print(f"✓ Successfully uploaded amenity_category_lookup\n")
    except Exception as e:
        print(f"✗ Failed to upload amenity_category_lookup: {e}\n")
        raise


async def upload_amenity_group_lookup(dry_run: bool = False) -> None:
    """Upload amenity_group_lookup.csv to Supabase."""
    csv_path = _resolve_lookup_path("amenity_group_lookup.csv")

    if not csv_path.exists():
        print(f"⚠ Warning: {csv_path} not found. Skipping.")
        return

    preview_csv(csv_path, "amenity_group_lookup")

    if dry_run:
        print("🔍 DRY RUN - Skipping upload\n")
        return

    pipeline = Pipeline(
        name="Upload Amenity Group Lookup",
        stages=[
            DatabaseWriteStage(
                table_name="amenity_group_lookup",
                config={
                    "batch_size": 100,
                }
            )
        ]
    )

    df = pd.read_csv(csv_path)
    records = df.to_dict(orient="records")

    print(f"📤 Uploading {len(records)} amenity groups to Supabase...")

    try:
        await pipeline.run(initial_data=records)
        print(f"✓ Successfully uploaded amenity_group_lookup\n")
    except Exception as e:
        print(f"✗ Failed to upload amenity_group_lookup: {e}\n")
        raise


async def upload_planning_area_lookup(dry_run: bool = False) -> None:
    """Upload planning_area_lookup.csv (columns: pa_id, planning_area)."""
    csv_path = _resolve_lookup_path("planning_area_lookup.csv")

    if not csv_path.exists():
        print(f"⚠ Warning: {csv_path} not found. Skipping.")
        return

    preview_csv(csv_path, "planning_area_lookup")

    if dry_run:
        print("🔍 DRY RUN - Skipping upload\n")
        return

    pipeline = Pipeline(
        name="Upload Planning Area Lookup",
        stages=[
            DatabaseWriteStage(
                table_name="planning_area_lookup",
                config={
                    "batch_size": 200,
                }
            )
        ]
    )

    df = pd.read_csv(csv_path)
    records = df.to_dict(orient="records")

    print(f"📤 Uploading {len(records)} planning areas to Supabase...")

    try:
        await pipeline.run(initial_data=records)
        print(f"✓ Successfully uploaded planning_area_lookup\n")
    except Exception as e:
        print(f"✗ Failed to upload planning_area_lookup: {e}\n")
        raise


async def upload_subzone_lookup(dry_run: bool = False) -> None:
    """Upload subzone_lookup.csv (columns: sz_id, subzone)."""
    csv_path = _resolve_lookup_path("subzone_lookup.csv")

    if not csv_path.exists():
        print(f"⚠ Warning: {csv_path} not found. Skipping.")
        return

    preview_csv(csv_path, "subzone_lookup")

    if dry_run:
        print("🔍 DRY RUN - Skipping upload\n")
        return

    pipeline = Pipeline(
        name="Upload Subzone Lookup",
        stages=[
            DatabaseWriteStage(
                table_name="subzone_lookup",
                config={
                    "batch_size": 500,
                }
            )
        ]
    )

    df = pd.read_csv(csv_path)
    records = df.to_dict(orient="records")

    print(f"📤 Uploading {len(records)} subzones to Supabase...")

    try:
        await pipeline.run(initial_data=records)
        print(f"✓ Successfully uploaded subzone_lookup\n")
    except Exception as e:
        print(f"✗ Failed to upload subzone_lookup: {e}\n")
        raise


# Road lookup upload removed per latest requirements


def _upload_to_supabase_storage(local_path: Path, bucket: str, object_path: str) -> None:
    """Upload a file to Supabase Storage with best-effort compatibility."""
    from backend.config.config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    from supabase import create_client

    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    data = local_path.read_bytes()

    # Prefer modern signatures, fall back to legacy
    try:
        client.storage.from_(bucket).upload(
            object_path,
            data,
            {"content-type": "application/geo+json", "upsert": True},
        )
    except TypeError:
        try:
            client.storage.from_(bucket).upload(
                file=data,
                path=object_path,
                file_options={"contentType": "application/geo+json", "upsert": True},
            )
        except Exception as e:
            raise e


async def upload_amenities_3layers(
    dry_run: bool = False,
    storage_only: bool = False,
    truncate: bool = True,
    no_geojson: bool = False,
    csv_path_override: Path | None = None,
    upload_storage: bool = False,
    storage_bucket: str | None = None,
    storage_path: str | None = None,
    drop_columns: str | None = None,
    drop_amenity_group: bool = False,
) -> None:
    """Upload amenities_3layers.csv to Supabase and optionally emit GeoJSON.

    If ``csv_path_override`` is provided, that file is used instead of the
    default ``frontend/public/map/amenities_3layers.csv``.
    """
    csv_path = (
        csv_path_override
        if csv_path_override is not None
        else PROJECT_ROOT / "frontend" / "public" / "map" / "amenities_3layers.csv"
    )

    if not csv_path.exists():
        print(f"⚠ Warning: {csv_path} not found. Skipping.")
        return

    preview_csv(csv_path, AMENITIES_TABLE)

    # Read CSV
    df = pd.read_csv(csv_path)

    # Normalize ID column for DB schema that uses 'id' instead of 'amenity_id'
    if 'id' not in df.columns and 'amenity_id' in df.columns:
        df['id'] = df['amenity_id']
    # Drop legacy column to avoid schema mismatch
    if 'amenity_id' in df.columns and 'id' in df.columns:
        df = df.drop(columns=['amenity_id'])

    # Filter out amenities from planning areas 24, 27, and 31
    excluded_pa_ids = [24, 27, 31]
    original_count = len(df)
    df = df[~df['pa_id'].isin(excluded_pa_ids)]
    filtered_count = original_count - len(df)

    if filtered_count > 0:
        print(f"🔍 Filtered out {filtered_count:,} amenities from planning areas {excluded_pa_ids}")
        print(f"   Remaining: {len(df):,} amenities\n")

    # Deduplicate on conflict key (amenity_type, id) to avoid
    # Postgres "ON CONFLICT DO UPDATE ... cannot affect row a second time"
    before = len(df)
    subset_cols = [c for c in ['amenity_type', 'id'] if c in df.columns]
    if len(subset_cols) == 2:
        df = df.drop_duplicates(subset=subset_cols, keep='last')
    removed = before - len(df)
    if removed > 0:
        print(f"🔁 Removed {removed:,} duplicate amenities by (amenity_type, id) within CSV")

    # Optionally drop columns not present in DB schema
    drop_list = []
    if drop_columns:
        drop_list.extend([c.strip() for c in drop_columns.split(",") if c.strip()])
    if drop_amenity_group:
        drop_list.append("amenity_group_id")
        drop_list.append("amenity_group")
    if drop_list:
        existing = [c for c in drop_list if c in df.columns]
        if existing:
            print(f"🧹 Dropping columns not in DB schema: {existing}")
            df = df.drop(columns=existing)

    # Strict sanitize NaN/Inf before JSON upload
    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.where(pd.notnull(df), None)

    # Force float columns to pure Python types and NULLs
    float_columns = ['lat', 'lon']
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

    # If lat/lon exist, also populate PostGIS geometry (EWKT) for direct DB upload
    # This makes the upload include geometry even if consumers don't use the GeoJSON file.
    populated_geom = 0
    for rec in records:
        lon = rec.get("lon")
        lat = rec.get("lat")
        if isinstance(lon, (int, float)) and isinstance(lat, (int, float)):
            # SRID-tagged WKT so PostgREST can cast to geometry(Point,4326)
            rec["geom"] = f"SRID=4326;POINT({lon} {lat})"
            populated_geom += 1
        else:
            # Ensure we don't send invalid geometry values
            rec.pop("geom", None)

    if populated_geom:
        print(f"🧭 Prepared geometry for {populated_geom:,} amenities (EWKT, SRID=4326)")

    # Validate JSON compatibility (no NaN/Inf)
    try:
        json.dumps(records, allow_nan=False)
    except ValueError:
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
        json.dumps(records, allow_nan=False)

    # Optional GeoJSON export (skip when --no-geojson)
    geojson_path: Path | None = None
    if not no_geojson:
        try:
            from shapely.geometry import Point
            import geopandas as gpd
            geojson_path = csv_path.parent / "amenities_3layers.geojson"
            print(f"\n📍 Creating GeoJSON from coordinates...")
            geometry = [Point(xy) for xy in zip(df['lon'], df['lat'])]
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
            object_path = storage_path or "map/amenities_3layers.geojson"
            try:
                print(f"☁️  Uploading GeoJSON to storage bucket '{bucket}' as '{object_path}'...")
                _upload_to_supabase_storage(geojson_path, bucket, object_path)
                print("  ✓ Storage upload complete")
                # If bucket is public, print public URL hint
                from backend.config.config import SUPABASE_URL
                public_url = f"{SUPABASE_URL}/storage/v1/object/public/{bucket}/{object_path}"
                print(f"  🔗 Public URL (if bucket is public): {public_url}\n")
            except Exception as e:
                print(f"  ⚠ Failed to upload GeoJSON to Storage: {e}\n")

    if dry_run or storage_only:
        print("🔍 DRY RUN - Skipping Supabase upload\n")
        return

    # Truncate existing table if requested
    if truncate:
        print(f"🗑️  Truncating existing '{AMENITIES_TABLE}' table...")
        try:
            from backend.common.db import DatabaseConnection
            db = DatabaseConnection()
            client = db._get_connection()
            # Delete all existing rows
            client.table(AMENITIES_TABLE).delete().neq('id', 0).execute()
            print(f"  ✓ Table truncated\n")
        except Exception as e:
            print(f"  ⚠ Warning: Could not truncate table: {e}\n")

    # Create pipeline with database write stage
    pipeline = Pipeline(
        name="Upload Amenity 3 Layers",
        stages=[
            DatabaseWriteStage(
                table_name=AMENITIES_TABLE,
                config={
                    "batch_size": 1000,
                    # Use 'id' for conflict resolution to match table schema
                    "on_conflict": "id",
                }
            )
        ]
    )

    print(f"📤 Uploading {len(records):,} records to Supabase table '{AMENITIES_TABLE}'...")

    try:
        await pipeline.run(initial_data=records)
        print(f"✓ Successfully uploaded {len(records):,} records to '{AMENITIES_TABLE}'\n")
    except Exception as e:
        print(f"✗ Failed to upload to table '{AMENITIES_TABLE}': {e}\n")
        raise


async def main():
    parser = argparse.ArgumentParser(
        description="Upload amenities data to Supabase",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument(
        "--amenities-only",
        action="store_true",
        help="Upload only amenities_3layers table"
    )
    parser.add_argument(
        "--lookups-only",
        action="store_true",
        help="Upload only lookup tables (amenity_category, planning_area, subzone)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview files without uploading"
    )
    parser.add_argument(
        "--storage-only",
        action="store_true",
        help="Generate and upload GeoJSON to Storage only; skip DB write",
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
        "--csv",
        type=str,
        help="Path to an existing amenities_3layers CSV to upload from",
    )
    parser.add_argument(
        "--drop-columns",
        type=str,
        help="Comma-separated list of columns to drop before upload",
    )
    parser.add_argument(
        "--no-group-col",
        action="store_true",
        help="Drop amenity_group_id and amenity_group columns before upload",
    )
    parser.add_argument(
        "--upload-storage",
        action="store_true",
        help="Upload generated GeoJSON to Supabase Storage",
    )
    parser.add_argument(
        "--storage-bucket",
        type=str,
        help="Supabase Storage bucket name (default: public-assets)",
    )
    parser.add_argument(
        "--storage-path",
        type=str,
        help="Object path within the bucket (default: map/amenities_3layers.geojson)",
    )

    args = parser.parse_args()

    print("\n" + "="*70)
    print("AMENITIES DATA UPLOAD TO SUPABASE")
    print("="*70)

    if args.dry_run:
        print("\n🔍 DRY RUN MODE - No data will be uploaded\n")

    try:
        truncate = not args.no_truncate

        # Upload based on flags
        if args.lookups_only:
            await upload_amenity_category_lookup(dry_run=args.dry_run)
            await upload_amenity_group_lookup(dry_run=args.dry_run)
            await upload_planning_area_lookup(dry_run=args.dry_run)
            await upload_subzone_lookup(dry_run=args.dry_run)
        elif args.amenities_only:
            await upload_amenities_3layers(
            dry_run=args.dry_run,
            storage_only=args.storage_only,
            truncate=truncate,
            no_geojson=args.no_geojson,
            csv_path_override=Path(args.csv) if args.csv else None,
            upload_storage=args.upload_storage,
            storage_bucket=args.storage_bucket,
            storage_path=args.storage_path,
            drop_columns=args.drop_columns,
            drop_amenity_group=args.no_group_col,
        )
        else:
            # Upload all by default
            await upload_amenity_category_lookup(dry_run=args.dry_run)
            await upload_amenity_group_lookup(dry_run=args.dry_run)
            await upload_planning_area_lookup(dry_run=args.dry_run)
            await upload_subzone_lookup(dry_run=args.dry_run)
            await upload_amenities_3layers(
                dry_run=args.dry_run,
                truncate=truncate,
                no_geojson=args.no_geojson,
                csv_path_override=Path(args.csv) if args.csv else None,
                upload_storage=args.upload_storage,
                storage_bucket=args.storage_bucket,
                storage_path=args.storage_path,
                drop_columns=args.drop_columns,
                drop_amenity_group=args.no_group_col,
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
