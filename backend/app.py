import os
import uvicorn
from dotenv import load_dotenv
from config.config import is_development

load_dotenv()

PORT = int(os.getenv("PORT", 8000))

if __name__ == "__main__":
    uvicorn.run("app.main:app", port=PORT, reload=is_development)
