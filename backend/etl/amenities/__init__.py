"""
Amenities ETL Pipeline
======================

Simplified ETL pipeline for processing Singapore amenities data.

Pipeline Steps:
--------------
1. Consolidation: Merge GeoJSON and OSM data sources
2. Geocoding: Spatial joins with planning areas, subzones, and roads
3. Classification: Categorize amenities and assign importance scores
4. Road Matching: Snap to nearest road segments using OSMnx

Final Output:
------------
amenities_3layers.csv with columns:
- amenity_id
- amenity_type
- amenity_name
- postalcode (6 digits with leading zeros)
- lat, lon
- amenity_category_id
- pa_id (Planning Area ID)
- sz_id (Subzone ID)
- rd_id (Road Network ID)

Usage:
------
    from backend.etl.amenities import consolidate_amenities, geocode_amenities
    from backend.etl.amenities import classify_amenities, match_roads

    # Or run the full pipeline:
    from backend.etl.amenities.pipeline import execute_steps

    execute_steps([0, 1, 2, 3], plot=False)
"""

from backend.etl.amenities.processors import (
    consolidate_amenities,
    geocode_amenities,
    classify_amenities,
    match_roads,
)

__all__ = [
    "consolidate_amenities",
    "geocode_amenities",
    "classify_amenities",
    "match_roads",
]
