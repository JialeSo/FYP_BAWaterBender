"""Classify Amenities"""

from __future__ import annotations

import logging
from pathlib import Path
import re
from typing import Any, Dict

import pandas as pd

from backend.etl.amenities.step_02_classification.importance_scorer import ImportanceScorer

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
    "sportsg_dus_sport_facilities": "Education_institutions",
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
    "doityourself": "Others",
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

    # Others
    "animal_boarding": "Others",
    "hobby": "Others",
    "adit": "Others",
    "psychic": "Others",
    "scuba_diving": "Others",
    "works": "Others",
    "conference_centre": "Community_spaces",
    "vending_machine": "Retail_services",
    "boutique": "Retail_services",
    "shoe_repair": "Retail_services",
    "spices": "Others",
    "repair": "Retail_services",
    "household_linen": "Others",
    "grocery": "Retail_services",
    "wholesale": "Retail_services",
    "games": "Retail_services",
    "video": "Retail_services",
    "hairdresser_supply": "Retail_services",
    "candles": "Retail_services",
    "camera": "Retail_services",
    "locksmith": "Retail_services",
    "computer_repair": "Retail_services",
    "window_blind": "Others",
    "radiotechnics": "Retail_services",
    "perfumery": "Retail_services",
    "photo_studio": "Retail_services",
    "model": "Others",
    "security": "Retail_services",
    "phone_repair": "Retail_services",
    "organic_products": "Retail_services",
    "farm": "Others",
    "communication": "Retail_services",
    "customer_service": "Retail_services",
    "juice_bar": "Retail_services",
    "sewing": "Retail_services",
    "funeral_directors": "Retail_services",
    "nuts": "Others",
    "furnishing_products": "Retail_services",
    "lighting_fans_bathroom_kitchen_and_smart_home": "Retail_services",
    "doors": "Retail_services",
    "fishing": "Others",
}


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


class AmenityClassifier:
    """OOP-based amenity classification with importance scoring."""

    def __init__(self):
        """Initialize classifier with ImportanceScorer."""
        self.scorer = ImportanceScorer()
        self.category_lookup = None
        self.type_lookup = None
        self.planning_lookup = None
        self.subzone_lookup = None
        self.road_lookup = None

    def _normalize_amenity_types(self, df: pd.DataFrame) -> pd.DataFrame:
        """Normalize amenity type strings."""
        if "amenity_type" in df.columns:
            df["amenity_type"] = _normalise_type_series(df["amenity_type"])
        return df

    def _apply_category_mapping(self, df: pd.DataFrame) -> pd.DataFrame:
        """Apply category mapping to amenity types."""
        if "amenity_type" not in df.columns:
            return df

        # First apply the regular mapping
        df["amenity_category"] = df["amenity_type"].map(TYPE_CATEGORY_MAP)

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
                        ""
                    ), axis=1
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
        # Create category lookup with importance scores
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

        # Create planning area lookup (pa_id) preserving integer IDs from geocoding when available
        if "planning_area" in df.columns:
            output_path = output_dir / "planning_area_lookup.csv"
            if "pa_id" in df.columns or "planning_area_id" in df.columns:
                # Prefer existing integer IDs from Step 1
                if "pa_id" not in df.columns and "planning_area_id" in df.columns:
                    df["pa_id"] = pd.to_numeric(df["planning_area_id"], errors="coerce").fillna(0).astype(int)
                else:
                    df["pa_id"] = pd.to_numeric(df["pa_id"], errors="coerce").fillna(0).astype(int)

                lookup_df = (
                    df[["pa_id", "planning_area"]]
                    .dropna(subset=["planning_area"])  # ensure valid names
                    .drop_duplicates()
                    .sort_values("pa_id")
                )
                output_path.parent.mkdir(parents=True, exist_ok=True)
                lookup_df.to_csv(output_path, index=False)
                self.planning_lookup = dict(zip(lookup_df["planning_area"], lookup_df["pa_id"]))
            else:
                # Fallback: generate integer IDs starting from 1 (no zero-padding)
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

        # Create subzone lookup (sz_id) preserving integer IDs when available
        if "subzone" in df.columns:
            output_path = output_dir / "subzone_lookup.csv"
            if "sz_id" in df.columns or "subzone_id" in df.columns:
                if "sz_id" not in df.columns and "subzone_id" in df.columns:
                    df["sz_id"] = pd.to_numeric(df["subzone_id"], errors="coerce").fillna(0).astype(int)
                else:
                    df["sz_id"] = pd.to_numeric(df["sz_id"], errors="coerce").fillna(0).astype(int)

                lookup_df = (
                    df[["sz_id", "subzone"]]
                    .dropna(subset=["subzone"])  # ensure valid names
                    .drop_duplicates()
                    .sort_values("sz_id")
                )
                output_path.parent.mkdir(parents=True, exist_ok=True)
                lookup_df.to_csv(output_path, index=False)
                self.subzone_lookup = dict(zip(lookup_df["subzone"], lookup_df["sz_id"]))
            else:
                # Fallback: generate integer IDs starting from 1 (no zero-padding)
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

        # Road lookup is created in Step 03 after snapping to OSM network (rn_id -> road_name)

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

        # Ensure postal codes are 6 digits with leading zeros
        if 'postal_code' in df.columns:
            df['postal_code'] = df['postal_code'].astype(str).str.strip()
            df['postal_code'] = df['postal_code'].apply(
                lambda x: x.zfill(6) if x and x.isdigit() and len(x) <= 6 else x
            )

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
