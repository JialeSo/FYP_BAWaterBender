"""Utility helpers for deriving consistent amenity names."""

from __future__ import annotations

from collections import ChainMap
from typing import Any, Iterable, Mapping, Sequence


_NULL_STRINGS = {"", "nan", "none", "null", "undefined", "nil"}

_COMMON_NAME_KEYS: Sequence[str] = (
    "amenity_name",
    "NAME",
    "name",
    "Name",
    "display_name",
    "label",
    "title",
    "TITLE",
    "description",
    "DESCRIPTION",
    "DESC",
    "desc",
    "TRADE_NAME",
    "TRADE_NAM",
    "facility",
    "FACILITY",
    "FACILITY_N",
    "FACIL_NAME",
    "BUILDING",
    "BUILDING_NA",
    "building_name",
    "PLACE_NAME",
    "place_name",
    "poi_name",
    "SEARCHVAL",
    "STATION_NAME",
    "STN_NAME",
    "STN_NAM",
    "STATION_N",
    "SHELTER_NAME",
    "CENTRE_NAME",
    "Attributes CENTRE_NAME",
    "ORGANISATION_NAME",
    "SCHOOL_NAME",
    "PROGRAMME_NAME",
    "TRADE_DESC",
    "TRADE_DES",
    "BUS_STOP_N",
    "BUS_STOP_NUM",
    "BUS_STOP_CODE",
    "BUS_STOP_NU",
    "EXIT_NAME",
    "Exit_No",
    "EXIT",
    "FAC_NAME",
    "FAC_DESC",
    "BUILDINGNAME",
    "BLOCK",
)

_TYPE_NAME_OVERRIDES: Mapping[str, Sequence[str]] = {
    "bus_stops": ("BUS_STOP_N", "BUS_STOP_CODE", "BUS_STOP_NUM", "BUS_STOP_NU"),
    "bus_depots": ("TRADE_NAME", "NAME"),
    "bus_interchanges_terminals": ("TRADE_NAME", "TERMINAL_NA", "TERMINAL_N", "NAME"),
    "childcare_clean": (
        "CENTRE_NAME",
        "Centre_Name",
        "centre_name",
        "Attributes CENTRE_NAME",
        "TRADE_NAME",
        "ORGANISATION_NAME",
        "Name",
    ),
    "preschools": (
        "Attributes CENTRE_NAME",
        "CENTRE_NAME",
        "centre_name",
        "TRADE_NAME",
        "SCHOOL_NAME",
    ),
    "kindergartens": ("TRADE_NAME", "CENTRE_NAME", "SCHOOL_NAME"),
    "moe_schools": ("SCHOOL_NAME", "SCHOOL", "NAME"),
    "mrt_station_exits": ("EXIT_NAME", "Exit_No", "EXIT", "NAME"),
    "parkfacilities": ("NAME", "FACIL_NAME", "CLASS", "UNIQUEID"),
    "parking": ("NAME", "description", "desc"),
    "parking_entrance": ("NAME", "description", "desc"),
    "parking_space": ("NAME", "description", "desc"),
    "shelter": ("NAME", "SHELTER_NAME", "SHELTER_TYPE"),
    "bench": ("NAME", "description"),
    "toilets": ("NAME", "description"),
    "bicycle_parking": ("NAME", "description"),
    "waste_basket": ("NAME", "description"),
    "vending_machine": ("NAME", "description"),
    "atm": ("NAME", "description"),
    "taxi": ("NAME", "description"),
}


def _clean(value: Any) -> str:
    """Return a normalised string value or empty string."""
    if value is None:
        return ""
    if isinstance(value, str):
        candidate = value.strip()
    else:
        candidate = str(value).strip()
    if candidate.lower() in _NULL_STRINGS:
        return ""
    return candidate


def _first_non_empty(mapping: Mapping[str, Any], keys: Iterable[str]) -> str:
    """Return the first non-empty string value for the provided keys."""
    for key in keys:
        if key in mapping:
            candidate = _clean(mapping.get(key))
            if candidate:
                return candidate
    return ""


def infer_amenity_name(
    mapping: Mapping[str, Any],
    *,
    source_file: str | None = None,
    extra_context: Mapping[str, Any] | None = None,
) -> str:
    """
    Infer an amenity name using a combination of direct properties and fallbacks.

    Args:
        mapping: Mapping containing amenity metadata.
        source_file: Optional source filename for context.
        extra_context: Optional additional mapping whose keys take priority.

    Returns:
        A non-empty amenity name string.
    """
    combined: Mapping[str, Any] = ChainMap(
        extra_context or {},
        mapping,
    )

    amenity_type = _clean(combined.get("amenity_type")) or _clean(
        (source_file or "").split(".")[0]
    )
    amenity_type_lower = amenity_type.lower()

    # 1. Type-specific overrides
    type_keys = _TYPE_NAME_OVERRIDES.get(amenity_type_lower, ())
    name = _first_non_empty(combined, type_keys)

    # Special-case bus stops: normalise to 5-digit code when possible.
    if amenity_type_lower == "bus_stops":
        if not name:
            for candidate_key in _TYPE_NAME_OVERRIDES["bus_stops"]:
                raw = _clean(combined.get(candidate_key))
                if raw:
                    name = raw
                    break
        if name:
            digits = "".join(ch for ch in name if ch.isdigit())
            if digits:
                return digits.zfill(5)

    if name:
        return name

    # 2. GeocodeInfo structures (e.g., OneMap nested metadata).
    for key, value in combined.items():
        if (
            key
            and key.lower() == "geocodeinfo"
            and isinstance(value, Sequence)
            and not isinstance(value, (str, bytes))
        ):
            for entry in value:
                if isinstance(entry, Mapping):
                    candidate = _first_non_empty(
                        entry,
                        (
                            "BUILDINGNAME",
                            "BUILDING_NAME",
                            "NAME",
                            "ROAD",
                        ),
                    )
                    if candidate:
                        return candidate

    # 3. Common keys shared across datasets.
    name = _first_non_empty(combined, _COMMON_NAME_KEYS)
    if name:
        return name

    # 4. Postal code-based fallback.
    postal_code = _clean(
        combined.get("postal_code")
        or combined.get("POSTAL")
        or combined.get("POSTAL_CD")
        or combined.get("POSTCODE")
    )
    if postal_code and amenity_type:
        return f"{amenity_type}_{postal_code}"

    # 5. Road-name fallback.
    road_name = _clean(combined.get("road_name") or combined.get("ROAD_NAME"))
    if road_name and amenity_type:
        return f"{amenity_type} @ {road_name}"

    # 6. ID-based fallback.
    amenity_id = _clean(combined.get("amenity_id"))
    if amenity_id and amenity_type:
        return f"{amenity_type}_{amenity_id[:8]}"

    # Final fallback: resort to amenity type (or generic placeholder).
    if amenity_type:
        return amenity_type
    return amenity_id or "unknown_amenity"
