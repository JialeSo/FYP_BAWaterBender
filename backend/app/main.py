import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers.router import api_router
from dotenv import load_dotenv

from config.config import ALLOWED_ORIGINS

load_dotenv()

logger = logging.getLogger(__name__)

# Create FastAPI app instance
app = FastAPI(
    title="FYP BAWaterBender API",
    description="Backend API for FYP BAWaterBender flood management system",
    version="1.0.0",
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS
    or [
        "http://localhost:3000",  # React dev server
        "http://localhost:5173",  # Vite dev server
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        # Add your production domains here
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Include the API router in the main app
app.include_router(api_router)

# start up Telegram listener module
try:
    from etl.pub.weather_alerts import weather_alerts as weather_alerts_listener
    import asyncio

    # Start the weather alerts listener in the background
    asyncio.create_task(weather_alerts_listener.start_live_monitoring())
    logger.info("✅ Telegram listener started as async task.")
except Exception as e:
    logger.info("❌ Failed to start Telegram listener: %s", e)


@app.get("/")
async def root():
    """Root endpoint for health check"""
    return {"message": "FYP BAWaterBender API is running!", "status": "healthy"}


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "message": "API is operational"}
