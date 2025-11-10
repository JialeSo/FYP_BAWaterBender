import logging
import asyncio
from typing import Dict, Any

logger = logging.getLogger(__name__)


class AmenitiesController:
    """Controller for handling amenities ETL pipeline operations."""

    def __init__(self):
        """Initialize the controller without loading the pipeline."""
        self._pipeline = None
        self._pipeline_config = None
        self._background_task = None

    def _get_pipeline(self):
        """Lazy load the amenities pipeline."""
        if self._pipeline is None:
            try:
                from etl.amenities.amenities_pipeline import (
                    build_amenities_pipeline,
                )

                # Initialize with default config
                config = self._pipeline_config or {}

                self._pipeline = build_amenities_pipeline(
                    table_name="amenity_3layers", config=config
                )
                logger.info("Amenities pipeline loaded successfully")

            except ImportError as e:
                logger.error(f"Failed to import amenities pipeline: {e}")
                raise
            except Exception as e:
                logger.error(f"Failed to initialize amenities pipeline: {e}")
                raise

        return self._pipeline

    def set_pipeline_config(self, config: Dict[str, Any]) -> None:
        """Set configuration for the pipeline.

        Args:
            config: Configuration dictionary for the pipeline
        """
        self._pipeline_config = config
        # Reset pipeline to force reinitialization with new config
        self._pipeline = None

    async def _run_pipeline_background(self) -> None:
        """Internal method to run the pipeline in the background."""
        try:
            logger.info("🔄 Starting amenities pipeline in background...")

            # Get the pipeline (lazy loading)
            pipeline = self._get_pipeline()

            # Process amenities through the complete pipeline
            await pipeline.process_amenities()

            logger.info("✅ Amenities pipeline completed successfully")

        except Exception as e:
            logger.error(f"❌ Amenities pipeline failed: {e}")
            # Don't re-raise - this is a background task
        finally:
            self._background_task = None

    def trigger_amenities_update(self) -> Dict[str, Any]:
        """
        Trigger the amenities pipeline to run in the background.

        This method starts the pipeline as a background task and returns
        immediately. The pipeline will continue running without blocking
        the API response.

        Returns:
            Dict containing status and message about the triggered job
        """
        try:
            # Check if a pipeline is already running
            if self._background_task and not self._background_task.done():
                logger.warning("Amenities pipeline is already running")
                return {
                    "status": "already_running",
                    "message": (
                        "Amenities pipeline is already running in " "the background"
                    ),
                    "job_started": False,
                }

            # Create and store the background task
            self._background_task = asyncio.create_task(self._run_pipeline_background())

            logger.info("Amenities pipeline triggered successfully")

            return {
                "status": "success",
                "message": "Amenities pipeline started in the background",
                "job_started": True,
            }

        except Exception as e:
            logger.error(f"Failed to trigger amenities pipeline: {e}")
            raise

    def get_pipeline_status(self) -> Dict[str, Any]:
        """Get the current status of the pipeline.

        Returns:
            Dict containing pipeline status information
        """
        is_running = (
            self._background_task is not None and not self._background_task.done()
        )

        return {
            "pipeline_loaded": self._pipeline is not None,
            "pipeline_config": self._pipeline_config,
            "pipeline_class": (
                type(self._pipeline).__name__ if self._pipeline else None
            ),
            "background_task_running": is_running,
        }


# Singleton instance of AmenitiesController
amenities_controller = AmenitiesController()
