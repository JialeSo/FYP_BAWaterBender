from pathlib import Path
import os
import csv
import logging
import json
from typing import List, Dict, Optional, Any, Tuple
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client, Client
import subprocess
import sys


# path to new flood csv
CSV_PATH = Path(__file__).resolve().parents[3] / "etl" / "upload_data" / "raw_data" / "test_flood.csv"

# Supabase configuration
TABLE_NAME = "flood_historical_sg"
REQUIRED_COLUMNS = [
    "event_date",  # YYYY-MM-DD
    "location",  # string - no constraint
    "event",  # string - no constraint
    "start_lat",  # float
    "start_lng",  # float
    "start_postal_code"  # 6 numbers no decimal
]

# --- validators ---
def validate_event_date(val: Optional[str]) -> datetime:
    if not val or not str(val).strip():
        raise ValueError("event_date is required")
    s = str(val).strip()
    try:
        return datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        raise ValueError("event_date must be YYYY-MM-DD")

def validate_lat_long(val: Optional[str]) -> float:
    if val is None or str(val).strip() == "":
        raise ValueError("Latitude/Longitude is required")
    try:
        return float(val)
    except ValueError:
        raise ValueError("Latitude/Longitude must be a valid float")

def validate_postal_code(val: Optional[str]) -> str:
    if not val or not str(val).strip():
        raise ValueError("Postal code is required")
    s = str(val).strip()
    if len(s) != 6 or not s.isdigit():
        raise ValueError("Postal code must be a 6-digit string")
    return s

VALIDATORS = {
    "event_date": validate_event_date,
    "start_lat": validate_lat_long,
    "start_lng": validate_lat_long,
    "start_postal_code": validate_postal_code
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
        for i, r in enumerate(reader, start=1):
            validated, errors = validate_row(r)
            if errors:
                logging.warning("Row %d has %d error(s): %s", i, len(errors), errors)
                invalid_rows.append({
                    "row_number": i,
                    "errors": errors,
                    "raw": r,
                    "validated": validated
                })
                continue
            valid_rows.append(validated)

    logging.info("Validation finished: %d valid, %d invalid rows", len(valid_rows), len(invalid_rows))
    print(f"✅ Validation complete — {len(valid_rows)} valid, {len(invalid_rows)} invalid")
    if invalid_rows:
        print(f"Tip: {len(invalid_rows)} rows were skipped — check logs for details.")

    return valid_rows, invalid_rows

def get_supabase_client() -> Client:
    """Create and return a Supabase client using env vars SUPABASE_URL and SUPABASE_KEY."""
    load_dotenv()
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in environment")
    return create_client(url, key)

def prepare_rows_for_upsert(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Convert validated rows into a JSON-serializable format suitable for the RPC.
    - event_date (datetime) -> 'YYYY-MM-DD' string
    - other fields kept as-is (postal code stays string; lat/lng as floats)
    - EXCLUDES 'id' field to let database auto-generate UUIDs
    """
    prepared: List[Dict[str, Any]] = []
    for r in rows:
        out: Dict[str, Any] = {}
        for k, v in r.items():
            # Skip 'id' field if present
            if k == "id":
                continue
            elif k == "event_date" and isinstance(v, datetime):
                out[k] = v.date().isoformat()
            else:
                out[k] = v
        prepared.append(out)
    return prepared

def upsert_valid_rows(valid_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Batch upsert validated rows by calling the conditional_upsert_flood_batch RPC.
    Returns a list of result dicts: {input, action, id} for each input row.
    """
    if not valid_rows:
        raise ValueError("No valid rows to upsert")

    client = get_supabase_client()
    payload = prepare_rows_for_upsert(valid_rows)

    try:
        resp = client.rpc("conditional_upsert_flood_batch", {"rows": payload}).execute()
    except Exception as e:
        logging.exception("Batch RPC call failed")
        print(f"✖ Upsert failed: {e}")
        raise

    # Handle the response - it's an object with a 'data' attribute
    if hasattr(resp, 'data'):
        results_raw = resp.data
    elif isinstance(resp, dict) and "data" in resp:
        results_raw = resp["data"]
    else:
        # If it's already a list, use it directly
        results_raw = resp if isinstance(resp, list) else []

    # Normalize the results
    normalized: List[Dict[str, Any]] = []
    for item in results_raw:
        # Each item has a 'result' key containing the actual data
        if isinstance(item, dict) and "result" in item:
            obj = item["result"]
        else:
            obj = item
        
        # Handle if obj is still a JSON string
        if isinstance(obj, str):
            try:
                obj = json.loads(obj)
            except Exception:
                pass
        
        normalized.append(obj)

    return normalized


# --- main guard ---
if __name__ == "__main__":
    valid_rows, invalid_rows = run_validation_and_report()
    if invalid_rows:
        print("✖ Validation errors detected — upsert skipped.")
    else:
        if not valid_rows:
            print("⚠️ No rows to upsert.")
        else:
            try:
                results = upsert_valid_rows(valid_rows)
                inserts = sum(1 for r in results if r.get("action") == "inserted")
                updates = sum(1 for r in results if r.get("action") == "updated")
                skips = sum(1 for r in results if r.get("action") == "skipped")
                errors = [r for r in results if r.get("action") is None]
                print(f"✅ Upsert done — inserted: {inserts}, skipped: {skips}, rows_with_unknown_result: {len(errors)}")
                if errors:
                    print("Some rows returned an unexpected RPC result. Check logs/response for details.")
                # Optionally print detail:
                for r in results: print(r)

                if (inserts + updates) > 0:
                    try:
                        print("ℹ️ Triggering floods ETL pipeline...")
                        script = Path(__file__).resolve().parents[3] / "etl" / "floods" / "run_floods_pipeline.py"

                        # Ensure the backend dir is on PYTHONPATH so `import etl...` inside the script works
                        env = os.environ.copy()
                        backend_dir = str(Path(__file__).resolve().parents[3])  # .../backend
                        existing = env.get("PYTHONPATH")
                        env["PYTHONPATH"] = backend_dir + (os.pathsep + existing if existing else "")

                        subprocess.run([sys.executable, str(script)], check=True, env=env)
                        print("✅ Floods ETL pipeline finished")
                    except subprocess.CalledProcessError as e:
                        logging.exception("Floods ETL pipeline subprocess failed")
                        print("✖ Floods ETL pipeline failed:", e)
                else:
                    print("ℹ️ No inserts/updates — floods ETL pipeline not triggered.")
            except Exception as e:
                logging.exception("Upsert failed")
                print("✖ Upsert failed:", e)


