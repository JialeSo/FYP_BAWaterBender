from pathlib import Path
import csv
import logging
from typing import List, Dict, Any, Tuple
from dotenv import load_dotenv
import os
from supabase import create_client, Client
from tqdm import tqdm
import subprocess
import sys

# Load environment variables
load_dotenv()

# path to new flood csv
CSV_PATH = Path(__file__).resolve().parents[3] / "etl" / "upload_data" / "raw_data" / "hdx_amenities_rows.csv"

# Supabase configuration
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
TABLE_NAME = "hdx_amenities"
BACKUP_TABLE_NAME = "hdx_amenities_backup"
REQUIRED_COLUMNS = [
    "name",
    "amenity",
    "addr_housenumber",
    "addr_street",
    "addr_city",
    "osm_id",
    "osm_type",
    "postal_code",
    "geometry", #only this not nullable
    "geom_type",
    "lon",
    "lat"   
]

# --- validators ---
def validate_headers_present(headers: List[str]) -> None:
    missing = [col for col in REQUIRED_COLUMNS if col not in headers]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    
def validate_geometry_not_null(value: str) -> str:
    v = str(value).strip()
    if not v:
        raise ValueError("geometry cannot be null or empty")
    return v

VALIDATORS = {
    "geometry": validate_geometry_not_null,
}

# --- row validation that accumulates errors ---
def validate_row(row: Dict[str, str]) -> Tuple[Dict[str, Any], Dict[str, str]]:
    validated: Dict[str, Any] = {}
    errors: Dict[str, str] = {}

    for col in REQUIRED_COLUMNS:
        raw = row.get(col)
        if raw is None:
            errors[col] = "Missing required column"
            validated[col] = None
            continue

        validator = VALIDATORS.get(col)
        if validator:
            try:
                validated[col] = validator(raw)
            except ValueError as e:
                errors[col] = str(e)
                validated[col] = None
        else:
            v = str(raw).strip()
            validated[col] = v or None

    return validated, errors

# --- validate whole CSV ---
def run_validation_and_report() -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    print(f"DEBUG: CSV_PATH = {CSV_PATH}")
    print(f"DEBUG: CSV exists? {CSV_PATH.exists()}")
    
    if not CSV_PATH.exists():
        logging.error("Could not find CSV at %s — please check the file path.", CSV_PATH)
        print(f"✖ CSV not found: {CSV_PATH}")
        return [], []

    logging.info("Starting validation for %s", CSV_PATH)
    print(f"🔎 Validating CSV: {CSV_PATH}")

    valid_rows: List[Dict[str, Any]] = []
    invalid_rows: List[Dict[str, Any]] = []

    with CSV_PATH.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)

        # Validate headers up-front and fail fast if required columns missing
        try:
            print(f"DEBUG: Headers found: {reader.fieldnames}")
            validate_headers_present(reader.fieldnames or [])
            print("DEBUG: Headers validated successfully")
        except ValueError as e:
            logging.error("CSV header validation failed: %s", e)
            print(f"✖ CSV header validation failed: {e}")
            return [], []

        print("DEBUG: Starting row validation...")
        for i, r in enumerate(reader, start=1):
            if i == 1:
                print(f"DEBUG: First row data: {r}")
            validated, errors = validate_row(r)
            if errors:
                logging.warning("Row %d has %d error(s): %s", i, len(errors), errors)
                print(f"❌ Row {i} has {len(errors)} error(s): {errors}")
                invalid_rows.append({
                    "row_number": i,
                    "errors": errors,
                    "raw": r,
                    "validated": validated
                })
                continue
            valid_rows.append(validated)
        
        print(f"DEBUG: Finished processing {i} rows")

    logging.info("Validation finished: %d valid, %d invalid rows", len(valid_rows), len(invalid_rows))
    print(f"✅ Validation complete — {len(valid_rows)} valid, {len(invalid_rows)} invalid")
    if invalid_rows:
        print(f"Tip: {len(invalid_rows)} rows were skipped — check logs for details.")

    return valid_rows, invalid_rows


# --- Supabase functions ---
def get_supabase_client() -> Client:
    """Initialize and return Supabase client"""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in environment variables")
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def backup_table(supabase: Client) -> bool:
    """
    Backup current table data to backup table
    Returns True if successful, False otherwise
    """
    try:
        print(f"📦 Creating backup of {TABLE_NAME}...")
        
        # Check if main table exists and has data
        try:
            existing_data = supabase.table(TABLE_NAME).select("*").limit(1).execute()
            print(f"   Main table exists with data")
        except Exception as e:
            print(f"⚠️  Main table doesn't exist or is empty. Skipping backup.")
            return True  # It's okay if there's nothing to backup
        
        # Drop backup table if it exists
        try:
            supabase.rpc('drop_table_if_exists', {'table_name': BACKUP_TABLE_NAME}).execute()
        except Exception as e:
            print(f"   Note: Could not drop existing backup (may not exist): {e}")
        
        # Create backup table as copy of original
        supabase.rpc('create_table_backup', {
            'source_table': TABLE_NAME,
            'backup_table': BACKUP_TABLE_NAME
        }).execute()
        
        print(f"✅ Backup created successfully: {BACKUP_TABLE_NAME}")
        return True
        
    except Exception as e:
        logging.error(f"Failed to create backup: {e}")
        print(f"✖ Backup failed: {e}")
        return False


def restore_from_backup(supabase: Client) -> bool:
    """
    Restore table from backup
    Returns True if successful, False otherwise
    """
    try:
        print(f"🔄 Restoring {TABLE_NAME} from backup...")
        
        # Delete all rows from main table
        supabase.table(TABLE_NAME).delete().neq('id', 0).execute()
        
        # Copy data from backup to main table
        backup_data = supabase.table(BACKUP_TABLE_NAME).select("*").execute()
        
        if backup_data.data:
            # Insert in batches of 1000
            batch_size = 1000
            for i in range(0, len(backup_data.data), batch_size):
                batch = backup_data.data[i:i + batch_size]
                supabase.table(TABLE_NAME).insert(batch).execute()
        
        print(f"✅ Table restored from backup successfully")
        return True
        
    except Exception as e:
        logging.error(f"Failed to restore from backup: {e}")
        print(f"✖ Restore failed: {e}")
        return False


def upload_to_supabase(supabase: Client, data: List[Dict[str, Any]]) -> bool:
    """
    Upload validated data to Supabase, overwriting existing data
    Returns True if successful, False otherwise
    """
    try:
        print(f"📤 Uploading {len(data)} rows to {TABLE_NAME}...")
        
        # Count existing rows first
        print(f"🗑️  Clearing existing data...")
        try:
            # Get total count
            count_result = supabase.table(TABLE_NAME).select("id", count="exact").execute()
            total_rows = count_result.count if count_result.count else 0
            
            if total_rows > 0:
                print(f"   Found {total_rows} existing rows to delete...")
                
                # Delete with progress bar simulation
                with tqdm(total=total_rows, desc="   Deleting", unit="rows") as pbar:
                    supabase.table(TABLE_NAME).delete().neq('id', 0).execute()
                    pbar.update(total_rows)
                
                print(f"   ✅ Deleted {total_rows} rows")
            else:
                print(f"   Table is empty, no deletion needed")
                
        except Exception as e:
            print(f"   ⚠️  Could not count existing rows: {e}")
            print(f"   Proceeding with deletion anyway...")
            supabase.table(TABLE_NAME).delete().neq('id', 0).execute()
        
        # Insert new data in batches with progress bar
        batch_size = 1000
        total_batches = (len(data) + batch_size - 1) // batch_size
        
        print(f"📥 Inserting {len(data)} new rows...")
        with tqdm(total=len(data), desc="   Uploading", unit="rows") as pbar:
            for i in range(0, len(data), batch_size):
                batch = data[i:i + batch_size]
                supabase.table(TABLE_NAME).insert(batch).execute()
                pbar.update(len(batch))
        
        print(f"✅ Upload complete: {len(data)} rows uploaded successfully")
        return True
        
    except Exception as e:
        logging.error(f"Upload failed: {e}")
        print(f"✖ Upload failed: {e}")
        return False


if __name__ == "__main__":
    # Step 1: Validate CSV
    print("="*60)
    print("STEP 1: Validating CSV")
    print("="*60)
    valid_rows, invalid_rows = run_validation_and_report()
    
    # Step 2: Check if validation passed
    if invalid_rows:
        print("\n" + "="*60)
        print("❌ VALIDATION FAILED")
        print("="*60)
        print(f"Cannot proceed with upload. Fix {len(invalid_rows)} invalid rows first.")
        exit(1)
    
    if not valid_rows:
        print("\n" + "="*60)
        print("❌ NO DATA TO UPLOAD")
        print("="*60)
        print("CSV is empty or all rows are invalid.")
        exit(1)
    
    # Step 3: Initialize Supabase client
    print("\n" + "="*60)
    print("STEP 2: Connecting to Supabase")
    print("="*60)
    try:
        supabase = get_supabase_client()
        print("✅ Connected to Supabase")
    except Exception as e:
        print(f"✖ Failed to connect to Supabase: {e}")
        exit(1)
    
    # Step 4: Create backup
    print("\n" + "="*60)
    print("STEP 3: Creating Backup")
    print("="*60)
    backup_success = backup_table(supabase)
    
    if not backup_success:
        print("\n❌ Cannot proceed without backup. Aborting.")
        exit(1)
    
    # Step 5: Upload new data
    print("\n" + "="*60)
    print("STEP 4: Uploading New Data")
    print("="*60)
    upload_success = upload_to_supabase(supabase, valid_rows)
    
    # Step 6: Handle upload result
    if upload_success:
        print("\n" + "="*60)
        print("🎉 SUCCESS!")
        print("="*60)
        print(f"✅ {len(valid_rows)} rows uploaded successfully")
        print(f"✅ Backup available at: {BACKUP_TABLE_NAME}")
        
        # # Step 7: Trigger amenities ETL pipeline
        # print("\n" + "="*60)
        # print("STEP 5: Triggering Amenities ETL Pipeline")
        # print("="*60)
        # try:
        #     print("ℹ️ Running amenities pipeline...")
        #     script = Path(__file__).resolve().parents[3] / "etl" / "amenities" / "run_amenities_pipeline.py"
            
        #     # Ensure the backend dir is on PYTHONPATH so imports work
        #     env = os.environ.copy()
        #     backend_dir = str(Path(__file__).resolve().parents[3])  # .../backend
        #     existing = env.get("PYTHONPATH")
        #     env["PYTHONPATH"] = backend_dir + (os.pathsep + existing if existing else "")
            
        #     subprocess.run([sys.executable, str(script)], check=True, env=env)
        #     print("\n✅ Amenities ETL pipeline finished successfully")
            
        # except subprocess.CalledProcessError as e:
        #     logging.exception("Amenities ETL pipeline subprocess failed")
        #     print(f"\n✖ Amenities ETL pipeline failed: {e}")
        #     print("⚠️ Data was uploaded but pipeline processing failed.")
        #     print("   You may need to run the pipeline manually:")
        #     print(f"   python {script}")
        #     exit(1)
            
    else:
        print("\n" + "="*60)
        print("⚠️  UPLOAD FAILED - RESTORING BACKUP")
        print("="*60)
        restore_success = restore_from_backup(supabase)
        
        if restore_success:
            print("\n✅ Table restored to previous state")
        else:
            print("\n❌ CRITICAL: Restore failed! Manual intervention required.")
            print(f"   Backup table: {BACKUP_TABLE_NAME}")
        
        exit(1)