#!/usr/bin/env python3
"""
Targeted Stage Runner for the Amenities ETL Pipeline
====================================================

Utility script to execute individual pipeline stages without running the
full end-to-end process. Helpful for debugging specific steps such as the
PySAL-based accessibility analysis (Step 04).

Usage
-----
    # Run only Step 04 (accessibility), skipping plots
    python pipeline_stage.py 4 --no-plot

    # Force re-run of Step 02 with plotting enabled
    python pipeline_stage.py 2 --plot

    # Execute multiple stages sequentially
    python pipeline_stage.py 1 2 3
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Callable, Dict, List

# Ensure local modules are importable regardless of invocation directory
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(SCRIPT_DIR.parent.parent))

from core.config import Config  # noqa: E402
from pipeline import (  # noqa: E402
    run_step_00_consolidation,
    run_step_01_geocoding,
    run_step_02_classification,
    run_step_03_network_mapping,
    run_step_04_accessibility,
)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run specific stage(s) of the amenities ETL pipeline.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "stages",
        nargs="+",
        type=int,
        choices=[0, 1, 2, 3, 4],
        help="Pipeline stage numbers to execute (e.g. 4, or 1 2 3).",
    )
    parser.add_argument(
        "--plot",
        dest="plot",
        action="store_true",
        help="Enable stage-specific plotting when available.",
    )
    parser.add_argument(
        "--no-plot",
        dest="plot",
        action="store_false",
        help="Disable plotting (useful for headless environments).",
    )
    parser.add_argument(
        "--input",
        type=Path,
        help="Optional override for the consolidated amenities CSV path.",
    )
    parser.set_defaults(plot=False)
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()

    stages: List[int] = sorted(set(args.stages))
    print("\n" + "=" * 72)
    print("AMENITIES PIPELINE – TARGETED STAGE RUNNER")
    print("=" * 72 + "\n")
    print(f"Stages requested: {', '.join(f'Step {stage}' for stage in stages)}")
    print(f"Plotting enabled: {args.plot}")

    config = Config()
    if args.input:
        print(f"\n⚠ Custom input path supplied: {args.input}")
        if not args.input.exists():
            parser.error(f"Specified input path does not exist: {args.input}")
        config.paths.raw_amenities_csv = args.input

    step_handlers: Dict[int, Callable[[Config], bool]] = {
        0: run_step_00_consolidation,
        1: run_step_01_geocoding,
        2: run_step_02_classification,
        3: run_step_03_network_mapping,
        4: lambda cfg: run_step_04_accessibility(cfg, plot=args.plot),
    }

    for stage in stages:
        print("\n" + "-" * 72)
        print(f"Executing Step {stage}...")
        print("-" * 72 + "\n")

        success = step_handlers[stage](config)
        if not success:
            print(f"\n✗ Stage {stage} failed – aborting remaining stages.")
            sys.exit(1)

    print("\n" + "=" * 72)
    print("SELECTED STAGES COMPLETED SUCCESSFULLY")
    print("=" * 72 + "\n")


if __name__ == "__main__":
    main()
