import logging
from typing import Any, Dict, List

from backend.etl.common.pipeline_stage import PipelineStage

logger = logging.getLogger(__name__)


class CheckGeocodeCompletenessStage(PipelineStage):
    """Abort if too many rows missing latitude/longitude pairs."""

    def __init__(self, max_missing_pairs: int = 10_000):
        super().__init__("Validate Geocode Completeness")
        self.max_missing_pairs = max_missing_pairs

    async def process(self, data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not isinstance(data, list) or not data:
            return data

        total = len(data)
        missing = sum(1 for r in data if r.get("latitude") is None or r.get("longitude") is None)
        logger.info("=" * 80)
        logger.info(
            f"Geocode completeness check: total={total:,}, complete={(total - missing):,}, missing={missing:,}"
        )
        logger.info(
            f"Threshold (max missing allowed before upload): {self.max_missing_pairs:,}"
        )
        logger.info("=" * 80)
        if missing > self.max_missing_pairs:
            raise RuntimeError(
                f"Abort upload: Missing lat/lon pairs {missing:,} exceeds threshold {self.max_missing_pairs:,}"
            )
        return data

