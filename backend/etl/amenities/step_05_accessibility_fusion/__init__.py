"""
Composite accessibility fusion step (Step 05).

This module exposes the high-level engine and configuration used to fuse
multiple accessibility models into a single composite index with agreement
metrics. It is designed to extend the existing amenities ETL pipeline by
providing public-audience friendly scores and confidence indicators.
"""

from .fusion import (
    CompositeAccessibilityConfig,
    CompositeAccessibilityPaths,
    AccessibilityFusionEngine,
)

__all__ = [
    "CompositeAccessibilityConfig",
    "CompositeAccessibilityPaths",
    "AccessibilityFusionEngine",
]
