#!/usr/bin/env python3
"""Utility to strip HTML tables from GeoJSON properties in geojson_layers."""

from __future__ import annotations

import json
import os
import re
from html import unescape
from typing import Dict

GEOJSON_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "data", "geojson_layers")
TARGET_KEYS = {"description", "descriptio"}
ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
CELL_RE = re.compile(r"<t[hd][^>]*>(.*?)</t[hd]>", re.IGNORECASE | re.DOTALL)
TAG_RE = re.compile(r"<[^>]+>")
WHITESPACE_RE = re.compile(r"\s+")


def _fix_mojibake(text: str) -> str:
    """Attempt to repair common cp1252 mojibake such as â€™ -> ’."""
    try:
        return text.encode("cp1252").decode("utf-8")
    except (UnicodeError, AttributeError):
        return text


def _strip_tags(value: str) -> str:
    """Remove HTML tags and condense whitespace."""
    without_tags = TAG_RE.sub(" ", value)
    normalized = WHITESPACE_RE.sub(" ", without_tags)
    return normalized.strip()


def parse_description(raw: str) -> Dict[str, str]:
    text = unescape(raw)
    text = _fix_mojibake(text)
    parsed: Dict[str, str] = {}

    for row in ROW_RE.findall(text):
        cells = [unescape(cell) for cell in CELL_RE.findall(row)]
        if len(cells) < 2:
            continue
        key = _strip_tags(cells[0])
        value = _strip_tags(cells[1])
        if not key:
            continue
        parsed[key] = value or None
    return {k: v for k, v in parsed.items() if k}


def clean_geojson_file(path: str) -> bool:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)

    changed = False
    features = data.get("features", [])

    for feature in features:
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            continue

        keys_to_process = [k for k in list(properties.keys()) if k.lower() in TARGET_KEYS]
        for key in keys_to_process:
            value = properties.get(key)
            if not isinstance(value, str):
                continue

            parsed = parse_description(value)
            if not parsed:
                continue

            # Remove the original HTML field.
            properties.pop(key, None)

            # Inject parsed fields without clobbering existing non-empty values.
            for new_key, new_value in parsed.items():
                if new_key in properties and properties[new_key] not in (None, ""):
                    continue
                properties[new_key] = new_value

            changed = True

    if changed:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))

    return changed


def main() -> None:
    directory = os.path.abspath(GEOJSON_DIR)
    if not os.path.isdir(directory):
        raise SystemExit(f"GeoJSON directory not found: {directory}")

    updated = []
    for name in sorted(os.listdir(directory)):
        if not name.lower().endswith(".geojson"):
            continue
        path = os.path.join(directory, name)
        if clean_geojson_file(path):
            updated.append(name)

    if updated:
        print("Cleaned HTML fields in:")
        for name in updated:
            print(f" - {name}")
    else:
        print("No HTML fields found to clean.")


if __name__ == "__main__":
    main()
