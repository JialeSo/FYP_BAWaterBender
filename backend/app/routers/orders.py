# app/routers/orders.py
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional, Any
from pydantic import BaseModel

from app.models.schemas import OrderCreate, Vehicle, Location
from app.db.supabase import get_service_client
from app.core.security import get_current_user
from app.utils.common import now_iso

router = APIRouter(prefix="/orders", tags=["orders"])

allowed_status = {"pending", "dispatched", "onsite", "completed", "cancelled"}


class OrderUpdate(BaseModel):
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    plate: Optional[str] = None
    breakdown_type: Optional[str] = None
    summary: Optional[str] = None
    vehicle: Optional[Vehicle] = None
    location: Optional[Location] = None
    preferred_time: Optional[str] = None
    assigned_agent: Optional[str] = None
    workshop_id: Optional[str] = None
    status: Optional[str] = None


@router.post("", status_code=201)
def create_order(body: OrderCreate, user=Depends(get_current_user)):
    sb = get_service_client()
    uid = user["id"]

    for k in ["customer_name", "customer_phone", "plate", "breakdown_type"]:
        if not getattr(body, k):
            raise HTTPException(status_code=400, detail=f"missing_{k}")

    status = (body.status or "pending").lower()
    if status not in allowed_status:
        raise HTTPException(status_code=400, detail="invalid_status")

    assigned_agent = (body.assigned_agent or user.get("username") or "").strip().lower() or None

    order = {
        "created_at": now_iso(),
        "last_update": now_iso(),
        "created_by": uid,
        "assigned_agent": assigned_agent,
        "customer_name": body.customer_name.strip(),
        "customer_phone": body.customer_phone.strip(),
        "plate": body.plate.strip().lower(),
        "vehicle": body.vehicle.model_dump() if body.vehicle else None,
        "breakdown_type": body.breakdown_type,
        "summary": (body.summary or "").strip(),
        "location": body.location.model_dump() if body.location else None,
        "preferred_time": body.preferred_time or "asap",
        "workshop_id": body.workshop_id or None,
        "status": status,
        "timestamps": {"dispatched": None, "onsite": None, "completed": None},
    }

    ins = sb.table("orders").insert(order).execute()
    if not ins.data:
        raise HTTPException(status_code=500, detail="insert_failed")
    order_id = ins.data[0]["id"]

    sb.table("status_logs").insert({
        "order_id": order_id,
        "at": now_iso(),
        "by": f"user:{user.get('username') or uid}",
        "action": "create",
        "to": status,
        "note": None,
    }).execute()

    q = (
        sb.table("orders")
        .select("*, workshops:workshop_id (id, name, phone, address)")
        .eq("id", order_id)
        .single()
        .execute()
    )
    return q.data


@router.get("")
def list_orders(_=Depends(get_current_user)):
    sb = get_service_client()
    q = sb.table("orders").select("*").order("created_at", desc=True).limit(50).execute()
    return {"items": q.data or []}


@router.get("/full")
def list_orders_full(_=Depends(get_current_user)):
    sb = get_service_client()
    q = (
        sb.table("orders")
        .select("*, workshops:workshop_id (id, name, phone, address)")
        .order("created_at", desc=True)
        .execute()
    )
    items = q.data or []
    for o in items:
        o["workshop_display"] = (
            o.get("workshops", {}).get("name")
            if isinstance(o.get("workshops"), dict)
            else None
        )
        vehicle = o.get("vehicle") or {}
        o["car_make"] = vehicle.get("make") or "—"
        o["car_model"] = vehicle.get("model") or "—"
    return {"items": items}


@router.get("/{order_id}")
def get_order(order_id: str, _=Depends(get_current_user)):
    sb = get_service_client()
    q = (
        sb.table("orders")
        .select("*, workshops:workshop_id (id, name, phone, address)")
        .eq("id", order_id)
        .single()
        .execute()
    )
    if not q.data:
        raise HTTPException(status_code=404, detail="not_found")
    return q.data


@router.patch("/{order_id}")
def update_order(order_id: str, body: OrderUpdate, user=Depends(get_current_user)):
    sb = get_service_client()

    curr = sb.table("orders").select("status,timestamps").eq("id", order_id).single().execute()
    if not curr.data:
        raise HTTPException(status_code=404, detail="not_found")

    curr_status = (curr.data.get("status") or "pending").lower()
    curr_ts = curr.data.get("timestamps") or {"dispatched": None, "onsite": None, "completed": None}

    incoming = body.model_dump(exclude_unset=True)
    patch: dict[str, Any] = {"last_update": now_iso()}

    if "customer_name" in incoming: patch["customer_name"] = (incoming["customer_name"] or "").strip()
    if "customer_phone" in incoming: patch["customer_phone"] = (incoming["customer_phone"] or "").strip()
    if "plate" in incoming: patch["plate"] = (incoming["plate"] or "").strip().lower()
    if "breakdown_type" in incoming: patch["breakdown_type"] = incoming["breakdown_type"]
    if "summary" in incoming: patch["summary"] = (incoming["summary"] or "").strip()
    if "preferred_time" in incoming: patch["preferred_time"] = incoming["preferred_time"]
    if "assigned_agent" in incoming:
        aa = (incoming["assigned_agent"] or "").strip().lower()
        patch["assigned_agent"] = aa or None
    if "vehicle" in incoming:
        patch["vehicle"] = incoming["vehicle"] or None
    if "location" in incoming:
        patch["location"] = incoming["location"] or None
    if "workshop_id" in incoming:
        patch["workshop_id"] = incoming["workshop_id"] or None
    if "status" in incoming and incoming["status"]:
        next_status = incoming["status"].lower()
        if next_status not in allowed_status:
            raise HTTPException(status_code=400, detail="invalid_status")
        patch["status"] = next_status
        ts = dict(curr_ts)
        if next_status in {"dispatched", "onsite", "completed"} and next_status != curr_status:
            ts[next_status] = now_iso()
        patch["timestamps"] = ts

    upd = sb.table("orders").update(patch).eq("id", order_id).execute()
    if not upd.data:
        raise HTTPException(status_code=404, detail="not_found")

    sb.table("status_logs").insert({
        "order_id": order_id,
        "at": now_iso(),
        "by": f"user:{user.get('username') or user['id']}",
        "action": "update",
        "note": None
    }).execute()

    q = (
        sb.table("orders")
        .select("*, workshops:workshop_id (id, name, phone, address)")
        .eq("id", order_id)
        .single()
        .execute()
    )
    return q.data


@router.delete("/{order_id}")
def delete_order(order_id: str, _=Depends(get_current_user)):
    sb = get_service_client()
    delr = sb.table("orders").delete().eq("id", order_id).execute()
    if not delr.data:
        raise HTTPException(status_code=404, detail="not_found")
    return {"ok": True}
