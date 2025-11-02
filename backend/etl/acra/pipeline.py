import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import requests

from backend.etl.common.pipeline import Pipeline
from backend.etl.common.pipeline_stage import PipelineStage
from backend.etl.common.database_write_stage import DatabaseWriteStage
from backend.config.config import LOCATIONIQ_FORWARD_URL, LOCATIONIQ_KEY
from backend.etl.acra.geocode_postal_onemap_stage import GeocodePostalOneMapStage

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
    """
    Fetch ACRA datasets from data.gov.sg using open-download API.

    Uses the working v2 open-download API to fetch ACRA business data
    from curated dataset IDs (A-Z and Others).
    """

    def __init__(self, dataset_ids: Optional[List[str]] = None):
        super().__init__("Fetch ACRA (data.gov.sg)")
        self.dataset_ids = dataset_ids or DEFAULT_ACRA_DATASET_IDS
        self.session = self._get_session()

    def _get_session(self) -> requests.Session:
        """Create session with data.gov.sg headers."""
        s = requests.Session()
        headers = {"referer": "https://colab.research.google.com"}

        # Add API key if available
        api_key = os.getenv("DATA_GOV_API_KEY") or os.getenv("data_gov_api_key")
        if api_key:
            headers["api-key"] = api_key
            headers["x-api-key"] = api_key

        s.headers.update(headers)
        return s

    def _download_dataset(self, dataset_id: str) -> Optional[pd.DataFrame]:
        """Download a single dataset using open-download API."""
        headers = {"Content-Type": "application/json"}
        headers.update(self.session.headers)

        try:
            # Step 1: Initiate download
            logger.info(f"Initiating download for dataset {dataset_id}")
            init_resp = self.session.get(
                f"https://api-open.data.gov.sg/v1/public/api/datasets/{dataset_id}/initiate-download",
                headers=headers,
                json={},
                timeout=60,
            )
            init_resp.raise_for_status()
            msg = (init_resp.json() or {}).get("data", {}).get("message")
            if msg:
                logger.debug(f"{dataset_id}: {msg}")

            # Step 2: Poll for download URL
            MAX_POLLS = 5
            for i in range(MAX_POLLS):
                poll_resp = self.session.get(
                    f"https://api-open.data.gov.sg/v1/public/api/datasets/{dataset_id}/poll-download",
                    headers=headers,
                    json={},
                    timeout=60,
                )
                poll_resp.raise_for_status()
                poll_data = (poll_resp.json() or {}).get("data", {})

                url = poll_data.get("url")
                if url:
                    logger.info(f"✓ Got download URL for {dataset_id}, reading CSV...")
                    # Download and filter the CSV
                    df = pd.read_csv(url, dtype=str)

                    # Normalize strings
                    for col in df.columns:
                        try:
                            df[col] = df[col].astype(str).str.strip()
                        except Exception:
                            pass

                    # Filter by allowed statuses FIRST (before selecting columns)
                    if "entity_status_description" in df.columns:
                        original_count = len(df)
                        df = df[df["entity_status_description"].isin(ALLOWED_STATUSES)]
                        logger.info(f"  Filtered {original_count} → {len(df)} rows by status")
                    else:
                        logger.warning(f"  No entity_status_description column found in {dataset_id}")

                    # Ensure target columns exist
                    for col in TARGET_COLUMNS:
                        if col not in df.columns:
                            df[col] = ""

                    # Select only target columns (after filtering)
                    df = df[TARGET_COLUMNS].copy()

                    df = df.dropna(how="all")
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
        """Fetch all ACRA datasets and combine into records."""
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

        # Combine all datasets
        combined = pd.concat(frames, ignore_index=True, sort=False)

        # Ensure column order
        for col in TARGET_COLUMNS:
            if col not in combined.columns:
                combined[col] = ""
        combined = combined[TARGET_COLUMNS]

        logger.info("="*80)
        logger.info(f"✓ Total consolidated: {len(combined):,} ACRA records")
        logger.info(f"✓ Columns: {list(combined.columns)}")
        logger.info(f"✓ Expected: ~600,000 records (if all statuses filtered correctly)")
        logger.info("="*80)

        # Save consolidated CSV to ACRA data directory only
        output_dir = Path(__file__).resolve().parent / "data"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_file = output_dir / "acra_all.csv"

        combined.to_csv(output_file, index=False)
        logger.info(f"✓ Saved consolidated data to {output_file}")

        # Convert to list of dicts
        return combined.to_dict('records')


class TransformACRAStage(PipelineStage):
    """
    Transform and clean ACRA rows.

    This stage:
    - Normalizes postal codes to 6 digits
    - Ensures required fields are present
    - Maps entity_name to amenity_name for database compatibility
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__("Transform ACRA", config)

    async def process(self, data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not isinstance(data, list):
            return []

        out: List[Dict[str, Any]] = []
        for row in data:
            if not isinstance(row, dict):
                continue

            # Extract fields
            uen = row.get("uen", "").strip()
            # Accept either entity_name (raw ACRA) or amenity_name (previously processed CSV)
            entity_name = (row.get("entity_name") or row.get("amenity_name") or "").strip().lower()
            street_name = (row.get("street_name") or "").strip().lower()
            building_name = (row.get("building_name") or "").strip().lower()
            postal_code = row.get("postal_code", "").strip()

            # Skip if missing required fields (require uen and a valid postal)
            if not (uen and postal_code):
                continue

            # Normalize postal to 6-digit string
            digits = "".join(ch for ch in str(postal_code) if ch.isdigit())
            if len(digits) == 6:
                postal_code = digits
            elif not digits:
                continue  # Skip if no valid postal code

            # Create output record with database-compatible field name
            out.append({
                "uen": uen,
                "amenity_name": entity_name,  # Mapped for database compatibility
                "street_name": street_name,
                "building_name": building_name,
                "postal_code": postal_code,
            })

        logger.info(f"Transformed rows: {len(out)}")
        if len(out) == 0:
            logger.warning(
                "Transform produced 0 rows. If loading an already-processed CSV, ensure it contains postal_code and uen; amenity/entity name is optional."
            )
        return out


class CheckGeocodeCompletenessStage(PipelineStage):
    """Validate geocoding completeness before uploading to Supabase.

    Aborts the pipeline if rows missing latitude/longitude pairs exceed the
    allowed threshold (default: 10,000).
    """

    def __init__(self, max_missing_pairs: int = 10_000):
        super().__init__("Validate Geocode Completeness")
        # Fixed threshold; no env override
        self.max_missing_pairs = max_missing_pairs

    async def process(self, data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not isinstance(data, list) or not data:
            return data

        total = len(data)
        missing = 0
        for row in data:
            lat = row.get("latitude")
            lon = row.get("longitude")
            if lat is None or lon is None:
                missing += 1

        logger.info("=" * 80)
        logger.info(
            f"Geocode completeness check: total={total:,}, complete={(total - missing):,}, missing={missing:,}"
        )
        logger.info(
            f"Threshold (max missing allowed before upload): {self.max_missing_pairs:,}"
        )
        logger.info("=" * 80)

        if missing > self.max_missing_pairs:
            raise RuntimeError(
                f"Abort upload: Missing lat/lon pairs {missing:,} exceeds threshold {self.max_missing_pairs:,}"
            )

        return data


class LoadACRAFromCsvStage(PipelineStage):
    """Lightweight loader to read pre-fetched ACRA CSV when skipping fetch."""

    def __init__(self, csv_path: Optional[Path] = None):
        super().__init__("Load ACRA from CSV")
        self.csv_path = Path(csv_path) if csv_path else (Path(__file__).resolve().parent / "data" / "acra_all.csv")

    async def process(self, data: Any) -> List[Dict[str, Any]]:
        path = self.csv_path
        if not path.exists():
            raise FileNotFoundError(f"ACRA CSV not found at {path}")
        df = pd.read_csv(path, dtype=str)
        for c in df.columns:
            try:
                df[c] = df[c].astype(str).str.strip()
            except Exception:
                pass
        records = df.to_dict("records")
        logger.info(f"Loaded {len(records):,} records from {path}")
        return records


class PostalCodeGeocodeStage(PipelineStage):
    """
    Geocode ACRA companies by postal code using two-tier lookup:
    1. First check onemap_postal_codes.csv for cached coordinates
    2. If not found, fallback to LocationIQ API

    This follows the same pattern as PUB/amenities geocoding.
    """

    def __init__(self, sleep_between_requests: float = 1.0):
        super().__init__("Geocode by Postal Code")
        self.sleep_between_requests = max(0.0, sleep_between_requests)
        self.api_key = LOCATIONIQ_KEY
        self.url = LOCATIONIQ_FORWARD_URL

        # Load postal codes reference CSV
        postal_csv = Path(__file__).resolve().parents[1] / "data" / "onemap" / "onemap_postal_codes.csv"
        self.postal_lookup = self._load_postal_codes(postal_csv)

    def _load_postal_codes(self, csv_path: Path) -> Dict[str, Tuple[float, float]]:
        """Load postal code to lat/lon mapping from CSV."""
        lookup = {}

        if not csv_path.exists():
            logger.warning(f"Postal codes CSV not found: {csv_path}")
            logger.warning("Will use LocationIQ API for all geocoding")
            return lookup

        try:
            df = pd.read_csv(csv_path, dtype=str)
            df.columns = [col.strip().lower() for col in df.columns]

            # Check for required columns
            if 'postal' not in df.columns:
                logger.warning("Postal CSV missing 'postal' column")
                return lookup

            if 'latitude' not in df.columns or 'longitude' not in df.columns:
                logger.warning("Postal CSV missing 'latitude' or 'longitude' columns")
                return lookup

            # Build lookup dictionary
            for _, row in df.iterrows():
                postal = str(row['postal']).strip().zfill(6)
                try:
                    lat = float(row['latitude'])
                    lon = float(row['longitude'])
                    if pd.notna(lat) and pd.notna(lon):
                        lookup[postal] = (lat, lon)
                except (ValueError, TypeError):
                    continue

            logger.info(f"✓ Loaded {len(lookup):,} postal codes from CSV")
            return lookup

        except Exception as e:
            logger.error(f"Error loading postal codes CSV: {e}")
            return {}

    async def _geocode_via_api(self, postal: str) -> Tuple[Optional[float], Optional[float]]:
        """Geocode postal code using LocationIQ API."""
        if not self.api_key:
            return None, None

        try:
            params = {
                "key": self.api_key,
                "q": f"Singapore {postal}",
                "format": "json",
                "addressdetails": 0,
                "limit": 1,
            }
            r = requests.get(self.url, params=params, timeout=20)
            r.raise_for_status()
            js = r.json()

            if isinstance(js, list) and js:
                lat = float(js[0].get("lat")) if js[0].get("lat") else None
                lon = float(js[0].get("lon")) if js[0].get("lon") else None
                return lat, lon

        except Exception as e:
            logger.debug(f"API geocode failed for postal {postal}: {e}")

        return None, None

    async def process(self, data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Geocode all records by postal code."""
        if not data or not isinstance(data, list):
            return data

        logger.info(f"Geocoding {len(data):,} records...")

        csv_hits = 0
        api_calls = 0
        no_match = 0

        out: List[Dict[str, Any]] = []

        for i, row in enumerate(data):
            postal = str(row.get("postal_code", "")).strip().zfill(6)
            lat, lon = None, None

            if postal and len(postal) == 6:
                # Try CSV lookup first
                if postal in self.postal_lookup:
                    lat, lon = self.postal_lookup[postal]
                    csv_hits += 1
                else:
                    # Fallback to API
                    lat, lon = await self._geocode_via_api(postal)
                    if lat and lon:
                        api_calls += 1
                        # Rate limiting for API calls
                        if self.sleep_between_requests:
                            await asyncio.sleep(self.sleep_between_requests)
                    else:
                        no_match += 1

            # Preserve only required columns for database
            # Ensure lowercase consistency before persisting
            new_row = {
                "uen": row.get("uen"),
                "amenity_name": (row.get("amenity_name") or "").strip().lower(),
                "street_name": (row.get("street_name") or "").strip().lower(),
                "building_name": (row.get("building_name") or "").strip().lower(),
                "postal_code": row.get("postal_code"),
                "latitude": lat,
                "longitude": lon,
            }
            out.append(new_row)

            if (i + 1) % 1000 == 0:
                logger.info(f"  Progress: {i+1}/{len(data):,} | CSV: {csv_hits} | API: {api_calls} | No match: {no_match}")

        logger.info("="*80)
        logger.info(f"✓ Geocoding complete:")
        logger.info(f"  CSV matches: {csv_hits:,}")
        logger.info(f"  API calls: {api_calls:,}")
        logger.info(f"  No match: {no_match:,}")
        logger.info("="*80)
        # Write back lat/lon to the combined CSV for traceability
        try:
            df_out = pd.DataFrame(out)
            # Ensure column order uen first and include geocode columns
            ordered_cols = [
                "uen",
                "amenity_name",
                "street_name",
                "building_name",
                "postal_code",
                "latitude",
                "longitude",
            ]
            cols = [c for c in ordered_cols if c in df_out.columns] + [
                c for c in df_out.columns if c not in ordered_cols
            ]
            df_out = df_out[cols]

            output_dir = Path(__file__).resolve().parent / "data"
            output_dir.mkdir(parents=True, exist_ok=True)
            output_file = output_dir / "acra_all.csv"
            df_out.to_csv(output_file, index=False)
            logger.info(f"✓ Updated consolidated CSV with geocodes at {output_file}")
        except Exception as e:
            logger.warning(f"Failed to write updated acra_all.csv: {e}")

        return out


def build_acra_pipeline(
    table_name: str = "acra_companies",
    *,
    skip_fetch: bool = False,
    csv_path: Optional[str] = None,
) -> Pipeline:
    stages: List[PipelineStage] = []

    if skip_fetch:
        stages.append(LoadACRAFromCsvStage(csv_path=Path(csv_path) if csv_path else None))
    else:
        stages.append(FetchACRAStage())  # Downloads from data.gov.sg

    stages.extend(
        [
            TransformACRAStage(),  # Clean and normalize
            GeocodePostalOneMapStage(
                out_dir=Path(__file__).resolve().parent / "data",
                out_csv="acra_all.csv",
                sleep_between_requests=0.75,
            ),  # Lookup first, then OneMap API
            CheckGeocodeCompletenessStage(max_missing_pairs=10_000),  # Gate DB write
            DatabaseWriteStage(table_name, config={"on_conflict": "uen", "batch_size": 100}),
        ]
    )

    return Pipeline("ACRA Monthly Pipeline", stages)


async def run_once(
    table_name: str = "acra_companies",
    *,
    skip_fetch: bool = False,
    csv_path: Optional[str] = None,
) -> None:
    pipe = build_acra_pipeline(table_name=table_name, skip_fetch=skip_fetch, csv_path=csv_path)
    await pipe.run()


if __name__ == "__main__":
    # Simple entrypoint: run once. For monthly scheduling, trigger externally (e.g., cron).
    asyncio.run(run_once())
