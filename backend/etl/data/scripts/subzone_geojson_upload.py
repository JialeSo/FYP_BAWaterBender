#!/usr/bin/env python3
"""
Script to upload subzone GeoJSON data to Supabase PostgreSQL database.
This assumes the subzone table already exists with proper schema.
"""

import sys
import os
import json
from typing import Dict, List, Any, Optional

# Add the backend directory to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), "../../.."))

from common.db import db


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
    else:
        raise ValueError(f"Unsupported geometry type: {geom_type}")


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


def multipolygon_to_polygons(geometry: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Convert a MultiPolygon geometry into individual Polygon geometries.

    Args:
        geometry: GeoJSON MultiPolygon geometry object

    Returns:
        List of GeoJSON Polygon geometry objects
    """
    if geometry.get("type") != "MultiPolygon":
        return [geometry]  # Return as-is if not MultiPolygon

    coordinates = geometry.get("coordinates", [])
    polygons = []

    for polygon_coords in coordinates:
        polygon_geometry = {"type": "Polygon", "coordinates": polygon_coords}
        polygons.append(polygon_geometry)

    return polygons


def process_geojson_feature(feature: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Process a single GeoJSON feature and convert it to database format.
    If the feature is a MultiPolygon, it will be split into multiple records.

    Args:
        feature: GeoJSON feature object

    Returns:
        List of dictionaries with processed data for database insertion
    """
    try:
        properties = feature.get("properties", {})
        geometry = feature.get("geometry", {})
        geom_type = geometry.get("type")

        if geom_type not in ["Polygon", "MultiPolygon"]:
            print(f"⚠️ Skipping non-Polygon/MultiPolygon: {geom_type}")
            return []

        coordinates = geometry.get("coordinates", [])
        if not coordinates:
            print("⚠️ Skipping feature with empty coordinates")
            return []

        # Convert MultiPolygon to individual Polygons
        polygon_geometries = multipolygon_to_polygons(geometry)

        results = []
        for i, polygon_geom in enumerate(polygon_geometries):
            try:
                # Convert geometry to WKT format for PostGIS
                wkt_geometry = convert_geojson_to_wkt(polygon_geom)

                # Create unique subzone_id for each polygon part
                base_subzone_id = properties.get("id", "")
                if len(polygon_geometries) > 1:
                    subzone_id = f"{base_subzone_id}_P{i+1}"
                    subzone_name = f"{properties.get('SUBZONE_N', '')} (Part {i+1})"
                else:
                    subzone_id = base_subzone_id
                    subzone_name = properties.get("SUBZONE_N", "")

                # Prepare data for database insertion
                subzone_data = {
                    "subzone_n": subzone_name,
                    "pln_area_n": properties.get("PLN_AREA_N", ""),
                    "subzone_id": subzone_id,
                    "geom": wkt_geometry,
                }

                results.append(subzone_data)

            except ValueError as e:
                print(f"⚠️ Invalid coordinates in polygon part {i+1}: {e}")
                continue

        return results

    except Exception as e:
        print(f"❌ Error processing feature: {e}")
        return []


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
        print(f"📊 Loaded {len(features)} features from GeoJSON file")

        return data

    except FileNotFoundError:
        print(f"❌ File not found: {file_path}")
        return None
    except json.JSONDecodeError as e:
        print(f"❌ Invalid JSON file: {e}")
        return None
    except Exception as e:
        print(f"❌ Error loading file: {e}")
        return None


def insert_subzone_data_batch(subzone_data_list: List[Dict[str, Any]]) -> bool:
    """
    Insert subzone data one by one to handle PostGIS conversion.

    Args:
        subzone_data_list: List of processed subzone data dictionaries

    Returns:
        True if successful, False otherwise
    """
    if not subzone_data_list:
        return True

    try:
        success_count = 0

        for subzone_data in subzone_data_list:
            try:
                # Create record with WKT string for geometry
                record = {
                    "subzone_n": subzone_data["subzone_n"],
                    "pln_area_n": subzone_data["pln_area_n"],
                    "subzone_id": subzone_data["subzone_id"],
                    "geom": f"SRID=4326;{subzone_data['geom']}",
                }

                # Insert single record
                response = db.insert("subzone", [record])
                if isinstance(response, Exception):
                    error_msg = str(response)
                    subzone_id = subzone_data["subzone_id"]
                    print(f"⚠️ Failed to insert record {subzone_id}: {error_msg}")
                    if "parse error" in error_msg.lower():
                        wkt_preview = record["geom"][:200]
                        print(f"   WKT: {wkt_preview}...")
                else:
                    success_count += 1
                    subzone_name = subzone_data["subzone_n"]
                    subzone_id = subzone_data["subzone_id"]
                    planning_area = subzone_data["pln_area_n"]
                    print(
                        f"✅ Inserted: {subzone_name} ({subzone_id}) "
                        f"in {planning_area}"
                    )

            except Exception as e:
                subzone_id = subzone_data.get("subzone_id", "unknown")
                print(f"⚠️ Error processing record {subzone_id}: {e}")
                continue

        total_records = len(subzone_data_list)
        print(f"✅ Inserted {success_count}/{total_records} records")
        return success_count > 0

    except Exception as e:
        print(f"❌ Error in batch insertion: {e}")
        return False


def clear_existing_data() -> bool:
    """
    Clear existing data from the subzone table.

    Returns:
        True if successful, False otherwise
    """
    try:
        client = db._get_connection()
        client.table("subzone").delete().neq("id", 0).execute()
        print("🧹 Cleared existing subzone data")
        return True
    except Exception as e:
        print(f"❌ Error clearing existing data: {e}")
        return False


def upload_subzone_data(
    geojson_file_path: str, batch_size: int = 50, clear_existing: bool = True
) -> bool:
    """
    Main function to upload subzone GeoJSON data to Supabase.

    Args:
        geojson_file_path: Path to the GeoJSON file
        batch_size: Number of records to process in each batch
        clear_existing: Whether to clear existing data before upload

    Returns:
        True if successful, False otherwise
    """
    print("🚀 Starting subzone data upload...")

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

    print(f"📊 Processing {total_features} features in batches...")

    for i, feature in enumerate(features):
        # Process individual feature (may return multiple records for MultiPolygon)
        subzone_data_list = process_geojson_feature(feature)

        for subzone_data in subzone_data_list:
            batch_data.append(subzone_data)
            successful_count += 1

        processed_count += 1

        # Insert batch when full or at the end
        if len(batch_data) >= batch_size or i == total_features - 1:
            if batch_data:
                if not insert_subzone_data_batch(batch_data):
                    print("❌ Failed to insert batch, stopping...")
                    return False
                batch_data = []

        # Progress indicator
        if processed_count % 10 == 0:
            progress = f"{processed_count}/{total_features}"
            print(f"📈 Progress: {progress} features processed")

    print("🎉 Upload completed!")
    print(f"📊 Total features processed: {processed_count}")
    print(f"✅ Successfully created records: {successful_count}")

    return True


def main():
    """Main entry point of the script."""
    # Path to the GeoJSON file
    script_dir = os.path.dirname(__file__)
    geojson_file = os.path.join(script_dir, "../subzone_area.geojson")

    # Check if file exists
    if not os.path.exists(geojson_file):
        print(f"❌ GeoJSON file not found: {geojson_file}")
        return False

    print(f"📁 Using GeoJSON file: {geojson_file}")

    # Upload the data
    success = upload_subzone_data(
        geojson_file_path=geojson_file,
        batch_size=50,  # Smaller batches for complex polygons
        clear_existing=True,
    )

    if success:
        print("✅ Subzone data upload completed successfully!")
        return True
    else:
        print("❌ Subzone data upload failed!")
        return False


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
