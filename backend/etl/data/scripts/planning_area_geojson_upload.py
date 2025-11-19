#!/usr/bin/env python3
"""
Script to upload planning area GeoJSON data to Supabase PostgreSQL database.
This assumes the planning_area table already exists with proper schema.
"""

import sys
import os
import json
import time
from typing import Dict, List, Any, Optional

# Add the project root directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../.."))

from backend.common.db import db


def convert_geojson_to_wkt(geometry: Dict[str, Any]) -> str:
    """
    Convert GeoJSON geometry to WKT format for PostGIS.

    Args:
        geometry: GeoJSON geometry object

    Returns:
        WKT string representation
    """
    geom_type = geometry.get("type")
    if geom_type not in ["Polygon", "MultiPolygon"]:
        raise ValueError(f"Unsupported geometry type: {geom_type}")

    if geom_type == "Polygon":
        return convert_polygon_to_wkt(geometry)
    elif geom_type == "MultiPolygon":
        return convert_multipolygon_to_wkt(geometry)


def convert_polygon_to_wkt(geometry: Dict[str, Any]) -> str:
    """
    Convert GeoJSON Polygon to WKT format.

    Args:
        geometry: GeoJSON Polygon geometry object

    Returns:
        WKT string representation
    """
    coordinates = geometry.get("coordinates", [])
    if not coordinates:
        raise ValueError("Polygon must have coordinates")

    # Build WKT for polygon
    rings = []
    for ring in coordinates:
        if len(ring) < 4:
            raise ValueError("Polygon ring must have at least 4 coordinate pairs")

        # Convert coordinates to WKT format: lon lat, lon lat, ...
        coord_pairs = [f"{coord[0]} {coord[1]}" for coord in ring]
        rings.append(f"({', '.join(coord_pairs)})")

    wkt = f"POLYGON({', '.join(rings)})"
    return wkt


def convert_multipolygon_to_wkt(geometry: Dict[str, Any]) -> str:
    """
    Convert GeoJSON MultiPolygon to WKT format.

    Args:
        geometry: GeoJSON MultiPolygon geometry object

    Returns:
        WKT string representation
    """
    coordinates = geometry.get("coordinates", [])
    if not coordinates:
        raise ValueError("MultiPolygon must have coordinates")

    polygons = []
    for polygon_coords in coordinates:
        rings = []
        for ring in polygon_coords:
            if len(ring) < 4:
                raise ValueError("Polygon ring must have at least 4 coordinate pairs")

            coord_pairs = [f"{coord[0]} {coord[1]}" for coord in ring]
            rings.append(f"({', '.join(coord_pairs)})")

        polygons.append(f"({', '.join(rings)})")

    wkt = f"MULTIPOLYGON({', '.join(polygons)})"
    return wkt


def process_geojson_feature(feature: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Process a single GeoJSON feature and convert it to database format.

    Args:
        feature: GeoJSON feature object

    Returns:
        Dictionary with processed data for database insertion
    """
    try:
        properties = feature.get("properties", {})
        geometry = feature.get("geometry", {})
        geom_type = geometry.get("type")

        if geom_type not in ["Polygon", "MultiPolygon"]:
            print(f"Skipping non-Polygon/MultiPolygon: {geom_type}")
            return None

        coordinates = geometry.get("coordinates", [])
        if not coordinates:
            print("Skipping feature with empty coordinates")
            return None

        # Convert geometry to WKT format for PostGIS
        try:
            wkt_geometry = convert_geojson_to_wkt(geometry)
        except ValueError as e:
            print(f"Invalid coordinates: {e}")
            return None

        # Prepare data for database insertion
        # Extract planning area properties from the GeoJSON
        planning_area_data = {
            "pln_area_n": properties.get("PLN_AREA_N", ""),
            "pa_id": properties.get("PA_ID", ""),
            "area": properties.get("area"),
            "population": properties.get("population"),
            "population_density": properties.get("population_density"),
            "geom": wkt_geometry,
        }

        return planning_area_data

    except Exception as e:
        print(f"Error processing feature: {e}")
        return None


def load_geojson_data(file_path: str) -> Optional[Dict[str, Any]]:
    """
    Load and parse GeoJSON file.

    Args:
        file_path: Path to the GeoJSON file

    Returns:
        Parsed GeoJSON data or None if error
    """
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        data_type = data.get("type")
        if data_type != "FeatureCollection":
            raise ValueError(f"Expected FeatureCollection, got {data_type}")

        features = data.get("features", [])
        print(f"Loaded {len(features)} features from GeoJSON file")

        return data

    except FileNotFoundError:
        print(f"File not found: {file_path}")
        return None
    except json.JSONDecodeError as e:
        print(f"Invalid JSON file: {e}")
        return None
    except Exception as e:
        print(f"Error loading file: {e}")
        return None


def insert_planning_area_data_batch(planning_data_list: List[Dict[str, Any]]) -> bool:
    """
    Insert planning area data one by one to handle PostGIS conversion.

    Args:
        planning_data_list: List of processed planning area data dictionaries

    Returns:
        True if successful, False otherwise
    """
    if not planning_data_list:
        return True

    try:
        success_count = 0
        max_retries = 3

        for planning_data in planning_data_list:
            pa_id = planning_data.get("pa_id", "unknown")

            # Retry logic for network errors
            for attempt in range(max_retries):
                try:
                    # Create record with WKT string for geometry
                    record = {
                        "pln_area_n": planning_data["pln_area_n"],
                        "pa_id": planning_data["pa_id"],
                        "area": planning_data["area"],
                        "population": planning_data["population"],
                        "population_density": planning_data["population_density"],
                        "geom": f"SRID=4326;{planning_data['geom']}",
                    }

                    # Insert single record
                    response = db.insert("planning_area", [record])
                    if isinstance(response, Exception):
                        error_msg = str(response)
                        print(f"Failed to insert record {pa_id}: {error_msg}")
                        if "parse error" in error_msg.lower():
                            wkt_preview = record["geom"][:200]
                            print(f"   WKT: {wkt_preview}...")
                        break  # Don't retry on data errors
                    else:
                        success_count += 1
                        area_name = planning_data["pln_area_n"]
                        print(f"Inserted: {area_name} ({pa_id})")
                        break  # Success, exit retry loop

                except Exception as e:
                    error_str = str(e)
                    if attempt < max_retries - 1 and ("stream" in error_str.lower() or "reset" in error_str.lower() or "connection" in error_str.lower()):
                        wait_time = 2 ** attempt  # Exponential backoff: 1s, 2s, 4s
                        print(f"Network error for {pa_id} (attempt {attempt + 1}/{max_retries}): {e}")
                        print(f"   Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                    else:
                        print(f"Error processing record {pa_id}: {e}")
                        break  # Max retries reached or non-network error

        total_records = len(planning_data_list)
        print(f"Inserted {success_count}/{total_records} records")
        return success_count > 0

    except Exception as e:
        print(f"Error in batch insertion: {e}")
        return False


def clear_existing_data() -> bool:
    """
    Clear existing data from the planning_area table.

    Returns:
        True if successful, False otherwise
    """
    try:
        client = db._get_connection()
        client.table("planning_area").delete().neq("pa_id", 0).execute()
        print("Cleared existing planning area data")
        return True
    except Exception as e:
        print(f"Error clearing existing data: {e}")
        return False


def upload_planning_area_data(
    geojson_file_path: str, batch_size: int = 50, clear_existing: bool = True
) -> bool:
    """
    Main function to upload planning area GeoJSON data to Supabase.

    Args:
        geojson_file_path: Path to the GeoJSON file
        batch_size: Number of records to process in each batch
        clear_existing: Whether to clear existing data before upload

    Returns:
        True if successful, False otherwise
    """
    print("Starting planning area data upload...")

    # Load GeoJSON data
    geojson_data = load_geojson_data(geojson_file_path)
    if not geojson_data:
        return False

    # Clear existing data if requested
    if clear_existing and not clear_existing_data():
        return False

    features = geojson_data.get("features", [])
    total_features = len(features)
    processed_count = 0
    successful_count = 0
    batch_data = []

    print(f"Processing {total_features} features in batches...")

    for i, feature in enumerate(features):
        # Process individual feature
        planning_data = process_geojson_feature(feature)
        if planning_data:
            batch_data.append(planning_data)
            successful_count += 1

        processed_count += 1

        # Insert batch when full or at the end
        if len(batch_data) >= batch_size or i == total_features - 1:
            if batch_data:
                if not insert_planning_area_data_batch(batch_data):
                    print("Failed to insert batch, stopping...")
                    return False
                batch_data = []

        # Progress indicator
        if processed_count % batch_size == 0:
            progress = f"{processed_count}/{total_features}"
            print(f"Progress: {progress} processed")

    print("Upload completed!")
    print(f"Total features processed: {processed_count}")
    print(f"Successfully uploaded: {successful_count}")
    print(f"Skipped: {processed_count - successful_count}")

    return True


def main():
    """Main entry point of the script."""
    # Path to the GeoJSON file
    script_dir = os.path.dirname(__file__)
    geojson_file = os.path.join(script_dir, "../roadnetwork/planning_area.geojson")

    # Check if file exists
    if not os.path.exists(geojson_file):
        print(f"GeoJSON file not found: {geojson_file}")
        return False

    print(f"Using GeoJSON file: {geojson_file}")

    # Upload the data
    success = upload_planning_area_data(
        geojson_file_path=geojson_file,
        batch_size=50,  # Smaller batches for complex polygons
        clear_existing=True,
    )

    if success:
        print("Planning area data upload completed successfully!")
        return True
    else:
        print("Planning area data upload failed!")
        return False


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
