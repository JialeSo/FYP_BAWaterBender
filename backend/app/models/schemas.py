# app/models/schemas.py
from __future__ import annotations
from pydantic import BaseModel
from typing import Optional, Dict

class RegisterIn(BaseModel):
    username: str
    password: str
    display_name: Optional[str] = None

class LoginIn(BaseModel):
    username: str
    password: str

class MeOut(BaseModel):
    id: str
    username: str
    display_name: Optional[str] = None
    role: Optional[str] = "user"
    profile: Optional[Dict] = None  # keep for compatibility

# ---- orders nested models ----
class Vehicle(BaseModel):
    make: Optional[str] = None
    model: Optional[str] = None
    series: Optional[str] = None

class Location(BaseModel):
    addr: Optional[str] = None  # address only

# include status here for create too (required by your dialog)
class OrderCreate(BaseModel):
    customer_name: str
    customer_phone: str
    plate: str
    breakdown_type: str = "battery_replacement"
    summary: Optional[str] = ""
    vehicle: Optional[Vehicle] = None
    location: Optional[Location] = None
    preferred_time: Optional[str] = "asap"
    assigned_agent: Optional[str] = None
    workshop_id: Optional[str] = None   # ✅ linked workshop
    status: Optional[str] = "pending"

class OrderOut(BaseModel):
    id: str
    created_at: str
    last_update: str
    created_by: Optional[str] = None
    assigned_agent: Optional[str] = None
    customer_name: str
    customer_phone: str
    plate: str
    vehicle: Optional[Dict] = None
    breakdown_type: str
    summary: Optional[str] = None
    location: Optional[Dict] = None
    preferred_time: Optional[str] = "asap"
    workshop_id: Optional[str] = None
    workshop_display: Optional[str] = None   # ✅ ready for frontend
    status: str
    timestamps: Dict

class AssignPatch(BaseModel):
    workshop_name: Optional[str] = None
    workshop_phone: Optional[str] = None
    notes: Optional[str] = None
    by: Optional[str] = "agent:api"

class StatusPatch(BaseModel):
    status: str
    by: Optional[str] = "agent:api"

class ReassignPatch(BaseModel):
    assigned_agent: str
    by: Optional[str] = "agent:api"

class WorkshopBase(BaseModel):
    name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    rating: Optional[float] = None

class WorkshopCreate(WorkshopBase):
    pass

class WorkshopUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    rating: Optional[float] = None

class WorkshopOut(WorkshopBase):
    id: str

