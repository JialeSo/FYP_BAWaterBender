from abc import ABC, abstractmethod
from typing import Any, Dict, Optional
import logging

logger = logging.getLogger(__name__)


class PipelineStage(ABC):
    """Abstract base class for pipeline stages

    Each pipeline stage represents a single unit of work in an ETL pipeline.
    Stages can be extraction, transformation, or loading operations.
    """

    def __init__(self, name: str, config: Optional[Dict[str, Any]] = None):
        """Initialize a pipeline stage

        Args:
            name: Human-readable name for this stage
            config: Configuration dictionary for this stage
        """
        self.name = name
        self.config = config or {}

    @abstractmethod
    async def process(self, data: Any) -> Any:
        """Process data through this stage

        This method must be implemented by concrete stage classes.

        Args:
            data: Input data to process

        Returns:
            Processed data to pass to the next stage

        Raises:
            Exception: If processing fails
        """
        pass

    async def execute(self, data: Any) -> Any:
        """Execute the stage with logging and error handling

        This method wraps the process() method with logging
        and error handling capabilities.

        Args:
            data: Input data to process

        Returns:
            Processed data from the process() method

        Raises:
            Exception: If processing fails
        """
        logger.info(f"Starting stage: {self.name}")

        try:
            result = await self.process(data)
            logger.info(f"Stage {self.name} completed successfully")
            return result

        except Exception as e:
            logger.error(f"Stage {self.name} failed: {str(e)}")
            raise

    def validate_config(self) -> bool:
        """Validate stage configuration

        Override this method in concrete classes to validate
        stage-specific configuration requirements.

        Returns:
            True if configuration is valid

        Raises:
            ValueError: If configuration is invalid
        """
        return True

    def __str__(self) -> str:
        """String representation of the stage"""
        return f"PipelineStage(name='{self.name}')"

    def __repr__(self) -> str:
        """Detailed string representation of the stage"""
        return f"PipelineStage(name='{self.name}', " f"config={self.config})"
