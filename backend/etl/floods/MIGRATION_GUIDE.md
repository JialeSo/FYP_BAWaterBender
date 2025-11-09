# Historical SG Flood Data Migration Guide

## Overview

This guide documents the migration of historical SG flood data from CSV files to Supabase database.

Previously, the floods pipeline loaded historical SG flood data from a CSV file (`SG_postal_codes_resolved.csv`). This has been migrated to Supabase for better consistency and centralized data management.

## Changes Made

### 1. New Supabase Table: `flood_historical_sg`

A new table has been created in Supabase to store the historical SG flood data (213 records, IDs 1-213).

**Table Schema:**
```sql
CREATE TABLE flood_historical_sg (
    id INTEGER PRIMARY KEY,
    event_date DATE,
    location TEXT,
    event TEXT,
    start_lat DOUBLE PRECISION,
    start_lng DOUBLE PRECISION,
    start_postal_code TEXT
);
```

### 2. Modified Pipeline

The `MergeFloodsDataStage` in [floods_pipeline.py](floods_pipeline.py) has been updated to:
- Fetch historical SG data from Supabase table `flood_historical_sg` instead of reading from CSV
- Both PUB alerts and historical SG data are now sourced from Supabase
- Removed dependency on `SG_postal_codes_resolved.csv` file

### 3. Upload Script

A one-time upload script has been created at:
- [backend/etl/data/scripts/upload_historical_sg_floods.py](../data/scripts/upload_historical_sg_floods.py)

## Migration Steps

### Step 1: Create Supabase Table

Before running the upload script, ensure the `flood_historical_sg` table exists in your Supabase database.

**Option A: Using Supabase Dashboard**
1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Run the following SQL:

```sql
CREATE TABLE IF NOT EXISTS flood_historical_sg (
    id INTEGER PRIMARY KEY,
    event_date DATE,
    location TEXT,
    event TEXT,
    start_lat DOUBLE PRECISION,
    start_lng DOUBLE PRECISION,
    start_postal_code TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

**Option B: Using Supabase CLI**
```bash
supabase db push
```

### Step 2: Run the Upload Script

The upload script extracts historical SG flood data from the merged CSV file and uploads it to Supabase.

**Prerequisites:**
- Python 3.11+
- Active virtual environment with dependencies installed
- Valid Supabase credentials in `.env` file

**Run the script:**
```bash
# From the project root directory
python backend/etl/data/scripts/upload_historical_sg_floods.py
```

**Expected Output:**
```
INFO | Reading merged flood data from /path/to/PUB_and_huiying_flood.csv
INFO | Found 213 historical SG flood records
INFO | Uploading 213 records to Supabase table 'flood_historical_sg'
INFO | Uploaded batch 1: 100 records (total: 100/213)
INFO | Uploaded batch 2: 100 records (total: 200/213)
INFO | Uploaded batch 3: 13 records (total: 213/213)
INFO | ✓ Successfully uploaded 213 historical SG flood records to Supabase
INFO | ✓ Verification: Found 213 records in flood_historical_sg table
```

### Step 3: Verify Upload

Check that the data was uploaded successfully:

**Option A: Using Supabase Dashboard**
1. Navigate to Table Editor
2. Select `flood_historical_sg` table
3. Verify 213 records exist

**Option B: Using SQL**
```sql
SELECT COUNT(*) FROM flood_historical_sg;
-- Expected: 213

SELECT * FROM flood_historical_sg ORDER BY id LIMIT 5;
-- Should show first 5 historical records
```

### Step 4: Run the Updated Pipeline

Once the data is uploaded, you can run the floods pipeline as usual:

```bash
# Run the complete floods pipeline
python backend/etl/floods/run_floods_pipeline.py
```

The pipeline will now fetch both PUB alerts and historical SG data from Supabase.

## Configuration

The `MergeFloodsDataStage` can be configured with the following options:

```python
config = {
    "sg_table": "flood_historical_sg",  # Supabase table for historical SG data
    "pub_table": "flood_3layers",        # Supabase table for PUB alerts
    "output_csv": "/path/to/output.csv"  # Path to save merged CSV
}
```

## Benefits of This Migration

1. **Centralized Data Management**: All flood data now in Supabase
2. **Consistency**: Both real-time and historical data use the same source
3. **Easier Updates**: Historical data can be updated via database instead of file edits
4. **Better for Production**: No need to deploy CSV files with the application
5. **Version Control**: Database migrations can track schema changes

## Rollback (if needed)

If you need to revert to the CSV-based approach:

1. Restore the original `MergeFloodsDataStage` from git history
2. Ensure `SG_postal_codes_resolved.csv` exists in `backend/etl/data/floods/`
3. Update any configuration that references `sg_table` to use `sg_csv`

## Troubleshooting

### Issue: "Table doesn't exist" error
**Solution**: Create the `flood_historical_sg` table in Supabase (see Step 1)

### Issue: "No historical SG records found"
**Solution**: Run the upload script to populate the table (see Step 2)

### Issue: Upload fails with connection error
**Solution**:
- Check your `.env` file has correct Supabase credentials
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set
- Test database connection: `python -c "from backend.common.db import DatabaseConnection; DatabaseConnection()._get_connection()"`

### Issue: Duplicate key errors during upload
**Solution**: The script uses `upsert` to handle duplicates. If this fails:
```sql
-- Clear the table and re-run
TRUNCATE TABLE flood_historical_sg;
```

## Related Files

- Upload Script: [backend/etl/data/scripts/upload_historical_sg_floods.py](../data/scripts/upload_historical_sg_floods.py)
- Pipeline: [backend/etl/floods/floods_pipeline.py](floods_pipeline.py)
- Runner: [backend/etl/floods/run_floods_pipeline.py](run_floods_pipeline.py)
- Data Source: [backend/etl/data/floods/PUB_and_huiying_flood.csv](../data/floods/PUB_and_huiying_flood.csv)

## Questions?

For questions or issues with this migration, please contact the development team or create an issue in the project repository.
