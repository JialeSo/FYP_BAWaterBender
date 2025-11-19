"""Test script for master pipeline with custom configuration."""
import asyncio
import logging
import sys
from pathlib import Path

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

from backend.etl.master_pipeline import run_master_pipeline

async def test_master_pipeline():
    """Test the master pipeline with custom config."""

    # Optional: customize configuration
    config = {
        "continue_on_error": False,  # Stop on first error
        "acra": {
            "table_name": "acra_companies",
            "skip_fetch": False,  # Set to True to skip fetching and use existing CSV
        },
        "amenities": {
            "table_name": "amenities",
        },
        "floods": {
            "table_name": "floods",
        }
    }

    print("=" * 80)
    print("Testing Master Pipeline")
    print("=" * 80)

    try:
        # Run the complete pipeline
        await run_master_pipeline(config)
        print("\n✓ Master pipeline test completed successfully!")
        return 0

    except Exception as e:
        print(f"\n✗ Master pipeline test failed: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(asyncio.run(test_master_pipeline()))
