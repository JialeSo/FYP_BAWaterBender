import logging
import os
from dotenv import load_dotenv

load_dotenv()


def setup_logger():
    """
    Simple logger setup that automatically sets logging level based on environment.
    - INFO level in production (when ENVIRONMENT=production)
    - DEBUG level for local development
    """
    # Determine environment
    env = os.getenv("ENVIRONMENT", "development").lower()

    # Set logging level
    level = _get_log_level()

    # Configure logging
    logging.basicConfig(
        level=level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Get logger for the application
    logger = logging.getLogger("bawaterbender")

    # Log the initialization
    level_name = logging.getLevelName(level)
    logger.info(f"Logger initialized - Environment: {env}, Level: {level_name}")

    return logger


def _get_log_level():
    env = os.getenv("ENVIRONMENT", "development").lower()
    if env in ["production", "prod"]:
        return logging.INFO
    return logging.DEBUG
