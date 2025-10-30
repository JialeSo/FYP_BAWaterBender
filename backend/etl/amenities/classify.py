"""
Classify Amenities and Assign Importance Scores
=================================================

Maps 200+ amenity types to 11 main categories and assigns importance scores.
Outputs consistent column names: pa_id, sz_id (matching geocode step).
"""

from __future__ import annotations

import logging
from pathlib import Path
import re
from typing import Any, Dict

import pandas as pd

logger = logging.getLogger(__name__)

DATA_ROOT = Path(__file__).resolve().parents[2] / "data"
TYPE_NORMALISATION_PREFIXES: tuple[str, ...] = (
    "onemap_",
    "osm_",
    "hotosm_",
    "datagovsg_",
    "sgp_",
    "sg_",
    "geojson_",
)

# Optional OneMap theme queryname -> category mapping loaded from JSON
_THEME_QN_DEFAULT_MAP: Dict[str, str] = {
    # Education
    "kindergartens": "Education_institutions",
    "childcare": "Education_institutions",
    "preschools": "Education_institutions",
    "preschool": "Education_institutions",
    "preschoolslocation": "Education_institutions",

    # Healthcare
    "polyclinics": "Healthcare_facilities",
    "public_access_aeds": "Emergency_services",
    "aeds": "Emergency_services",

    # Community
    "community_clubs": "Community_spaces",
    "communityclubs": "Community_spaces",
    "commmediationctr": "Community_spaces",
    "mosques": "Community_spaces",
    "churches": "Community_spaces",
    "synagogues": "Community_spaces",
    "chinese_temples": "Community_spaces",
    "indian_temples": "Community_spaces",
    "sikh_temples": "Community_spaces",
    "sports_centres": "Community_spaces",

    # Tourism / culture
    "museums": "Tourism",
    "galleries": "Tourism",
}


def _load_theme_queryname_map() -> Dict[str, str]:
    """Load external OneMap theme queryname -> category overrides if present."""
    path = DATA_ROOT / "onemap" / "theme_category_map.json"
    if not path.exists():
        return _THEME_QN_DEFAULT_MAP
    try:
        import json as _json
        data = _json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            # normalize keys to lower snake
            norm = {}
            for k, v in data.items():
                kk = _normalise_amenity_type(k)
                norm[kk] = v
            # extend defaults, user overrides win
            merged = {**_THEME_QN_DEFAULT_MAP, **norm}
            return merged
    except Exception:
        pass
    return _THEME_QN_DEFAULT_MAP


def _heuristic_category_from_queryname(qn: str) -> str | None:
    """Cheap heuristics to assign category from queryname when no explicit rule exists."""
    if not qn:
        return None
    q = qn.lower()
    # Education
    if any(k in q for k in ["school", "preschool", "kindergarten", "childcare", "library", "tuition", "studentcare"]):
        return "Education_institutions"
    # Healthcare or emergency
    if any(k in q for k in ["clinic", "hospital", "polyclinic", "pharmacy", "aeds", "aed", "blood", "screen"]):
        return "Healthcare_facilities" if "aed" not in q else "Emergency_services"
    # Transport
    if any(k in q for k in ["bus", "mrt", "lrt", "interchange", "parking", "taxi", "bicycle", "cycle", "carpark"]):
        return "Transport_services"
    # Community / recreation
    if any(k in q for k in ["park", "sports", "stadium", "pool", "swimming", "community", "temple", "church", "mosque", "synagogue", "cemeter", "club"]):
        return "Community_spaces"
    # Tourism / culture
    if any(k in q for k in ["museum", "gallery", "attraction", "heritage"]):
        return "Tourism"
    # Retail / services
    if any(k in q for k in ["hawker", "mall", "market", "retail", "shop", "centre", "center"]):
        return "Retail_services"
    return None


# ============================================================================
# ImportanceScorer (embedded)
# ============================================================================

class ImportanceScorer:
    """Calculate importance scores based on category priority and weight."""

    # Category priority and weight mapping (priority, weight)
    CATEGORY_PRIORITY_WEIGHT: Dict[str, tuple[float, float]] = {
        "Emergency_services": (1.0, 10.0),
        "Healthcare_facilities": (2.0, 8.0),
        "Essential_services": (3.0, 7.0),
        "Education_institutions": (4.0, 6.0),
        "Transport_services": (5.0, 5.0),
        "Residential": (6.0, 4.0),
        "Government_services": (7.0, 4.0),
        "Community_spaces": (8.0, 3.0),
        "Tourism": (9.0, 2.0),
        "Retail_services": (10.0, 2.0),
        "Others": (11.0, 1.0),

        # High-level 5-group priorities (replacement categories)
        "Emergency_&_Public_Safety": (1.0, 10.0),
        "Healthcare_&_Essential_Utilities": (2.0, 8.0),
        "Residential_&_Community": (3.0, 6.0),
        "Education_&_Mobility": (4.0, 5.0),
        "Commerce_&_Leisure": (5.0, 3.0),
    }

    def get_importance_score(self, category: str) -> float:
        """
        Calculate importance score for a category.

        Args:
            category: Amenity category

        Returns:
            Importance score (higher = more important)
        """
        priority, weight = self.CATEGORY_PRIORITY_WEIGHT.get(category, (11.0, 1.0))
        # Higher weight and lower priority = higher importance
        # Use inverse of priority so lower priority number = higher score
        return weight * (12.0 - priority)

    def _assign_importance_label(self, score: float) -> str:
        """Assign a descriptive label based on importance score."""
        if score >= 100:
            return "Critical"
        elif score >= 60:
            return "High"
        elif score >= 30:
            return "Medium"
        else:
            return "Low"


# ============================================================================
# Helper Functions
# ============================================================================

def _normalise_amenity_type(value: Any) -> str:
    """Remove source prefixes and normalise amenity type strings."""
    if value is None:
        return ""
    text = str(value).strip().lower()
    if not text:
        return ""
    for prefix in TYPE_NORMALISATION_PREFIXES:
        if text.startswith(prefix):
            text = text[len(prefix):]
            break
    text = re.sub(r"[^a-z0-9_]+", "_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    return text or str(value).strip().lower()


def _normalise_type_series(series: pd.Series) -> pd.Series:
    return series.map(_normalise_amenity_type)


# Updated mapping based on notebook discussion
TYPE_CATEGORY_MAP: Dict[str, str] = {
    # Emergency Services
    "fire_station": "Emergency_services",
    "police": "Emergency_services",
    "hospital": "Emergency_services",
    "moh_hospitals": "Emergency_services",
    "public_access_aeds": "Emergency_services",
    "aeds": "Emergency_services",
    "bombshelters": "Emergency_services",
    "civildefencepublicshelters": "Emergency_services",
    "scdfhq": "Emergency_services",
    "cdcouncils": "Emergency_services",
    "constituencyoffices": "Emergency_services",
    "cpfb_location": "Emergency_services",
    "firestation": "Emergency_services",
    "ias": "Emergency_services",
    "neaoffices": "Emergency_services",
    "spf_establishments": "Emergency_services",

    # Healthcare Facilities
    "dentist": "Healthcare_facilities",
    "clinic": "Healthcare_facilities",
    "doctors": "Healthcare_facilities",
    "pharmacy": "Healthcare_facilities",
    "veterinary": "Healthcare_facilities",
    "massage": "Healthcare_facilities",
    "beauty": "Healthcare_facilities",
    "spa": "Healthcare_facilities",
    "optician": "Healthcare_facilities",
    "registered_pharmacy": "Healthcare_facilities",
    "polyclinics": "Healthcare_facilities",
    "vaccination_polyclinics": "Healthcare_facilities",
    "blood_bank": "Healthcare_facilities",
    "breastscreen": "Healthcare_facilities",
    "cervicalscreen": "Healthcare_facilities",
    "eldercare": "Healthcare_facilities",
    "medical_supply": "Healthcare_facilities",
    "hearing_aids": "Healthcare_facilities",
    "nutrition_supplements": "Healthcare_facilities",
    "herbalist": "Healthcare_facilities",
    "health_food": "Healthcare_facilities",
    "chemist": "Healthcare_facilities",

    # Essential Services
    "sso": "Essential_services",
    "atm": "Essential_services",
    "bank": "Essential_services",
    "post_office": "Essential_services",
    "fuel": "Essential_services",
    "electricity": "Essential_services",
    "post_box": "Essential_services",
    "parcel_locker": "Essential_services",
    "water_point": "Essential_services",
    "drinking_water": "Essential_services",
    "water_well": "Essential_services",
    "water_tower": "Essential_services",
    "toilets": "Essential_services",
    "bathroom": "Essential_services",
    "recycling": "Essential_services",
    "waste_basket": "Essential_services",
    "reusechannels": "Essential_services",
    "manhole": "Essential_services",
    "pub_waterlevelsensors": "Essential_services",

    # Residential
    "apartment": "Residential",
    "hotel": "Residential",
    "hostel": "Residential",
    "chalet": "Residential",
    "guest_house": "Residential",
    "motel": "Residential",
    "camp_site": "Residential",
    "hotels": "Residential",
    "hdb_branches": "Residential",
    "hdb_buildings": "Residential",
    "residential": "Residential",

    # Education Institutions
    "prep_school": "Education_institutions",
    "school": "Education_institutions",
    "schools": "Education_institutions",
    "moe_schools": "Education_institutions",
    "library": "Education_institutions",
    "libraries": "Education_institutions",
    "language_school": "Education_institutions",
    "kindergarten": "Education_institutions",
    "kindergartens": "Education_institutions",
    "childcare": "Education_institutions",
    "dojo": "Education_institutions",
    "music_school": "Education_institutions",
    "dancing_school": "Education_institutions",
    "college": "Education_institutions",
    "university": "Education_institutions",
    "driving_school": "Education_institutions",
    "art_school": "Education_institutions",
    "toy_library": "Education_institutions",
    "tuition": "Education_institutions",
    "studentcare": "Education_institutions",
    "cpe_pei_premises": "Education_institutions",
    "cetcentres": "Education_institutions",
    "preschools": "Education_institutions",
    "preschool": "Education_institutions",
    "preschoolslocation": "Education_institutions",
    "higher_education": "Education_institutions",
    "special_education": "Education_institutions",

    # Transport Services
    "bus_station": "Transport_services",
    "bus_stop": "Transport_services",
    "bus_stops": "Transport_services",
    "bus_interchanges_terminals": "Transport_services",
    "bus_depots": "Transport_services",
    "bicycle_parking": "Transport_services",
    "charging_station": "Transport_services",
    "parking": "Transport_services",
    "parking_entrance": "Transport_services",
    "parking_exit": "Transport_services",
    "parking_space": "Transport_services",
    "taxi": "Transport_services",
    "taxi_rank": "Transport_services",
    "car_rental": "Transport_services",
    "car_sharing": "Transport_services",
    "bicycle_rental": "Transport_services",
    "ferry_terminal": "Transport_services",
    "motorcycle_parking": "Transport_services",
    "bicycle_repair_station": "Transport_services",
    "vehicle_ramp": "Transport_services",
    "vehicle_inspection": "Transport_services",
    "motorcycle_rental": "Transport_services",
    "boat_rental": "Transport_services",
    "boat": "Transport_services",

    # Tourism
    "attraction": "Tourism",
    "tourist_attractions": "Tourism",
    "tourist_attraction": "Tourism",
    "viewpoint": "Tourism",
    "zoo": "Tourism",
    "information": "Tourism",
    "theme_park": "Tourism",
    "museum": "Tourism",
    "museums": "Tourism",
    "gallery": "Tourism",
    "fountain": "Tourism",
    "theatre": "Tourism",
    "bench": "Tourism",
    "monastery": "Tourism",
    "beacon": "Tourism",
    "tower": "Tourism",
    "cross": "Tourism",
    "tourism": "Tourism",
    "monuments": "Tourism",
    "artwork": "Tourism",
    "banner": "Tourism",
    "historic_sites": "Tourism",

    # Community Spaces
    "place_of_worship": "Community_spaces",
    "religion": "Community_spaces",
    "studio": "Community_spaces",
    "study_area": "Community_spaces",
    "reception_area": "Community_spaces",
    "clock": "Community_spaces",
    "observatory": "Community_spaces",
    "aquarium": "Community_spaces",
    "lighthouse": "Community_spaces",
    "picnic_site": "Community_spaces",
    "nationalparks": "Community_spaces",
    "community_centre": "Community_spaces",
    "community_clubs": "Community_spaces",
    "communityclubs": "Community_spaces",
    "events_venue": "Community_spaces",
    "social_facility": "Community_spaces",
    "marketplace": "Community_spaces",
    "food_court": "Community_spaces",
    "cinema": "Community_spaces",
    "nightclub": "Community_spaces",
    "internet_cafe": "Community_spaces",
    "bbq": "Community_spaces",
    "arts_centre": "Community_spaces",
    "country_club": "Community_spaces",
    "coworking_space": "Community_spaces",
    "grave_yard": "Community_spaces",
    "social_centre": "Community_spaces",
    "bbq_shelter": "Community_spaces",
    "biergarten": "Community_spaces",
    "crematorium": "Community_spaces",
    "prison": "Community_spaces",
    "casino": "Community_spaces",
    "charity": "Community_spaces",
    "karaoke_box": "Community_spaces",
    "karaoke": "Community_spaces",
    "brothel": "Community_spaces",
    "smoking_area": "Community_spaces",
    "photo_booth": "Community_spaces",
    "give_box": "Community_spaces",
    "activecemeteries": "Community_spaces",
    "afterdeathfacilities": "Community_spaces",
    "columbaria": "Community_spaces",
    "crematoria": "Community_spaces",
    "funeralparlours": "Community_spaces",
    "communityclubpassionwave": "Community_spaces",
    "residentscommittee": "Community_spaces",
    "voluntarywelfareorgs": "Community_spaces",
    "commmediationctr": "Community_spaces",
    "family": "Community_spaces",
    "sportsg_dus_sport_facilities": "Community_spaces",
    "sportsg_sip_facilities": "Community_spaces",
    "sportsg_sport_facilities": "Community_spaces",
    "hsgb_fcc": "Community_spaces",
    "hsgb_napfa": "Community_spaces",
    "hsgb_safra": "Community_spaces",
    "infocommaccess": "Community_spaces",
    "parkfacilities": "Community_spaces",
    "park": "Community_spaces",
    "playground": "Community_spaces",
    "shelter": "Community_spaces",
    "concert_halls": "Community_spaces",
    "mosques": "Community_spaces",
    "churches": "Community_spaces",
    "synagogues": "Community_spaces",
    "chinese_temples": "Community_spaces",
    "indian_temples": "Community_spaces",
    "sikh_temples": "Community_spaces",
    "sports_centres": "Community_spaces",
    "stadiums": "Community_spaces",
    "swimming_complex": "Community_spaces",
    "courts": "Community_spaces",

    # Government Services
    "townhall": "Government_services",
    "government": "Government_services",
    "government_office": "Government_services",
    "reception_desk": "Government_services",
    "surveillance": "Government_services",
    "admin": "Government_services",
    "office": "Government_services",
    "public_building": "Government_services",
    "bfabuildings": "Government_services",

    # Retail Services
    "ssot_hawkercentres": "Retail_services",
    "cafe": "Retail_services",
    "restaurant": "Retail_services",
    "fast_food": "Retail_services",
    "bar": "Retail_services",
    "pub": "Retail_services",
    "beverages": "Retail_services",
    "hairdresser": "Retail_services",
    "pet": "Retail_services",
    "gift": "Retail_services",
    "pastry": "Retail_services",
    "sports": "Retail_services",
    "interior_decoration": "Retail_services",
    "convenience": "Retail_services",
    "seafood": "Retail_services",
    "tyres": "Retail_services",
    "bicycle": "Retail_services",
    "car": "Retail_services",
    "furniture": "Retail_services",
    "mobile_phone": "Retail_services",
    "cell_phones": "Retail_services",
    "shoes": "Retail_services",
    "deli": "Retail_services",
    "newsagent": "Retail_services",
    "books": "Retail_services",
    "supermarket": "Retail_services",
    "bakery": "Retail_services",
    "toys": "Retail_services",
    "electronics": "Retail_services",
    "photo": "Retail_services",
    "tailor": "Retail_services",
    "ticket": "Retail_services",
    "computer": "Retail_services",
    "variety_store": "Retail_services",
    "bag": "Retail_services",
    "clothes": "Retail_services",
    "stationery": "Retail_services",
    "lighting": "Retail_services",
    "party": "Retail_services",
    "hardware": "Retail_services",
    "department_store": "Retail_services",
    "general": "Retail_services",
    "ice_cream": "Retail_services",
    "craft": "Retail_services",
    "motorcycle_repair": "Retail_services",
    "fashion_accessories": "Retail_services",
    "car_repair": "Retail_services",
    "alcohol": "Retail_services",
    "tea": "Retail_services",
    "jewelry": "Retail_services",
    "building_materials": "Retail_services",
    "electrical": "Retail_services",
    "musical_instrument": "Retail_services",
    "cosmetics": "Retail_services",
    "bathroom_furnishing": "Retail_services",
    "watches": "Retail_services",
    "fabric": "Retail_services",
    "carpet": "Retail_services",
    "florist": "Retail_services",
    "art": "Retail_services",
    "retail": "Retail_services",
    "car_wash": "Retail_services",
    "confectionery": "Retail_services",
    "video_games": "Retail_services",
    "anime": "Retail_services",
    "outdoor": "Retail_services",
    "chocolate": "Retail_services",
    "houseware": "Retail_services",
    "car_parts": "Retail_services",
    "kitchen": "Retail_services",
    "rental": "Retail_services",
    "copyshop": "Retail_services",
    "greengrocer": "Retail_services",
    "travel_agency": "Retail_services",
    "gambling": "Retail_services",
    "appliance": "Retail_services",
    "tiles": "Retail_services",
    "music": "Retail_services",
    "trade": "Retail_services",
    "telecommunication": "Retail_services",
    "bed": "Retail_services",
    "kiosk": "Retail_services",
    "mall": "Retail_services",
    "coffee": "Retail_services",
    "curtain": "Retail_services",
    "butcher": "Retail_services",
    "baby_goods": "Retail_services",
    "collector": "Retail_services",
    "antiques": "Retail_services",
    "tattoo": "Retail_services",
    "lottery": "Retail_services",
    "garden_centre": "Retail_services",
    "wine": "Retail_services",
    "frame": "Retail_services",
    "second_hand": "Retail_services",
    "bookmaker": "Retail_services",
    "storage_rental": "Retail_services",
    "pet_grooming": "Retail_services",
    "leather": "Retail_services",
    "hifi": "Retail_services",
    "cheese": "Retail_services",
    "motorcycle": "Retail_services",
    "food": "Retail_services",
    "wedding": "Retail_services",
    "erotic": "Retail_services",
    "office_supplies": "Retail_services",
    "flooring": "Retail_services",
    "laundry": "Retail_services",
    "dry_cleaning": "Retail_services",
    "bureau_de_change": "Retail_services",
    "money_lender": "Retail_services",
    "money_transfer": "Retail_services",
    "moneychanger": "Retail_services",
    "remittance": "Retail_services",
    "payment_terminal": "Retail_services",
    "pawnbroker": "Retail_services",
    "vending_machine": "Retail_services",
    "boutique": "Retail_services",
    "shoe_repair": "Retail_services",
    "repair": "Retail_services",
    "grocery": "Retail_services",
    "wholesale": "Retail_services",
    "games": "Retail_services",
    "video": "Retail_services",
    "hairdresser_supply": "Retail_services",
    "candles": "Retail_services",
    "camera": "Retail_services",
    "locksmith": "Retail_services",
    "computer_repair": "Retail_services",
    "radiotechnics": "Retail_services",
    "perfumery": "Retail_services",
    "photo_studio": "Retail_services",
    "security": "Retail_services",
    "phone_repair": "Retail_services",
    "organic_products": "Retail_services",
    "communication": "Retail_services",
    "customer_service": "Retail_services",
    "juice_bar": "Retail_services",
    "sewing": "Retail_services",
    "funeral_directors": "Retail_services",
    "furnishing_products": "Retail_services",
    "lighting_fans_bathroom_kitchen_and_smart_home": "Retail_services",
    "doors": "Retail_services",

    # Others
    "animal_boarding": "Others",
    "hobby": "Others",
    "adit": "Others",
    "psychic": "Others",
    "scuba_diving": "Others",
    "works": "Others",
    "conference_centre": "Others",
    "spices": "Others",
    "household_linen": "Others",
    "window_blind": "Others",
    "model": "Others",
    "farm": "Others",
    "nuts": "Others",
    "fishing": "Others",
    "doityourself": "Others",
}


# Substring-based fallback rules for amenity_type when exact match failed
TYPE_SUBSTR_RULES: Dict[str, str] = {
    # Education
    "school": "Education_institutions",
    "polytechnic": "Education_institutions",
    "university": "Education_institutions",
    "college": "Education_institutions",
    "library": "Education_institutions",
    "kindergarten": "Education_institutions",
    "preschool": "Education_institutions",

    # Emergency/health
    "polyclinic": "Healthcare_facilities",
    "clinic": "Healthcare_facilities",
    "dental": "Healthcare_facilities",
    "hospital": "Healthcare_facilities",
    "pharmacy": "Healthcare_facilities",
    "aed": "Emergency_services",
    "shelter": "Emergency_services",
    "fire": "Emergency_services",
    "police": "Emergency_services",

    # Transport
    "bus": "Transport_services",
    "mrt": "Transport_services",
    "lrt": "Transport_services",
    "taxi": "Transport_services",
    "carpark": "Transport_services",
    "parking": "Transport_services",
    "cycle": "Transport_services",

    # Community/recreation
    "park": "Community_spaces",
    "playground": "Community_spaces",
    "temple": "Community_spaces",
    "church": "Community_spaces",
    "mosque": "Community_spaces",
    "synagogue": "Community_spaces",
    "gurdwara": "Community_spaces",
    "community": "Community_spaces",
    "sports": "Community_spaces",
    "stadium": "Community_spaces",
    "swimming": "Community_spaces",

    # Retail / services
    "mall": "Retail_services",
    "market": "Retail_services",
    "hawker": "Retail_services",
    "supermarket": "Retail_services",
    "shop": "Retail_services",
    "retail": "Retail_services",
    "hotel": "Residential",
}


NAME_REGEX_RULES: list[tuple[re.Pattern, str]] = [
    # Education
    (re.compile(r"\b(primary|secondary) school\b", re.I), "Education_institutions"),
    (re.compile(r"\bjunior college\b", re.I), "Education_institutions"),
    (re.compile(r"\b(polytechnic|university|college|institute)\b", re.I), "Education_institutions"),
    (re.compile(r"\b(kindergarten|preschool|student care)\b", re.I), "Education_institutions"),
    (re.compile(r"\blibrary\b", re.I), "Education_institutions"),

    # Emergency / Healthcare
    (re.compile(r"\b(polyclinic|clinic|medical centre|dental|dentist)\b", re.I), "Healthcare_facilities"),
    (re.compile(r"\b(hospital|nursing home|eldercare|dialysis)\b", re.I), "Healthcare_facilities"),
    (re.compile(r"\b(guardian|watsons|unity)\b", re.I), "Healthcare_facilities"),
    (re.compile(r"\b(aed|defibrillator|civil defence|scdf|fire station|police)\b", re.I), "Emergency_services"),

    # Transport
    (re.compile(r"\b(mrt|lrt) station\b", re.I), "Transport_services"),
    (re.compile(r"\b(bus (stop|interchange)|taxi|ferry|harbour|pier)\b", re.I), "Transport_services"),

    # Retail / food
    (re.compile(r"\b(supermarket|minimart|hawker|market|food (centre|center)|mall|plaza|centre|center)\b", re.I), "Retail_services"),
    (re.compile(r"\b(restaurant|cafe|coffee|kopitiam)\b", re.I), "Retail_services"),
    (re.compile(r"\b(money ?changer|remittance|pawnbroker)\b", re.I), "Retail_services"),

    # Community / religion / recreation
    (re.compile(r"\b(community club|safra|sports|stadium|swimming complex)\b", re.I), "Community_spaces"),
    (re.compile(r"\b(church|mosque|temple|synagogue|gurdwara)\b", re.I), "Community_spaces"),
    (re.compile(r"\b(park|playground|garden|bbq)\b", re.I), "Community_spaces"),

    # Tourism / hotels
    (re.compile(r"\b(museum|gallery|theatre|attraction|resort|zoo|aquarium|sentosa)\b", re.I), "Tourism"),
    (re.compile(r"\b(hotel|residence|residences|hostel|lodge|condo(minium)?)\b", re.I), "Residential"),
]


def _classify_mixed_use_amenity(name: str, description: str = "") -> str:
    """
    Classify mixed-use amenities (bfabuildings, dfc_gtp) based on name and description.

    These sources contain diverse amenity types, so we cannot rely solely on the
    amenity_type field (which is just the filename). Instead, we analyze the name
    and description to determine the actual category.
    """
    if not name:
        return "Others"

    # Convert to lowercase for pattern matching
    text = f"{name.lower()} {description.lower()}".strip()

    # Education Institutions (check first to avoid false matches with healthcare)
    # Schools should be classified before checking healthcare keywords like "unity" (pharmacy)
    if any(keyword in text for keyword in [
        'school', 'university', 'college', 'institute', 'library', 'kindergarten',
        'education', 'academy', 'polytechnic', 'student care', 'preschool',
        'junior college', 'primary school', 'secondary school', 'ite'
    ]):
        return "Education_institutions"

    # Emergency Services
    if any(keyword in text for keyword in [
        'police', 'fire station', 'hospital', 'emergency', 'ambulance',
        'civil defence', 'scdf', 'neighbourhood police', 'spf'
    ]):
        return "Emergency_services"

    # Healthcare Facilities
    if any(keyword in text for keyword in [
        'hospital', 'clinic', 'medical centre', 'polyclinic', 'health centre',
        'nursing home', 'eldercare', 'dialysis', 'dental', 'dentist',
        'pharmacy', 'guardian', 'watsons', 'unity pharmacy'
    ]):
        return "Healthcare_facilities"

    # Transport Services
    if any(keyword in text for keyword in [
        'mrt station', 'lrt station', 'bus interchange', 'transport', 'airport',
        'terminal', 'taxi', 'parking', 'station'
    ]):
        return "Transport_services"

    # Retail Services (broad category for supermarkets, shops, etc.)
    if any(keyword in text for keyword in [
        'ntuc', 'fairprice', 'giant', 'sheng siong', 'cold storage',
        'mall', 'shopping', 'market', 'food centre', 'restaurant', 'hotel',
        'plaza', 'point', 'centre', 'hawker', 'retail', 'store', 'shop',
        'supermarket', 'minimart', '7-eleven', 'cheers'
    ]):
        return "Retail_services"

    # Tourism
    if any(keyword in text for keyword in [
        'museum', 'universal studio', 'sentosa', 'zoo', 'attraction', 'gallery',
        'theatre', 'resort', 'casino', 'theme park', 'aquarium', 'flyer'
    ]):
        return "Tourism"

    # Community Spaces (check for religious buildings and community facilities)
    if any(keyword in text for keyword in [
        'community', 'club', 'sports', 'swimming', 'recreation', 'stadium',
        'hall', 'park', 'playground', 'church', 'mosque', 'temple', 'cemetery',
        'masjid', 'gurdwara', 'synagogue'
    ]):
        return "Community_spaces"

    # Residential
    if any(keyword in text for keyword in [
        'residence', 'condominium', 'apartment', 'home', 'lodge', 'hostel',
        'condo', 'dormitory'
    ]):
        return "Residential"

    # Government Services
    if any(keyword in text for keyword in [
        'court', 'government', 'ministry', 'authority', 'cpf', 'immigration',
        'registry', 'civil service', 'public building', 'town hall', 'hdb hub',
        'iras', 'ica', 'parliament'
    ]):
        return "Government_services"

    # Default to Others if no clear match
    return "Others"


def _heuristic_category_from_name_desc(name: str, description: str = "") -> str | None:
    """Generic heuristic for classifying amenities by name/description.

    Applied as a fallback for records still in "Others" after type and theme mappings.
    Keeps rules broad and conservative to avoid mislabeling.
    """
    text = f"{str(name or '').lower()} {str(description or '').lower()}".strip()
    if not text:
        return None

    # Education before healthcare to avoid e.g., "student care clinic" mislabels
    if any(k in text for k in (
        'school', 'polytechnic', 'university', 'college', 'institute',
        'kindergarten', 'preschool', 'student care', 'junior college',
        'primary school', 'secondary school', 'library', 'ite', 'madrasah',
    )):
        return "Education_institutions"

    if any(k in text for k in (
        'police', 'fire station', 'civil defence', 'scdf', 'emergency', 'ambulance',
        'neighbourhood police', 'npcc', 'spf', 'aed', 'defibrillator', 'shelter',
    )):
        return "Emergency_services"

    if any(k in text for k in (
        'hospital', 'clinic', 'medical centre', 'polyclinic', 'eldercare', 'nursing home',
        'dialysis', 'dental', 'dentist', 'pharmacy', 'guardian', 'watsons', 'unity pharmacy',
    )):
        return "Healthcare_facilities"

    if any(k in text for k in (
        'mrt station', 'lrt station', 'bus interchange', 'transport', 'airport', 'terminal', 'taxi',
        'bus stop', 'station', 'pier', 'ferry', 'harbour', 'dock',
    )):
        return "Transport_services"

    if any(k in text for k in (
        'ntuc', 'fairprice', 'giant', 'sheng siong', 'cold storage', 'market', 'minimart',
        'supermarket', 'shopping', 'mall', 'plaza', 'centre', 'center', 'hawker', 'food court',
        'restaurant', 'hotel', 'retail', 'store', 'shop', 'pharmacy', 'money changer', 'moneychanger',
    )):
        return "Retail_services"

    if any(k in text for k in (
        'museum', 'gallery', 'theatre', 'theater', 'attraction', 'resort', 'sentosa', 'zoo', 'aquarium', 'casino',
    )):
        return "Tourism"

    if any(k in text for k in (
        'community', 'club', 'sports', 'swimming', 'recreation', 'stadium', 'hall', 'park', 'playground',
        'church', 'mosque', 'temple', 'cemetery', 'masjid', 'gurdwara', 'synagogue', 'youth hub',
    )):
        return "Community_spaces"

    if any(k in text for k in (
        'residence', 'condominium', 'apartment', 'home', 'lodge', 'hostel', 'condo', 'dormitory', 'residences',
    )):
        return "Residential"

    if any(k in text for k in (
        'court', 'government', 'ministry', 'authority', 'cpf', 'immigration', 'registry', 'civil service',
        'hdb hub', 'hdb branch', 'iras', 'ica', 'parliament', 'town council',
    )):
        return "Government_services"

    if any(k in text for k in (
        'atm', 'post office', 'singpost', 'parcel locker', 'drinking water', 'water point', 'fuel', 'petrol',
    )):
        return "Essential_services"

    return None


# ============================================================================
# Classifier Class
# ============================================================================

class AmenityClassifier:
    """OOP-based amenity classification with importance scoring."""

    def __init__(self):
        """Initialize classifier with ImportanceScorer."""
        self.scorer = ImportanceScorer()
        self.category_lookup = None
        self.group_lookup = None
        self.type_lookup = None
        self.planning_lookup = None
        self.subzone_lookup = None

        # Mapping of fine categories to 5 high-level groups
        self.CATEGORY_TO_GROUP = {
            # 1. Emergency & Public Safety
            "Emergency_services": "Emergency_&_Public_Safety",
            "Government_services": "Emergency_&_Public_Safety",

            # 2. Healthcare & Essential Utilities
            "Healthcare_facilities": "Healthcare_&_Essential_Utilities",
            "Essential_services": "Healthcare_&_Essential_Utilities",

            # 3. Residential & Community
            "Residential": "Residential_&_Community",
            "Community_spaces": "Residential_&_Community",

            # 4. Education & Mobility
            "Education_institutions": "Education_&_Mobility",
            "Transport_services": "Education_&_Mobility",

            # 5. Commerce & Leisure
            "Retail_services": "Commerce_&_Leisure",
            "Tourism": "Commerce_&_Leisure",
            "Others": "Commerce_&_Leisure",
        }

    def _normalize_amenity_types(self, df: pd.DataFrame) -> pd.DataFrame:
        """Normalize amenity type strings."""
        # If OneMap theme queryname is present, prefer it for type matching
        if "theme_queryname" in df.columns and "amenity_type" in df.columns:
            qn = df["theme_queryname"].astype(str).str.strip()
            # Backfill amenity_type from theme_queryname where amenity_type is missing/blank
            at = df["amenity_type"].astype(str).fillna("").str.strip()
            need = (at.eq("") | at.isna()) & qn.ne("") & qn.notna()
            if need.any():
                df.loc[need, "amenity_type"] = qn[need]

        if "amenity_type" in df.columns:
            df["amenity_type"] = _normalise_type_series(df["amenity_type"]).fillna("")
            # As a final guard, if still empty and theme_queryname exists, copy it (normalized)
            if "theme_queryname" in df.columns:
                qn_norm = _normalise_type_series(df["theme_queryname"].fillna(""))
                still_empty = df["amenity_type"].eq("") & qn_norm.ne("")
                if still_empty.any():
                    df.loc[still_empty, "amenity_type"] = qn_norm[still_empty]
        return df

    def _apply_category_mapping(self, df: pd.DataFrame) -> pd.DataFrame:
        """Apply category mapping to amenity types."""
        if "amenity_type" not in df.columns:
            return df

        # First apply the regular mapping
        df["amenity_category"] = df["amenity_type"].map(TYPE_CATEGORY_MAP)

        # If OneMap theme queryname exists, use a dedicated mapping to improve coverage
        if "theme_queryname" in df.columns:
            theme_map = _load_theme_queryname_map()
            qn = _normalise_type_series(df["theme_queryname"].fillna(""))
            mapped = qn.map(theme_map)
            # Fill where missing or still Others
            need_fill = df["amenity_category"].isna() | df["amenity_category"].eq("Others")
            df.loc[need_fill & mapped.notna(), "amenity_category"] = mapped[need_fill & mapped.notna()]

            # Apply heuristics for any remaining
            still = df["amenity_category"].isna() | df["amenity_category"].eq("Others")
            if still.any():
                heuristic = qn.map(lambda s: _heuristic_category_from_queryname(s) or "")
                df.loc[still & heuristic.ne(""), "amenity_category"] = heuristic[still & heuristic.ne("")]

        # Fallback 1: amenity_type substring rules
        mask_others = df["amenity_category"].isna() | df["amenity_category"].eq("Others")
        if mask_others.any():
            types = df.loc[mask_others, "amenity_type"].astype(str).str.lower().fillna("")
            inferred = []
            for t in types:
                cat = None
                for sub, c in TYPE_SUBSTR_RULES.items():
                    if sub in t:
                        cat = c
                        break
                inferred.append(cat)
            df.loc[mask_others, "amenity_category"] = [
                inferred[i] if inferred[i] is not None else df.loc[idx, "amenity_category"]
                for i, idx in enumerate(types.index)
            ]

        # Fallback 2: amenity_name regex rules
        mask_others = df["amenity_category"].isna() | df["amenity_category"].eq("Others")
        if mask_others.any() and "amenity_name" in df.columns:
            names = df.loc[mask_others, "amenity_name"].astype(str).fillna("")
            descs = df.loc[mask_others, "description"] if "description" in df.columns else pd.Series([""] * len(names), index=names.index)
            combined = (names.str.cat(descs.astype(str), sep=" ").str.lower())
            out = []
            for text in combined:
                cat = None
                for pat, cat_name in NAME_REGEX_RULES:
                    if pat.search(text):
                        cat = cat_name
                        break
                out.append(cat)
            df.loc[mask_others, "amenity_category"] = [
                out[i] if out[i] is not None else df.loc[idx, "amenity_category"]
                for i, idx in enumerate(combined.index)
            ]

        # List of mixed-use amenity sources that need name/description-based classification
        mixed_use_sources = ["bfabuildings", "onemap_bfabuildings", "dfc_gtp", "onemap_dfc_gtp"]

        # Special handling for mixed-use sources
        for source in mixed_use_sources:
            source_mask = df["amenity_type"] == source
            if source_mask.any():
                logger.info(
                    "Applying name/description-based classification for %d %s amenities",
                    source_mask.sum(),
                    source
                )
                df.loc[source_mask, "amenity_category"] = df.loc[source_mask].apply(
                    lambda row: _classify_mixed_use_amenity(
                        str(row.get("amenity_name", "")),
                        str(row.get("description", ""))
                    ), axis=1
                )

        # Final fallback: Generic heuristic for any remaining Others
        if "amenity_name" in df.columns:
            mask_others = df["amenity_category"].isna() | df["amenity_category"].eq("Others")
            if mask_others.any():
                df.loc[mask_others, "amenity_category"] = df.loc[mask_others].apply(
                    lambda row: _heuristic_category_from_name_desc(
                        str(row.get("amenity_name", "")),
                        str(row.get("description", ""))
                    ) or row.get("amenity_category", "Others"),
                    axis=1,
                )

        df["amenity_category"] = df["amenity_category"].fillna("Others")
        return df

    def _compute_importance_scores(self, df: pd.DataFrame) -> pd.DataFrame:
        """Compute importance scores for each amenity."""
        # Add priority and weight based on category
        if "amenity_priority" not in df.columns:
            df["amenity_priority"] = df["amenity_category"].map(
                lambda cat: self.scorer.CATEGORY_PRIORITY_WEIGHT.get(cat, (4.0, 2.0))[0]
            )

        if "amenity_weight" not in df.columns:
            df["amenity_weight"] = df["amenity_category"].map(
                lambda cat: self.scorer.CATEGORY_PRIORITY_WEIGHT.get(cat, (4.0, 2.0))[1]
            )

        # Compute importance scores
        if "importance_score" not in df.columns:
            df["importance_score"] = df["amenity_category"].map(
                lambda cat: self.scorer.get_importance_score(cat)
            )

        # Assign importance labels
        if "importance_label" not in df.columns:
            df["importance_label"] = df["importance_score"].apply(
                self.scorer._assign_importance_label
            )

        return df

    def _create_lookup_table(
        self,
        series: pd.Series,
        value_col: str,
        id_col: str,
        output_path: Path
    ) -> Dict[str, str]:
        """Create a lookup table mapping values to IDs."""
        cleaned = series.dropna().astype(str).str.strip()
        unique = sorted({val for val in cleaned if val})

        if not unique:
            return {}

        width = max(2, len(str(len(unique))))
        ids = [f"{i + 1:0{width}d}" for i in range(len(unique))]

        lookup_df = pd.DataFrame({
            id_col: ids,
            value_col: unique,
        })

        output_path.parent.mkdir(parents=True, exist_ok=True)
        lookup_df.to_csv(output_path, index=False)
        logger.info("Created lookup table: %s", output_path)

        return dict(zip(unique, ids))

    def _create_category_importance_lookup(
        self,
        df: pd.DataFrame,
        output_path: Path
    ) -> Dict[str, str]:
        """Create category lookup table with importance scores."""
        # Get unique categories
        categories = df["amenity_category"].dropna().unique()

        # Create mapping data
        mapping_data = []
        for idx, category in enumerate(sorted(categories), start=1):
            priority, weight = self.scorer.CATEGORY_PRIORITY_WEIGHT.get(category, (4.0, 2.0))
            importance_score = self.scorer.get_importance_score(category)

            mapping_data.append({
                "amenity_category_id": f"{idx:02d}",
                "amenity_category": category,
                "amenity_priority": priority,
                "amenity_weight": weight,
                "importance_score": round(importance_score, 2)
            })

        lookup_df = pd.DataFrame(mapping_data)
        lookup_df = lookup_df.sort_values("importance_score", ascending=False)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        lookup_df.to_csv(output_path, index=False)
        logger.info("Created category importance lookup: %s", output_path)

        return dict(zip(lookup_df["amenity_category"], lookup_df["amenity_category_id"]))

    def _create_all_lookups(
        self,
        df: pd.DataFrame,
        output_dir: Path
    ) -> pd.DataFrame:
        """Create all lookup tables and map IDs."""
        # Collapse detailed categories into 5 high-level groups and REPLACE amenity_category
        grouped = df["amenity_category"].map(self.CATEGORY_TO_GROUP).fillna("Commerce_&_Leisure")
        df["amenity_category"] = grouped

        # Create category lookup (now for 5 groups) with importance scores
        self.category_lookup = self._create_category_importance_lookup(
            df,
            output_dir / "amenity_category_lookup.csv"
        )
        df["amenity_category_id"] = df["amenity_category"].map(self.category_lookup)

        # Create type lookup
        if "amenity_type" in df.columns:
            self.type_lookup = self._create_lookup_table(
                df["amenity_type"],
                "amenity_type",
                "amenity_type_id",
                output_dir / "amenity_type_lookup.csv"
            )
            if self.type_lookup:
                df["amenity_type_id"] = df["amenity_type"].map(self.type_lookup)

        # Planning area lookup: ensure we use pa_id (consistent naming)
        if "planning_area" in df.columns:
            output_path = output_dir / "planning_area_lookup.csv"
            if "pa_id" in df.columns:
                # Use existing integer IDs from geocoding step
                df["pa_id"] = pd.to_numeric(df["pa_id"], errors="coerce").fillna(0).astype(int)

                lookup_df = (
                    df[["pa_id", "planning_area"]]
                    .dropna(subset=["planning_area"])
                    .drop_duplicates()
                    .sort_values("pa_id")
                )
                output_path.parent.mkdir(parents=True, exist_ok=True)
                lookup_df.to_csv(output_path, index=False)
                self.planning_lookup = dict(zip(lookup_df["planning_area"], lookup_df["pa_id"]))
            else:
                # Fallback: generate integer IDs starting from 1
                unique = sorted(df["planning_area"].dropna().unique())
                mapping = {name: i + 1 for i, name in enumerate(unique)}
                df["pa_id"] = df["planning_area"].map(mapping).astype(int)

                lookup_df = pd.DataFrame({
                    "pa_id": [mapping[name] for name in unique],
                    "planning_area": unique,
                }).sort_values("pa_id")
                output_path.parent.mkdir(parents=True, exist_ok=True)
                lookup_df.to_csv(output_path, index=False)
                self.planning_lookup = mapping

        # Subzone lookup: ensure we use sz_id (consistent naming)
        if "subzone" in df.columns:
            output_path = output_dir / "subzone_lookup.csv"
            if "sz_id" in df.columns:
                # Use existing integer IDs from geocoding step
                df["sz_id"] = pd.to_numeric(df["sz_id"], errors="coerce").fillna(0).astype(int)

                lookup_df = (
                    df[["sz_id", "subzone"]]
                    .dropna(subset=["subzone"])
                    .drop_duplicates()
                    .sort_values("sz_id")
                )
                output_path.parent.mkdir(parents=True, exist_ok=True)
                lookup_df.to_csv(output_path, index=False)
                self.subzone_lookup = dict(zip(lookup_df["subzone"], lookup_df["sz_id"]))
            else:
                # Fallback: generate integer IDs starting from 1
                unique = sorted(df["subzone"].dropna().unique())
                mapping = {name: i + 1 for i, name in enumerate(unique)}
                df["sz_id"] = df["subzone"].map(mapping).astype(int)

                lookup_df = pd.DataFrame({
                    "sz_id": [mapping[name] for name in unique],
                    "subzone": unique,
                }).sort_values("sz_id")
                output_path.parent.mkdir(parents=True, exist_ok=True)
                lookup_df.to_csv(output_path, index=False)
                self.subzone_lookup = mapping

        # Road lookup (rd_id) will be created in match_roads step

        return df

    def _select_final_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """Select only the required columns for final output."""
        required_columns = [
            "amenity_id",
            "amenity_type",
            "amenity_name",
            "postal_code",
            "lat",
            "lon",
            "amenity_category_id",
            "pa_id",
            "sz_id",
        ]

        # Keep only columns that exist
        existing_columns = [col for col in required_columns if col in df.columns]

        # Log missing columns
        missing_columns = [col for col in required_columns if col not in df.columns]
        if missing_columns:
            logger.warning("Missing columns in output: %s", missing_columns)

        return df[existing_columns]

    def classify(
        self,
        input_csv: Path,
        output_csv: Path,
        output_dir: Path | None = None
    ) -> pd.DataFrame:
        """
        Classify amenities and generate final output.

        Args:
            input_csv: Path to input CSV with geocoded amenities
            output_csv: Path for final classified amenities output
            output_dir: Directory for lookup tables (defaults to output_csv parent)

        Returns:
            DataFrame with classified amenities
        """
        logger.info("Loading amenities data from %s", input_csv)
        # Load with postal_code as string to preserve leading zeros
        df = pd.read_csv(input_csv, dtype={'postal_code': str})
        logger.info("Loaded %d records", len(df))

        # Ensure postal codes are 6 digits; set missing/NaN to '000000'
        if 'postal_code' in df.columns:
            df['postal_code'] = df['postal_code'].astype(str).str.strip()
            df['postal_code'] = df['postal_code'].apply(
                lambda x: (x.zfill(6) if x.isdigit() and len(x) <= 6 else x)
            )
            # Normalize blanks/NaNs to '000000'
            df.loc[df['postal_code'].isin(['', 'nan', 'NaN', 'None']), 'postal_code'] = '000000'

        # Set output directory for lookups
        if output_dir is None:
            output_dir = output_csv.parent

        # Classification pipeline
        df = self._normalize_amenity_types(df)
        df = self._apply_category_mapping(df)
        df = self._compute_importance_scores(df)
        df = self._create_all_lookups(df, output_dir)

        # Log statistics
        total_records = len(df)
        if total_records:
            category_share = (
                df["amenity_category"]
                .fillna("uncategorised")
                .value_counts(normalize=True)
                .mul(100)
                .round(2)
            )
            logger.info("Amenity category distribution (%% of total):\n%s", category_share.to_string())
        # Diagnostics (optional): gated by AMENITIES_DIAGNOSTICS=1
        try:
            import os as _os
            if _os.getenv("AMENITIES_DIAGNOSTICS", "0").lower() in {"1", "true", "yes"}:
                diag_dir = (output_dir or output_csv.parent) / "diagnostics"
                diag_dir.mkdir(parents=True, exist_ok=True)
                mask_others = df["amenity_category"].eq("Others")
                if mask_others.any():
                    (
                        df.loc[mask_others]
                        .groupby(df.loc[mask_others, "amenity_type"].fillna(""))
                        .size()
                        .sort_values(ascending=False)
                        .to_csv(diag_dir / "others_by_amenity_type.csv", header=["count"])
                    )
                    if "theme_queryname" in df.columns:
                        (
                            df.loc[mask_others]
                            .groupby(df.loc[mask_others, "theme_queryname"].fillna(""))
                            .size()
                            .sort_values(ascending=False)
                            .to_csv(diag_dir / "others_by_theme_queryname.csv", header=["count"])
                        )
                    sample_cols = [c for c in [
                        "amenity_type", "theme_queryname", "amenity_name", "description", "source_file"
                    ] if c in df.columns]
                    df.loc[mask_others, sample_cols].head(1000).to_csv(
                        diag_dir / "others_samples.csv", index=False
                    )
                    logger.info("Wrote diagnostics for 'Others' → %s", diag_dir)
        except Exception:
            pass

        # Create full output (all columns for reference)
        reference_csv = output_csv.with_name("amenities_with_importance_score.csv")

        # Drop unwanted columns
        drop_columns = [
            "fallback_category",
            "fallback_priority",
            "fallback_weight",
            "fallback_importance_score",
            "fallback_importance_label",
            "predicted_category",
        ]
        existing_drop = [col for col in drop_columns if col in df.columns]
        if existing_drop:
            df = df.drop(columns=existing_drop)

        # Save reference CSV with all columns
        reference_csv.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(reference_csv, index=False)
        logger.info("Reference amenities saved to %s", reference_csv)

        # Create final output with only required columns
        final_df = self._select_final_columns(df)

        # Save final output
        output_csv.parent.mkdir(parents=True, exist_ok=True)
        final_df.to_csv(output_csv, index=False)
        logger.info("Final classified amenities saved to %s", output_csv)

        return final_df


def classify_amenities(
    input_csv: Path,
    output_csv: Path,
    reference_csv: Path | None = None,
    **kwargs
) -> pd.DataFrame:
    """
    Classify amenities and compute importance scores.

    Args:
        input_csv: Path to input CSV with geocoded amenities
        output_csv: Path for final classified amenities output
        reference_csv: Optional path for reference CSV (deprecated, ignored)
        **kwargs: Additional arguments (output_dir for lookup tables)

    Returns:
        DataFrame with classified amenities

    Note:
        This is a wrapper function for backward compatibility.
        Use AmenityClassifier class for more control.
    """
    classifier = AmenityClassifier()
    output_dir = kwargs.get("output_dir", output_csv.parent)
    return classifier.classify(input_csv, output_csv, output_dir)


__all__ = ["AmenityClassifier", "classify_amenities"]
