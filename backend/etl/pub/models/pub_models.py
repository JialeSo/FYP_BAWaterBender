from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class WeatherAlertMessage(BaseModel):
    id: int
    text: str
    created_at: datetime  # Changed from 'date' to match schema
    sender_id: int


class ParsedWeatherAlert(BaseModel):
    """Parsed weather alert data model based on WeatherAlerts output"""

    id: int  # Changed from msg_id to match database schema
    text: str
    created_at: datetime  # Changed from 'event_date_time' to match schema
    sender_id: int
    start_loc: Optional[str] = None
    end_loc: Optional[str] = None
    start: Optional[datetime] = None
    end: Optional[datetime] = None
    event: Optional[str] = None


class FinalWeatherAlert(ParsedWeatherAlert):
    """Final weather alert data model with geocoding references"""

    start_loc: Optional[str] = None
    end_loc: Optional[str] = None
    start_loc_geocode_id: Optional[int] = None
    end_loc_geocode_id: Optional[int] = None


class GeocodeRecord(BaseModel):
    """Geocode record data model for the geocodes table"""

    id: Optional[int] = None
    location_name: str  # normalized location name
    latitude: float
    longitude: float
    postal_code: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
