"""Simple standalone test for data.gov.sg API call."""
import os
import requests
from pathlib import Path

# Load .env file manually
env_file = Path(__file__).resolve().parent.parent.parent / ".env"
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            if line.strip() and not line.startswith("#"):
                key, _, value = line.partition("=")
                os.environ[key.strip()] = value.strip()

def test_api_call():
    """Test the data.gov.sg API call to fetch ACRA dataset IDs."""
    print("=" * 80)
    print("Testing data.gov.sg Collection Metadata API")
    print("=" * 80)

    # Get API key
    api_key = os.getenv("DATA_GOV_API_KEY") or os.getenv("data_gov_api_key")
    print(f"\nAPI Key found: {'Yes' if api_key else 'No'}")
    if api_key:
        print(f"API Key (first 20 chars): {api_key[:20]}...")

    # Prepare request
    collection_id = 2
    url = f"https://api-production.data.gov.sg/v2/public/api/collections/{collection_id}/metadata?withDatasetMetadata=true"

    headers = {"referer": "https://colab.research.google.com"}
    if api_key:
        headers["api-key"] = api_key
        headers["x-api-key"] = api_key

    print(f"\nCalling: {url}")
    print(f"Headers: {list(headers.keys())}")

    # Make request
    try:
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()

        data = response.json()
        print(f"\n✓ API call successful!")
        print(f"Response code: {data.get('code')}")

        # Extract dataset IDs
        dataset_ids = []
        if "data" in data and "collectionMetadata" in data["data"]:
            collection_data = data["data"]["collectionMetadata"]
            if "childDatasets" in collection_data:
                dataset_ids = collection_data["childDatasets"]

            # Print collection info
            print(f"\nCollection: {collection_data.get('name')}")
            print(f"Description: {collection_data.get('description', '')[:100]}...")
            print(f"Last Updated: {collection_data.get('lastUpdatedAt')}")

        print(f"\n✓ Found {len(dataset_ids)} dataset IDs:")
        for i, dataset_id in enumerate(dataset_ids, 1):
            print(f"  {i:2d}. {dataset_id}")

        print("\n" + "=" * 80)
        print(f"✓ SUCCESS: Fetched {len(dataset_ids)} ACRA dataset IDs")
        print("=" * 80)

    except requests.exceptions.HTTPError as e:
        print(f"\n✗ HTTP Error: {e}")
        print(f"Response: {e.response.text if hasattr(e, 'response') else 'No response'}")
    except Exception as e:
        print(f"\n✗ Error: {e}")

if __name__ == "__main__":
    test_api_call()
