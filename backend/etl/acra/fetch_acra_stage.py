import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd
import requests

from backend.etl.common.pipeline_stage import PipelineStage

logger = logging.getLogger(__name__)


# ACRA Collection ID on data.gov.sg
ACRA_COLLECTION_ID = 2

# Target columns to extract
TARGET_COLUMNS = ["uen", "entity_name", "street_name", "building_name", "postal_code"]

# Allowed business statuses
ALLOWED_STATUSES = {
    "Live Company",
    "Live",
    "Converted to LLP",
    "Live (Receiver or Receiver and Manager appointed)",
}


class FetchACRAStage(PipelineStage):
    """Fetch ACRA datasets and consolidate to CSV + records."""

    def __init__(self, dataset_ids: Optional[List[str]] = None, collection_id: int = ACRA_COLLECTION_ID):
        super().__init__("Fetch ACRA (data.gov.sg)")
        self.collection_id = collection_id
        self.session = self._get_session()
        self.dataset_ids = dataset_ids or self._fetch_dataset_ids_from_collection()

    def _get_session(self) -> requests.Session:
        s = requests.Session()
        headers = {"referer": "https://colab.research.google.com"}
        api_key = os.getenv("DATA_GOV_API_KEY") or os.getenv("data_gov_api_key")
        if api_key:
            headers["api-key"] = api_key
            headers["x-api-key"] = api_key
        s.headers.update(headers)
        return s

    def _fetch_dataset_ids_from_collection(self) -> List[str]:
        """Fetch all dataset IDs from the ACRA collection metadata."""
        try:
            url = f"https://api-production.data.gov.sg/v2/public/api/collections/{self.collection_id}/metadata?withDatasetMetadata=true"
            logger.info(f"Fetching collection metadata from data.gov.sg (collection_id={self.collection_id})")

            response = self.session.get(url, timeout=30)
            response.raise_for_status()

            data = response.json()

            # Extract dataset IDs from childDatasets in collectionMetadata
            dataset_ids = []
            if "data" in data and "collectionMetadata" in data["data"]:
                collection_data = data["data"]["collectionMetadata"]
                if "childDatasets" in collection_data:
                    dataset_ids = collection_data["childDatasets"]

            logger.info(f"Found {len(dataset_ids)} datasets in collection {self.collection_id}")

            if not dataset_ids:
                logger.warning("No dataset IDs found in collection metadata!")

            return dataset_ids

        except Exception as e:
            logger.error(f"Failed to fetch collection metadata: {e}")
            logger.warning("Falling back to empty dataset list")
            return []

    def _download_dataset(self, dataset_id: str) -> Optional[pd.DataFrame]:
        headers = {"Content-Type": "application/json"}
        headers.update(self.session.headers)
        try:
            logger.info(f"Initiating download for dataset {dataset_id}")
            init_resp = self.session.get(
                f"https://api-open.data.gov.sg/v1/public/api/datasets/{dataset_id}/initiate-download",
                headers=headers,
                json={},
                timeout=60,
            )
            init_resp.raise_for_status()

            MAX_POLLS = 5
            for i in range(MAX_POLLS):
                poll_resp = self.session.get(
                    f"https://api-open.data.gov.sg/v1/public/api/datasets/{dataset_id}/poll-download",
                    headers=headers,
                    json={},
                    timeout=60,
                )
                poll_resp.raise_for_status()
                url = (poll_resp.json() or {}).get("data", {}).get("url")
                if url:
                    logger.info(f"\u2713 Got download URL for {dataset_id}, reading CSV...")
                    df = pd.read_csv(url, dtype=str)
                    for col in df.columns:
                        try:
                            df[col] = df[col].astype(str).str.strip()
                        except Exception:
                            pass
                    if "entity_status_description" in df.columns:
                        original_count = len(df)
                        df = df[df["entity_status_description"].isin(ALLOWED_STATUSES)]
                        logger.info(f"  Filtered {original_count} → {len(df)} rows by status")
                    else:
                        logger.warning(f"  No entity_status_description column found in {dataset_id}")
                    for col in TARGET_COLUMNS:
                        if col not in df.columns:
                            df[col] = ""
                    df = df[TARGET_COLUMNS].copy().dropna(how="all")
                    logger.info(f"  Retrieved {len(df)} records from {dataset_id}")
                    return df
                if i < MAX_POLLS - 1:
                    logger.debug(f"  Poll {i+1}/{MAX_POLLS}: No URL yet, waiting...")
                    time.sleep(3)
            logger.warning(f"{dataset_id}: No download URL after {MAX_POLLS} polls")
            return None
        except Exception as e:
            logger.error(f"{dataset_id}: Download failed - {e}")
            return None

    async def process(self, data: Any) -> List[Dict[str, Any]]:
        logger.info(f"Fetching {len(self.dataset_ids)} ACRA datasets from data.gov.sg")
        logger.info(f"Filtering by statuses: {', '.join(ALLOWED_STATUSES)}")
        logger.info(f"Keeping columns: {', '.join(TARGET_COLUMNS)}")

        frames: List[pd.DataFrame] = []
        for dataset_id in self.dataset_ids:
            df = self._download_dataset(dataset_id)
            if df is not None and not df.empty:
                frames.append(df)

        if not frames:
            logger.warning("No data downloaded from any dataset!")
            return []

        combined = pd.concat(frames, ignore_index=True, sort=False)
        for col in TARGET_COLUMNS:
            if col not in combined.columns:
                combined[col] = ""
        combined = combined[TARGET_COLUMNS]

        logger.info("=" * 80)
        logger.info(f"\u2713 Total consolidated: {len(combined):,} ACRA records")
        logger.info(f"\u2713 Columns: {list(combined.columns)}")
        logger.info(f"\u2713 Expected: ~600,000 records (if all statuses filtered correctly)")
        logger.info("=" * 80)

        # Save consolidated CSV to ACRA data directory only
        output_dir = Path(__file__).resolve().parent / "data"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_file = output_dir / "acra_all.csv"
        combined.to_csv(output_file, index=False)
        logger.info(f"\u2713 Saved consolidated data to {output_file}")

        return combined.to_dict("records")
