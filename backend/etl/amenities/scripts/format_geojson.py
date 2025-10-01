#!/usr/bin/env python3
"""Pretty-print all GeoJSON files under geojson_layers."""

from __future__ import annotations

import json
import os
from typing import Iterable

GEOJSON_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "data", "geojson_layers")


def iter_geojson_files(directory: str) -> Iterable[str]:
    for name in sorted(os.listdir(directory)):
        if name.lower().endswith(".geojson"):
            yield os.path.join(directory, name)


def format_geojson(path: str) -> None:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)

    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def main() -> None:
    directory = os.path.abspath(GEOJSON_DIR)
    if not os.path.isdir(directory):
        raise SystemExit(f"GeoJSON directory not found: {directory}")

    for path in iter_geojson_files(directory):
        format_geojson(path)
        print(f"Formatted {os.path.basename(path)}")


if __name__ == "__main__":
    main()
