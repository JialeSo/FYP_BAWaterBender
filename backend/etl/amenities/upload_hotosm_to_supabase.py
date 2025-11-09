#!/usr/bin/env python3
"""
One-Time HOTOSM Data Upload to Supabase
========================================

This script uploads HOTOSM GeoJSON data to Supabase for efficient retrieval
during the amenities pipeline. Run this once to populate the database.

Usage:
    python backend/etl/amenities/upload_hotosm_to_supabase.py
"""

import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.common.db import DatabaseConnection

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)

# Paths
SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR.parent / "data"
HOTOSM_FILE = DATA_DIR / "geojson" / "layers" / "hotosm_new.geojson"

# Supabase table name
TABLE_NAME = "hdx_amenities"


def load_hotosm_geojson() -> List[Dict[str, Any]]:
    """Load HOTOSM GeoJSON file and extract features.

    Returns:
        List of feature dictionaries with properties and geometry
    """
    logger.info(f"Loading HOTOSM data from: {HOTOSM_FILE}")

    if not HOTOSM_FILE.exists():
        raise FileNotFoundError(f"HOTOSM file not found: {HOTOSM_FILE}")

    with open(HOTOSM_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    features = data.get('features', [])
    logger.info(f"Loaded {len(features):,} features from HOTOSM GeoJSON")

    return features


def prepare_records_for_db(features: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Convert GeoJSON features to database records.

    Args:
        features: List of GeoJSON features

    Returns:
        List of records ready for database insertion
    """
    records = []

    for feature in features:
        properties = feature.get('properties', {})
        geometry = feature.get('geometry', {})

        # Extract coordinates
        coords = geometry.get('coordinates', [])
        geom_type = geometry.get('type', 'Point')

        if geom_type == 'Point' and len(coords) >= 2:
            lon, lat = coords[0], coords[1]
        elif coords and isinstance(coords[0], list):
            # For non-Point geometries, use first coordinate
            lon, lat = coords[0][0], coords[0][1]
        else:
            lon, lat = None, None

        # Extract only the specific properties we need
        # OSM uses colons in property names (addr:housenumber), which we convert to underscores for DB
        record = {
            # OSM Properties
            'name': properties.get('name'),
            'amenity': properties.get('amenity'),
            'addr_housenumber': properties.get('addr:housenumber'),
            'addr_street': properties.get('addr:street'),
            'addr_city': properties.get('addr:city'),
            'osm_id': str(properties.get('osm_id')) if properties.get('osm_id') else None,
            'osm_type': properties.get('osm_type'),
            'postal_code': properties.get('postal_code'),
            # Geometry
            'geometry': json.dumps(geometry),  # Store full geometry as JSONB
            'geom_type': geom_type,
            'lon': lon,
            'lat': lat,
        }

        records.append(record)

    logger.info(f"Prepared {len(records):,} records for database insertion")
    return records


async def upload_to_supabase(records: List[Dict[str, Any]], batch_size: int = 500):
    """Upload records to Supabase in batches.

    Args:
        records: List of database records
        batch_size: Number of records per batch
    """
    db = DatabaseConnection()

    logger.info(f"Uploading {len(records):,} records to table '{TABLE_NAME}'")
    logger.info(f"Batch size: {batch_size}")

    # Get the Supabase client
    client = db._get_connection()

    # Clear existing data (optional - comment out if you want to append)
    try:
        logger.info(f"Clearing existing data from '{TABLE_NAME}'...")
        client.table(TABLE_NAME).delete().neq('id', -1).execute()
        logger.info("✓ Existing data cleared")
    except Exception as e:
        logger.warning(f"Could not clear existing data (table may not exist yet): {e}")

    # Upload in batches
    total_batches = (len(records) + batch_size - 1) // batch_size

    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        batch_num = (i // batch_size) + 1

        try:
            logger.info(f"Uploading batch {batch_num}/{total_batches} ({len(batch)} records)...")

            # Use upsert to handle potential conflicts
            client.table(TABLE_NAME).upsert(batch).execute()

            logger.info(f"✓ Batch {batch_num}/{total_batches} uploaded successfully")

            # Small delay to avoid rate limiting
            await asyncio.sleep(0.1)

        except Exception as e:
            logger.error(f"✗ Failed to upload batch {batch_num}: {e}")
            raise

    logger.info(f"✓ Successfully uploaded all {len(records):,} records to '{TABLE_NAME}'")


async def main():
    """Main execution function."""
    logger.info("="*80)
    logger.info("HOTOSM DATA UPLOAD TO SUPABASE")
    logger.info("="*80)

    try:
        # Step 1: Load HOTOSM GeoJSON
        features = load_hotosm_geojson()

        # Step 2: Prepare records for database
        records = prepare_records_for_db(features)

        # Step 3: Upload to Supabase
        await upload_to_supabase(records)

        logger.info("="*80)
        logger.info("✓ HOTOSM UPLOAD COMPLETED SUCCESSFULLY")
        logger.info("="*80)
        logger.info(f"Table: {TABLE_NAME}")
        logger.info(f"Records: {len(records):,}")
        logger.info("="*80)

    except Exception as e:
        logger.error("="*80)
        logger.error(f"✗ HOTOSM UPLOAD FAILED: {e}")
        logger.error("="*80)
        import traceback
        traceback.print_exc()
        raise


if __name__ == "__main__":
    asyncio.run(main())
