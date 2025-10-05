"""Hybrid amenity category classifier with optional HuggingFace support."""
from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence

# Optional heavy imports are guarded to keep the module usable without transformers
try:  # pragma: no cover - optional dependency
    from transformers import pipeline  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    pipeline = None  # type: ignore

LOGGER = logging.getLogger(__name__)

DEFAULT_APPEND_START_INDEX = 17858

CANONICAL_CATEGORIES: Sequence[str] = (
    "Emergency_services",
    "Healthcare_facilities",
    "Essential_services",
    "Residential",
    "Education_institutions",
    "Transport_services",
    "Tourism",
    "Community_spaces",
    "Government_services",
    "Retail_services",
    "Others",
)


@dataclass
class ClassificationResult:
    label: str
    score: float


class HuggingFaceZeroShot:
    """Wrapper around transformers zero-shot pipeline."""

    def __init__(self, model_name: str = "facebook/bart-large-mnli") -> None:
        if pipeline is None:
            raise RuntimeError(
                "transformers is not installed. Install it to enable HuggingFace classification."
            )
        self._classifier = pipeline("zero-shot-classification", model=model_name)

    def predict(self, text: str, *, candidate_labels: Sequence[str]) -> ClassificationResult:
        output = self._classifier(text, candidate_labels=candidate_labels)
        label = output["labels"][0]
        score = float(output["scores"][0])
        return ClassificationResult(label=label, score=score)


class RuleBasedClassifier:
    """Deterministic fallback classifier derived from amenity metadata."""

    TYPE_TO_CATEGORY: Dict[str, str] = {
        # Emergency services
        "police": "Emergency_services",
        "fire_station": "Emergency_services",
        "security": "Emergency_services",
        # Healthcare facilities
        "clinic": "Healthcare_facilities",
        "clinics": "Healthcare_facilities",
        "doctors": "Healthcare_facilities",
        "doctor": "Healthcare_facilities",
        "dentist": "Healthcare_facilities",
        "hospital": "Healthcare_facilities",
        "pharmacy": "Healthcare_facilities",
        "veterinary": "Healthcare_facilities",
        "nursing_home": "Healthcare_facilities",
        "nursing_room": "Healthcare_facilities",
        # Essential services
        "atm": "Essential_services",
        "bank": "Essential_services",
        "bureau_de_change": "Essential_services",
        "money_transfer": "Essential_services",
        "payment_terminal": "Essential_services",
        "post_office": "Essential_services",
        "post_box": "Essential_services",
        "post_depot": "Essential_services",
        "letter_box": "Essential_services",
        "parcel_locker": "Essential_services",
        "waste_disposal": "Essential_services",
        "recycling": "Essential_services",
        "waste_transfer_station": "Essential_services",
        "waste_basket": "Essential_services",
        # Residential (rare in OSM extract)
        "residential": "Residential",
        # Education
        "childcare": "Education_institutions",
        "kindergarten": "Education_institutions",
        "school": "Education_institutions",
        "college": "Education_institutions",
        "university": "Education_institutions",
        "prep_school": "Education_institutions",
        "language_school": "Education_institutions",
        "music_school": "Education_institutions",
        "dancing_school": "Education_institutions",
        "art_school": "Education_institutions",
        "driving_school": "Education_institutions",
        # Transport services
        "bus_station": "Transport_services",
        "ferry_terminal": "Transport_services",
        "taxi": "Transport_services",
        "parking": "Transport_services",
        "parking_entrance": "Transport_services",
        "parking_exit": "Transport_services",
        "parking_space": "Transport_services",
        "car_rental": "Transport_services",
        "car_sharing": "Transport_services",
        "car_wash": "Transport_services",
        "car_pooling": "Transport_services",
        "charging_station": "Transport_services",
        "device_charging_station": "Transport_services",
        "vehicle_ramp": "Transport_services",
        "bicycle_parking": "Transport_services",
        "bicycle_rental": "Transport_services",
        "bicycle_repair_station": "Transport_services",
        "motorcycle_parking": "Transport_services",
        "motorcycle_rental": "Transport_services",
        "boat_rental": "Transport_services",
        "ticket_validator": "Transport_services",
        # Tourism / leisure
        "museum": "Tourism",
        "cinema": "Tourism",
        "theatre": "Tourism",
        "events_venue": "Tourism",
        "conference_centre": "Tourism",
        "arts_centre": "Tourism",
        "tourist_attraction": "Tourism",
        # Community spaces
        "community_centre": "Community_spaces",
        "social_centre": "Community_spaces",
        "social_facility": "Community_spaces",
        "library": "Community_spaces",
        "studio": "Community_spaces",
        "bbq": "Community_spaces",
        "bench": "Community_spaces",
        "shelter": "Community_spaces",
        "fountain": "Community_spaces",
        "water_point": "Community_spaces",
        "park": "Community_spaces",
        "nparks_parks": "Community_spaces",
        "nparks_bbq_pit": "Community_spaces",
        # Government services
        "admin": "Government_services",
        "public_building": "Government_services",
        "townhall": "Government_services",
        # Retail / F&B
        "restaurant": "Retail_services",
        "fast_food": "Retail_services",
        "cafe": "Retail_services",
        "bar": "Retail_services",
        "pub": "Retail_services",
        "marketplace": "Retail_services",
        "food_court": "Retail_services",
        "nightclub": "Retail_services",
        "spa": "Retail_services",
        "ice_cream": "Retail_services",
    }

    KEYWORD_TO_CATEGORY: Dict[str, str] = {
        "police": "Emergency_services",
        "fire": "Emergency_services",
        "clinic": "Healthcare_facilities",
        "hospital": "Healthcare_facilities",
        "medical": "Healthcare_facilities",
        "childcare": "Education_institutions",
        "school": "Education_institutions",
        "university": "Education_institutions",
        "college": "Education_institutions",
        "bus": "Transport_services",
        "mrt": "Transport_services",
        "station": "Transport_services",
        "carpark": "Transport_services",
        "parking": "Transport_services",
        "port": "Transport_services",
        "harbour": "Transport_services",
        "ferry": "Transport_services",
        "terminal": "Transport_services",
        "taxi": "Transport_services",
        "museum": "Tourism",
        "gallery": "Tourism",
        "theatre": "Tourism",
        "cinema": "Tourism",
        "library": "Community_spaces",
        "park": "Community_spaces",
        "community": "Community_spaces",
        "centre": "Community_spaces",
        "mosque": "Community_spaces",
        "temple": "Community_spaces",
        "church": "Community_spaces",
        "synagogue": "Community_spaces",
        "restaurant": "Retail_services",
        "cafe": "Retail_services",
        "bar": "Retail_services",
        "mall": "Retail_services",
        "market": "Retail_services",
        "shop": "Retail_services",
        "store": "Retail_services",
        "atm": "Essential_services",
        "bank": "Essential_services",
        "post": "Essential_services",
        "parcel": "Essential_services",
    }

    DEFAULT_CATEGORY = "Others"

    def predict(self, *, amenity_type: str, amenity_name: str) -> ClassificationResult:
        type_key = (amenity_type or "").strip().lower()
        if type_key in self.TYPE_TO_CATEGORY:
            label = self.TYPE_TO_CATEGORY[type_key]
            return ClassificationResult(label=label, score=1.0)

        name_lower = (amenity_name or "").strip().lower()
        for keyword, category in self.KEYWORD_TO_CATEGORY.items():
            if keyword in name_lower:
                return ClassificationResult(label=category, score=0.6)

        return ClassificationResult(label=self.DEFAULT_CATEGORY, score=0.0)


class HybridAmenityClassifier:
    """Attempt HuggingFace classification with a rule-based fallback."""

    def __init__(self, *, model_name: str = "facebook/bart-large-mnli") -> None:
        self._rule_based = RuleBasedClassifier()
        try:
            self._hf = HuggingFaceZeroShot(model_name=model_name)
            LOGGER.info("Using HuggingFace zero-shot classifier '%s'", model_name)
        except Exception as exc:  # pragma: no cover - depends on environment
            LOGGER.warning("Falling back to rule-based classifier: %s", exc)
            self._hf = None

    def predict(self, text: str, *, amenity_type: str, amenity_name: str) -> ClassificationResult:
        if self._hf is not None:
            try:
                return self._hf.predict(text, candidate_labels=CANONICAL_CATEGORIES)
            except Exception as exc:  # pragma: no cover - runtime safety
                LOGGER.warning("HuggingFace prediction failed (%s); using rule-based fallback", exc)
        return self._rule_based.predict(amenity_type=amenity_type, amenity_name=amenity_name)


class AmenityCategoryReclassifier:
    """Applies a classifier to amenity dataset rows."""

    def __init__(self, classifier: HybridAmenityClassifier) -> None:
        self.classifier = classifier

    def build_text(self, row: Dict[str, str]) -> str:
        parts: List[str] = []
        for key in ("amenity_name", "amenity_type", "amenity_category", "road_name", "planning_area", "subzone"):
            value = (row.get(key) or "").strip()
            if value:
                parts.append(value)
        return " | ".join(parts)

    def reclassify_rows(self, rows: List[Dict[str, str]]) -> List[str]:
        labels: List[str] = []
        for row in rows:
            text = self.build_text(row)
            result = self.classifier.predict(
                text,
                amenity_type=row.get("amenity_type", ""),
                amenity_name=row.get("amenity_name", ""),
            )
            labels.append(result.label)
        return labels

    def reclassify_file(
        self,
        input_path: Path,
        output_path: Path,
        *,
        start_index: int = 0,
    ) -> None:
        import csv

        with input_path.open("r", newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            rows = list(reader)

        target_rows = rows[start_index:]
        new_labels = self.reclassify_rows(target_rows)

        for offset, label in enumerate(new_labels):
            rows[start_index + offset]["amenity_category"] = label

        with output_path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=reader.fieldnames)
            writer.writeheader()
            writer.writerows(rows)


@dataclass(frozen=True)
class ReclassificationPreset:
    name: str
    description: str
    input_path: Path
    output_path: Path
    start_index: int


PRESETS: Dict[str, ReclassificationPreset] = {
    "baseline": ReclassificationPreset(
        name="baseline",
        description="Reclassify the full baseline dataset (amenities_3layers.csv).",
        input_path=Path("backend/etl/data/amenities_3layers.csv"),
        output_path=Path("backend/etl/data/amenities_3layers_reclassified.csv"),
        start_index=0,
    ),
    "appended": ReclassificationPreset(
        name="appended",
        description=(
            "Reclassify appended OSM rows in amenities_3layers_V2.csv starting at index "
            f"{DEFAULT_APPEND_START_INDEX}."
        ),
        input_path=Path("backend/etl/data/amenities_3layers_V2.csv"),
        output_path=Path("backend/etl/data/amenities_3layers_V2_reclassified.csv"),
        start_index=DEFAULT_APPEND_START_INDEX,
    ),
}


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Amenity category classification CLI consolidating previous scripts."
    )
    parser.add_argument(
        "--preset",
        choices=sorted(PRESETS.keys()),
        default="appended",
        help="Named configuration for common datasets (default: appended).",
    )
    parser.add_argument(
        "--input",
        type=Path,
        help="Custom input CSV path (overrides preset).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Custom output CSV path (overrides preset).",
    )
    parser.add_argument(
        "--start-index",
        type=int,
        help="Row index to begin reclassification (overrides preset).",
    )
    parser.add_argument(
        "--model",
        default="facebook/bart-large-mnli",
        help="HuggingFace model name for zero-shot classification.",
    )
    parser.add_argument(
        "--list-presets",
        action="store_true",
        help="List preset configurations and exit.",
    )
    args = parser.parse_args(argv)

    if args.list_presets:
        for preset in PRESETS.values():
            print(f"{preset.name}: {preset.description}\n  input={preset.input_path}\n  output={preset.output_path}\n  start_index={preset.start_index}")
        parser.exit()

    return args


def _resolve_execution_plan(args: argparse.Namespace) -> tuple[Path, Path, int]:
    preset = PRESETS.get(args.preset)
    input_path = args.input or (preset.input_path if preset else None)
    if input_path is None:
        raise ValueError("Input path must be provided either via preset or --input")

    if args.output is not None:
        output_path = args.output
    elif preset is not None and args.input is None:
        output_path = preset.output_path
    else:
        output_path = input_path

    if args.start_index is not None:
        start_index = args.start_index
    elif preset is not None and args.input is None:
        start_index = preset.start_index
    else:
        start_index = 0

    return (input_path, output_path, start_index)


def main(argv: Optional[Sequence[str]] = None) -> None:
    args = parse_args(argv)
    input_path, output_path, start_index = _resolve_execution_plan(args)

    classifier = HybridAmenityClassifier(model_name=args.model)
    reclassifier = AmenityCategoryReclassifier(classifier)
    reclassifier.reclassify_file(input_path, output_path, start_index=start_index)
    print(f"Reclassified rows >= {start_index} from {input_path} into {output_path}")


__all__ = [
    "CANONICAL_CATEGORIES",
    "HybridAmenityClassifier",
    "AmenityCategoryReclassifier",
    "main",
]


if __name__ == "__main__":
    main()
