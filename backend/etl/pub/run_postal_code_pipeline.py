#!/usr/bin/env python3
"""
Pipeline runner for PUB weather alert processing with postal code mapping.

This script demonstrates how to use the PostalCodeMappingStage as part of a
data processing pipeline. It includes data loading, processing, and saving.
"""

import asyncio
import pandas as pd
from pathlib import Path
from typing import Optional, Dict, Any
import logging

from ..common.pipeline import Pipeline
from ..common.pipeline_stage import PipelineStage
from .postal_code_mapping_stage import PostalCodeMappingStage

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class DataLoadingStage(PipelineStage):
    """Stage for loading CSV data."""

    def __init__(self, input_file: str, config: Optional[Dict[str, Any]] = None):
        super().__init__("Data Loading", config)
        self.input_file = Path(input_file)

    def validate_config(self) -> bool:
        if not self.input_file.exists():
            raise FileNotFoundError(f"Input file not found: {self.input_file}")
        return True

    async def process(self, data: Any) -> pd.DataFrame:
        """Load CSV data and perform basic cleaning."""
        logger.info(f"Loading data from {self.input_file}")

        # Load data with proper dtype handling
        df = pd.read_csv(
            self.input_file, dtype={"start_postal_code": str, "end_postal_code": str}
        )

        # Basic data cleaning
        df = df.dropna(subset=["location"])
        df = df[df["location"].astype(str).str.strip() != ""]

        logger.info(f"Loaded {len(df)} records")
        return df


class DataSavingStage(PipelineStage):
    """Stage for saving processed data."""

    def __init__(self, output_file: str, config: Optional[Dict[str, Any]] = None):
        super().__init__("Data Saving", config)
        self.output_file = Path(output_file)

    async def process(self, data: pd.DataFrame) -> pd.DataFrame:
        """Save processed data to CSV."""
        logger.info(f"Saving data to {self.output_file}")

        # Ensure output directory exists
        self.output_file.parent.mkdir(parents=True, exist_ok=True)

        # Save data
        data.to_csv(self.output_file, index=False)

        logger.info(f"Saved {len(data)} records")
        return data


class PostalCodePipeline:
    """Main pipeline orchestrator for postal code mapping."""

    def __init__(
        self, input_file: str, output_file: str, config: Optional[Dict[str, Any]] = None
    ):
        """Initialize the pipeline.

        Args:
            input_file: Path to input CSV file with weather alerts
            output_file: Path to output CSV file for processed data
            config: Configuration for the postal code mapping stage
        """
        self.input_file = input_file
        self.output_file = output_file
        self.config = config or {}

        # Create pipeline stages
        self.stages = [
            DataLoadingStage(input_file),
            PostalCodeMappingStage(self.config),
            DataSavingStage(output_file),
        ]

        # Create pipeline
        self.pipeline = Pipeline(
            name="PUB Weather Alert Postal Code Mapping",
            stages=self.stages,
            config=self.config,
        )

    async def run(self) -> pd.DataFrame:
        """Run the complete pipeline."""
        logger.info("Starting postal code mapping pipeline")

        try:
            # Run pipeline with initial empty data (loading stage ignores this)
            result = await self.pipeline.execute(None)

            logger.info("Pipeline completed successfully")
            return result

        except Exception as e:
            logger.error(f"Pipeline failed: {e}")
            raise


async def main():
    """Main entry point for the pipeline."""
    # Configuration
    BASE_DIR = Path(__file__).resolve().parent

    # File paths
    input_file = BASE_DIR / "PUB_weather_alerts.csv"
    output_file = BASE_DIR / "PUB_weather_alerts_clean.csv"

    # Pipeline configuration
    config = {
        "locationiq_key": None,  # Will use environment variable
        "cache_dir": str(BASE_DIR),
        "sleep_between_requests": 1.0,
        "max_reverse_attempts": 6,
        "jitter_radius_meters": 500,
    }

    # Create and run pipeline
    pipeline = PostalCodePipeline(
        input_file=str(input_file), output_file=str(output_file), config=config
    )

    try:
        result = await pipeline.run()

        # Print summary statistics
        print(f"\nPipeline Results:")
        print(f"Total records processed: {len(result)}")
        print(f"Records with start coordinates: {result['start_lat'].notna().sum()}")
        print(f"Records with end coordinates: {result['end_lat'].notna().sum()}")
        print(
            f"Records with start postal codes: {result['start_postal_code'].notna().sum()}"
        )
        print(
            f"Records with end postal codes: {result['end_postal_code'].notna().sum()}"
        )

    except Exception as e:
        logger.error(f"Pipeline execution failed: {e}")
        return 1

    return 0


if __name__ == "__main__":
    """Run the pipeline when executed directly."""
    exit_code = asyncio.run(main())
    exit(exit_code)
