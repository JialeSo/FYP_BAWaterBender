import os
import re
import time
import math
import requests
import random
import pandas as pd
from pathlib import Path
from typing import Optional, Tuple, List
from datetime import datetime

# -----------------------
# CONFIG
# -----------------------
BASE = Path(__file__).resolve().parent
infile = BASE / "PUB_weather_alerts_raw.csv"
outfile = BASE / "PUB_weather_alerts_clean.csv"
GEOCODE_CACHE_FILE = BASE / "geocode_cache.csv"
REVERSE_CACHE_FILE = BASE / "reverse_cache.csv"

LOCATIONIQ_KEY = os.getenv("LOCATIONIQ_KEY") or "pk.e4e9832f2313263c0d4de9baacda589a"
LOCATIONIQ_URL = "https://us1.locationiq.com/v1/search.php"
LOCATIONIQ_REVERSE = "https://us1.locationiq.com/v1/reverse.php"

SLEEP_BETWEEN_REQUESTS = 1.0  # keep to 1s for free tiers
MAX_REVERSE_JITTER_ATTEMPTS = 6
JITTER_RADIUS_METERS = 500

# -----------------------
# CACHE MANAGEMENT
# -----------------------
def load_geocode_cache() -> dict:
    """Load geocode cache from CSV file."""
    cache = {}
    if GEOCODE_CACHE_FILE.exists():
        try:
            df = pd.read_csv(GEOCODE_CACHE_FILE)
            for _, row in df.iterrows():
                if pd.notna(row['lat']) and pd.notna(row['lon']):
                    cache[row['query']] = (float(row['lat']), float(row['lon']))
                else:
                    cache[row['query']] = (None, None)
            print(f"Loaded {len(cache)} geocode cache entries")
        except Exception as e:
            print(f"Error loading geocode cache: {e}")
    return cache

def save_geocode_cache(cache: dict):
    """Save geocode cache to CSV file."""
    try:
        data = []
        for query, (lat, lon) in cache.items():
            data.append({
                'query': query,
                'lat': lat,
                'lon': lon,
                'last_updated': datetime.now().isoformat()
            })
        df = pd.DataFrame(data)
        df.to_csv(GEOCODE_CACHE_FILE, index=False)
        print(f"Saved {len(cache)} geocode cache entries")
    except Exception as e:
        print(f"Error saving geocode cache: {e}")

def load_reverse_cache() -> dict:
    """Load reverse geocode cache from CSV file."""
    cache = {}
    if REVERSE_CACHE_FILE.exists():
        try:
            df = pd.read_csv(REVERSE_CACHE_FILE)
            for _, row in df.iterrows():
                key = (round(float(row['lat']), 5), round(float(row['lon']), 5))
                cache[key] = row['postcode'] if pd.notna(row['postcode']) else None
            print(f"Loaded {len(cache)} reverse cache entries")
        except Exception as e:
            print(f"Error loading reverse cache: {e}")
    return cache

def save_reverse_cache(cache: dict):
    """Save reverse geocode cache to CSV file."""
    try:
        data = []
        for (lat, lon), postcode in cache.items():
            data.append({
                'lat': lat,
                'lon': lon,
                'postcode': postcode,
                'last_updated': datetime.now().isoformat()
            })
        df = pd.DataFrame(data)
        df.to_csv(REVERSE_CACHE_FILE, index=False)
        print(f"Saved {len(cache)} reverse cache entries")
    except Exception as e:
        print(f"Error saving reverse cache: {e}")

# -----------------------
# Initialize caches from files
# -----------------------
geocode_cache = load_geocode_cache()
reverse_cache = load_reverse_cache()

# -----------------------
# Helpers
# -----------------------
def safe_print(s: str):
    """Avoid UnicodeEncodeError on some Windows consoles."""
    print(str(s).encode("ascii", "ignore").decode())

def clean_individual_part(part: str) -> str:
    """Clean a location part: remove filler words, expand abbreviations."""
    if not isinstance(part, str) or not part.strip():
        return ""

    # Remove filler prefixes
    part = re.sub(r"^(near|from|at|junction of|intersection of|leading to)\s+", "", part, flags=re.IGNORECASE)
    # Replace "exit"/"slip road"
    part = re.sub(r"\b(exit|slip road)\b", "Slip", part, flags=re.IGNORECASE)

    # Expand abbreviations (allow trailing punctuation)
    replacements = {
        r"\bJln\b[.,]?": "Jalan", r"\bRd\b[.,]?": "Road", r"\bDr\b[.,]?": "Drive",
        r"\bAve\b[.,]?": "Avenue", r"\bCt\b[.,]?": "Court", r"\bCl\b[.,]?": "Close",
        r"\bCres\b[.,]?": "Crescent", r"\bSt\b[.,]?": "Street", r"\bLn\b[.,]?": "Lane",
        r"\bPl\b[.,]?": "Place", r"\bUpp\b[.,]?": "Upper", r"\bBt\b[.,]?": "Bukit",
        r"\bKg\b[.,]?": "Kampong", r"\bLor\b[.,]?": "Lorong", r"\bTPE\b": "Tampines Expressway",
        r"\bPIE\b": "Pan Island Expressway", r"\bKJE\b": "Kranji Expressway",
        r"\bECP\b": "East Coast Parkway", r"\bKPE\b": "Kallang-Paya Lebar Expressway",
        r"\bCTE\b": "Central Expressway", r"\bMCE\b": "Marina Coastal Expressway",
        r"\bSLE\b": "Seletar Expressway", r"\bPk\b[.,]?": "Park"
    }
    for patt, repl in replacements.items():
        part = re.sub(patt, repl, part, flags=re.IGNORECASE)

    # Clean stray chars
    part = re.sub(r"[^\w\s,.\-&]", " ", part)
    part = re.sub(r"\s+", " ", part).strip()
    return part

def extract_location_parts_and_cleaned(raw: str) -> Tuple[List[str], Optional[str], str]:
    """ 
        Extract structured location information from raw strings. Returns: 
        - parts: list of 1 or 2 cleaned location parts to geocode 
        - parent_main: top-level/main road (if available) 
        - cleaned_location: cleaned version for display 
    """
    if not raw or not isinstance(raw, str):
        return [], None, ""

    cleaned_raw = re.sub(r"\[.*?hours.*?\]", "", raw, flags=re.IGNORECASE)
    cleaned_raw = re.sub(r"issued.*?\d+", "", cleaned_raw, flags=re.IGNORECASE)
    cleaned_raw = re.sub(r"\[.*?\]", "", cleaned_raw)
    cleaned_raw = re.sub(r"\s+", " ", cleaned_raw).strip()

    # === Case: "X leading to Y"
    leading_match = re.search(r"(.+?)\s+leading to\s+(.+)", cleaned_raw, flags=re.IGNORECASE)
    if leading_match:
        start_clean = clean_individual_part(leading_match.group(1))
        end_clean = clean_individual_part(leading_match.group(2))
        cleaned_display = f"{start_clean} to {end_clean}"
        return [start_clean, end_clean], None, cleaned_display

    # === Case: "X (towards Y) before/after/near/at Z"
    complex_towards_match = re.search(
        r"(.+?\(.*towards.*?\))\s*(?:before|after|near|at)\s+(.+)",
        cleaned_raw,
        flags=re.IGNORECASE
    )
    if complex_towards_match:
        start_clean = clean_individual_part(complex_towards_match.group(1))
        end_clean = clean_individual_part(complex_towards_match.group(2))
        return [start_clean, end_clean], None, f"{start_clean} to {end_clean}"

    # === Case: "X towards Y before Z"
    towards_before_match = re.search(
        r"(.+?)\s+towards\s+(.+?)\s+(?:before|after|near|at)\s+(.+)",
        cleaned_raw,
        flags=re.IGNORECASE
    )
    if towards_before_match:
        start_clean = clean_individual_part(towards_before_match.group(1))
        mid_clean = clean_individual_part(towards_before_match.group(2))
        end_clean = clean_individual_part(towards_before_match.group(3))
        return [f"{start_clean} towards {mid_clean}", end_clean], None, f"{start_clean} towards {mid_clean} to {end_clean}"

    # === Case: "X towards Y"
    simple_towards = re.search(r"(.+?)\s+towards\s+(.+)", cleaned_raw, flags=re.IGNORECASE)
    if simple_towards:
        start_clean = clean_individual_part(simple_towards.group(1))
        end_clean = clean_individual_part(simple_towards.group(2))
        return [start_clean, end_clean], None, f"{start_clean} to {end_clean}"

    raw_lower = cleaned_raw.lower()

    # === Case: "between A and B" in ()
    between_in_parens = re.search(r"\(.*between\s+(.+?)\s+and\s+(.+?)\)", raw_lower)
    if between_in_parens:
        a, b = between_in_parens.group(1), between_in_parens.group(2)
        parent = re.search(r"^([^(]*)\(.*between.*\)", cleaned_raw)
        parent_clean = clean_individual_part(parent.group(1)) if parent else None
        a_clean, b_clean = clean_individual_part(a), clean_individual_part(b)
        cleaned_display = f"{parent_clean} ({a_clean} to {b_clean})" if parent_clean else f"{a_clean} to {b_clean}"
        return [a_clean, b_clean], parent_clean, cleaned_display

    # === Case: "A to B" in ()
    to_in_parens = re.search(r"\((.+?)\s+to\s+(.+?)\)", raw_lower)
    if to_in_parens:
        a, b = to_in_parens.group(1), to_in_parens.group(2)
        parent = re.search(r"^([^(]*)\(.*to.*\)", cleaned_raw)
        parent_clean = clean_individual_part(parent.group(1)) if parent else None
        a_clean, b_clean = clean_individual_part(a), clean_individual_part(b)
        cleaned_display = f"{parent_clean} ({a_clean} to {b_clean})" if parent_clean else f"{a_clean} to {b_clean}"
        return [a_clean, b_clean], parent_clean, cleaned_display

    # === Case: "A and B" in ()
    and_in_parens = re.search(r"\((.+?)\s+and\s+(.+?)\)", raw_lower)
    if and_in_parens:
        a, b = and_in_parens.group(1), and_in_parens.group(2)
        parent = re.search(r"^([^(]*)\(.*and.*\)", cleaned_raw)
        parent_clean = clean_individual_part(parent.group(1)) if parent else None
        a_clean, b_clean = clean_individual_part(a), clean_individual_part(b)
        cleaned_display = f"{parent_clean} ({a_clean} and {b_clean})" if parent_clean else f"{a_clean} and {b_clean}"
        return [a_clean, b_clean], parent_clean, cleaned_display

    # === Case: "between A and B"
    between_no_parens = re.search(r"between\s+(.+?)\s+and\s+(.+)", raw_lower)
    if between_no_parens:
        a, b = between_no_parens.group(1), between_no_parens.group(2)
        a_clean, b_clean = clean_individual_part(a), clean_individual_part(b)
        return [a_clean, b_clean], None, f"{a_clean} to {b_clean}"

    # === Case: "A to B"
    to_no_parens = re.search(r"(.+?)\s+to\s+(.+)", raw_lower)
    if to_no_parens:
        a, b = to_no_parens.group(1), to_no_parens.group(2)
        a_clean, b_clean = clean_individual_part(a), clean_individual_part(b)
        return [a_clean, b_clean], None, f"{a_clean} to {b_clean}"

    # === Case: "A and B"
    and_no_parens = re.search(r"(.+?)\s+and\s+(.+)", raw_lower)
    if and_no_parens:
        a, b = and_no_parens.group(1), and_no_parens.group(2)
        a_clean, b_clean = clean_individual_part(a), clean_individual_part(b)
        return [a_clean, b_clean], None, f"{a_clean} and {b_clean}"

    # === Case: Slash separated
    if "/" in cleaned_raw:
        parts = [clean_individual_part(p) for p in cleaned_raw.split("/") if p.strip()]
        if len(parts) == 2:
            return parts, None, f"{parts[0]} and {parts[1]}"

    # === Fallback: single
    cleaned_display = clean_individual_part(cleaned_raw)
    return [cleaned_display], None, cleaned_display

# -----------------------
# Geocoding primitives (LocationIQ only)
# -----------------------
def jitter_coords(lat: float, lon: float, radius_m: float = JITTER_RADIUS_METERS) -> Tuple[float, float]:
    """Return a random point within radius_m of (lat, lon)."""
    radius_deg = radius_m / 111320.0
    u = random.random()
    v = random.random()
    w = radius_deg * math.sqrt(u)
    t = 2 * math.pi * v
    return lat + w * math.cos(t), lon + w * math.sin(t)

def geocode_location_with_variants(part: str, parent_context: Optional[str] = None) -> Tuple[Optional[float], Optional[float]]:
    """
    Try multiple query variants to improve precision using LocationIQ only:
      1) exact part
      2) 'part near parent_context'
      3) 'part parent_context' (concatenate)
    """
    if not part or len(part.strip()) < 3:
        return None, None

    queries = []
    part_clean = part.strip()
    queries.append(f"{part_clean}, Singapore")
    if parent_context:
        parent_clean = parent_context.strip()
        queries.append(f"{part_clean} near {parent_clean}, Singapore")
        queries.append(f"{part_clean} {parent_clean}, Singapore")

    # dedupe queries
    seen = set()
    queries = [q for q in queries if q not in seen and not seen.add(q)]

    for q in queries:
        latlon = geocode_one_query(q)
        if latlon is not None:
            return latlon
        time.sleep(SLEEP_BETWEEN_REQUESTS)

    return None, None

def geocode_one_query(query: str) -> Optional[Tuple[float, float]]:
    """Perform one forward geocode attempt using LocationIQ only"""
    if not query:
        return None
    if query in geocode_cache:
        return geocode_cache[query]

    if LOCATIONIQ_KEY and LOCATIONIQ_KEY != "YOUR_LOCATIONIQ_KEY":
        try:
            params = {"key": LOCATIONIQ_KEY, "q": query, "format": "json", "limit": 1, "countrycodes": "SG"}
            resp = requests.get(LOCATIONIQ_URL, params=params, timeout=12)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list) and data:
                    lat, lon = float(data[0]["lat"]), float(data[0]["lon"])
                    geocode_cache[query] = (lat, lon)
                    return lat, lon
            elif resp.status_code == 404:
                geocode_cache[query] = (None, None)
                return None
            else:
                safe_print(f"[LocationIQ geocode HTTP error] {query} -> {resp.status_code}")
        except Exception as e:
            safe_print(f"[LocationIQ geocode error] {query} -> {e}")

    geocode_cache[query] = (None, None)
    return None

def reverse_geocode_postcode_with_buffer(lat: float, lon: float, attempts: int = MAX_REVERSE_JITTER_ATTEMPTS) -> Optional[str]:
    """Reverse geocode a point using LocationIQ only; if no postcode found, jitter up to attempts times within 500m."""
    if lat is None or lon is None:
        return None

    cache_key = (round(lat, 5), round(lon, 5))
    if cache_key in reverse_cache:
        return reverse_cache[cache_key]

    for attempt in range(attempts):
        try_lat, try_lon = (lat, lon) if attempt == 0 else jitter_coords(lat, lon, radius_m=JITTER_RADIUS_METERS)
        
        try:
            params = {"key": LOCATIONIQ_KEY, "lat": try_lat, "lon": try_lon, "format": "json", "addressdetails": 1}
            r = requests.get(LOCATIONIQ_REVERSE, params=params, timeout=12)
            if r.status_code == 200:
                d = r.json()
                pc = d.get("address", {}).get("postcode")
                if pc:
                    reverse_cache[cache_key] = pc
                    return pc
            elif r.status_code != 404:
                safe_print(f"[LocationIQ reverse HTTP error] ({try_lat}, {try_lon}) -> {r.status_code}")
        except Exception as e:
            safe_print(f"[LocationIQ reverse error] ({try_lat}, {try_lon}) -> {e}")
        
        time.sleep(SLEEP_BETWEEN_REQUESTS)

    reverse_cache[cache_key] = None
    return None

# ---------------------------
# Pipeline: process dataframe
# ---------------------------
def enrich_df_keep_original(df_in: pd.DataFrame) -> pd.DataFrame:
    df = df_in.copy()
    
    location_data = df["location"].apply(extract_location_parts_and_cleaned)
    df["start_loc"] = location_data.apply(lambda x: x[0][0] if x[0] and len(x[0]) > 0 else None)
    df["end_loc"] = location_data.apply(lambda x: x[0][1] if x[0] and len(x[0]) > 1 else None)
    df["parent_road"] = location_data.apply(lambda x: x[1])
    df["cleaned_location"] = location_data.apply(lambda x: x[2])

    for col in ["start_lat", "start_lng", "start_postal_code", "end_lat", "end_lng", "end_postal_code"]:
        if col not in df.columns:
            df[col] = None

    for idx, row in df.iterrows():
        raw = row["location"]
        parts, parent, _ = extract_location_parts_and_cleaned(raw)
        
        parts = [p for p in parts if isinstance(p, str) and len(p.strip()) >= 3]

        s_lat = s_lng = s_pc = None
        e_lat = e_lng = e_pc = None

        if len(parts) == 0:
            pass
        elif len(parts) == 1:
            part = parts[0]
            latlon = geocode_location_with_variants(part, parent)
            if latlon and latlon[0] is not None:
                s_lat, s_lng = latlon
                s_pc = reverse_geocode_postcode_with_buffer(s_lat, s_lng)
        else:
            start_part, end_part = parts[0], parts[1]
            latlon_s = geocode_location_with_variants(start_part, parent)
            time.sleep(SLEEP_BETWEEN_REQUESTS)
            latlon_e = geocode_location_with_variants(end_part, parent)
            if latlon_s and latlon_s[0] is not None:
                s_lat, s_lng = latlon_s
                s_pc = reverse_geocode_postcode_with_buffer(s_lat, s_lng)
            if latlon_e and latlon_e[0] is not None:
                e_lat, e_lng = latlon_e
                e_pc = reverse_geocode_postcode_with_buffer(e_lat, e_lng)

        df.at[idx, "start_lat"] = s_lat
        df.at[idx, "start_lng"] = s_lng
        df.at[idx, "start_postal_code"] = s_pc
        df.at[idx, "end_lat"] = e_lat
        df.at[idx, "end_lng"] = e_lng
        df.at[idx, "end_postal_code"] = e_pc

    return df

# -----------------------
# Run
# -----------------------
if __name__ == "__main__":
    if not infile.exists():
        safe_print(f"Input file not found: {infile}")
        safe_print(f"Current directory: {BASE}")
        safe_print(f"Files in directory: {[f.name for f in BASE.iterdir() if f.is_file()]}")
        raise SystemExit(1)

    safe_print("Starting enrichment using LocationIQ only...")
    df = pd.read_csv(infile, dtype={"start_postal_code": str, "end_postal_code": str})

    # Drop 'start', 'end', 'created_at', 'sender_id', 'msg_id' if they exist
    df = df.drop(columns=[col for col in ["start", "end", "created_at", "sender_id", "msg_id"] if col in df.columns])

    # Drop rows where 'location' is empty or NaN
    df = df.dropna(subset=["location"])                # remove NaN
    df = df[df["location"].astype(str).str.strip() != ""]  # remove empty strings

    # Ensure event_date column exists and format as YYYY-MM-DD
    if "event_date_time" in df.columns:
        df.rename(columns={"event_date_time": "event_date"}, inplace=True)
    df["event_date"] = pd.to_datetime(df["event_date"], errors="coerce").dt.strftime("%Y-%m-%d")

    try:
        enriched = enrich_df_keep_original(df)
        enriched.to_csv(outfile, index=False)
        safe_print(f"Done. Saved: {outfile}")
        
        # Save caches after successful processing
        save_geocode_cache(geocode_cache)
        save_reverse_cache(reverse_cache)
        
    except Exception as e:
        safe_print(f"Error during processing: {e}")
        # Save caches even if there's an error (partial progress)
        save_geocode_cache(geocode_cache)
        save_reverse_cache(reverse_cache)
        raise