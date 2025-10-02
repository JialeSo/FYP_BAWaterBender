import os
from dotenv import load_dotenv

load_dotenv()

APP_ENV = os.getenv("APP_ENV", "development")


is_production = APP_ENV.lower() in ["production", "prod"]
is_development = APP_ENV.lower() in ["development", "dev", "local"]