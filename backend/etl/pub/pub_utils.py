import re
from datetime import datetime
from typing import Optional, Literal, Dict, Any

EventType = Literal["flash_flood", "heavy_rain", "flash_flood_risk", "flood_subsided"]

def _parse_location_direction(location_str: str) -> Dict[str, Optional[str]]:
    """
    Parse location string to extract start and end locations from directional phrases.

    Examples:
    - "Jurong Town Hall Road (towards PIE) before Jurong East Street 11"
      -> start_loc: "jurong town hall road", end_loc: "pie"
    - "TPE (Punggol West Flyover)"
      -> start_loc: "tpe", end_loc: "punggol west flyover"
    - "northern, western and central areas of Singapore"
      -> start_loc: "northern, western and central areas", end_loc: None
    """
    if not location_str:
        return {"start_loc": None, "end_loc": None}

    # Clean the location string first
    location_str = location_str.strip()

    # Pattern 1: "Location (towards Destination)"
    towards_match = re.search(
        r"^([^(]+)\s*\(towards\s+([^)]+)\)", location_str, re.IGNORECASE
    )
    if towards_match:
        return {
            "start_loc": clean_location_string(towards_match.group(1)),
            "end_loc": clean_location_string(towards_match.group(2)),
        }

    # Pattern 2: "Location (Description)" - treat description as end_loc
    paren_match = re.search(r"^([^(]+)\s*\(([^)]+)\)", location_str)
    if paren_match:
        return {
            "start_loc": clean_location_string(paren_match.group(1)),
            "end_loc": clean_location_string(paren_match.group(2)),
        }

    # Pattern 3: "Location before Another Location"
    before_match = re.search(r"^(.+?)\s+before\s+(.+)$", location_str, re.IGNORECASE)
    if before_match:
        return {
            "start_loc": clean_location_string(before_match.group(1)),
            "end_loc": clean_location_string(before_match.group(2)),
        }

    # Pattern 4: No directional info - single location goes to start_loc
    return {"start_loc": clean_location_string(location_str), "end_loc": None}


def parse_alert(text: str, alert_time: datetime) -> Dict[str, Any]:
    """
    Rule-based parser using simple string operations (no spaCy dependency).
    Anchors time parsing to `alert_time`'s date.
    """
    low = text.lower()

    out: Dict[str, Any] = {
        "start_loc": None,
        "end_loc": None,
        "start": None,
        "end": None,
        "event": None,
    }

    location_raw: Optional[str] = None

    # --- 1) classify event by stable cues and extract location text ---
    if low.startswith("[risk of flash floods]"):
        out["event"] = "flash_flood_risk"
        # Location is usually after the last ":" and before the next "[" (time)
        colon_idx = text.rfind(":")
        if colon_idx != -1:
            bracket_idx = text.find("[", colon_idx + 1)
            if bracket_idx == -1:
                location_raw = text[colon_idx + 1 :].strip()
            else:
                location_raw = text[colon_idx + 1 : bracket_idx].strip()

    elif low.startswith("[flash flood occurred]"):
        out["event"] = "flash_flood"
        # "Flash flood at <LOC>."
        location_raw = _text_after_before(text, "at", ".")

    elif "subsided at" in low:
        out["event"] = "flood_subsided"
        # "subsided at <LOC>."
        location_raw = _text_after_before(text, "subsided at", ".")

    elif "heavy rain expected" in low:
        out["event"] = "heavy_rain"
        # "over <LOC> from ..."
        location_raw = _text_after_before(text, "over", "from")
        # "from HH:MM hours to HH:MM hours"
        start_txt = _text_after_before(text, "from", "hours")
        end_txt = _text_after_before(
            text, "to", "hours", start_pos=text.lower().find(" to ")
        )
        if start_txt:
            out["start"] = _parse_time(start_txt, alert_time)
        if end_txt:
            out["end"] = _parse_time(end_txt, alert_time)

    # Parse location into start_loc and end_loc
    if location_raw:
        location_data = _parse_location_direction(location_raw)
        out.update(location_data)

    return out


# ---------------- helpers (token-aware spans) ----------------


def _span_between_tokens(doc, left_tok: str, right_tok: str) -> Optional[str]:
    li = _find_token_index(doc, left_tok)
    if li is None:
        return None
    ri = _find_token_index(doc, right_tok, start=li + 1)
    if ri is None:
        ri = len(doc)
    if ri - li <= 1:
        return None
    return doc[li + 1 : ri].text.strip()


def _span_after_until(
    doc, cue: str, until: str, after_word: Optional[str] = None
) -> Optional[str]:
    # get index of cue (e.g., "at" or "subsided")
    ci = _find_token_index(doc, cue, case_insensitive=True)
    if ci is None:
        return None
    if after_word:
        # ensure "subsided at"
        ai = _find_token_index(doc, after_word, start=ci + 1, case_insensitive=True)
        if ai is None:
            return None
        start_i = ai + 1
    else:
        start_i = ci + 1
    ui = _find_token_index(doc, until, start=start_i)
    if ui is None:
        ui = len(doc)
    if ui - start_i <= 0:
        return None
    return doc[start_i:ui].text.strip()


def _span_between_keywords(doc, left_kw: str, right_kw: str) -> Optional[str]:
    li = _find_token_index(doc, left_kw, case_insensitive=True)
    if li is None:
        return None
    ri = _find_token_index(doc, right_kw, start=li + 1, case_insensitive=True)
    if ri is None or ri - li <= 1:
        return None
    return doc[li + 1 : ri].text.strip()


def _find_token_index(
    doc, token_text: str, start: int = 0, case_insensitive: bool = False
) -> Optional[int]:
    t = token_text.lower() if case_insensitive else token_text
    for i in range(start, len(doc)):
        cur = doc[i].text.lower() if case_insensitive else doc[i].text
        if cur == t:
            return i
    return None


def _first_bracket_content(s: str) -> Optional[str]:
    l = s.find("[")
    r = s.find("]", l + 1) if l != -1 else -1
    if l != -1 and r != -1 and r > l + 1:
        return s[l + 1 : r]
    return None


def _text_after_before(
    s: str, after: str, before: str, start_pos: int = 0
) -> Optional[str]:
    low = s.lower()
    a = low.find(after.lower(), start_pos)
    if a == -1:
        return None
    a_end = a + len(after)
    b = low.find(before.lower(), a_end)
    if b == -1:
        return None
    return s[a_end:b].strip(" :,[]()")


# ---------------- time parsing (anchored to alert date) ----------------


def _parse_time(chunk: str, alert_time) -> Optional[datetime]:
    """
    Accepts '09:28', '0928', '09:28 hours', '0810 hours'
    Returns datetime on the same date as alert_time.
    """
    # Handle string input
    if isinstance(alert_time, str):
        try:
            alert_time = datetime.fromisoformat(alert_time.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return None

    if not isinstance(alert_time, datetime):
        return None

    s = chunk.strip()
    # keep only digits and colon
    m = re.search(r"(\d{1,2}):?(\d{2})", s)
    if not m:
        return None
    try:
        hh = int(m.group(1))
        mm = int(m.group(2))
        if hh > 23 or mm > 59:
            return None
        return alert_time.replace(hour=hh, minute=mm, second=0, microsecond=0)
    except (ValueError, AttributeError):
        return None


def clean_location_string(location_str: str) -> str:
    """
    Clean location string by removing redundancy and standardizing format.

    Args:
        location_str: Raw location string

    Returns:
        Cleaned location string in lowercase without ", Singapore" suffix
    """
    if not location_str or not isinstance(location_str, str):
        return ""

    # Strip whitespace
    cleaned = location_str.strip()

    # Remove ", Singapore" suffix (case insensitive)
    if cleaned.lower().endswith(", singapore"):
        cleaned = cleaned[:-11]  # Remove ", singapore"
    elif cleaned.lower().endswith(",singapore"):
        cleaned = cleaned[:-10]  # Remove ",singapore"

    # Convert to lowercase
    cleaned = cleaned.lower()

    # Strip any remaining whitespace
    return cleaned.strip()


def normalize_location_for_lookup(location_str: str) -> str:
    """
    Normalize location string for database lookup.
    This is an alias for clean_location_string for clarity.

    Args:
        location_str: Raw location string

    Returns:
        Normalized location string for database lookup
    """
    return clean_location_string(location_str)


# --- Example usage ---
if __name__ == "__main__":
    alert_time = datetime(2025, 9, 6, 18, 0)  # the time your bot fetched the alert

    examples = [
        # Flash flood risk
        "[Risk of Flash Floods] Due to heavy rain, please avoid this location for the next 1 hour: TPE (Punggol West Flyover) [09:28 hours]",
        # Heavy rain with NEA issuance
        "Heavy rain expected over northern, western and central areas of Singapore from 09:00 hours to 09:40 hours. [Issued by NEA, 08:52 hours]",
        # Flood subsided
        "Flash flood subsided at Jurong Town Hall Road (towards PIE) before Jurong East Street 11. Issued 0810 hours.",
        # Flash flood occurred
        "[FLASH FLOOD OCCURRED] Flash flood at Jurong Town Hall Road (towards PIE) before Jurong East Street 11. Please avoid the area.",
    ]

    for e in examples:
        parsed = parse_alert(e, alert_time)
        print(f"\nTEXT: {e}")
        print("PARSED:", parsed)

    # Test location cleaning
    print("\n--- Location Cleaning Tests ---")
    test_locations = [
        "Orchard Road, Singapore",
        "Marina Bay Sands, Singapore",
        "Jurong East Street 11,Singapore",
        "PIE (Changi Airport towards Tuas)",
        "ORCHARD ROAD, SINGAPORE",
    ]

    for loc in test_locations:
        cleaned = clean_location_string(loc)
        print(f"'{loc}' -> '{cleaned}'")
