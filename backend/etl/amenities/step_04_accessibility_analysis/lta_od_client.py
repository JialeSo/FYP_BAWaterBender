"""
LTA DataMall Origin-Destination (OD) Data Client
=================================================

This module provides a client for extracting passenger volume Origin-Destination
data from LTA DataMall API endpoints.

Data Sources:
-------------
1. OD Train: Monthly passenger flows between MRT/LRT stations
2. OD Bus: Monthly passenger flows between bus stops

API Documentation:
------------------
LTA DataMall API User Guide v6.4 (July 2025)
- OD Train: https://datamall2.mytransport.sg/ltaodataservice/PV/ODTrain
- OD Bus: https://datamall2.mytransport.sg/ltaodataservice/PV/ODBus

Usage:
------
    from step_04_accessibility_analysis.lta_od_client import LTAODClient

    client = LTAODClient(api_key="your-api-key")

    # Fetch OD train data for March 2024
    train_data = client.fetch_od_train(date="202403")

    # Fetch OD bus data for March 2024
    bus_data = client.fetch_od_bus(date="202403")

    # Get all data for a date range
    all_data = client.fetch_all_od_data(
        start_date="202401",
        end_date="202403"
    )
"""

from __future__ import annotations

import os
import time
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional, Literal
from urllib.parse import urljoin
import warnings

import pandas as pd
import requests

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    warnings.warn(
        "python-dotenv not installed. Install with: pip install python-dotenv",
        ImportWarning
    )


@dataclass
class LTAODConfig:
    """Configuration for LTA DataMall OD API client."""

    # API endpoints
    BASE_URL: str = "https://datamall2.mytransport.sg"
    OD_TRAIN_ENDPOINT: str = "/ltaodataservice/PV/ODTrain"
    OD_BUS_ENDPOINT: str = "/ltaodataservice/PV/ODBus"
    BUS_STOPS_ENDPOINT: str = "/ltaodataservice/BusStops"

    # Request settings
    TIMEOUT_SECONDS: int = 30
    LINK_EXPIRY_MINUTES: int = 5  # Links expire after 5 minutes

    # Rate limiting
    MAX_RETRIES: int = 3
    RETRY_DELAY_SECONDS: float = 2.0

    # Data storage
    CACHE_DIR: Path = Path("data/lta_od_cache")

    # Date format
    DATE_FORMAT: str = "%Y%m"  # YYYYMM format (e.g., "202403")


class LTAODClient:
    """
    Client for fetching Origin-Destination (OD) passenger volume data from LTA DataMall.

    This client handles:
    - API authentication
    - Data download from S3 links
    - ZIP file extraction
    - CSV parsing
    - Caching
    - Error handling and retries
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        config: Optional[LTAODConfig] = None,
        cache_enabled: bool = True,
    ):
        """
        Initialize LTA DataMall OD client.

        Args:
            api_key: LTA DataMall API key. If not provided, looks for SLA_API_KEY in .env file.
            config: Optional custom configuration
            cache_enabled: Whether to cache downloaded data locally
        """
        # Priority: parameter > SLA_API_KEY env var > LTA_API_KEY env var (backward compatibility)
        self.api_key = api_key or os.getenv("SLA_API_KEY") or os.getenv("LTA_API_KEY")
        if not self.api_key:
            raise ValueError(
                "LTA DataMall API key required. "
                "Add SLA_API_KEY to your .env file, provide via api_key parameter, "
                "or set SLA_API_KEY (or legacy LTA_API_KEY) environment variable."
            )

        self.config = config or LTAODConfig()
        self.cache_enabled = cache_enabled

        # Create cache directory
        if self.cache_enabled:
            self.config.CACHE_DIR.mkdir(parents=True, exist_ok=True)

    def _make_request(
        self,
        endpoint: str,
        params: Optional[dict] = None,
    ) -> dict:
        """
        Make authenticated request to LTA DataMall API.

        Args:
            endpoint: API endpoint (e.g., "/ltaodataservice/PV/ODTrain")
            params: Query parameters

        Returns:
            JSON response as dictionary

        Raises:
            requests.HTTPError: If request fails
        """
        url = urljoin(self.config.BASE_URL, endpoint)
        headers = {
            "AccountKey": self.api_key,
            "accept": "application/json",
        }

        for attempt in range(self.config.MAX_RETRIES):
            try:
                response = requests.get(
                    url,
                    headers=headers,
                    params=params,
                    timeout=self.config.TIMEOUT_SECONDS,
                )
                response.raise_for_status()
                return response.json()

            except requests.exceptions.RequestException as e:
                if attempt < self.config.MAX_RETRIES - 1:
                    warnings.warn(
                        f"Request failed (attempt {attempt + 1}/{self.config.MAX_RETRIES}): {e}. "
                        f"Retrying in {self.config.RETRY_DELAY_SECONDS}s..."
                    )
                    time.sleep(self.config.RETRY_DELAY_SECONDS)
                else:
                    raise

        raise RuntimeError("Should not reach here")

    def _download_from_link(
        self,
        download_link: str,
        output_path: Path,
    ) -> Path:
        """
        Download file from S3 link.

        Args:
            download_link: S3 download URL (expires after 5 minutes)
            output_path: Local path to save file

        Returns:
            Path to downloaded file
        """
        response = requests.get(
            download_link,
            timeout=self.config.TIMEOUT_SECONDS,
            stream=True,
        )
        response.raise_for_status()

        output_path.parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        return output_path

    def _extract_zip(
        self,
        zip_path: Path,
        extract_dir: Path,
    ) -> list[Path]:
        """
        Extract ZIP file.

        Args:
            zip_path: Path to ZIP file
            extract_dir: Directory to extract to

        Returns:
            List of extracted file paths
        """
        extract_dir.mkdir(parents=True, exist_ok=True)

        extracted_files = []
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_dir)
            extracted_files = [extract_dir / name for name in zip_ref.namelist()]

        return extracted_files

    def _get_cache_path(
        self,
        data_type: Literal["train", "bus"],
        date: str,
    ) -> Path:
        """Get cache file path for given data type and date."""
        return self.config.CACHE_DIR / f"od_{data_type}_{date}.csv"

    def _fetch_od_data(
        self,
        endpoint: str,
        data_type: Literal["train", "bus"],
        date: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Generic method to fetch OD data from LTA DataMall.

        Args:
            endpoint: API endpoint
            data_type: "train" or "bus"
            date: Date in YYYYMM format (e.g., "202403"). Defaults to latest available.

        Returns:
            DataFrame with OD trip data
        """
        # Check cache first
        if date and self.cache_enabled:
            cache_path = self._get_cache_path(data_type, date)
            if cache_path.exists():
                print(f"  ✓ Loading from cache: {cache_path}")
                return pd.read_csv(cache_path)

        # Make API request
        params = {"Date": date} if date else {}
        print(f"  Requesting OD {data_type} data (date={date or 'latest'})...")

        response_data = self._make_request(endpoint, params)

        # Extract download link
        if "value" not in response_data or len(response_data["value"]) == 0:
            raise ValueError(f"No data available for date: {date}")

        download_link = response_data["value"][0].get("Link")
        if not download_link:
            raise ValueError("No download link in API response")

        print(f"  ✓ Download link received (expires in {self.config.LINK_EXPIRY_MINUTES} min)")

        # Download ZIP file
        zip_filename = f"od_{data_type}_{date or 'latest'}.zip"
        zip_path = self.config.CACHE_DIR / zip_filename

        print(f"  Downloading ZIP file...")
        self._download_from_link(download_link, zip_path)
        print(f"  ✓ Downloaded: {zip_path}")

        # Extract ZIP
        extract_dir = self.config.CACHE_DIR / f"od_{data_type}_{date or 'latest'}"
        print(f"  Extracting ZIP...")
        extracted_files = self._extract_zip(zip_path, extract_dir)

        # Find CSV file(s)
        csv_files = [f for f in extracted_files if f.suffix.lower() == '.csv']
        if not csv_files:
            raise ValueError(f"No CSV files found in ZIP: {zip_path}")

        print(f"  ✓ Found {len(csv_files)} CSV file(s)")

        # Load and concatenate all CSVs
        dfs = []
        for csv_file in csv_files:
            df = pd.read_csv(csv_file)
            dfs.append(df)

        combined_df = pd.concat(dfs, ignore_index=True)

        # Cache the result
        if date and self.cache_enabled:
            cache_path = self._get_cache_path(data_type, date)
            combined_df.to_csv(cache_path, index=False)
            print(f"  ✓ Cached to: {cache_path}")

        # Clean up ZIP and extracted files
        zip_path.unlink()
        for file in extracted_files:
            file.unlink()
        extract_dir.rmdir()

        return combined_df

    def fetch_od_train(
        self,
        date: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Fetch OD train (MRT/LRT) passenger volume data.

        Data Format:
        ------------
        Columns: YEAR_MONTH, DAY_TYPE, TIME_PER_HOUR, PT_TYPE,
                 ORIGIN_PT_CODE, DESTINATION_PT_CODE, TOTAL_TRIPS

        Example:
        --------
            YEAR_MONTH  DAY_TYPE  TIME_PER_HOUR  PT_TYPE  ORIGIN_PT_CODE  DESTINATION_PT_CODE  TOTAL_TRIPS
            201803      WEEKDAY   6              MRT      NS1             NS2                   1250

        Args:
            date: Date in YYYYMM format (e.g., "202403").
                  Can request up to last 3 months. Defaults to latest.

        Returns:
            DataFrame with train OD trip volumes
        """
        print(f"\n{'='*60}")
        print(f"Fetching OD Train Data")
        print(f"{'='*60}")

        df = self._fetch_od_data(
            endpoint=self.config.OD_TRAIN_ENDPOINT,
            data_type="train",
            date=date,
        )

        print(f"\n✓ OD Train data loaded: {len(df):,} records")
        print(f"  Date range: {df['YEAR_MONTH'].unique()}")
        print(f"  Day types: {df['DAY_TYPE'].unique()}")
        print(f"  Total trips: {df['TOTAL_TRIPS'].sum():,}")

        return df

    def fetch_od_bus(
        self,
        date: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Fetch OD bus passenger volume data.

        Data Format:
        ------------
        Columns: YEAR_MONTH, DAY_TYPE, TIME_PER_HOUR, PT_TYPE,
                 ORIGIN_PT_CODE, DESTINATION_PT_CODE, TOTAL_TRIPS

        Example:
        --------
            YEAR_MONTH  DAY_TYPE  TIME_PER_HOUR  PT_TYPE  ORIGIN_PT_CODE  DESTINATION_PT_CODE  TOTAL_TRIPS
            201804      WEEKDAY   7              BUS      01012           01013                 850

        Args:
            date: Date in YYYYMM format (e.g., "202404").
                  Can request up to last 3 months. Defaults to latest.

        Returns:
            DataFrame with bus OD trip volumes
        """
        print(f"\n{'='*60}")
        print(f"Fetching OD Bus Data")
        print(f"{'='*60}")

        df = self._fetch_od_data(
            endpoint=self.config.OD_BUS_ENDPOINT,
            data_type="bus",
            date=date,
        )

        print(f"\n✓ OD Bus data loaded: {len(df):,} records")
        print(f"  Date range: {df['YEAR_MONTH'].unique()}")
        print(f"  Day types: {df['DAY_TYPE'].unique()}")
        print(f"  Total trips: {df['TOTAL_TRIPS'].sum():,}")

        return df

    def fetch_bus_stops(self, skip: int = 0) -> pd.DataFrame:
        """
        Fetch bus stop locations (for geocoding bus OD pairs).

        Returns:
            DataFrame with bus stop codes, descriptions, and coordinates
        """
        all_stops = []
        skip = 0

        print(f"\n{'='*60}")
        print(f"Fetching Bus Stops")
        print(f"{'='*60}")

        while True:
            print(f"  Fetching batch (skip={skip})...")

            params = {"$skip": skip}
            response = self._make_request(self.config.BUS_STOPS_ENDPOINT, params)

            stops = response.get("value", [])
            if not stops:
                break

            all_stops.extend(stops)
            skip += len(stops)

        df = pd.DataFrame(all_stops)

        print(f"\n✓ Bus stops loaded: {len(df):,} stops")

        return df

    def fetch_all_od_data(
        self,
        start_date: str,
        end_date: str,
        modes: list[Literal["train", "bus"]] = ["train", "bus"],
    ) -> dict[str, pd.DataFrame]:
        """
        Fetch all OD data for a date range.

        Args:
            start_date: Start date in YYYYMM format
            end_date: End date in YYYYMM format
            modes: List of modes to fetch ("train", "bus", or both)

        Returns:
            Dictionary with keys "train" and/or "bus" containing DataFrames
        """
        # Generate date range
        start = datetime.strptime(start_date, self.config.DATE_FORMAT)
        end = datetime.strptime(end_date, self.config.DATE_FORMAT)

        # Generate list of YYYYMM dates
        dates = []
        current = start
        while current <= end:
            dates.append(current.strftime(self.config.DATE_FORMAT))
            # Move to next month
            if current.month == 12:
                current = current.replace(year=current.year + 1, month=1)
            else:
                current = current.replace(month=current.month + 1)

        results = {}

        # Fetch train data
        if "train" in modes:
            train_dfs = []
            for date in dates:
                try:
                    df = self.fetch_od_train(date=date)
                    train_dfs.append(df)
                except Exception as e:
                    warnings.warn(f"Failed to fetch train data for {date}: {e}")

            if train_dfs:
                results["train"] = pd.concat(train_dfs, ignore_index=True)

        # Fetch bus data
        if "bus" in modes:
            bus_dfs = []
            for date in dates:
                try:
                    df = self.fetch_od_bus(date=date)
                    bus_dfs.append(df)
                except Exception as e:
                    warnings.warn(f"Failed to fetch bus data for {date}: {e}")

            if bus_dfs:
                results["bus"] = pd.concat(bus_dfs, ignore_index=True)

        return results


__all__ = [
    "LTAODClient",
    "LTAODConfig",
]
