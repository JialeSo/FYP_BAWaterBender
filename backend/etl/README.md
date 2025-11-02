**ETL Overview**
- Centralized ETL for ACRA companies, public amenities, and floods.
- Pipelines use reusable stages from `backend/etl/common` and write to Supabase.
- Data inputs/outputs live under `backend/etl/data` to keep artifacts versioned and visible.

**Prerequisites**
- Python 3.11+
- Virtualenv and project deps installed: `pip install -r backend/requirements.txt`
- Supabase credentials with service role for upserts.
- OneMap credentials for tokened endpoints.
- Optional: Data.gov.sg API key and LocationIQ key for certain fallbacks.

**Environment**
- Required
  - `SUPABASE_URL` — Supabase instance URL
  - `SUPABASE_SERVICE_ROLE_KEY` — Service role key (server-side)
- OneMap (either pair works)
  - `ONE_MAP_USER` and `ONE_MAP_PASS`
  - or `ONEMAP_EMAIL` and `ONEMAP_EMAIL_PASSWORD`
- Optional
  - `DATA_GOV_API_KEY` — Boosts reliability for ACRA fetch
  - `LOCATIONIQ_KEY` — Optional ACRA postal geocode fallback
  - `AMENITIES_RAW_ONLY` — `1/true` to stop after geocode for amenities
  - `SKIP_FETCH` — `1/true` to load ACRA from CSV instead of fetching
  - `ACRA_CSV_PATH` — Path to pre-downloaded ACRA CSV when `SKIP_FETCH` is set

**One‑Time Setup (Step‑by‑Step)**
1) Create and activate a virtualenv
   - `python3 -m venv .venv && source .venv/bin/activate`
2) Install backend deps
   - `pip install -r backend/requirements.txt`
3) Configure environment
   - Copy `.env.example` (at repo root or backend) → `.env` and fill:
     - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
     - `ONE_MAP_USER`, `ONE_MAP_PASS` (or `ONEMAP_EMAIL`, `ONEMAP_EMAIL_PASSWORD`)
     - Optional: `DATA_GOV_API_KEY`, `LOCATIONIQ_KEY`
   - Ensure your shell session loads `.env` (e.g., `export $(cat .env | xargs)` locally or use dotenv in scripts)
4) Verify Supabase access
   - Run a small select from any table via a python shell importing `backend/common/db.py` or trigger any ETL write stage in dry‑run lab.
5) Verify OneMap token
   - `python backend/etl/onemap/onemap_extended.py` (main prints token payload; should succeed)

**Prepare Reference Data (Step‑by‑Step)**
1) Planning/Subzone GeoJSON
   - Place files under `backend/etl/data/geojson/`:
     - `planning_area.geojson`
     - `subzone_area.geojson`
   - If missing, pipelines fall back to `frontend/public/map/{planning_area,subzone_area}.geojson`.
2) Road Network
   - Ensure `backend/etl/data/roadnetwork/road_network_final.geojson` exists (used by amenities and floods road matching).
   - To upload/refresh road network in DB or storage, consult `backend/etl/data/scripts/road_network_geojson_upload.py` (manual helper).
3) Postal Codes Lookup
   - Ensure `backend/etl/data/onemap/onemap_postal_codes.csv` exists and is recent; ACRA and amenities geocoding use it for instant matches.
4) Floods Source CSV
   - Place your canonical floods CSV at `backend/etl/data/floods/PUB_and_huiying_flood.csv` (default path used by pipeline).

**Data Layout**
- `backend/etl/data/`
  - `amenities/` — intermediate and final amenities CSVs
  - `floods/` — source floods CSV(s)
  - `geojson/` — planning_area and subzone reference layers
  - `geojson_layers/` — other GIS layers used by scripts
  - `onemap/` — `onemap_postal_codes.csv` lookup
  - `roadnetwork/` — `road_network_final.geojson` for road matching
  - top-level outputs commonly referenced by pipelines:
    - `amenities_consolidated.geojson`
    - `amenities_3layers.csv`
    - `floods_3layers.csv`

**Common Module**
- Files
  - `backend/etl/common/pipeline.py` — Orchestrates sequential stages with logging and error handling.
  - `backend/etl/common/pipeline_stage.py` — Base class; stages implement `process()`.
  - `backend/etl/common/database_write_stage.py` — Batched insert/upsert with retries/backoff and basic JSON-safe sanitization; can drop columns via config.
- Database connection
  - `backend/common/db.py` uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to create a Supabase client.
- Usage
  - Pipelines assemble `PipelineStage` instances and call `Pipeline.run()`; each stage receives previous output and returns next input.

**How Pipelines Run (Generic Step‑by‑Step)**
1) Stage validates config and inputs
2) Stage processes data and returns structured output
3) Next stage consumes output; sequence continues
4) Final stage writes to Supabase using batched insert/upsert with retries
5) Any unhandled exception stops the pipeline (default stop‑on‑error)

**ACRA Pipeline**
- Code
  - `backend/etl/acra/pipeline.py`
  - Entrypoint: `backend/etl/acra/run_acra_pipeline.py`
- Purpose
  - Monthly pipeline to fetch ACRA business datasets, normalize, geocode via OneMap, validate completeness, and upsert into `acra_companies`.
- Stages
  - `FetchACRAStage` — Downloads curated datasets from data.gov.sg open-download API, filters by allowed statuses, selects target columns.
  - `TransformACRAStage` — Normalizes fields, enforces 6-digit postals, maps `entity_name` to `amenity_name` for schema alignment.
  - `GeocodePostalOneMapStage` — Uses `data/onemap/onemap_postal_codes.csv` first, then OneMap search API; writes lat/lon back to `data/acra/acra_all.csv`.
  - `CheckGeocodeCompletenessStage` — Fails if missing lat/lon exceeds threshold (default 10,000).
  - `DatabaseWriteStage` — Upserts to `acra_companies` using `uen` conflict target.
- Inputs
  - Data.gov.sg datasets (IDs in `DEFAULT_ACRA_DATASET_IDS`)
  - Postal lookup: `backend/etl/data/onemap/onemap_postal_codes.csv`
  - Optional: `LOCATIONIQ_KEY` used only in older code paths; primary geocode is OneMap.
- Outputs
  - `backend/etl/acra/data/acra_all.csv` — consolidated and then geocoded ACRA records
  - Database table: `acra_companies`
- Step‑by‑Step Run
  1) Ensure OneMap env vars and postal CSV are present
  2) Optional: set `DATA_GOV_API_KEY` (improves dataset fetch reliability)
  3) Default full run:
     - `python backend/etl/acra/run_acra_pipeline.py`
  4) If you already have a consolidated CSV (faster iteration):
     - `SKIP_FETCH=1 ACRA_CSV_PATH=backend/etl/acra/data/acra_all.csv python backend/etl/acra/run_acra_pipeline.py`
  5) Verify results:
     - File: open `backend/etl/acra/data/acra_all.csv` and confirm `latitude,longitude` populated
     - DB: check `acra_companies` row count increases and spot‑check a few `uen`
  
  Step‑by‑Step Details
  - Step 1: Consolidation (27 datasets A–Z + Others)
    - Data.gov.sg open‑download API used programmatically (initiate → poll‑download) for curated dataset IDs in code.
    - Example of a simple DataStore search (for manual testing):
      - `python`
      - `import requests; dataset_id = "d_9af9317c646a1c881bb5591c91817cc6"`
      - `url = "https://data.gov.sg/api/action/datastore_search?resource_id=" + dataset_id`
      - `print(requests.get(url).json())`
  - Step 2: Geocoding
    - From `postal_code`, append `latitude/longitude` via lookup against `data/onemap/onemap_postal_codes.csv` (comprehensive postal → lat/lng table sourced from OneMap Search API).
    - If no match in lookup, call OneMap Search API live to fill coordinates (https://www.onemap.gov.sg/apidocs/search); geocoded values are written back to the consolidated CSV.
    - Recommended: append new postal matches into the lookup CSV to reduce future API calls.
  - Step 3: Upload to Supabase
    - Normalize string fields to lowercase where appropriate.
    - Final table columns:
      - `uen`
      - `amenity_name`
      - `street_name`
      - `building_name`
      - `postal_code`
      - `latitude`
      - `longitude`
      - `updated_at` (if present in schema)
- Maintenance Tips
  - If OneMap geocoding return rates drop, confirm env creds and `onemap_postal_codes.csv` freshness.
  - Update dataset IDs if data.gov.sg rotates them; list is near the top of `acra/pipeline.py`.
  - Large writes: tune `batch_size` in `DatabaseWriteStage` if HTTP2 resets observed.

**Amenities Pipeline**
- Code
  - `backend/etl/amenities/amenities_pipeline.py`
  - Entrypoint: `backend/etl/amenities/run_amenities_pipeline.py`
- Purpose
  - Build a unified amenities dataset, geocode to Planning Areas/Subzones, classify categories and priorities, and match to road network; upsert to `amenity_3layers`.
- Stages
  - `FetchAndConsolidateStage` — Loads GeoJSON files from `data/geojson/`, OSM-OneMap matched JSON (if provided), and optional OneMap Themes; outputs `amenities_consolidated.geojson`.
  - `AmenitiesThreeLayersStage` —
    - Geocode: matches each amenity to PA/SZ using planning/subzone GeoJSONs and postal/road refs.
    - Classification: `classify_amenities` assigns categories, groups, and priority scores; persists `data/amenities/amenities_raw.csv`.
    - Road matching: `match_roads` maps to `road_network_final.geojson` and writes `amenities_3layers.csv`.
  - `DatabaseWriteStage` — Upserts to `amenity_3layers`; drops `amenity_group_id` and `amenity_group` by default for backward compatibility.
- Inputs
  - `backend/etl/data/amenities/osm_onemap_matched.json` (optional)
  - `backend/etl/data/geojson/planning_area.geojson`
  - `backend/etl/data/geojson/subzone_area.geojson`
  - `backend/etl/data/roadnetwork/road_network_final.geojson`
  - `backend/etl/data/onemap/onemap_postal_codes.csv`
  - Fallbacks: will use `frontend/public/map/{planning_area,subzone_area}.geojson` if backend copies missing.
- Outputs
  - `backend/etl/data/amenities/amenities_raw.csv` — post-classification
  - `backend/etl/data/amenities_consolidated.geojson` — consolidated source
  - `backend/etl/data/amenities_3layers.csv` — final output
  - Database table: `amenity_3layers`
- Step‑by‑Step Run
  1) Place/confirm reference files under `backend/etl/data/` (planning, subzone, road network, postal codes)
  2) Consolidate + 3‑layers + DB in one command:
     - `python backend/etl/amenities/run_amenities_pipeline.py`
  3) Raw‑only (geocode only, for diagnostics or interim export):
     - `AMENITIES_RAW_ONLY=1 python backend/etl/amenities/run_amenities_pipeline.py`
  4) Verify results:
     - Files: `amenities_consolidated.geojson`, `data/amenities/amenities_raw.csv`, `amenities_3layers.csv`
     - DB: table `amenity_3layers` row count and key columns `pa_id, sz_id, rn_id`
  
  Step‑by‑Step Details
  - Step 1: Consolidation & Geocoding
    - Sources
      - Humanitarian Data Exchange (curated GeoJSONs where applicable)
      - OneMap Themes (150+ themes; filtered): https://www.onemap.gov.sg/apidocs/themes
    - Token refresh
      - OneMap token via `backend/etl/onemap/onemap_extended.py` using OneMap env vars.
    - Theme selection
      - Fetch all themes, compare to static exclusion lists, download the rest.
      - Exclusions defined in code: see `backend/etl/amenities/consolidate.py` (`EXCLUDED_THEME_NAMES`, `EXCLUDED_QUERYNAMES`).
      - Helper: `backend/etl/onemap/scripts/generate_themes_allowlist.py` to print computed allowlist/exclusions.
    - Geocoding
      - Planning/Subzone join against `planning_area.geojson` and `subzone_area.geojson`.
      - Cleansing
        - Entries with only postal code → forward geocode via OneMap Search API to get LAT/LNG
        - Entries with only LAT/LNG → reverse geocode to populate postal, then join PA/SZ
  - Step 2: Classification
    - Category groups and example priority scores:
      - 03 Emergency & Public Safety → 1.0, 10.0, 110.0
      - 04 Healthcare & Essential Utilities → 2.0, 8.0, 80.0
      - 05 Residential & Community → 3.0, 6.0, 54.0
      - 02 Education & Mobility → 4.0, 5.0, 40.0
      - 01 Commerce & Leisure → 5.0, 3.0, 21.0
    - Implemented in `backend/etl/amenities/classify.py`; output persisted to `data/amenities/amenities_raw.csv`.
  - Step 3: Road Matching (OSM)
    - Base network: `backend/etl/data/roadnetwork/road_network_final.geojson`.
    - Matching uses nearest‑edge snapping with osmnx/geometry helpers in `backend/etl/amenities/match_roads.py`.
    - Current scale reference: ~42,017 amenities matched.
  - Step 4: Upload to Supabase
    - Writes `amenities_3layers.csv` to DB via `DatabaseWriteStage` (upsert on `id`).
- Maintenance Tips
  - Keep `road_network_final.geojson` updated if the road network schema changes; matching depends on RN geometry and ID fields.
  - If planning/subzone boundaries update, refresh the two reference GeoJSONs and rerun.
  - Classification rules live in `backend/etl/amenities/classify.py` and consolidation logic in `backend/etl/amenities/consolidate.py`.

**Floods Pipeline**
- Code
  - `backend/etl/floods/floods_pipeline.py`
  - Entrypoint: `backend/etl/floods/run_floods_pipeline.py`
- Purpose
  - Load flood events from CSV and match each to Planning Areas/Subzones and the road network; upsert to `flood_3layers` with schema-safe sanitization.
- Stages
  - `LoadFloodsStage` — Reads source-of-truth CSV, default: `data/floods/PUB_and_huiying_flood.csv`.
  - `ProcessFloodsThreeLayersStage` — Wraps `scripts/process_floods_3layers.py` to compute start/end PA/SZ/RN IDs and writes `floods_3layers.csv`.
  - `SanitizeFloodsForDBStage` — Drops unsupported columns, coerces types, builds `geom` from available coordinates when missing, ensures JSON-safe values.
  - `FloodsUpsertStage` — Upserts into the configured table on conflict `id`.
- Inputs
  - `backend/etl/data/floods/PUB_and_huiying_flood.csv`
  - `backend/etl/data/geojson/planning_area.geojson`
  - `backend/etl/data/geojson/subzone_area.geojson`
  - `backend/etl/data/roadnetwork/road_network_final.geojson`
 - Step‑by‑Step Details
  - Step 1: Load datasets
    - Combine sponsor datasets (historical floods) with PUB alerts into the canonical CSV used by the pipeline. In current merged file, IDs 1–213 represent historical entries.
  - Step 2: 3‑Layers processing
    - For each event’s start/end (or origin) coordinates, compute `*_pa_id`, `*_sz_id`, `*_rn_id` via spatial joins and nearest road snapping.
  - Step 3: Sanitize + Upsert
    - Coerce IDs to ints, floats to finite values, build `geom` when missing, then upsert in batches with conflict target `id`.
- Outputs
  - `backend/etl/data/floods_3layers.csv`
  - Database table: `flood_3layers`
- Step‑by‑Step Run
  1) Ensure source CSV at `backend/etl/data/floods/PUB_and_huiying_flood.csv`
  2) Ensure planning/subzone and road network reference files exist
  3) Run pipeline:
     - `python backend/etl/floods/run_floods_pipeline.py`
  4) Verify results:
     - File: `backend/etl/data/floods_3layers.csv`
     - DB: table `flood_3layers` updated with start_* and end_* IDs
- Maintenance Tips
  - Validate required columns exist in the floods CSV (`id,start_lat,start_lng` minimum).
  - Geospatial matches are sensitive to the quality of coordinates and boundary layers.

**Running Pipelines**
- Activate your env and set variables, e.g.:
  - `source venv/bin/activate`
  - `export SUPABASE_URL=...`
  - `export SUPABASE_SERVICE_ROLE_KEY=...`
  - `export ONE_MAP_USER=... && export ONE_MAP_PASS=...`
- Then run one of:
  - ACRA: `python backend/etl/acra/run_acra_pipeline.py`
  - Amenities: `python backend/etl/amenities/run_amenities_pipeline.py`
  - Floods: `python backend/etl/floods/run_floods_pipeline.py`

**Verification (Step‑by‑Step)**
1) Files produced
   - ACRA: `acra/acra_all.csv` contains `latitude,longitude`
   - Amenities: `amenities_consolidated.geojson`, `amenities/amenities_raw.csv`, `amenities_3layers.csv`
   - Floods: `floods_3layers.csv`
2) Database checks (Supabase)
   - ACRA: select a few rows by known `uen`
   - Amenities: ensure `pa_id, sz_id, rn_id` not null for majority of rows
   - Floods: spot‑check `geom` exists or start_lat/lng populated; confirm upsert on `id`
3) Spot QA
   - Pick a sample postal code and verify coordinates via OneMap UI
   - Randomly open a few RN_ID edges in the road network geojson and confirm matched amenities nearby

**Operational Notes**
- Batching and retries
  - `DatabaseWriteStage` batches writes (default ~300) and retries with exponential backoff; tune `batch_size` via stage config when building pipelines, or adjust in code if needed.
- Error handling
  - Pipelines default to stop-on-error for data integrity; set `continue_on_error` when constructing pipeline configs only if partial results are acceptable.
- Logging
  - All stages log at INFO; errors emit stack traces. Run scripts configure sensible logging formats.

**Troubleshooting**
- OneMap 401 / token issues
  - Re‑export `ONE_MAP_USER`/`ONE_MAP_PASS` (or `ONEMAP_EMAIL`/`ONEMAP_EMAIL_PASSWORD`) and re‑run `onemap_extended.py`
  - Network restrictions can block token fetch; test via a browser call to the token endpoint if needed
- HTTP2 resets/timeouts on DB writes
  - Reduce `batch_size` in `DatabaseWriteStage` when building the pipeline (e.g., 100–200)
- ACRA fetch returns 0 rows
  - Data.gov.sg initiated but no poll URL returned; try again or provide `DATA_GOV_API_KEY`
  - Check status filter — allowed statuses are defined in `acra/pipeline.py`
- Many ACRA rows missing lat/lon
  - Update `data/onemap/onemap_postal_codes.csv` and ensure 6‑digit postals after `TransformACRAStage`
- Amenities classification keys missing
  - Inspect `backend/etl/amenities/classify.py`; re‑run pipeline after rule updates
- Floods missing required columns
  - Ensure the CSV includes at least `id,start_lat,start_lng`; clean inconsistent column headers

**Where To Change What**
- Geocoding policies: `backend/etl/acra/geocode_postal_onemap_stage.py` and `backend/etl/amenities/geocode.py`.
- Classification rules: `backend/etl/amenities/classify.py`.
- Road matching logic: `backend/etl/amenities/match_roads.py` and floods `backend/etl/floods/scripts/process_floods_3layers.py`.
- Database schema mapping/sanitization: `backend/etl/common/database_write_stage.py` and floods’ `SanitizeFloodsForDBStage`.

**Scheduling**
- ACRA is monthly; amenities and floods as data updates. Use your scheduler of choice (cron, GitHub Actions, etc.) to call the entrypoint scripts.

Example cron (server time)
- ACRA (1st of month, 02:00): `0 2 1 * * /usr/bin/python /app/backend/etl/acra/run_acra_pipeline.py >> /var/log/acra.log 2>&1`
- Amenities (weekly, Sun 03:00): `0 3 * * 0 /usr/bin/python /app/backend/etl/amenities/run_amenities_pipeline.py >> /var/log/amenities.log 2>&1`
- Floods (daily, 04:00): `0 4 * * * /usr/bin/python /app/backend/etl/floods/run_floods_pipeline.py >> /var/log/floods.log 2>&1`

**Support Artifacts**
- Road network GeoJSON lives at `backend/etl/data/roadnetwork/road_network_final.geojson`.
- Planning/Subzone layers at `backend/etl/data/geojson/` (pipelines fall back to `frontend/public/map` if not present).
- Postal code lookup at `backend/etl/data/onemap/onemap_postal_codes.csv`.

**Validation Checklist**
- OneMap token retrieval works: try `backend/etl/onemap/onemap_extended.py` (main section) locally to verify.
- Supabase upsert succeeds: confirm `SUPABASE_SERVICE_ROLE_KEY` has table access.
- Reference layers exist: planning, subzone, road network are present and readable.
 - Final CSVs produced where expected; DB tables populated and upserted.
