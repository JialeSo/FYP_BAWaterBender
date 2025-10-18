from typing import Any, Dict, List, Optional
import logging

from .pipeline_stage import PipelineStage

logger = logging.getLogger(__name__)


class Pipeline:
    """Main pipeline orchestrator for executing multiple stages sequentially

    A pipeline consists of multiple stages that are executed in order,
    with the output of each stage becoming the input of the next stage.
    """

    def __init__(
        self,
        name: str,
        stages: List[PipelineStage],
        config: Optional[Dict[str, Any]] = None,
    ):
        """Initialize a pipeline

        Args:
            name: Human-readable name for this pipeline
            stages: List of pipeline stages to execute in order
            config: Configuration dictionary for the pipeline
        """
        self.name = name
        self.stages = stages
        self.config = config or {}
        self._validate_pipeline()

    def _validate_pipeline(self) -> None:
        """Validate pipeline configuration and stages

        Raises:
            ValueError: If pipeline configuration is invalid
        """
        if not self.stages:
            raise ValueError("Pipeline must have at least one stage")

        # Validate each stage
        for i, stage in enumerate(self.stages):
            if not isinstance(stage, PipelineStage):
                raise ValueError(f"Stage {i} is not a PipelineStage instance")

            # Validate stage configuration
            try:
                stage.validate_config()
            except Exception as e:
                error_msg = f"Stage '{stage.name}' has invalid config: {e}"
                raise ValueError(error_msg)

    async def run(self, initial_data: Any = None) -> Any:
        """Run the complete pipeline

        Executes all stages in sequence, passing the output of each stage
        as input to the next stage.

        Args:
            initial_data: Initial data to pass to the first stage

        Returns:
            Final output from the last stage

        Raises:
            Exception: If any stage fails and error handling is not configured
        """
        stage_count = len(self.stages)
        log_msg = f"Starting pipeline: {self.name} with {stage_count} stages"
        logger.info(log_msg)

        data = initial_data

        try:
            for i, stage in enumerate(self.stages):
                stage_info = f"stage {i+1}/{stage_count}: {stage.name}"
                logger.info(f"Executing {stage_info}")

                try:
                    data = await stage.execute(data)

                except Exception as e:
                    # Check if we should continue on error
                    continue_on_error = self.config.get("continue_on_error", False)
                    if not continue_on_error:
                        error_msg = (
                            f"Pipeline {self.name} stopped at "
                            f"stage {stage.name}: {e}"
                        )
                        logger.error(error_msg)
                        raise
                    else:
                        warn_msg = f"Stage {stage.name} failed but " f"continuing: {e}"
                        logger.warning(warn_msg)

            logger.info(f"Pipeline {self.name} completed successfully")
            return data

        except Exception as e:
            logger.error(f"Pipeline {self.name} failed: {str(e)}")
            raise

    def add_stage(self, stage: PipelineStage, position: Optional[int] = None) -> None:
        """Add a stage to the pipeline

        Args:
            stage: Pipeline stage to add
            position: Position to insert stage (default: append to end)
        """
        if not isinstance(stage, PipelineStage):
            raise ValueError("Stage must be a PipelineStage instance")

        if position is None:
            self.stages.append(stage)
        else:
            self.stages.insert(position, stage)

        logger.info(f"Added stage '{stage.name}' to pipeline '{self.name}'")

    def remove_stage(self, stage_name: str) -> bool:
        """Remove a stage from the pipeline by name

        Args:
            stage_name: Name of the stage to remove

        Returns:
            True if stage was removed, False if not found
        """
        for i, stage in enumerate(self.stages):
            if stage.name == stage_name:
                removed_stage = self.stages.pop(i)
                removed_msg = (
                    f"Removed stage '{removed_stage.name}' "
                    f"from pipeline '{self.name}'"
                )
                logger.info(removed_msg)
                return True

        not_found_msg = f"Stage '{stage_name}' not found " f"in pipeline '{self.name}'"
        logger.warning(not_found_msg)
        return False

    def get_stage(self, stage_name: str) -> Optional[PipelineStage]:
        """Get a stage by name

        Args:
            stage_name: Name of the stage to retrieve

        Returns:
            Pipeline stage if found, None otherwise
        """
        for stage in self.stages:
            if stage.name == stage_name:
                return stage
        return None

    def __str__(self) -> str:
        """String representation of the pipeline"""
        stage_count = len(self.stages)
        return f"Pipeline(name='{self.name}', stages={stage_count})"

    def __repr__(self) -> str:
        """Detailed string representation of the pipeline"""
        return (
            f"Pipeline(name='{self.name}', "
            f"stages={[stage.name for stage in self.stages]}, "
            f"config={self.config})"
        )
