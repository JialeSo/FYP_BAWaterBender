"""Quick test script to verify collection metadata fetching."""
import logging
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))

from backend.etl.acra.fetch_acra_stage import FetchACRAStage

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

def test_fetch_dataset_ids():
    """Test fetching dataset IDs from collection."""
    print("=" * 80)
    print("Testing ACRA Collection Metadata Fetch")
    print("=" * 80)

    # Create stage instance (this will trigger the API call)
    stage = FetchACRAStage()

    print(f"\nDataset IDs fetched: {len(stage.dataset_ids)}")
    print("\nDataset IDs:")
    for i, dataset_id in enumerate(stage.dataset_ids, 1):
        print(f"  {i}. {dataset_id}")

    print("=" * 80)
    print(f"✓ Successfully fetched {len(stage.dataset_ids)} dataset IDs")
    print("=" * 80)

if __name__ == "__main__":
    test_fetch_dataset_ids()
