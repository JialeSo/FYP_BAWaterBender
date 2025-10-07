#!/usr/bin/env python3
"""Replace childcare placeholder names in amenities_3layers.csv using OneMap results."""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

PRIMARY_KEYWORDS = {
    "CHILDCARE",
    "CHILD CARE",
    "CHILD DEVELOPMENT",
    "INFANT CARE",
    "PRESCHOOL",
    "PRE-SCHOOL",
    "PRE SCHOOL",
    "KINDERGARTEN",
    "STUDENT CARE",
    "PLAYGROUP",
    "PLAYGROUPS",
    "MONTESSORI",
    "SCHOOLHOUSE",
    "SCHOOL HOUSE",
    "MY FIRST SKOOL",
    "SPARKLETOTS",
    "MY WORLD",
    "E-BRIDGE",
    "KIDZ",
    "KIDS",
    "INFANT",
    "PCF",
    "EARLY LEARNING",
    "EARLY YEARS",
    "GLOBAL TOTS",
    "TOTS",
    "BABY STAR",
    "SUNSHINE KIDS",
    "LITTLE UNI",
}

SECONDARY_KEYWORDS = {
    "CHILD",
    "CARE",
    "CENTRE",
    "CENTER",
    "CENTERS",
    "CENTRES",
    "LEARNING",
    "LEARNERS",
    "ACADEMY",
    "EDUCATION",
    "EDUCARE",
    "CHILDREN",
    "NURSERY",
    "PLAYHOUSE",
    "PLAY SCHOOL",
    "PLAY-SCHOOL",
    "PLAYGROUP",
    "KID",
    "TODDLER",
    "EARLY",
    "SCHOOL",
    "PTE.",
    "PTE",
    "LTD",
    "LLP",
}

BRAND_INDICATORS = {
    "MAPLEBEAR",
    "MINDCHAMPS",
    "STAR LEARNERS",
    "LITTLE FOOTPRINTS",
    "LITTLE FOOTPRINT",
    "LITTLE SCHOOL-HOUSE",
    "LITTLE SCHOOL HOUSE",
    "MY FIRST SKOOL",
    "MY WORLD",
    "GLOBAL TOTS",
    "SKOOL4KIDZ",
    "FIRST STEPPING STONES",
    "LEARNING VISION",
    "QDE CHILD DEVELOPMENT",
    "CHERIE HEARTS",
    "SHICHIDA",
    "ICHIBAN",
    "KIDDY",
    "HEARTS & MINDS",
    "HEARTS AND MINDS",
    "ST JOSEPH",
    "ST. JOSEPH",
    "MY LITTLE CAMPUS",
    "BRIGHTON",
    "SUNFLOWER",
    "BRILLIANT TOTS",
    "TUTOR TIME",
    "BETTER TOTS",
    "EARLY LEARNING CENTRE",
    "AGAPE LITTLE UNI",
    "BLEU CASTLE",
    "BIG FOOT",
    "GENIUS HIVE",
    "DA LITTLE",
    "COLUMBIA JUNIOR",
}

KML_NAME_PATTERN = re.compile(r"^kml_\d+$", re.IGNORECASE)


@dataclass
class Candidate:
    name: str
    score: int
    source: dict


def normalise_postal(value: object) -> str | None:
    """Return a zero-padded 6 digit postal code or None."""

    if value is None:
        return None

    if isinstance(value, int):
        digits = f"{value:06d}"
        return digits[-6:]

    if isinstance(value, float):
        if math.isnan(value):
            return None
        return f"{int(value):06d}"[-6:]

    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None

    if "." in text:
        text = text.split(".", 1)[0]

    digits = re.sub(r"\D", "", text)
    if not digits:
        return None
    if len(digits) > 6:
        digits = digits[-6:]
    if len(digits) == 5:
        digits = "0" + digits
    return digits.zfill(6)


def extract_postal_candidates(*values: object) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        if not value:
            continue
        text = str(value)
        for match in re.findall(r"\b\d{5,6}\b", text):
            candidate = normalise_postal(match)
            if candidate and candidate not in seen:
                seen.add(candidate)
                ordered.append(candidate)
    return ordered


def _looks_like_childcare(text: str) -> bool:
    upper = text.upper()
    for kw in PRIMARY_KEYWORDS | BRAND_INDICATORS:
        if kw in upper:
            return True
    if "INFANT" in upper or "PRESCHOOL" in upper or "PRE SCHOOL" in upper or "CHILD CARE" in upper:
        return True
    return False


def derive_display_name(result: dict) -> str | None:
    building = (result.get("BUILDING") or "").strip()
    if building and building.upper() not in {"NIL", "NA"}:
        if _looks_like_childcare(building) or "@" in building or "PTE" in building.upper() or "LLP" in building.upper():
            return building

    searchval = (result.get("SEARCHVAL") or "").strip()
    if searchval:
        if _looks_like_childcare(searchval):
            return searchval

    address = (result.get("ADDRESS") or "").strip()
    if address and _looks_like_childcare(address):
        return address

    # Fallbacks: prefer detailed searchval/building even if they do not contain childcare
    if searchval:
        return searchval
    if building:
        return building
    return address or None


def compute_candidate_score(result: dict) -> tuple[int, str | None]:
    text_parts = [result.get("SEARCHVAL", ""), result.get("BUILDING", ""), result.get("ADDRESS", "")]
    text = " ".join(part for part in text_parts if part)
    text_upper = text.upper()
    if not text_upper:
        return 0, None

    primary_hits = sum(1 for kw in PRIMARY_KEYWORDS if kw in text_upper)
    secondary_hits = sum(1 for kw in SECONDARY_KEYWORDS if kw in text_upper)
    brand_hits = sum(1 for kw in BRAND_INDICATORS if kw in text_upper)

    score = primary_hits * 6 + secondary_hits * 3 + brand_hits * 8

    if "CHILD" in text_upper and "CARE" in text_upper:
        score += 4
    if "INFANT" in text_upper:
        score += 3
    if "@" in text_upper:
        score += 2
    if "PTE" in text_upper and ("CHILD" in text_upper or "CARE" in text_upper):
        score += 2

    name = derive_display_name(result)
    if not name:
        return 0, None

    return score, name


def select_childcare_candidate(results: Iterable[dict]) -> Candidate | None:
    candidates: list[Candidate] = []
    for idx, item in enumerate(results):
        score, name = compute_candidate_score(item)
        if score <= 0 or not name:
            continue

        # small benefit for earlier results to preserve API ordering
        score += max(0, 3 - idx)
        candidates.append(Candidate(name=name, score=score, source=item))

    if not candidates:
        return None

    candidates.sort(key=lambda c: c.score, reverse=True)
    return candidates[0]


def load_onemap_mapping(path: Path) -> dict[str, Candidate]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    mapping: dict[str, Candidate] = {}

    for entry in raw:
        postal = normalise_postal(entry.get("postal"))
        if not postal:
            continue
        response = entry.get("response") or {}
        results = response.get("results") or []
        candidate = select_childcare_candidate(results)
        if candidate:
            mapping[postal] = candidate

    return mapping


def update_childcare_rows(
    rows: list[dict[str, str]], mapping: dict[str, Candidate], limit: int | None
) -> list[tuple[str, str, str]]:
    updates: list[tuple[str, str, str]] = []

    for row in rows:
        # normalise postal column for all rows while we iterate
        postal_value = row.get("postal_code")
        cleaned_postal = normalise_postal(postal_value)
        if cleaned_postal is not None and postal_value != cleaned_postal:
            row["postal_code"] = cleaned_postal

        if row.get("amenity_type") != "childcare_clean":
            continue

        current_name = (row.get("amenity_name") or "").strip()
        if not KML_NAME_PATTERN.match(current_name):
            continue

        candidate = None

        postal_candidates: list[str] = []
        if cleaned_postal:
            postal_candidates.append(cleaned_postal)
        for candidate_code in extract_postal_candidates(
            row.get("road_name"),
            row.get("amenity_name"),
            row.get("geometry_wkt"),
            row.get("geometry_coordinates"),
        ):
            if candidate_code not in postal_candidates:
                postal_candidates.append(candidate_code)

        for postal_code in postal_candidates:
            candidate = mapping.get(postal_code)
            if candidate:
                cleaned_postal = postal_code
                break

        if not candidate:
            continue

        if current_name == candidate.name:
            continue

        if cleaned_postal:
            row["postal_code"] = cleaned_postal
        row["amenity_name"] = candidate.name
        updates.append((row.get("amenity_id", ""), current_name, candidate.name))

        if limit is not None and len(updates) >= limit:
            break

    return updates


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Replace childcare placeholder names with OneMap matches.")
    parser.add_argument(
        "--amenities",
        type=Path,
        default=Path("backend/etl/data/amenities_3layers.csv"),
        help="Path to amenities CSV to update.",
    )
    parser.add_argument(
        "--onemap",
        type=Path,
        default=Path("childcare_onemap.json"),
        help="OneMap results JSON file.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional output CSV path. Defaults to overwriting the input file.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview replacements without writing.")
    parser.add_argument(
        "--limit",
        type=int,
        help="Only apply the first N replacements (useful for testing).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    amenities_path = args.amenities
    if not amenities_path.exists():
        raise SystemExit(f"Amenities file not found: {amenities_path}")

    onemap_path = args.onemap
    if not onemap_path.exists():
        raise SystemExit(f"OneMap file not found: {onemap_path}")

    with amenities_path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames
        if fieldnames is None:
            raise SystemExit("Amenities CSV is missing headers.")
        rows = list(reader)

    mapping = load_onemap_mapping(onemap_path)
    updates = update_childcare_rows(rows, mapping, args.limit)

    print(f"Prepared {len(updates)} childcare name updates.")
    for amenity_id, old_name, new_name in updates[:10]:
        print(f"  {amenity_id}: '{old_name}' -> '{new_name}'")
    if len(updates) > 10:
        print(f"  ... and {len(updates) - 10} more")

    if args.dry_run:
        print("Dry-run mode; no files were written.")
        return

    output_path = args.output or amenities_path
    with output_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Updated amenities written to {output_path}")


if __name__ == "__main__":
    main()
