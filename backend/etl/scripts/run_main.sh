#!/usr/bin/env bash
# Minimal orchestrator to run ACRA → Amenities → Floods pipelines
# Usage (manual):
#   bash backend/etl/scripts/run_main.sh
# Cron (Jan/Jul at 03:00):
#   0 3 1 1,7 * /usr/bin/env bash -lc 'cd /path/to/FYP_BAWaterBender && bash backend/etl/scripts/run_main.sh' >> backend/etl/etl_main.log 2>&1

set -euo pipefail

# cd to repo root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}/../../.."
cd "$REPO_ROOT"

# Optional: activate venv if available and not already active
if [ -n "${VENV_PATH:-}" ] && [ -f "$VENV_PATH/bin/activate" ]; then
  # shellcheck disable=SC1090
  source "$VENV_PATH/bin/activate"
fi

echo "==== $(date +'%Y-%m-%d %H:%M:%S') | MAIN ETL START ===="

echo "[1/3] Running ACRA pipeline…"
python backend/etl/acra/run_acra_pipeline.py

echo "[2/3] Running Amenities pipeline…"
python backend/etl/amenities/run_amenities_pipeline.py

echo "[3/3] Running Floods pipeline…"
python backend/etl/floods/run_floods_pipeline.py

echo "==== $(date +'%Y-%m-%d %H:%M:%S') | MAIN ETL DONE ===="

