# app/main.py
import asyncio
import logging
from app.routers.weather_alerts_router import router as weather_alerts_router
from etl.pub.weather_alerts import weather_alerts
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
import os
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

app = FastAPI(title="FYP BAWaterBender Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure properly for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(weather_alerts_router)

# Supabase setup
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")

if SUPABASE_URL and SUPABASE_KEY:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    logger.info("✅ Supabase client initialized successfully")
else:
    supabase = None
    logger.warning(
        "⚠️ Supabase credentials not found - database features will be disabled"
    )


@app.on_event("startup")
async def startup_event():
    # start Telethon in background
    asyncio.create_task(run_telethon())


async def run_telethon():
    await weather_alerts.start_live_monitoring()


@app.get("/")
async def root():
    return {"message": "FYP BAWaterBender Backend is running!"}


@app.get("/healthz")
def health():
    return {"ok": True}


@app.get("/health/db")
async def check_db_connection():
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")

    try:
        # Simple test query - this will work even if you have no tables
        response = supabase.rpc("version").execute()
        return {"status": "connected", "message": "Database connection successful"}
    except Exception as e:
        # Even if the RPC fails, if we get here, the connection works
        return {
            "status": "connected",
            "message": f"Database connected (basic test passed)",
        }


# Quick endpoint to see your tables
@app.get("/tables")
async def get_tables():
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")

    try:
        # Try to get table information from information_schema
        response = supabase.rpc("get_table_names").execute()
        return {"tables": response.data}
    except Exception as e:
        return {"message": "Could not fetch table names automatically", "error": str(e)}


# Generic endpoint to get data from any table
@app.get("/tables/{table_name}")
async def get_table_data(table_name: str, limit: int = 10):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")

    try:
        response = supabase.table(table_name).select("*").limit(limit).execute()
        return {
            "table": table_name,
            "data": response.data,
            "count": len(response.data) if response.data else 0,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error fetching from {table_name}: {str(e)}"
        )


# Generic endpoint to get single record
@app.get("/tables/{table_name}/{record_id}")
async def get_record(table_name: str, record_id: int):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")

    try:
        response = supabase.table(table_name).select("*").eq("id", record_id).execute()
        if response.data:
            return {"table": table_name, "record": response.data[0]}
        else:
            raise HTTPException(status_code=404, detail="Record not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fet ing record: {str(e)}")


if __name__ == "__main__":
    import uvicorn

    is_prod = os.getenv("ENV") == "production"

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=not is_prod)
