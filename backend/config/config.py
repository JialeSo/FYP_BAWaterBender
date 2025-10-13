import os
from dotenv import load_dotenv

load_dotenv()

APP_ENV = os.getenv("APP_ENV", "development")

is_production = APP_ENV.lower() in ["production", "prod"]
is_development = APP_ENV.lower() in ["development", "dev", "local"]


PUB_CHANNEL_USERNAME = "pubfloodalerts" if is_production else "testPubAlerts"
SERVER_URL = os.getenv("SERVER_URL", "http://localhost:8000/api")

LOCATIONIQ_KEY = os.getenv("LOCATIONIQ_KEY")
LOCATIONIQ_FORWARD_URL = "https://us1.locationiq.com/v1/search.php"
LOCATIONIQ_REVERSE_URL = "https://us1.locationiq.com/v1/reverse.php"
