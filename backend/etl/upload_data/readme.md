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

## What the script does
- Validates every CSV row according to the defined validation rules.
- Skips rows that fail validation (these are reported).
- Calls a Supabase RPC `conditional_upsert_flood_batch` to insert/update rows.
- If the upsert performed any inserts or updates, it will trigger the floods ETL pipeline
  (`backend/etl/floods/run_floods_pipeline.py`) as a subprocess.

## Validation Rules
- **Required columns**: event_date, location, event, start_lat, start_lng, start_postal_code
- **Validation rules**:
  - `event_date`: Must be in YYYY-MM-DD format (e.g., "2024-01-15")
  - `location`: String, no constraints
  - `event`: String, no constraints
  - `start_lat`: Must be a valid float (e.g., 1.3521)
  - `start_lng`: Must be a valid float (e.g., 103.8198)
  - `start_postal_code`: Must be exactly 6 digits (e.g., "018956")

## Script Flow
1. **Validation**: Reads CSV and validates all rows
   - Valid rows are collected for upsert
   - Invalid rows are skipped and reported
2. **Upsert**: Calls RPC function to conditionally insert/update valid rows
   - Returns action taken for each row: "inserted", "updated", or "skipped"
3. **ETL Trigger**: If any rows were inserted or updated, triggers the floods ETL pipeline
   - Pipeline processes the new data and updates related tables
   - Only runs if changes were made to the database

## Notes / Troubleshooting

### If validation reports N valid / M invalid
- Only the N valid rows are sent for upsert
- Invalid rows are printed to the terminal with specific error messages
- Example: `Row 5 has 2 error(s): {'event_date': 'event_date must be YYYY-MM-DD', 'start_postal_code': 'Postal code must be a 6-digit string'}`
- Fix invalid rows in the CSV and re-run the script

### If the floods pipeline receives fewer rows than expected
Check:
1. **Validation output** - How many rows were marked invalid?
2. **RPC upsert results** - Check the printed output:
```
   ✅ Upsert done — inserted: 5, skipped: 3, rows_with_unknown_result: 0
```
3. **Pipeline filters** - The floods ETL may remove rows that don't match locations:
   - Missing Planning Area (PA) mappings
   - Missing Subzone (SZ) mappings  
   - Missing Region (RN) mappings
4. **Duplicate detection** - The RPC may skip rows if they already exist with identical data

### Common Validation Errors

**Date format errors:**
```
'event_date': 'event_date must be YYYY-MM-DD'
```
Fix: Ensure dates are formatted as `2024-01-15`, not `15/01/2024` or `Jan 15, 2024`

**Postal code errors:**
```
'start_postal_code': 'Postal code must be a 6-digit string'
```
Fix: Ensure postal codes are exactly 6 digits (e.g., `018956`, not `18956` or `18956.0`)

**Coordinate errors:**
```
'start_lat': 'Latitude/Longitude must be a valid float'
```
Fix: Ensure coordinates are numeric (e.g., `1.3521`, not `1.3521°N` or empty)

### Required Supabase RPC Function
The script requires the `conditional_upsert_flood_batch` RPC function to be set up in Supabase. This function:
- Takes an array of flood event objects
- Checks if each event already exists (based on event_date, location, start_postal_code)
- Returns "inserted", "updated", or "skipped" for each row

```sql
CREATE OR REPLACE FUNCTION conditional_upsert_flood_batch(rows jsonb)
RETURNS TABLE(result jsonb) AS $$
DECLARE
  r jsonb;
  v_id INTEGER;  -- Changed from uuid to INTEGER
  v_xmax bigint;
  v_action text;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(rows) LOOP
    -- reset
    v_id := NULL;
    v_xmax := NULL;
    v_action := NULL;

    -- Attempt INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING id, xmax
    INSERT INTO flood_historical_sg (
      event_date,
      location,
      event,
      start_lat,
      start_lng,
      start_postal_code
    )
    VALUES (
      (r ->> 'event_date')::date,
      r ->> 'location',
      r ->> 'event',
      (r ->> 'start_lat')::double precision,
      (r ->> 'start_lng')::double precision,
      r ->> 'start_postal_code'
    )
    ON CONFLICT (
      event_date,
      location,
      event,
      start_lat,
      start_lng,
      start_postal_code
    ) DO UPDATE
    SET
      event_date = EXCLUDED.event_date,
      location = EXCLUDED.location,
      event = EXCLUDED.event,
      start_lat = EXCLUDED.start_lat,
      start_lng = EXCLUDED.start_lng,
      start_postal_code = EXCLUDED.start_postal_code
    WHERE
      EXCLUDED.event_date IS DISTINCT FROM flood_historical_sg.event_date OR
      EXCLUDED.location IS DISTINCT FROM flood_historical_sg.location OR
      EXCLUDED.event IS DISTINCT FROM flood_historical_sg.event OR
      EXCLUDED.start_lat IS DISTINCT FROM flood_historical_sg.start_lat OR
      EXCLUDED.start_lng IS DISTINCT FROM flood_historical_sg.start_lng OR
      EXCLUDED.start_postal_code IS DISTINCT FROM flood_historical_sg.start_postal_code
    RETURNING id, xmax
    INTO v_id, v_xmax;

    IF v_id IS NOT NULL THEN
      -- If a row was returned: inserted OR updated
      IF v_xmax = 0 THEN
        v_action := 'inserted';
      ELSE
        v_action := 'updated';
      END IF;
    ELSE
      -- No INSERT/UPDATE happened because the WHERE prevented update => identical row => skipped
      SELECT id INTO v_id
      FROM flood_historical_sg
      WHERE
        event_date = (r ->> 'event_date')::date AND
        location = r ->> 'location' AND
        event = r ->> 'event' AND
        start_lat = (r ->> 'start_lat')::double precision AND
        start_lng = (r ->> 'start_lng')::double precision AND
        start_postal_code = r ->> 'start_postal_code'
      LIMIT 1;

      v_action := 'skipped';
    END IF;

    result := jsonb_build_object(
      'input', r,
      'action', v_action,
      'id', v_id
    );

    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
```
### Running the script
```bash
# Basic run
python backend/etl/upload_data/execute_pipeline/flood_update.py

# With debug logging (more verbose pipeline output)
export LOG_LEVEL=DEBUG
python backend/etl/upload_data/execute_pipeline/flood_update.py
```

### CSV Path Configuration
The script expects the CSV at:
```
backend/etl/upload_data/raw_data/updated_flood_data.csv
```

If your CSV is in a different location, update the `CSV_PATH` variable in the script.

### Understanding Upsert Results

**inserted**: New flood event added to database  
**updated**: Existing flood event was modified  
**skipped**: Event already exists with identical data (no changes needed)  
**rows_with_unknown_result**: Unexpected response from RPC (check logs)

Example output:
```
✅ Upsert done — inserted: 12, skipped: 3, rows_with_unknown_result: 0
ℹ️ Triggering floods ETL pipeline...
✅ Floods ETL pipeline finished
```

### ETL Pipeline Behavior
- **Triggered**: Only when inserts or updates occur (changes made to database)
- **Not triggered**: When all rows are skipped (no database changes)
- **Purpose**: Processes new flood data and updates:
  - Location mappings (PA/SZ/RN)
  - Aggregated statistics
  - Related flood analysis tables

### Performance Notes
- Validation processes one row at a time (memory efficient)
- Upsert uses batch RPC call (all valid rows sent together)
- Large CSVs (1000+ rows) should complete in under a minute
- ETL pipeline may take several minutes depending on data volume

### Debugging Tips

**Script fails immediately:**
- Check CSV file path exists
- Verify environment variables are set
- Ensure Supabase credentials are valid

**Upsert fails:**
- Check RPC function exists in Supabase
- Verify service role key has sufficient permissions
- Check Supabase logs for detailed error messages

**ETL pipeline fails:**
- Check `LOG_LEVEL=DEBUG` output for detailed errors
- Verify pipeline script path is correct
- Ensure all required database tables exist

**Unexpected "skipped" count:**
- RPC skips duplicate events automatically
- Check if CSV contains rows that already exist in database
- Verify event uniqueness criteria (date + location + postal code)



# Amenities upload — usage
This document explains how to prepare your environment, add a CSV and run the uploader script:
`backend/etl/upload_data/execute_pipeline/amenities_update.py`.

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
  `updated_amenities_data.csv`

Required columns (and formats)
- name - no constraint
- amenity - no constraint
- addr_housenumber - no constraint
- addr_street - no constraint
- addr_city - no constraint
- osm_id - no constraint
- osm_type - no constraint
- postal_code - no constraint
- geometry - not null
- geom_type - no constraint
- lon - no constraint
- lat - no constraint


Example CSV header:
```
name,amenity,addr_housenumber,addr_street,addr_city,osm_id,osm_type,postal_code,geometry,geom_type,lon,lat
```

4) Run the uploader
- From repo root (recommended to set PYTHONPATH so pipeline subprocess imports resolve):
```bash
# ensure backend is on PYTHONPATH (so `import etl.*` works in subprocess)
export PYTHONPATH="$(pwd)/backend${PYTHONPATH:+:$PYTHONPATH}"

# run the uploader
python backend/etl/upload_data/execute_pipeline/amenities_update.py
```

## What the script does
- Validates every CSV row according to the defined validation rules (geometry cannot be null/empty).
- Stops execution if any rows fail validation - no partial uploads are allowed.
- Creates a backup of the existing `hdx_amenities` table before making any changes.
- If validation passes, clears all existing data from `hdx_amenities` and uploads the new validated rows.
- If upload fails, automatically restores the table from backup to prevent data loss.
- Shows progress bars for deletion and upload operations.

## Validation Rules
- **Required columns**: name, amenity, addr_housenumber, addr_street, addr_city, osm_id, osm_type, postal_code, geometry, geom_type, lon, lat
- **Non-nullable fields**: geometry (must not be empty or null)
- All other fields can be empty/null

## Script Flow
1. **Validation**: Reads CSV and validates all rows
   - If validation fails → script exits with error (no upload occurs)
   - If validation passes → proceeds to upload
2. **Backup**: Creates backup table `hdx_amenities_backup`
   - If backup fails → script exits (safety measure)
3. **Upload**: Clears existing data and inserts validated rows in batches of 1000
   - If upload fails → automatically restores from backup
4. **Success**: Reports total rows uploaded and confirms backup location

## Notes / Troubleshooting

### If validation fails
- Check the terminal output - each invalid row will be printed with specific error messages
- Example error: `❌ Row 5 has 1 error(s): {'geometry': 'geometry cannot be null or empty'}`
- Fix the CSV and re-run the script
- **No data will be uploaded if validation fails**

### If backup creation fails
- Ensure the Supabase RPC functions are installed (see SQL setup below)
- Check Supabase permissions for your service key
- The script will NOT proceed without a successful backup

### If upload fails
- The script will automatically attempt to restore from backup
- Check the terminal for the specific error message
- Common issues:
  - Network connectivity problems
  - Supabase rate limits
  - Invalid data types in validated rows
  - Table schema mismatch

### Required SQL Functions
Run these in your Supabase SQL editor to enable backup/restore:
```sql
-- Function to drop table if exists
CREATE OR REPLACE FUNCTION drop_table_if_exists(table_name text)
RETURNS void 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', table_name);
END;
$$;

-- Function to create backup table
CREATE OR REPLACE FUNCTION create_table_backup(source_table text, backup_table text)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('CREATE TABLE %I AS SELECT * FROM %I', backup_table, source_table);
END;
$$;
```

### Running the script
```bash
# Basic run
python backend/etl/upload_data/execute_pipeline/amenities_update.py

# With debug logging
export LOG_LEVEL=DEBUG
python backend/etl/upload_data/execute_pipeline/amenities_update.py
```

### CSV Path Configuration
The script expects the CSV at:
```
backend/etl/upload_data/raw_data/updated_amenities_data.csv
```

If your CSV is in a different location, update the `CSV_PATH` variable in the script.

### Performance Notes
- Validation processes one row at a time (memory efficient)
- Upload uses batch inserts of 1000 rows for optimal performance
- Progress bars show real-time status for deletion and upload operations
- Large CSVs (100k+ rows) may take several minutes to upload

### Safety Features
- ✅ All-or-nothing validation (no partial uploads)
- ✅ Automatic backup before any changes
- ✅ Automatic restore on upload failure
- ✅ Detailed error reporting for debugging
- ✅ Exit codes (0 = success, 1 = failure)