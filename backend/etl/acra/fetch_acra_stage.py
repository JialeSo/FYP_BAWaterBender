import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd
import requests

from backend.etl.common.pipeline_stage import PipelineStage

logger = logging.getLogger(__name__)


# Default ACRA dataset IDs (A-Z and Others from data.gov.sg)
DEFAULT_ACRA_DATASET_IDS = [
    "d_8575e84912df3c28995b8e6e0e05205a",
    "d_3a3807c023c61ddfba947dc069eb53f2",
    "d_c0650f23e94c42e7a20921f4c5b75c24",
    "d_acbc938ec77af18f94cecc4a7c9ec720",
    "d_124a9bd407c7a25f8335b93b86e50fdd",
    "d_4526d47d6714d3b052eed4a30b8b1ed6",
    "d_b58303c68e9cf0d2ae93b73ffdbfbfa1",
    "d_fa2ed456cf2b8597bb7e064b08fc3c7c",
    "d_85518d970b8178975850457f60f1e738",
    "d_478f45a9c541cbe679ca55d1cd2b970b",
    "d_5573b0db0575db32190a2ad27919a7aa",
    "d_a2141adf93ec2a3c2ec2837b78d6d46e",
    "d_9af9317c646a1c881bb5591c91817cc6",
    "d_67e99e6eabc4aad9b5d48663b579746a",
    "d_5c4ef48b025fdfbc80056401f06e3df9",
    "d_300ddc8da4e8f7bdc1bfc62d0d99e2e7",
    "d_181005ca270b45408b4cdfc954980ca2",
    "d_4130f1d9d365d9f1633536e959f62bb7",
    "d_2b8c54b2a490d2fa36b925289e5d9572",
    "d_df7d2d661c0c11a7c367c9ee4bf896c1",
    "d_72f37e5c5d192951ddc5513c2b134482",
    "d_0cc5f52a1f298b916f317800251057f3",
    "d_e97e8e7fc55b85a38babf66b0fa46b73",
    "d_af2042c77ffaf0db5d75561ce9ef5688",
    "d_1cd970d8351b42be4a308d628a6dd9d3",
    "d_31af23fdb79119ed185c256f03cb5773",
    "d_4e3db8955fdcda6f9944097bef3d2724",
]

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

    def __init__(self, dataset_ids: Optional[List[str]] = None):
        super().__init__("Fetch ACRA (data.gov.sg)")
        self.dataset_ids = dataset_ids or DEFAULT_ACRA_DATASET_IDS
        self.session = self._get_session()

    def _get_session(self) -> requests.Session:
        s = requests.Session()
        headers = {"referer": "https://colab.research.google.com"}
        api_key = os.getenv("DATA_GOV_API_KEY") or os.getenv("data_gov_api_key")
        if api_key:
            headers["api-key"] = api_key
            headers["x-api-key"] = api_key
        s.headers.update(headers)
        return s

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
