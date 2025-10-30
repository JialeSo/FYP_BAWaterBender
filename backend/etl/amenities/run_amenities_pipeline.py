#!/usr/bin/env python3
"""
Run Amenities ETL Pipeline
===========================

This script runs the complete amenities pipeline:
1. Fetch and consolidate amenities from OneMap API, GeoJSON files, OSM data
2. Process through 3 layers (geocode to PA/SZ, classify, match roads)
3. Upload to Supabase database

Usage:
    python backend/etl/amenities/run_amenities_pipeline.py
"""

import asyncio
import logging
import sys
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.etl.amenities.amenities_pipeline import run_amenities_pipeline

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)


async def main():
    """Run the amenities pipeline."""
    logger.info("="*80)
    logger.info("AMENITIES ETL PIPELINE")
    logger.info("="*80)

    try:
        # Write to the final table name used by the app/frontend
        await run_amenities_pipeline(table_name="amenity_3layers")

        logger.info("="*80)
        logger.info("✓ AMENITIES PIPELINE COMPLETED SUCCESSFULLY")
        logger.info("="*80)

    except Exception as e:
        logger.error("="*80)
        logger.error(f"✗ AMENITIES PIPELINE FAILED: {e}")
        logger.error("="*80)
        raise


if __name__ == "__main__":
    asyncio.run(main())
