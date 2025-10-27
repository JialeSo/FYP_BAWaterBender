"""ETL Common Module

This module provides the core pipeline framework for building modular
ETL pipelines.

Classes:
    PipelineStage: Abstract base class for individual pipeline stages
    Pipeline: Main orchestrator for executing multiple stages sequentially
"""

from .pipeline_stage import PipelineStage
from .pipeline import Pipeline
from .database_write_stage import DatabaseWriteStage

__all__ = [
    "PipelineStage",
    "Pipeline",
    "DatabaseWriteStage",
]
