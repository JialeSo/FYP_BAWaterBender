import os
import logging
from dotenv import load_dotenv

load_dotenv()

# ==========================================
# Environment Configuration
# ==========================================
APP_ENV = os.getenv("APP_ENV", "development")

def _get_int_env(name: str, default: int) -> int:
    val = os.getenv(name)
    if val is None:
        return default
    try:
        return int(val)
    except Exception:
        logging.warning(f"Invalid integer for {name}='{val}', falling back to {default}")
        return default

PORT = _get_int_env("PORT", 8000)

is_production = APP_ENV.lower() in ["production", "prod"]
is_development = APP_ENV.lower() in ["development", "dev", "local"]

# ==========================================
# Database Configuration (Supabase)
# ==========================================
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# ==========================================
# CORS Configuration
# ==========================================
ALLOWED_ORIGINS = [
    s.strip() for s in os.getenv("ALLOWED_ORIGINS", "").split(",") if s.strip()
]

# ==========================================
# External Services Configuration
# ==========================================
PUB_CHANNEL_USERNAME = "pubfloodalerts" if is_production else "testPubAlerts"
PUB_CREDENTIALS_BUCKET = "pub_tele_credentials"
SERVER_URL = os.getenv("SERVER_URL", "http://localhost:8000/api")


LOCATIONIQ_KEY = os.getenv("LOCATIONIQ_KEY")
LOCATIONIQ_FORWARD_URL = "https://us1.locationiq.com/v1/search.php"
LOCATIONIQ_REVERSE_URL = "https://us1.locationiq.com/v1/reverse.php"

ONE_MAP_API = "https://www.onemap.gov.sg"
