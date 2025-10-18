import os
import uvicorn
from dotenv import load_dotenv
from config.config import is_development
from app.app import app  # Import the FastAPI app instance

load_dotenv()

PORT = int(os.getenv("PORT", 8000))

# For Vercel deployment - the app is imported from app.app
# Vercel will look for an 'app' variable in this file

if __name__ == "__main__":
    uvicorn.run("app.app:app", port=PORT, reload=is_development)
