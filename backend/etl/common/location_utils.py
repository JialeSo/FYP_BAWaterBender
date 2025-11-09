"""
Location Utilities
==================

Shared helpers for cleaning and normalizing location-related text used across
pipelines (PUB, ACRA, amenities, etc.). Keep this module minimal and focused
on generic string operations that multiple pipelines need.
"""

from __future__ import annotations

import re
from typing import Optional


_SG_SUFFIX_RE = re.compile(r",\s*singapore\.?$", flags=re.IGNORECASE)


def clean_location_string(text: Optional[str]) -> str:
    """Canonical location string cleanup.

    - Handles None safely
    - Strips whitespace
    - Removes trailing ", Singapore" (case-insensitive, optional period)
    - Lowercases for consistent downstream lookups
    """
    if text is None:
        return ""
    s = str(text).strip()
    # Remove ", Singapore" suffix if present
    s = _SG_SUFFIX_RE.sub("", s)
    return s.lower()


def normalize_text(text: Optional[str]) -> str:
    """Lightweight normalization for general text fields.

    - Handles None safely
    - Strips leading/trailing whitespace
    - Lowercases
    """
    if text is None:
        return ""
    return str(text).strip().lower()

