"""Utility to download rainfall readings from data.gov.sg and persist them as GeoJSON."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

import requests

API_URL = "https://api-open.data.gov.sg/v2/real-time/api/rainfall"
DEFAULT_TIMEOUT = 30


def fetch_rainfall(
    *,
    date: Optional[str] = None,
    pagination_token: Optional[str] = None,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Call the rainfall endpoint and return the parsed JSON payload."""

    params: Dict[str, str] = {}
    if date:
        params["date"] = date
    if pagination_token:
        params["paginationToken"] = pagination_token

    headers: Dict[str, str] = {}
    if api_key:
        headers["x-api-key"] = api_key

    response = requests.get(
        API_URL,
        params=params or None,
        headers=headers or None,
        timeout=DEFAULT_TIMEOUT,
    )
    response.raise_for_status()

    payload = response.json()
    code = payload.get("code")
    if code not in (0, None):
        message = payload.get("errorMsg") or "Unknown error"
        raise ValueError(f"Rainfall API returned code {code}: {message}")

    return payload


def build_station_lookup(stations: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Index stations by station ID for quick lookups."""

    lookup: Dict[str, Dict[str, Any]] = {}
    for station in stations:
        station_id = station.get("id")
        if station_id:
            lookup[station_id] = station
    return lookup


def build_geojson(payload: Dict[str, Any], *, retrieved_at: Optional[str] = None) -> Dict[str, Any]:
    """Convert the rainfall payload into a GeoJSON feature collection."""

    data_section = payload.get("data") or {}
    stations = data_section.get("stations") or []
    readings = data_section.get("readings") or []

    station_lookup = build_station_lookup(stations)

    features = []
    for reading in readings:
        timestamp = reading.get("timestamp")
        for record in reading.get("data") or []:
            station_id = record.get("stationId")
            station_meta = station_lookup.get(station_id, {})
            label_location = station_meta.get("labelLocation") or {}
            latitude = label_location.get("latitude")
            longitude = label_location.get("longitude")

            geometry = None
            if latitude is not None and longitude is not None:
                geometry = {
                    "type": "Point",
                    "coordinates": [longitude, latitude],
                }

            properties = {
                "stationId": station_id,
                "deviceId": station_meta.get("deviceId") or station_meta.get("id"),
                "stationName": station_meta.get("name"),
                "timestamp": timestamp,
                "rainfall": record.get("value"),
            }

            features.append(
                {
                    "type": "Feature",
                    "geometry": geometry,
                    "properties": properties,
                }
            )

    retrieved = retrieved_at or datetime.now(timezone.utc).isoformat()

    metadata = {
        "source": API_URL,
        "description": "5-minute rainfall readings from NEA via data.gov.sg real-time API",
        "readingType": data_section.get("readingType"),
        "readingUnit": data_section.get("readingUnit"),
        "retrievedAt": retrieved,
    }

    pagination_token = data_section.get("paginationToken")
    if pagination_token:
        metadata["paginationToken"] = pagination_token

    geojson = {
        "type": "FeatureCollection",
        "name": "rainfall_records",
        "metadata": metadata,
        "features": features,
    }

    return geojson


def write_geojson(payload: Dict[str, Any], output_path: Path) -> None:
    """Serialize GeoJSON payload to disk."""

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch rainfall readings and store them as GeoJSON",
    )
    parser.add_argument("--date", help="Filter readings by date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)")
    parser.add_argument("--pagination-token", help="Pagination token for historical queries")
    parser.add_argument("--api-key", help="Optional x-api-key for higher rate limits")
    parser.add_argument(
        "--output",
        help="Output GeoJSON path",
        default=str(Path(__file__).resolve().parent / "data" / "rainfall_records.geojson"),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    payload = fetch_rainfall(
        date=args.date,
        pagination_token=args.pagination_token,
        api_key=args.api_key,
    )
    geojson = build_geojson(payload)
    output_path = Path(args.output)
    write_geojson(geojson, output_path)
    print(f"Saved rainfall GeoJSON to {output_path}")


if __name__ == "__main__":
    main()
