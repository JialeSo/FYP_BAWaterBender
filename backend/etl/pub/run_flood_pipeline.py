# run_flood_pipeline.py
import os
import pandas as pd
from pathlib import Path
import subprocess
import sys

# -----------------------
# CONFIGURATION
# -----------------------
BASE = Path(__file__).resolve().parent

# File paths
WEATHER_ALERTS_SCRIPT = BASE / "weather_alerts.py"
POSTAL_MAPPING_SCRIPT = BASE / "PUB_postal_code_mapping.py"
REVERSE_GEOLOCATE_SCRIPT = BASE / "../roadnetwork/reverse_geolocate.py"

# Data files
RAW_ALERTS_CSV = BASE / "PUB_weather_alerts.csv"
CLEANED_ALERTS_CSV = BASE / "PUB_weather_alerts_clean.csv"
FINAL_OUTPUT_CSV = BASE / "../data/floods.csv"

# -----------------------
# HELPER FUNCTIONS
# -----------------------

def get_existing_alert_ids():
    """Get IDs of alerts that already exist in PUB_weather_alerts.csv"""
    if not RAW_ALERTS_CSV.exists():
        return set()
    
    try:
        existing_df = pd.read_csv(RAW_ALERTS_CSV)
        if 'id' in existing_df.columns:
            return set(existing_df['id'].dropna().astype(int).tolist())
        return set()
    except Exception as e:
        print(f"Warning: Error reading existing alerts: {e}")
        return set()

def get_existing_flood_ids():
    """Get IDs of floods that already exist in floods.csv"""
    if not FINAL_OUTPUT_CSV.exists():
        return set()
    
    try:
        existing_floods = pd.read_csv(FINAL_OUTPUT_CSV)
        if 'id' in existing_floods.columns:
            return set(existing_floods['id'].dropna().astype(int).tolist())
        return set()
    except Exception as e:
        print(f"Warning: Error reading existing floods: {e}")
        return set()

def extract_new_alerts_only(limit=100):
    """Extract only new weather alerts that don't exist in current files"""
    print("Step 1: Extracting new weather alerts...")
    
    if not WEATHER_ALERTS_SCRIPT.exists():
        raise FileNotFoundError(f"Weather alerts script not found: {WEATHER_ALERTS_SCRIPT}")
    
    # Get existing IDs from both files to avoid duplicates
    existing_alert_ids = get_existing_alert_ids()
    existing_flood_ids = get_existing_flood_ids()
    all_existing_ids = existing_alert_ids.union(existing_flood_ids)
    
    try:
        # Run weather_alerts.py as a subprocess
        result = subprocess.run([
            sys.executable, str(WEATHER_ALERTS_SCRIPT)
        ], capture_output=True, text=True, cwd=BASE, timeout=60)
        
        if result.returncode != 0:
            print(f"Warning: Weather alerts script had issues: {result.stderr}")
        
        # Check if new data was created
        if not RAW_ALERTS_CSV.exists():
            print("No alerts file created")
            return False
        
        # Read the extracted data and filter out existing IDs
        new_df = pd.read_csv(RAW_ALERTS_CSV)
        
        # Filter out existing IDs
        if all_existing_ids and 'id' in new_df.columns:
            new_alerts = new_df[~new_df['id'].isin(all_existing_ids)]
            
            if len(new_alerts) == 0:
                print("No new alerts found")
                # Remove the file since no new data
                RAW_ALERTS_CSV.unlink()
                return False
            
            # Save only new alerts back to file
            new_alerts.to_csv(RAW_ALERTS_CSV, index=False)
            print(f"Added {len(new_alerts)} new alerts")
            return True
        else:
            # First run or no IDs present
            print(f"Found {len(new_df)} alerts")
            return len(new_df) > 0
            
    except subprocess.TimeoutExpired:
        print("Weather alerts extraction timed out")
        return False
    except Exception as e:
        print(f"Error extracting new alerts: {e}")
        return False

def run_postal_mapping():
    """Run postal code mapping on new alerts"""
    print("Step 2: Running postal code mapping...")
    
    if not POSTAL_MAPPING_SCRIPT.exists():
        raise FileNotFoundError(f"Postal mapping script not found: {POSTAL_MAPPING_SCRIPT}")
    
    if not RAW_ALERTS_CSV.exists():
        print("No new weather alerts found to process")
        return False
    
    try:
        # Check if we have any data to process
        df = pd.read_csv(RAW_ALERTS_CSV)
        if len(df) == 0:
            print("No data to process in PUB_weather_alerts.csv")
            return False
        
        # Run the postal mapping script
        result = subprocess.run([sys.executable, str(POSTAL_MAPPING_SCRIPT)], 
                              capture_output=True, text=True, cwd=BASE, timeout=120)
        
        if result.returncode != 0:
            print(f"Error running postal mapping: {result.stderr}")
            return False
            
        print("Postal code mapping completed")
        return True
        
    except subprocess.TimeoutExpired:
        print("Postal mapping timed out")
        return False
    except Exception as e:
        print(f"Error running postal mapping: {e}")
        return False

def run_reverse_geolocate():
    """Run reverse geolocation on cleaned alerts"""
    print("Step 3: Running reverse geolocation...")
    
    if not REVERSE_GEOLOCATE_SCRIPT.exists():
        raise FileNotFoundError(f"Reverse geolocate script not found: {REVERSE_GEOLOCATE_SCRIPT}")
    
    if not CLEANED_ALERTS_CSV.exists():
        print("No cleaned alerts found to process")
        return False
    
    try:
        # Run the reverse geolocate script
        result = subprocess.run([sys.executable, str(REVERSE_GEOLOCATE_SCRIPT)], 
                              capture_output=True, text=True, cwd=BASE, timeout=120)
        
        if result.returncode != 0:
            print(f"Error running reverse geolocation: {result.stderr}")
            return False
            
        print("Reverse geolocation completed")
        return True
        
    except subprocess.TimeoutExpired:
        print("Reverse geolocation timed out")
        return False
    except Exception as e:
        print(f"Error running reverse geolocate: {e}")
        return False

def append_new_alerts():
    """Append only new alerts to floods.csv"""
    print("Step 4: Appending new alerts to floods.csv...")
    
    if not CLEANED_ALERTS_CSV.exists():
        print("No cleaned alerts found to append")
        return False
    
    try:
        # Read the newly processed alerts
        new_alerts = pd.read_csv(CLEANED_ALERTS_CSV)
        
        if len(new_alerts) == 0:
            print("No new alerts to append")
            return True
        
        # Get existing flood IDs to avoid duplicates
        existing_flood_ids = get_existing_flood_ids()
        
        # Filter out alerts that already exist in floods.csv
        if 'id' in new_alerts.columns and existing_flood_ids:
            new_alerts = new_alerts[~new_alerts['id'].isin(existing_flood_ids)]
        
        if len(new_alerts) == 0:
            print("All alerts already exist in floods.csv")
            return True
        
        # Ensure all required columns are present
        required_columns = [
            'id', 'text', 'event_date', 'location', 'event', 'start_loc', 'end_loc', 
            'parent_road', 'cleaned_location', 'start_lat', 'start_lng', 
            'start_postal_code', 'end_lat', 'end_lng', 'end_postal_code',
            'start_planning_area', 'start_planning_area_id', 'start_subzone', 
            'start_subzone_id', 'start_street_name', 'start_street_id',
            'end_planning_area', 'end_planning_area_id', 'end_subzone', 
            'end_subzone_id', 'end_street_name', 'end_street_id'
        ]
        
        # Add missing columns with None values
        for col in required_columns:
            if col not in new_alerts.columns:
                new_alerts[col] = None
        
        # Ensure 'id' column exists and is properly typed
        if 'id' not in new_alerts.columns:
            # If no ID column, create sequential IDs starting from max existing ID + 1
            next_id = max(existing_flood_ids) + 1 if existing_flood_ids else 1
            new_alerts['id'] = range(next_id, next_id + len(new_alerts))
        else:
            # Ensure IDs are integers
            new_alerts['id'] = new_alerts['id'].astype(int)
        
        # Read existing floods data if it exists
        if FINAL_OUTPUT_CSV.exists():
            existing_floods = pd.read_csv(FINAL_OUTPUT_CSV)
            
            # Ensure column order matches
            new_alerts = new_alerts[existing_floods.columns]
            
            # Append new alerts
            combined_floods = pd.concat([existing_floods, new_alerts], ignore_index=True)
        else:
            # First time running
            combined_floods = new_alerts
        
        # Save the combined data
        combined_floods.to_csv(FINAL_OUTPUT_CSV, index=False)
        
        print(f"Successfully appended {len(new_alerts)} new alerts to floods.csv")
        print(f"Total records in floods.csv: {len(combined_floods)}")
        
        return True
        
    except Exception as e:
        print(f"Error appending new alerts: {e}")
        return False

def cleanup_intermediate_files():
    """Clean up intermediate files"""
    print("Cleaning up intermediate files...")
    
    files_to_remove = [RAW_ALERTS_CSV, CLEANED_ALERTS_CSV]
    
    for file_path in files_to_remove:
        if file_path.exists():
            try:
                file_path.unlink()
                print(f"Removed: {file_path.name}")
            except Exception as e:
                print(f"Could not remove {file_path.name}: {e}")

def check_dependencies():
    """Check if all required scripts exist"""
    print("Checking dependencies...")
    
    missing_files = []
    
    if not WEATHER_ALERTS_SCRIPT.exists():
        missing_files.append(WEATHER_ALERTS_SCRIPT.name)
    if not POSTAL_MAPPING_SCRIPT.exists():
        missing_files.append(POSTAL_MAPPING_SCRIPT.name)
    if not REVERSE_GEOLOCATE_SCRIPT.exists():
        missing_files.append(REVERSE_GEOLOCATE_SCRIPT.name)
    
    if missing_files:
        print(f"Missing required files: {', '.join(missing_files)}")
        return False
    
    print("All dependencies found")
    return True

# -----------------------
# MAIN PIPELINE
# -----------------------

def run_new_alerts_pipeline(cleanup=True, limit=100):
    """
    Run the complete pipeline for new alerts only:
    1. Extract only NEW weather alerts
    2. Geocode locations with postal codes
    3. Reverse geolocate for planning areas and streets
    4. Append only NEW alerts to floods.csv
    5. Clean up intermediate files
    """
    print("Starting Flood Data Pipeline - New Alerts Only")
    print("=" * 50)
    
    # Check dependencies first
    if not check_dependencies():
        return False
    
    # Step 1: Extract only new alerts
    if not extract_new_alerts_only(limit=limit):
        print("No new alerts to process")
        return True
    
    # Step 2: Geocode locations
    if not run_postal_mapping():
        print("Pipeline failed at postal code mapping")
        return False
    
    # Step 3: Reverse geolocate
    if not run_reverse_geolocate():
        print("Pipeline failed at reverse geolocation")
        return False
    
    # Step 4: Append only new alerts to floods.csv
    if not append_new_alerts():
        print("Pipeline failed at appending new alerts")
        return False
    
    # Step 5: Cleanup
    if cleanup:
        cleanup_intermediate_files()
    
    print("=" * 50)
    print("Flood Data Pipeline completed successfully!")
    return True

# -----------------------
# COMMAND LINE INTERFACE
# -----------------------

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Process new flood alerts only')
    parser.add_argument('--limit', type=int, default=100,
                       help='Maximum number of messages to fetch (default: 100)')
    parser.add_argument('--no-cleanup', action='store_true',
                       help='Keep intermediate files for debugging')
    
    args = parser.parse_args()
    
    success = run_new_alerts_pipeline(
        cleanup=not args.no_cleanup,
        limit=args.limit
    )
    
    sys.exit(0 if success else 1)