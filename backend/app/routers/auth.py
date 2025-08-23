# app/routers/auth.py
from fastapi import APIRouter, Depends, HTTPException, status, Query
from passlib.hash import bcrypt
from app.models.schemas import RegisterIn, LoginIn, MeOut
from app.db.supabase import get_service_client
from app.core.security import create_access_token, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register")
def register(payload: RegisterIn):
    sb = get_service_client()

    username = (payload.username or "").strip().lower()
    if not (3 <= len(username) <= 64):
        raise HTTPException(status_code=400, detail="invalid_username")

    existing = sb.table("app_users").select("id").eq("username", username).limit(1).execute()
    if existing.data:
        raise HTTPException(status_code=409, detail="username_taken")

    pw_hash = bcrypt.hash(payload.password)
    ins = sb.table("app_users").insert({
        "username": username,
        "password_hash": pw_hash,
        "display_name": payload.display_name or username,
        "role": "user",
    }).execute()
    if not ins.data:
        raise HTTPException(status_code=500, detail="create_user_failed")

    user = ins.data[0]
    return {"id": user["id"], "role": user["role"]}


@router.post("/login")
def login(payload: LoginIn):
    sb = get_service_client()
    username = (payload.username or "").strip().lower()

    q = sb.table("app_users").select("*").eq("username", username).single().execute()
    user = q.data
    if not user or not bcrypt.verify(payload.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_credentials")

    token = create_access_token(user["id"], extra={
        "username": user["username"],
        "display_name": user.get("display_name"),
        "role": user.get("role", "user")
    })
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "username": user["username"],
            "display_name": user.get("display_name"),
            "role": user.get("role", "user"),
        },
    }


@router.get("/me", response_model=MeOut)
def me(current=Depends(get_current_user)):
    return {
        "id": current["id"],
        "username": current["username"],
        "display_name": current.get("display_name"),
        "role": current.get("role", "user"),
        "profile": None,
    }


# 👇 NEW: list users (optionally by role, e.g. ?role=agent)
@router.get("/users")
def list_users(role: str | None = Query(None), _=Depends(get_current_user)):
    sb = get_service_client()
    q = sb.table("app_users").select("id,username,display_name,role").order("display_name", desc=False)
    if role:
        q = q.eq("role", role)
    res = q.execute()
    return {"items": res.data or []}
