from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any

import jwt
from fastapi import Header, HTTPException, status

from app.core.config import JWT_SECRET, JWT_ALG, JWT_EXPIRES_MIN
from app.db.supabase import get_service_client

def create_access_token(sub: str, extra: Optional[Dict[str, Any]] = None, expires_min: int = JWT_EXPIRES_MIN) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": sub, "iat": int(now.timestamp()), "exp": int((now + timedelta(minutes=expires_min)).timestamp())}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def decode_token(token: str) -> Dict[str, Any]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_token")

async def get_current_user(authorization: str = Header(None)) -> Dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing_bearer_token")
    token = authorization.split(" ", 1)[1].strip()
    payload = decode_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_token")

    # fetch user from DB to get latest role/display_name
    sb = get_service_client()
    q = sb.table("app_users").select("id,username,display_name,role").eq("id", user_id).single().execute()
    if not q.data:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user_not_found")
    return q.data  # {"id","username","display_name","role"}
