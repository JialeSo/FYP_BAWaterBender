#!/usr/bin/env python3
"""
Amenities ETL Pipeline Orchestrator
===================================

Provides step-level entry points used by the interactive runners and the
shared pipeline orchestrator in ``backend.etl.common``. Each step delegates to
the modernised modules (fast geocoding, classification, PySAL accessibility,
etc.) and stores outputs under ``backend/etl/data``.
"""

from __future__ import annotations

import argparse
import logging
import shutil
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Sequence

import sys

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.etl.amenities.core.config import Config

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def _ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _default_input(config: Config) -> Path:
    custom = config.paths.raw_amenities_csv
    if custom != config.paths.consolidated_geojson and custom.exists():
        return custom
    return config.paths.consolidated_geojson


# ---------------------------------------------------------------------------
# Step implementations
# ---------------------------------------------------------------------------

def run_step_00_consolidation(config: Config | None = None) -> bool:
    """Consolidate raw amenity sources into a single GeoJSON."""
    cfg = config or Config()
    from backend.etl.amenities.step_00_consolidation.consolidate_clean import (
        consolidate_all,
        save_consolidated,
    )

    logger.info("Step 00: Consolidating raw amenities")

    geojson = consolidate_all()
    target = cfg.paths.consolidated_geojson
    _ensure_parent(target)
    save_consolidated(geojson, target)

    logger.info("Step 00 complete: %s", target)
    return True


def run_step_01_geocoding(config: Config | None = None) -> bool:
    """Geocode consolidated amenities against planning areas and subzones."""
    cfg = config or Config()
    from backend.etl.amenities.step_01_geocoding.geocoder_fast import fast_geocode

    source = _default_input(cfg)
    if not source.exists():
        raise FileNotFoundError(f"Geocoding input not found: {source}")

    logger.info("Step 01: Geocoding amenities from %s", source)
    fast_geocode(
        input_geojson=source,
        output_csv=cfg.paths.amenities_geocoded_csv,
        planning_geojson=cfg.paths.planning_areas_geojson,
        subzone_geojson=cfg.paths.subzones_geojson,
        road_network_geojson=cfg.paths.road_network_geojson,
        postal_codes_csv=cfg.paths.postal_codes_csv,
    )

    logger.info("Step 01 complete: %s", cfg.paths.amenities_geocoded_csv)
    return True


def run_step_02_classification(config: Config | None = None) -> bool:
    """Attach amenity categories, priorities, and importance scores."""
    cfg = config or Config()
    from backend.etl.amenities.step_02_classification import classify_amenities

    input_csv = cfg.paths.amenities_geocoded_csv
    if not input_csv.exists():
        raise FileNotFoundError(f"Classification input not found: {input_csv}")

    logger.info("Step 02: Classifying amenities")
    classify_amenities(
        input_csv=input_csv,
        output_csv=cfg.paths.amenities_with_priority_csv,
    )

    logger.info("Step 02 complete: %s", cfg.paths.amenities_with_priority_csv)
    return True


def run_step_03_network_mapping(config: Config | None = None) -> bool:
    """Match amenities to nearby road segments and create final 3layers output."""
    cfg = config or Config()
    try:
        from backend.etl.amenities.step_03_network_mapping.road_matcher_osmnx import (
            OSMnxRoadMatcherPipeline,
            OSMnxRoadMatcherPaths,
        )
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise ImportError(
            "OSMnx road matching requires the 'osmnx' dependency"
        ) from exc

    # Use the classified amenities file (02_amenities_classified.csv) which has correct amenity_category_id
    input_csv = (
        cfg.paths.amenities_with_priority_csv
        if cfg.paths.amenities_with_priority_csv.exists()
        else cfg.paths.amenities_geocoded_csv
    )

    if not input_csv.exists():
        raise FileNotFoundError(f"Network mapping input not found: {input_csv}")

    logger.info("Step 03: Matching amenities to roads and creating final output")
    matcher_paths = OSMnxRoadMatcherPaths(
        amenities_csv=input_csv,
        road_network_geojson=cfg.paths.road_network_geojson,
        output_csv=cfg.paths.amenities_3layers_csv,  # Changed to final output
    )
    pipeline = OSMnxRoadMatcherPipeline(matcher_paths)
    pipeline.run(output=cfg.paths.amenities_3layers_csv)

    # Write a data copy under backend/etl/data/amenities as well
    try:
        _ensure_parent(cfg.paths.amenities_3layers_data_csv)
        shutil.copy(cfg.paths.amenities_3layers_csv, cfg.paths.amenities_3layers_data_csv)
        logger.info("Step 03 data copy: %s", cfg.paths.amenities_3layers_data_csv)
    except Exception as exc:  # non-fatal; keep primary output
        logger.warning("Could not write data copy: %s", exc)

    logger.info(
        "Step 03 complete: %s", cfg.paths.amenities_3layers_csv
    )
    return True


def run_step_04_accessibility(
    config: Config | None = None,
    *,
    plot: bool = False,
) -> bool:
    """Compute accessibility grids using the PySAL-based service."""
    cfg = config or Config()
    fallback_outputs = [
        cfg.paths.accessibility_planning_csv,
        cfg.paths.accessibility_subzone_csv,
    ]

    try:
        from backend.etl.amenities.step_04_accessibility_analysis.service_pysal import (
            AccessibilityService,
        )
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise ImportError(
            "Accessibility analysis requires geopandas/pysal dependencies"
        ) from exc

    try:
        service = AccessibilityService()
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(f"Unable to initialise AccessibilityService: {exc}") from exc

    logger.info("Step 04: Running PySAL accessibility analysis")
    try:
        results = service.analyze_citywide()
    except Exception as exc:
        raise

    output_dir = cfg.paths.accessibility_output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    if hasattr(service, "export_results"):
        service.export_results(results, output_dir=output_dir)

    # Persist each category grid to GeoJSON/CSV for downstream use.
    for category, result in results.items():
        grid = result.as_geodataframe()
        geojson_path = output_dir / f"accessibility_{category}.geojson"
        csv_path = output_dir / f"accessibility_{category}.csv"
        grid.to_file(geojson_path, driver="GeoJSON")
        grid.drop(columns="geometry").to_csv(csv_path, index=False)

    logger.info("Step 04 complete: results stored in %s", output_dir)
    return True


def run_step_05_fusion(config: Config | None = None) -> bool:
    """Fuse accessibility model outputs into composite indices."""
    cfg = config or Config()
    try:
        from backend.etl.amenities.step_05_accessibility_fusion.fusion import (
            AccessibilityFusionEngine,
            CompositeAccessibilityPaths,
        )
    except ImportError as exc:  # pragma: no cover
        raise ImportError("Step 05 fusion module unavailable") from exc

    logger.info("Step 05: Fusing accessibility scores")

    required = [cfg.paths.accessibility_planning_csv]
    if cfg.paths.accessibility_subzone_csv:
        required.append(cfg.paths.accessibility_subzone_csv)
    missing = [p for p in required if not p.exists()]
    if missing:
        missing_str = ", ".join(str(p) for p in missing)
        raise FileNotFoundError(f"Accessibility score inputs missing: {missing_str}")

    paths = CompositeAccessibilityPaths(
        planning_scores_csv=cfg.paths.accessibility_planning_csv,
        subzone_scores_csv=cfg.paths.accessibility_subzone_csv,
        planning_output_csv=cfg.paths.accessibility_fusion_planning_csv,
        subzone_output_csv=cfg.paths.accessibility_fusion_subzone_csv,
        amenities_input_csv=(
            cfg.paths.amenities_3layers_csv
            if cfg.paths.amenities_3layers_csv.exists()
            else cfg.paths.amenities_with_priority_csv
        ),
        amenities_output_csv=cfg.paths.amenities_enriched_csv,
        amenities_final_csv=cfg.paths.amenities_final_csv,
        classification_csv=cfg.paths.amenities_with_priority_csv,
    )

    engine = AccessibilityFusionEngine()
    _ensure_parent(cfg.paths.amenities_enriched_csv)
    engine.run(paths)

    logger.info("Step 05 complete: %s", cfg.paths.amenities_enriched_csv)
    return True


# ---------------------------------------------------------------------------
# CLI helpers
# ---------------------------------------------------------------------------

STEP_FUNCTIONS: Dict[int, Callable[..., bool]] = {
    0: run_step_00_consolidation,
    1: run_step_01_geocoding,
    2: run_step_02_classification,
    3: run_step_03_network_mapping,
    # Steps 4 and 5 disabled - pipeline ends at step 3 with amenities_3layers.csv
    # 4: run_step_04_accessibility,
    # 5: run_step_05_fusion,
}

OPTIONAL_STEPS = {3}  # Steps 4 and 5 removed
OPTIONAL_SKIP_EXCEPTIONS = (
    ImportError,
    ModuleNotFoundError,
    FileNotFoundError,
    KeyError,
    ValueError,
)


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Execute amenities ETL pipeline stages.",
    )
    parser.add_argument(
        "--steps",
        nargs="+",
        type=int,
        choices=list(STEP_FUNCTIONS.keys()),
        help="Specific steps to execute (default: run all sequentially).",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Shorthand to run all steps sequentially.",
    )
    parser.add_argument(
        "--plot",
        dest="plot",
        action="store_true",
        help="Enable plotting for compatible steps.",
    )
    parser.add_argument(
        "--no-plot",
        dest="plot",
        action="store_false",
        help="Disable plotting (default).",
    )
    parser.set_defaults(plot=False)
    return parser.parse_args(argv)


def execute_steps(
    steps: Iterable[int],
    *,
    plot: bool,
    config: Config | None = None,
) -> Dict[int, str]:
    """Execute the requested steps synchronously, returning status per step."""
    cfg = config or Config()
    status: Dict[int, str] = {}

    for step in steps:
        fn = STEP_FUNCTIONS[step]
        try:
            if step == 4:
                fn(cfg, plot=plot)
            else:
                fn(cfg)
        except OPTIONAL_SKIP_EXCEPTIONS as exc:
            if step in OPTIONAL_STEPS:
                logger.warning("Step %s skipped: %s", step, exc)
                status[step] = f"skipped ({exc})"
                continue
            logger.exception("Step %s failed due to missing dependency", step)
            status[step] = f"failed ({exc})"
            break
        except Exception as exc:
            logger.exception("Step %s failed", step)
            status[step] = f"failed ({exc})"
            break
        else:
            status[step] = "ok"
    return status


def main(argv: Sequence[str] | None = None) -> None:
    args = _parse_args(argv)
    if not args.steps and not args.all:
        selected_steps: List[int] = list(STEP_FUNCTIONS.keys())
    elif args.all:
        selected_steps = list(STEP_FUNCTIONS.keys())
    else:
        selected_steps = sorted(set(args.steps))

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    logger.info("Running steps: %s", ", ".join(map(str, selected_steps)))

    config = Config()
    status = execute_steps(selected_steps, plot=args.plot, config=config)

    print("\nPipeline results:")
    for step in selected_steps:
        state = status.get(step, "not-run")
        print(f"  Step {step}: {state}")


if __name__ == "__main__":  # pragma: no cover
    main()
