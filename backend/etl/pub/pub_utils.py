import re
from datetime import datetime
from typing import Optional, Literal, Dict, Any

EventType = Literal["flash_flood", "heavy_rain", "flash_flood_risk", "flood_subsided"]


def _normalize_location_or_none(location_str: Optional[str]) -> Optional[str]:
    """
    Clean a location string and drop obviously invalid ones
    (pure time, URLs, or no alphabetic characters).
    """
    if not location_str or not isinstance(location_str, str):
        return None

    cleaned = clean_location_string(location_str)
    if not cleaned:
        return None

    low = cleaned.lower()

    # Drop URLs / Telegram handles / channel names
    if any(x in low for x in ("http://", "https://", "t.me", "telegram", "pubfloodalerts")):
        return None

    # Must contain at least one alphabetic character
    if not any(c.isalpha() for c in low):
        return None

    # Drop pure time expressions like "45 hours" or "14:05 hours"
    if "hours" in low or "hour" in low:
        core = re.sub(r"(hours?|h)\b", "", low)
        core = re.sub(r"[0-9:\\s]", "", core)
        if not core.strip():
            return None

    return cleaned

def _parse_location_direction(location_str: str) -> Dict[str, Optional[str]]:
    """
    Parse location string to extract start and end locations from directional phrases.

    Examples:
    - "Jurong Town Hall Road (towards PIE) before Jurong East Street 11"
      -> start_loc: "jurong town hall road", end_loc: "pie"
    - "TPE (Punggol West Flyover)"
      -> start_loc: "punggol west flyover", end_loc: None  (expressway name ignored)
    - "King's Road (from Prince Road to Lutheran Road)"
      -> start_loc: "king's road", end_loc: "prince road to lutheran road"
    - "Kings Rd (between Prince Rd and Lutheran Rd)"
      -> start_loc: "prince rd", end_loc: "lutheran rd"
    - "northern, western and central areas of Singapore"
      -> start_loc: "northern, western and central areas", end_loc: None
    """
    if not location_str:
        return {"start_loc": None, "end_loc": None}

    # Clean the location string first
    location_str = location_str.strip()

    # Pattern 0: "Junction of X and Y" - extract both roads at intersection
    junction_match = re.search(
        r"^junction\s+of\s+(.+?)\s+and\s+(.+?)$", location_str, re.IGNORECASE
    )
    if junction_match:
        return {
            "start_loc": _normalize_location_or_none(junction_match.group(1)),
            "end_loc": _normalize_location_or_none(junction_match.group(2)),
        }

    # Pattern 1: "Location (towards Destination)"
    towards_match = re.search(
        r"^([^(]+)\s*\(towards\s+([^)]+)\)", location_str, re.IGNORECASE
    )
    if towards_match:
        return {
            "start_loc": _normalize_location_or_none(towards_match.group(1)),
            "end_loc": _normalize_location_or_none(towards_match.group(2)),
        }

    # Pattern 2: "Location (from X to Y)" or "Location (X to Y)" - extract cross streets
    # The flood is between the two cross streets, not at the main road itself
    from_to_match = re.search(
        r"^([^(]+)\s*\((?:from\s+)?(.+?)\s+to\s+(.+?)\)", location_str, re.IGNORECASE
    )
    if from_to_match:
        # X is start_loc, Y is end_loc (the cross streets define the segment)
        return {
            "start_loc": _normalize_location_or_none(from_to_match.group(2)),
            "end_loc": _normalize_location_or_none(from_to_match.group(3)),
        }

    # Pattern 2b: "Location (between X and Y)" - X is start, Y is end
    between_match = re.search(
        r"^([^(]+)\s*\(between\s+(.+?)\s+and\s+(.+?)\)", location_str, re.IGNORECASE
    )
    if between_match:
        # For "between X and Y", X is start_loc and Y is end_loc
        return {
            "start_loc": _normalize_location_or_none(between_match.group(2)),
            "end_loc": _normalize_location_or_none(between_match.group(3)),
        }

    # Pattern 2c: "Expressway (direction) at/after Specific Location" - extract location after "at"/"after"
    # Example: "ECP (towards Changi Airport) at Tanah Merah Coast Road Entrance"
    # Example: "ECP (towards Changi Airport) after Bayshore Rd Exit"
    expressway_at_after_match = re.search(
        r"^(TPE|PIE|CTE|KPE|ECP|AYE|SLE|BKE)\s*\([^)]+\)\s+(at|after)\s+(.+)",
        location_str,
        re.IGNORECASE
    )
    if expressway_at_after_match:
        # Use the location after "at"/"after" as start_loc, ignore expressway and direction
        return {
            "start_loc": _normalize_location_or_none(expressway_at_after_match.group(3)),
            "end_loc": None,
        }

    # Pattern 3: "Expressway/Road (Specific Location)" - use specific location as start_loc
    # Common expressways: TPE, PIE, CTE, KPE, ECP, AYE, SLE, BKE
    expressway_match = re.search(
        r"^(TPE|PIE|CTE|KPE|ECP|AYE|SLE|BKE)\s*\(([^)]+)\)",
        location_str,
        re.IGNORECASE
    )
    if expressway_match:
        # Use the specific location in parentheses as start_loc
        # The expressway name becomes the parent road (handled separately)
        return {
            "start_loc": _normalize_location_or_none(expressway_match.group(2)),
            "end_loc": None,
        }

    # Pattern 4: "Location (Description)" - treat description as end_loc
    paren_match = re.search(r"^([^(]+)\s*\(([^)]+)\)", location_str)
    if paren_match:
        return {
            "start_loc": _normalize_location_or_none(paren_match.group(1)),
            "end_loc": _normalize_location_or_none(paren_match.group(2)),
        }

    # Pattern 5: "Location before Another Location"
    before_match = re.search(r"^(.+?)\s+before\s+(.+)$", location_str, re.IGNORECASE)
    if before_match:
        return {
            "start_loc": _normalize_location_or_none(before_match.group(1)),
            "end_loc": _normalize_location_or_none(before_match.group(2)),
        }

    # Pattern 6: No directional info - single location goes to start_loc
    return {
        "start_loc": _normalize_location_or_none(location_str),
        "end_loc": None,
    }


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
    # Many templates start with emoji and/or brackets; relax to substring checks.
    if "risk of flash floods" in low:
        out["event"] = "flash_flood_risk"
        # Prefer bullet-style location if present
        location_raw = _extract_bullet_location(text)
        if not location_raw:
            # Fallback: find the colon after "location" keyword, not the colon in time stamps
            # Look for "location for the next X hour:" pattern
            location_kw_match = re.search(r"location[^:]*:\s*", text, re.IGNORECASE)
            if location_kw_match:
                start_idx = location_kw_match.end()
                # Find the opening bracket of the time marker
                # Handles both "[14:03 hours]" and "[Issued 13:12 hours]"
                bracket_match = re.search(r"\s*\[(Issued\s+)?[\d:]+\s*hours?\]", text[start_idx:], re.IGNORECASE)
                if bracket_match:
                    location_raw = text[start_idx : start_idx + bracket_match.start()].strip()
                else:
                    location_raw = text[start_idx:].strip()

    elif "[flash flood occurred]" in low:
        out["event"] = "flash_flood"
        # "Flash flood at <LOC>."
        location_raw = _text_after_before(text, "at", ".")

    elif "flash flood at the following location" in low:
        # Template: "Flash flood at the following location:\n\n• <LOC> [time]"
        out["event"] = "flash_flood"
        location_raw = _extract_bullet_location(text) or _text_after_before(
            text, "location:", "["
        )

    elif "flash flood at" in low:
        # Generic: "Flash flood at <LOC> ..." (without the special header)
        out["event"] = out.get("event") or "flash_flood"
        # Try between "flash flood at" and "[" or "."
        loc = _text_after_before(text, "flash flood at", "[") or _text_after_before(
            text, "flash flood at", "."
        )
        location_raw = loc or location_raw

    elif "subsided at" in low:
        out["event"] = "flood_subsided"
        # "subsided at <LOC>."
        location_raw = _text_after_before(text, "subsided at", ".")

    elif "has subsided" in low and "flash flood at" in low:
        # Template: "Flash flood at <LOC> has subsided."
        out["event"] = "flood_subsided"
        loc = _text_after_before(text, "flash flood at", "has subsided")
        location_raw = loc or location_raw

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


def _extract_bullet_location(s: str) -> Optional[str]:
    """
    Extract first bullet-point location, e.g.:
    - \"• TPE (Punggol West Flyover) [20:27 hours]\"
    - \"• Enterprise Road [Issued 16:05 hours]\"
    """
    bullet_idx = s.find("•")
    if bullet_idx == -1:
        return None

    segment = s[bullet_idx + 1 :].lstrip()
    # Take first non-empty line
    lines = [ln for ln in segment.splitlines() if ln.strip()]
    if not lines:
        return None
    first = lines[0]
    # Strip trailing time / bracket section
    if "[" in first:
        first = first.split("[", 1)[0]
    # Remove trailing sentence endings
    first = first.strip(" .;:-")
    return first or None


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
    # Only strip whitespace and common separators, but preserve parentheses
    # as they may contain important directional info like "(from X to Y)"
    return s[a_end:b].strip(" :,[]")


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
        Cleaned location string with title case normalization and without ", Singapore" suffix
    """
    if not location_str or not isinstance(location_str, str):
        return ""

    # Strip whitespace
    cleaned = location_str.strip()

    # Handle multi-line locations (e.g., "Marine Parade Ctrl;\nMarine Parade Rd")
    # Take the first line as the primary/more specific location
    if '\n' in cleaned or '\r' in cleaned:
        # Split by newlines and filter out empty lines
        lines = [line.strip() for line in cleaned.replace('\r\n', '\n').replace('\r', '\n').split('\n') if line.strip()]
        if len(lines) > 0:
            # Use only the first line (the primary/more specific location)
            cleaned = lines[0]
        # Remove any trailing semicolons
        cleaned = cleaned.rstrip(';').strip()

    # Remove ", Singapore" suffix (case insensitive)
    if cleaned.lower().endswith(", singapore"):
        cleaned = cleaned[:-11]  # Remove ", singapore"
    elif cleaned.lower().endswith(",singapore"):
        cleaned = cleaned[:-10]  # Remove ",singapore"

    # Apply title case normalization for consistent capitalization
    # This handles inconsistent casing in raw alert text
    cleaned = cleaned.title()

    # Fix expressway/highway codes to be uppercase
    # Common Singapore expressways: TPE, PIE, CTE, KPE, ECP, AYE, SLE, BKE
    expressway_codes = ['Tpe', 'Pie', 'Cte', 'Kpe', 'Ecp', 'Aye', 'Sle', 'Bke']
    for code in expressway_codes:
        if code in cleaned:
            cleaned = cleaned.replace(code, code.upper())

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
