#!/usr/bin/env python3
"""
Run Floods ETL Pipeline
========================

This script runs the complete floods pipeline:
1. Load floods data from CSV
2. Process through 3 layers (match to PA/SZ/RN)
3. Upload to Supabase database

Usage:
    python backend/etl/floods/run_floods_pipeline.py
"""

import asyncio
import logging
import sys
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.etl.floods.floods_pipeline import run_floods_pipeline

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)


async def main():
    """Run the floods pipeline."""
    logger.info("="*80)
    logger.info("FLOODS ETL PIPELINE")
    logger.info("="*80)

    try:
        await run_floods_pipeline(table_name="flood_3layers")

        logger.info("="*80)
        logger.info("✓ FLOODS PIPELINE COMPLETED SUCCESSFULLY")
        logger.info("="*80)

    except Exception as e:
        logger.error("="*80)
        logger.error(f"✗ FLOODS PIPELINE FAILED: {e}")
        logger.error("="*80)
        raise


if __name__ == "__main__":
    asyncio.run(main())
