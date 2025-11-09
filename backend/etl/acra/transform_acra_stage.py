import logging
from typing import Any, Dict, List, Optional

from backend.etl.common.pipeline_stage import PipelineStage

logger = logging.getLogger(__name__)


class TransformACRAStage(PipelineStage):
    """Normalize and filter ACRA rows."""

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__("Transform ACRA", config)

    async def process(self, data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not isinstance(data, list):
            return []

        out: List[Dict[str, Any]] = []
        for row in data:
            if not isinstance(row, dict):
                continue

            uen = (row.get("uen") or "").strip()
            entity_name = (row.get("entity_name") or "").strip()
            street_name = (row.get("street_name") or "").strip()
            building_name = (row.get("building_name") or "").strip()
            postal_code = (row.get("postal_code") or "").strip()

            if not (uen and entity_name and postal_code):
                continue

            digits = "".join(ch for ch in str(postal_code) if ch.isdigit())
            if len(digits) == 6:
                postal_code = digits
            elif not digits:
                continue

            out.append(
                {
                    "uen": uen,
                    "amenity_name": entity_name,
                    "street_name": street_name,
                    "building_name": building_name,
                    "postal_code": postal_code,
                }
            )

        logger.info(f"Transformed rows: {len(out)}")
        return out

