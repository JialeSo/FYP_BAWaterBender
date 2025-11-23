# Flood upload — usage

This document explains how to prepare your environment, add a CSV and run the uploader script:
`backend/etl/upload_data/execute_pipeline/flood_update.py`.

Environment variables required:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

Set them in your environment or in a `.env` file (the script uses python-dotenv).

1) Create & activate a virtualenv
```bash
# navigate to backend folder
cd backend

# create venv
python3 -m venv .venv

# activate
source .venv/bin/activate
```

2) Install dependencies
- Install from the project's requirements file (named `requirements.etl.txt` here):
```bash
pip install --upgrade pip setuptools wheel
pip install -r requirements.etl.txt
```

3) CSV to upload
- Place your CSV in:
  backend/etl/upload_data/raw_data/
- Default test filename used by the script:
  `updated_flood_data.csv`

Required columns (and formats)
- event_date — YYYY-MM-DD (e.g. `2025-11-20`)
- location — string
- event — string
- start_lat — float 
- start_lng — float 
- start_postal_code — 6-digit string (e.g. `018958`)

Example CSV header:
```
event_date,location,event,start_lat,start_lng,start_postal_code
```

4) Run the uploader
- From repo root (recommended to set PYTHONPATH so pipeline subprocess imports resolve):
```bash
# ensure backend is on PYTHONPATH (so `import etl.*` works in subprocess)
export PYTHONPATH="$(pwd)/backend${PYTHONPATH:+:$PYTHONPATH}"

# run the uploader
python backend/etl/upload_data/execute_pipeline/flood_update.py
```

What the script does
- Validates every CSV row according to the rules above.
- Skips rows that fail validation (these are reported).
- Calls a Supabase RPC `conditional_upsert_flood_batch` to insert/update rows.
- If the upsert performed any inserts or updates, it will trigger the floods ETL pipeline
  (`backend/etl/floods/run_floods_pipeline.py`) as a subprocess.

Notes / troubleshooting
- If validation reports N valid / M invalid, only the N valid rows are sent for upsert.
- If the floods pipeline receives fewer rows than expected, check:
  - validation output (invalid rows)
  - RPC upsert results printed by the script (inserted/updated/skipped)
  - pipeline filters that may remove unmatched locations (e.g. missing PA/SZ/RN mappings)
- To get more verbose logs from the floods pipeline, set LOG_LEVEL=DEBUG before running the script:
```bash
export LOG_LEVEL=DEBUG
python backend/etl/upload_data/execute_pipeline/flood_update.py
```
