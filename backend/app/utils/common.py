import os, re
from datetime import datetime, timezone

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def pick(d: dict, keys: list[str]) -> dict:
    return {k: d.get(k) for k in keys if k in d}

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,32}$")

ALIAS_EMAIL_DOMAIN = os.getenv("ALIAS_EMAIL_DOMAIN", "example.com")

def alias_email_from_username(username: str) -> str:
    u = username.strip().lower()
    return f"{u}@{ALIAS_EMAIL_DOMAIN}"
