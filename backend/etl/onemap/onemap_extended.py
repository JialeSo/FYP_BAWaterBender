import os
import time
import requests
from dotenv import load_dotenv
import pandas as pd

load_dotenv()


def _get_env_creds() -> tuple[str, str]:
    """Get OneMap credentials from env, supporting both var names.

    Prefers ONE_MAP_USER/ONE_MAP_PASS, falls back to ONEMAP_EMAIL/ONEMAP_EMAIL_PASSWORD.
    """
    email = os.environ.get("ONE_MAP_USER") or os.environ.get("ONEMAP_EMAIL")
    password = os.environ.get("ONE_MAP_PASS") or os.environ.get("ONEMAP_EMAIL_PASSWORD")
    if not email or not password:
        raise ValueError(
            "Set ONE_MAP_USER/ONE_MAP_PASS or ONEMAP_EMAIL/ONEMAP_EMAIL_PASSWORD in environment"
        )
    return email, password


def get_token_payload() -> dict:
    """Fetch a fresh OneMap token payload (full JSON) from the auth API."""
    email, password = _get_env_creds()
    auth_url = "https://www.onemap.gov.sg/api/auth/post/getToken"
    resp = requests.post(auth_url, json={"email": email, "password": password}, timeout=20)
    resp.raise_for_status()
    payload = resp.json() or {}
    return payload


def get_token() -> str:
    """Fetch a fresh OneMap access token string from the auth API."""
    payload = get_token_payload()
    token = payload.get("access_token") or payload.get("accessToken")
    if not token:
        raise RuntimeError(f"OneMap auth response missing access_token: keys={list(payload.keys())}")
    return token


class OneMapClient:
    """Reusable OneMap API client with token caching and helpers.

    - Supports both ONE_MAP_USER/ONE_MAP_PASS and ONEMAP_EMAIL/ONEMAP_EMAIL_PASSWORD
    - Caches token for a configurable TTL (default: 3 days)
    - Auto-refreshes token on expiry or 401
    - Builds proper Authorization header using token_type when provided
    """

    def __init__(self, ttl_seconds: float = 3 * 24 * 60 * 60):
        self._token: str | None = None
        self._token_type: str | None = None
        self._token_time: float | None = None
        self._ttl = ttl_seconds

    def _expired(self) -> bool:
        if not self._token or self._token_time is None:
            return True
        return (time.time() - self._token_time) > self._ttl

    def ensure_token(self) -> None:
        if self._expired():
            payload = get_token_payload()
            token = payload.get("access_token") or payload.get("accessToken")
            if not token:
                raise RuntimeError("OneMap auth response missing access_token")
            self._token = token
            self._token_type = payload.get("token_type") or payload.get("tokenType")
            self._token_time = time.time()

    def auth_header(self) -> dict:
        if not self._token:
            return {}
        val = self._token
        if self._token_type and "bearer" in str(self._token_type).lower():
            val = f"Bearer {self._token}"
        return {"Authorization": val}

    def get_public(self, url: str, *, params: dict | None = None, headers: dict | None = None, timeout: int = 20):
        base_headers = {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
            "Referer": "https://www.onemap.gov.sg/",
            "Origin": "https://www.onemap.gov.sg",
            "Accept": "application/json",
        }
        if headers:
            base_headers.update(headers)
        r = requests.get(url, params=params or {}, headers=base_headers, timeout=timeout)
        return r

    def get_auth(self, url: str, *, params: dict | None = None, headers: dict | None = None, timeout: int = 20):
        self.ensure_token()
        base_headers = {**self.auth_header(), "Accept": "application/json"}
        if headers:
            base_headers.update(headers)
        r = requests.get(url, params=params or {}, headers=base_headers, timeout=timeout)
        if r.status_code == 401:
            # refresh and retry once
            self._token = None
            self._token_time = None
            self._token_type = None
            self.ensure_token()
            base_headers = {**self.auth_header(), "Accept": "application/json"}
            if headers:
                base_headers.update(headers)
            r = requests.get(url, params=params or {}, headers=base_headers, timeout=timeout)
        return r

    def search_elastic_postal(self, postal: str) -> tuple[float | None, float | None]:
        """Token-only elastic search for a postal code -> (lat, lon)."""
        url = "https://www.onemap.gov.sg/api/common/elastic/search"
        params = {"searchVal": postal, "returnGeom": "Y", "getAddrDetails": "Y", "pageNum": 1}
        r = self.get_auth(url, params=params)
        r.raise_for_status()
        js = r.json() or {}
        results = js.get("results") or js.get("SearchResults") or []
        if results:
            first = results[0]
            lat = first.get("LATITUDE") or first.get("lat") or first.get("LAT")
            lon = first.get("LONGITUDE") or first.get("lon") or first.get("LNG")
            return (float(lat), float(lon)) if lat and lon else (None, None)
        return (None, None)


if __name__ == "__main__":
    # Demo: get token payload and fetch themes
    payload = get_token_payload()
    token = payload.get("access_token") or payload.get("accessToken")
    token_type = payload.get("token_type") or payload.get("tokenType")
    expires_in = payload.get("expires_in") or payload.get("expiry_timestamp")
    print("✅ Token payload:", {k: payload.get(k) for k in payload.keys()})
    if token:
        shown = token[:30] + "..."
    else:
        shown = None
    print("✅ Access token:", shown)
    print("✅ token_type:", token_type)
    print("✅ expires_in:", expires_in)

    themes_url = "https://www.onemap.gov.sg/api/public/themesvc/getAllThemesInfo?moreInfo=Y"
    # Use Bearer prefix if provided, else raw token
    auth_value = f"Bearer {token}" if token_type and "bearer" in str(token_type).lower() else token
    headers = {"Authorization": auth_value}
    themes_resp = requests.get(themes_url, headers=headers)
    themes_resp.raise_for_status()
    themes = themes_resp.json().get("Theme_Names", [])
    print(f"📌 Found {len(themes)} themes.")

    all_records = []
    for theme in themes:
        themename = theme.get("THEMENAME")
        queryname = theme.get("QUERYNAME")
        print(f"🔍 Fetching data for: {themename} ({queryname})")
        theme_data_url = f"https://www.onemap.gov.sg/api/public/themesvc/retrieveTheme?queryName={queryname}"
        try:
            data_resp = requests.get(theme_data_url, headers=headers)
            data_resp.raise_for_status()
            data_items = data_resp.json().get("SrchResults", [])
            for item in data_items:
                item["Theme Name"] = themename
                item["Query Name"] = queryname
                all_records.append(item)
        except Exception as e:
            print(f"⚠️ Failed to fetch {queryname}: {e}")
        time.sleep(0.2)

    df = pd.DataFrame(all_records)
    df.columns = [col.strip().replace(" ", "_").lower() for col in df.columns]
    print("\n📌 Column Names in df:")
    print(df.columns.tolist())
