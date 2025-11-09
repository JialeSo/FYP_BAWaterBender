#!/usr/bin/env python3
"""
Run ACRA ETL Pipeline
======================

This script runs the complete ACRA pipeline:
1. Fetch ACRA datasets from data.gov.sg
2. Transform and filter business data
3. Geocode by postal code
4. Upload to Supabase database

Usage:
    python backend/etl/acra/run_acra_pipeline.py
"""

import asyncio
import logging
import sys
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.etl.acra.pipeline import run_once

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)


async def main():
    """Run the ACRA pipeline."""
    logger.info("="*80)
    logger.info("ACRA ETL PIPELINE")
    logger.info("="*80)

    try:
        # Optional: respect env flags for quick iteration
        import os
        skip_fetch = os.getenv("SKIP_FETCH", "0").lower() in {"1", "true", "yes"}
        csv_path = os.getenv("ACRA_CSV_PATH")
        await run_once(table_name="acra_companies", skip_fetch=skip_fetch, csv_path=csv_path)

        logger.info("="*80)
        logger.info("✓ ACRA PIPELINE COMPLETED SUCCESSFULLY")
        logger.info("="*80)

    except Exception as e:
        logger.error("="*80)
        logger.error(f"✗ ACRA PIPELINE FAILED: {e}")
        logger.error("="*80)
        raise


if __name__ == "__main__":
    asyncio.run(main())
