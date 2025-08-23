from fastapi import APIRouter, Depends, HTTPException
from typing import List
from app.db.supabase import get_service_client
from app.models.schemas import WorkshopCreate, WorkshopUpdate, WorkshopOut
from app.core.security import get_current_user

router = APIRouter(prefix="/workshops", tags=["workshops"])

@router.get("", response_model=List[WorkshopOut])
def list_workshops(_=Depends(get_current_user)):
    sb = get_service_client()
    q = sb.table("workshops").select("*").order("name", desc=False).execute()
    return q.data or []

@router.post("", response_model=WorkshopOut)
def create_workshop(body: WorkshopCreate, _=Depends(get_current_user)):
    sb = get_service_client()
    ins = sb.table("workshops").insert(body.model_dump()).execute()
    if not ins.data:
        raise HTTPException(status_code=500, detail="create_failed")
    return ins.data[0]

@router.patch("/{workshop_id}", response_model=WorkshopOut)
def update_workshop(workshop_id: str, body: WorkshopUpdate, _=Depends(get_current_user)):
    sb = get_service_client()
    upd = sb.table("workshops").update(body.model_dump(exclude_unset=True)).eq("id", workshop_id).execute()
    if not upd.data:
        raise HTTPException(status_code=404, detail="not_found")
    return upd.data[0]

@router.delete("/{workshop_id}")
def delete_workshop(workshop_id: str, _=Depends(get_current_user)):
    sb = get_service_client()
    delr = sb.table("workshops").delete().eq("id", workshop_id).select("id").execute()
    if not delr.data:
        raise HTTPException(status_code=404, detail="not_found")
    return {"ok": True}
