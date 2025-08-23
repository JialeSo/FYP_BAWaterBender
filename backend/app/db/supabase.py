from supabase import create_client, Client
from app.core.config import SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

def get_public_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

def get_service_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
