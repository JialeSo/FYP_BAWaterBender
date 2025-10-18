import re
import time
import math
import requests
import random
from datetime import datetime
from typing import Optional, Tuple, List, Any, Dict, Union
from pydantic import BaseModel

from config.config import LOCATIONIQ_FORWARD_URL, LOCATIONIQ_KEY, LOCATIONIQ_REVERSE_URL

from ..common.pipeline_stage import PipelineStage


class PostalCodeMappingStage(PipelineStage):
    """Pipeline stage for geocoding weather alert locations and postal codes.

    This stage processes weather alert data by:
    1. Parsing complex location descriptions into structured parts
    2. Geocoding location parts using LocationIQ API
    3. Reverse geocoding coordinates to extract postal codes

    Input: Pydantic models with 'location' field or list of such models
    Output: Enhanced models with geocoding fields added
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the postal code mapping stage.

        Args:
            config: Configuration dictionary containing:
                - locationiq_key: API key for LocationIQ service
                - sleep_between_requests: Delay between API calls (default: 1.0)
                - max_reverse_attempts: Max reverse geocoding attempts (default: 6)
                - jitter_radius_meters: Coordinate jitter radius (default: 500)
        """
        super().__init__("Postal Code Mapping", config)

        # Configuration
        self.locationiq_key = LOCATIONIQ_KEY

        self.sleep_between_requests = self.config.get("sleep_between_requests", 1.0)
        self.max_reverse_attempts = self.config.get("max_reverse_attempts", 6)
        self.jitter_radius_meters = self.config.get("jitter_radius_meters", 500)

        # API endpoints
        self.locationiq_url = LOCATIONIQ_FORWARD_URL
        self.locationiq_reverse = LOCATIONIQ_REVERSE_URL

        # Validation
        if not self.validate_config():
            raise ValueError("Configuration validation failed")

    def validate_config(self) -> bool:
        """Validate configuration parameters."""
        if not self.locationiq_key or self.locationiq_key == "YOUR_LOCATIONIQ_KEY":
            raise ValueError("LocationIQ API key is required")

        if self.sleep_between_requests < 0:
            raise ValueError("sleep_between_requests must be non-negative")

        if self.max_reverse_attempts < 1:
            raise ValueError("max_reverse_attempts must be at least 1")

        if self.jitter_radius_meters < 0:
            raise ValueError("jitter_radius_meters must be non-negative")

        if not self.locationiq_url or not isinstance(self.locationiq_url, str):
            raise ValueError("locationiq_url must be a valid URL string")

        if not self.locationiq_reverse or not isinstance(self.locationiq_reverse, str):
            raise ValueError("locationiq_reverse must be a valid URL string")

        # Basic URL validation
        if not (
            self.locationiq_url.startswith("http://")
            or self.locationiq_url.startswith("https://")
        ):
            raise ValueError("locationiq_url must start with http:// or https://")

        if not (
            self.locationiq_reverse.startswith("http://")
            or self.locationiq_reverse.startswith("https://")
        ):
            raise ValueError("locationiq_reverse must start with http:// or https://")

        return True

    async def process(
        self, data: Union[BaseModel, List[BaseModel], Dict, List[Dict]]
    ) -> Union[Dict, List[Dict]]:
        """Process input data by enriching location information.

        Args:
            data: Input data which can be:
                - Single Pydantic model with 'location' field
                - List of Pydantic models with 'location' field
                - Single dictionary with 'location' field
                - List of dictionaries with 'location' field

        Returns:
            Enhanced data with additional fields:
                - start_loc: First parsed location part
                - end_loc: Second parsed location part (if applicable)
                - parent_road: Parent/main road context
                - cleaned_location: Human-readable cleaned location string
                - start_lat, start_lng, start_postal_code: Start location data
                - end_lat, end_lng, end_postal_code: End location data
        """
        # Handle single item vs list
        is_single_item = not isinstance(data, list)
        items = [data] if is_single_item else data

        # Convert to dictionaries for processing
        dict_items = []
        for item in items:
            if hasattr(item, "dict"):  # Pydantic v1
                dict_items.append(item.dict())
            elif hasattr(item, "model_dump"):  # Pydantic v2
                dict_items.append(item.model_dump())
            elif isinstance(item, dict):
                dict_items.append(item.copy())
            else:
                raise ValueError(f"Unsupported item type: {type(item)}")

        # Filter items that have location field
        valid_items = []
        for item in dict_items:
            if "location" not in item:
                # Skip items without location field but keep them in output
                valid_items.append(item)
                continue

            if not item["location"] or str(item["location"]).strip() == "":
                # Skip items with empty location but keep them in output
                valid_items.append(item)
                continue

            valid_items.append(item)

        # Process each item
        for item in valid_items:
            if (
                "location" in item
                and item["location"]
                and str(item["location"]).strip()
            ):
                self._enrich_single_item(item)

        # Return in the same format as input
        if is_single_item:
            return valid_items[0] if valid_items else {}
        else:
            return valid_items

    def _enrich_single_item(self, item: Dict) -> None:
        """Enrich a single item with location data."""
        location_text = item["location"]

        # Extract location parts and cleaned string
        parts, parent, cleaned_loc = self._extract_location_parts_and_cleaned(
            location_text
        )

        # Ensure date formatting
        if "created_at" in item:
            item["event_date"] = item.pop("created_at")
        elif "event_date_time" in item:
            # Legacy support for old field name
            item["event_date"] = item.pop("event_date_time")
        if "event_date" in item and item["event_date"]:
            try:
                # Convert to standardized date format
                if isinstance(item["event_date"], str):
                    # Try common datetime formats
                    for fmt in ["%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"]:
                        try:
                            date_val = datetime.strptime(item["event_date"], fmt)
                            item["event_date"] = date_val.strftime("%Y-%m-%d")
                            break
                        except ValueError:
                            continue
                elif hasattr(item["event_date"], "strftime"):
                    # Already a datetime object
                    item["event_date"] = item["event_date"].strftime("%Y-%m-%d")
            except Exception:
                pass  # Keep original value if conversion fails

        # Initialize with defaults
        item.update(
            {
                "start_loc": None,
                "end_loc": None,
                "parent_road": parent,
                "cleaned_location": cleaned_loc,
                "start_lat": None,
                "start_lng": None,
                "start_postal_code": None,
                "end_lat": None,
                "end_lng": None,
                "end_postal_code": None,
            }
        )

        if len(parts) >= 1:
            item["start_loc"] = parts[0]

            # Geocode start location
            start_part = parts[0]
            start_coords = self._geocode_location_with_variants(start_part, parent)
            if start_coords:
                s_lat, s_lng = start_coords
                item["start_lat"] = s_lat
                item["start_lng"] = s_lng
                s_pc = self._reverse_geocode_postcode_with_buffer(s_lat, s_lng)
                item["start_postal_code"] = s_pc
            else:
                # Try geocoding with parent context
                latlon_s = self._geocode_location_with_variants(start_part, parent)
                if len(parts) > 1:
                    end_part = parts[1]
                    latlon_e = self._geocode_location_with_variants(end_part, parent)
                    if latlon_s:
                        s_lat, s_lng = latlon_s
                        item["start_lat"] = s_lat
                        item["start_lng"] = s_lng
                        s_pc = self._reverse_geocode_postcode_with_buffer(s_lat, s_lng)
                        item["start_postal_code"] = s_pc
                    if latlon_e:
                        e_lat, e_lng = latlon_e
                        item["end_lat"] = e_lat
                        item["end_lng"] = e_lng
                        e_pc = self._reverse_geocode_postcode_with_buffer(e_lat, e_lng)
                        item["end_postal_code"] = e_pc

        if len(parts) >= 2:
            item["end_loc"] = parts[1]

    def _extract_location_parts_and_cleaned(
        self, raw: str
    ) -> Tuple[List[str], Optional[str], str]:
        """Extract structured location information from raw strings."""
        if not raw or not isinstance(raw, str):
            return [], None, ""

        # Clean raw input
        cleaned_raw = re.sub(r"\[.*?hours.*?\]", "", raw, flags=re.IGNORECASE)
        cleaned_raw = re.sub(r"issued.*?\d+", "", cleaned_raw, flags=re.IGNORECASE)
        cleaned_raw = re.sub(r"\[.*?\]", "", cleaned_raw)
        cleaned_raw = re.sub(r"\s+", " ", cleaned_raw).strip()

        # Various parsing patterns (keeping the original logic)
        # === Case: "X leading to Y"
        leading_match = re.search(
            r"(.+?)\s+leading to\s+(.+)", cleaned_raw, flags=re.IGNORECASE
        )
        if leading_match:
            start_clean = self._clean_individual_part(leading_match.group(1))
            end_clean = self._clean_individual_part(leading_match.group(2))
            cleaned_display = f"{start_clean} to {end_clean}"
            return [start_clean, end_clean], None, cleaned_display

        # === Case: "X (towards Y) before/after/near/at Z"
        complex_towards_match = re.search(
            r"(.+?\(.*towards.*?\))\s*(?:before|after|near|at)\s+(.+)",
            cleaned_raw,
            flags=re.IGNORECASE,
        )
        if complex_towards_match:
            start_clean = self._clean_individual_part(complex_towards_match.group(1))
            end_clean = self._clean_individual_part(complex_towards_match.group(2))
            return [start_clean, end_clean], None, f"{start_clean} to {end_clean}"

        # === Case: "X towards Y before Z"
        towards_before_match = re.search(
            r"(.+?)\s+towards\s+(.+?)\s+(?:before|after|near|at)\s+(.+)",
            cleaned_raw,
            flags=re.IGNORECASE,
        )
        if towards_before_match:
            start_clean = self._clean_individual_part(towards_before_match.group(1))
            mid_clean = self._clean_individual_part(towards_before_match.group(2))
            end_clean = self._clean_individual_part(towards_before_match.group(3))
            return (
                [f"{start_clean} towards {mid_clean}", end_clean],
                None,
                f"{start_clean} towards {mid_clean} to {end_clean}",
            )

        # === Case: "X towards Y"
        simple_towards = re.search(
            r"(.+?)\s+towards\s+(.+)", cleaned_raw, flags=re.IGNORECASE
        )
        if simple_towards:
            start_clean = self._clean_individual_part(simple_towards.group(1))
            end_clean = self._clean_individual_part(simple_towards.group(2))
            return [start_clean, end_clean], None, f"{start_clean} to {end_clean}"

        raw_lower = cleaned_raw.lower()

        # === Case: "between A and B" in ()
        between_in_parens = re.search(r"\(.*between\s+(.+?)\s+and\s+(.+?)\)", raw_lower)
        if between_in_parens:
            a, b = between_in_parens.group(1), between_in_parens.group(2)
            parent = re.search(r"^([^(]*)\(.*between.*\)", cleaned_raw)
            parent_clean = (
                self._clean_individual_part(parent.group(1)) if parent else None
            )
            a_clean, b_clean = self._clean_individual_part(
                a
            ), self._clean_individual_part(b)
            cleaned_display = (
                f"{parent_clean} ({a_clean} to {b_clean})"
                if parent_clean
                else f"{a_clean} to {b_clean}"
            )
            return [a_clean, b_clean], parent_clean, cleaned_display

        # === Case: "A to B" in ()
        to_in_parens = re.search(r"\((.+?)\s+to\s+(.+?)\)", raw_lower)
        if to_in_parens:
            a, b = to_in_parens.group(1), to_in_parens.group(2)
            parent = re.search(r"^([^(]*)\(.*to.*\)", cleaned_raw)
            parent_clean = (
                self._clean_individual_part(parent.group(1)) if parent else None
            )
            a_clean, b_clean = self._clean_individual_part(
                a
            ), self._clean_individual_part(b)
            cleaned_display = (
                f"{parent_clean} ({a_clean} to {b_clean})"
                if parent_clean
                else f"{a_clean} to {b_clean}"
            )
            return [a_clean, b_clean], parent_clean, cleaned_display

        # === Case: "A and B" in ()
        and_in_parens = re.search(r"\((.+?)\s+and\s+(.+?)\)", raw_lower)
        if and_in_parens:
            a, b = and_in_parens.group(1), and_in_parens.group(2)
            parent = re.search(r"^([^(]*)\(.*and.*\)", cleaned_raw)
            parent_clean = (
                self._clean_individual_part(parent.group(1)) if parent else None
            )
            a_clean, b_clean = self._clean_individual_part(
                a
            ), self._clean_individual_part(b)
            cleaned_display = (
                f"{parent_clean} ({a_clean} and {b_clean})"
                if parent_clean
                else f"{a_clean} and {b_clean}"
            )
            return [a_clean, b_clean], parent_clean, cleaned_display

        # === Case: "between A and B"
        between_no_parens = re.search(r"between\s+(.+?)\s+and\s+(.+)", raw_lower)
        if between_no_parens:
            a, b = between_no_parens.group(1), between_no_parens.group(2)
            a_clean, b_clean = self._clean_individual_part(
                a
            ), self._clean_individual_part(b)
            return [a_clean, b_clean], None, f"{a_clean} to {b_clean}"

        # === Case: "A to B"
        to_no_parens = re.search(r"(.+?)\s+to\s+(.+)", raw_lower)
        if to_no_parens:
            a, b = to_no_parens.group(1), to_no_parens.group(2)
            a_clean, b_clean = self._clean_individual_part(
                a
            ), self._clean_individual_part(b)
            return [a_clean, b_clean], None, f"{a_clean} to {b_clean}"

        # === Case: "A and B"
        and_no_parens = re.search(r"(.+?)\s+and\s+(.+)", raw_lower)
        if and_no_parens:
            a, b = and_no_parens.group(1), and_no_parens.group(2)
            a_clean, b_clean = self._clean_individual_part(
                a
            ), self._clean_individual_part(b)
            return [a_clean, b_clean], None, f"{a_clean} and {b_clean}"

        # === Case: Slash separated
        if "/" in cleaned_raw:
            parts = [
                self._clean_individual_part(p)
                for p in cleaned_raw.split("/")
                if p.strip()
            ]
            if len(parts) == 2:
                return parts, None, f"{parts[0]} and {parts[1]}"

        # === Fallback: single
        cleaned_display = self._clean_individual_part(cleaned_raw)
        return [cleaned_display], None, cleaned_display

    def _clean_individual_part(self, part: str) -> str:
        """Clean a location part: remove filler words, expand abbreviations."""
        if not isinstance(part, str) or not part.strip():
            return ""

        # Remove filler prefixes
        part = re.sub(
            r"^(near|from|at|junction of|intersection of|leading to)\s+",
            "",
            part,
            flags=re.IGNORECASE,
        )
        # Replace "exit"/"slip road"
        part = re.sub(r"\b(exit|slip road)\b", "Slip", part, flags=re.IGNORECASE)

        # Expand abbreviations (allow trailing punctuation)
        replacements = {
            r"\bJln\b[.,]?": "Jalan",
            r"\bRd\b[.,]?": "Road",
            r"\bDr\b[.,]?": "Drive",
            r"\bAve\b[.,]?": "Avenue",
            r"\bCt\b[.,]?": "Court",
            r"\bCl\b[.,]?": "Close",
            r"\bCres\b[.,]?": "Crescent",
            r"\bSt\b[.,]?": "Street",
            r"\bLn\b[.,]?": "Lane",
            r"\bPl\b[.,]?": "Place",
            r"\bUpp\b[.,]?": "Upper",
            r"\bBt\b[.,]?": "Bukit",
            r"\bKg\b[.,]?": "Kampong",
            r"\bLor\b[.,]?": "Lorong",
            r"\bTPE\b": "Tampines Expressway",
            r"\bPIE\b": "Pan Island Expressway",
            r"\bKJE\b": "Kranji Expressway",
            r"\bECP\b": "East Coast Parkway",
            r"\bKPE\b": "Kallang-Paya Lebar Expressway",
            r"\bCTE\b": "Central Expressway",
            r"\bMCE\b": "Marina Coastal Expressway",
            r"\bSLE\b": "Seletar Expressway",
            r"\bPk\b[.,]?": "Park",
        }
        for patt, repl in replacements.items():
            part = re.sub(patt, repl, part, flags=re.IGNORECASE)

        # Clean stray chars
        part = re.sub(r"[^\w\s,.\-&]", " ", part)
        part = re.sub(r"\s+", " ", part).strip()
        return part

    def _jitter_coords(
        self, lat: float, lon: float, radius_m: Optional[float] = None
    ) -> Tuple[float, float]:
        """Return a random point within radius_m of (lat, lon)."""
        if radius_m is None:
            radius_m = float(self.jitter_radius_meters)
        radius_deg = radius_m / 111320.0
        u = random.random()
        v = random.random()
        w = radius_deg * math.sqrt(u)
        t = 2 * math.pi * v
        return lat + w * math.cos(t), lon + w * math.sin(t)

    def _geocode_location_with_variants(
        self, part: str, parent_context: Optional[str] = None
    ) -> Optional[Tuple[float, float]]:
        """Try multiple query variants to improve precision using LocationIQ only."""
        if not part or len(part.strip()) < 3:
            return None

        queries = []
        part_clean = part.strip()
        queries.append(f"{part_clean}, Singapore")
        if parent_context:
            parent_clean = parent_context.strip()
            queries.append(f"{part_clean} near {parent_clean}, Singapore")
            queries.append(f"{part_clean} {parent_clean}, Singapore")

        # Dedupe queries
        seen = set()
        queries = [q for q in queries if q not in seen and not seen.add(q)]

        for q in queries:
            latlon = self._geocode_one_query(q)
            if latlon is not None:
                return latlon
            time.sleep(self.sleep_between_requests)

        return None

    def _geocode_one_query(self, query: str) -> Optional[Tuple[float, float]]:
        """Perform one forward geocode attempt using LocationIQ only."""
        if not query:
            return None

        if self.locationiq_key and self.locationiq_key != "YOUR_LOCATIONIQ_KEY":
            try:
                params = {
                    "key": self.locationiq_key,
                    "q": query,
                    "format": "json",
                    "limit": 1,
                    "countrycodes": "SG",
                }
                resp = requests.get(self.locationiq_url, params=params, timeout=12)
                if resp.status_code == 200:
                    data = resp.json()
                    if isinstance(data, list) and data:
                        lat, lon = float(data[0]["lat"]), float(data[0]["lon"])
                        return lat, lon
                elif resp.status_code == 404:
                    return None
                else:
                    print(
                        f"[LocationIQ geocode HTTP error] {query} -> {resp.status_code}"
                    )
            except Exception as e:
                print(f"[LocationIQ geocode error] {query} -> {e}")

        return None

    def _reverse_geocode_postcode_with_buffer(
        self, lat: float, lon: float
    ) -> Optional[str]:
        """Reverse geocode a point using LocationIQ; if no postcode found, jitter within buffer."""
        if lat is None or lon is None:
            return None

        for attempt in range(self.max_reverse_attempts):
            try_lat, try_lon = (
                (lat, lon) if attempt == 0 else self._jitter_coords(lat, lon)
            )

            try:
                params = {
                    "key": self.locationiq_key,
                    "lat": try_lat,
                    "lon": try_lon,
                    "format": "json",
                    "addressdetails": 1,
                }
                r = requests.get(self.locationiq_reverse, params=params, timeout=12)
                if r.status_code == 200:
                    d = r.json()
                    pc = d.get("address", {}).get("postcode")
                    if pc:
                        return pc
                elif r.status_code != 404:
                    print(
                        f"[LocationIQ reverse HTTP error] ({try_lat}, {try_lon}) -> {r.status_code}"
                    )
            except Exception as e:
                print(f"[LocationIQ reverse error] ({try_lat}, {try_lon}) -> {e}")

            time.sleep(self.sleep_between_requests)

        return None
