"""
Postal Code Utilities
=====================

Shared utilities for loading and working with Singapore postal codes.

Used across ACRA, PUB, amenities, and other ETL pipelines.
"""

import logging
from pathlib import Path
from typing import Dict, Tuple, Optional

import pandas as pd

logger = logging.getLogger(__name__)


def load_postal_codes_lookup(csv_path: Path) -> Dict[str, Tuple[float, float]]:
    """Load postal code to lat/lon mapping from CSV.

    This is the canonical function for loading postal code reference data
    across all ETL pipelines.

    Args:
        csv_path: Path to CSV file with columns: postal, latitude, longitude

    Returns:
        Dictionary mapping 6-digit postal codes to (latitude, longitude) tuples

    Example:
        >>> postal_csv = Path("data/onemap/onemap_postal_codes.csv")
        >>> lookup = load_postal_codes_lookup(postal_csv)
        >>> lookup["238801"]
        (1.2897, 103.8501)

    Notes:
        - Returns empty dict if file doesn't exist (logs warning)
        - Skips rows with NaN coordinates
        - Normalizes postal codes to 6-digit strings (zero-padded)
        - Case-insensitive column names
    """
    lookup: Dict[str, Tuple[float, float]] = {}

    try:
        if not csv_path.exists():
            logger.warning(f"Postal reference CSV not found: {csv_path}")
            return lookup

        # Load CSV with all columns as strings initially
        df = pd.read_csv(csv_path, dtype=str)

        # Normalize column names (lowercase, strip whitespace)
        df.columns = [c.strip().lower() for c in df.columns]

        # Check for required columns
        required_cols = {"postal", "latitude", "longitude"}
        if not required_cols.issubset(df.columns):
            missing = required_cols - set(df.columns)
            logger.warning(
                f"Postal CSV missing required columns: {missing}. "
                f"Available: {list(df.columns)}"
            )
            return lookup

        # Build lookup dictionary
        for _, row in df.iterrows():
            postal = str(row["postal"]).strip().zfill(6)

            try:
                lat = float(row["latitude"]) if pd.notna(row["latitude"]) else None
                lon = float(row["longitude"]) if pd.notna(row["longitude"]) else None

                # Only add if both coordinates are valid and postal is 6 digits
                if lat is not None and lon is not None and len(postal) == 6:
                    lookup[postal] = (lat, lon)
            except (ValueError, TypeError):
                # Skip rows with invalid coordinate values
                continue

        logger.info(f"Loaded {len(lookup):,} postal code entries from {csv_path.name}")

    except Exception as e:
        logger.warning(f"Failed to load postal reference CSV: {e}")

    return lookup


def normalize_postal_code(postal: str) -> Optional[str]:
    """Normalize a postal code to 6-digit format.

    Args:
        postal: Raw postal code string (may contain non-digits)

    Returns:
        6-digit postal code string, or None if invalid

    Examples:
        >>> normalize_postal_code("238801")
        "238801"
        >>> normalize_postal_code("12345")
        "012345"
        >>> normalize_postal_code("S238801")
        "238801"
        >>> normalize_postal_code("abc")
        None
    """
    if not postal:
        return None

    # Extract only digits
    digits = "".join(ch for ch in str(postal) if ch.isdigit())

    # Return 6-digit format if we have digits
    if len(digits) == 6:
        return digits
    elif len(digits) > 0 and len(digits) < 6:
        # Zero-pad if less than 6 digits
        return digits.zfill(6)
    else:
        return None


def get_default_postal_csv_path() -> Path:
    """Get the default path to the postal codes CSV file.

    Returns:
        Path to backend/etl/data/onemap/onemap_postal_codes.csv
    """
    return Path(__file__).resolve().parents[1] / "data" / "onemap" / "onemap_postal_codes.csv"
