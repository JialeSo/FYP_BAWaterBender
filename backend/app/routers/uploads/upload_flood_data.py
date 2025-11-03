from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from typing import List, Dict, Any
import pandas as pd
import csv
from io import StringIO
import logging
from datetime import datetime
from common.db import db
from tempfile import NamedTemporaryFile
import os

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/upload", tags=["upload"])

# Update required columns to match raw floods schema
REQUIRED_COLUMNS = {
    "text": "str",
    "event_date": "datetime64[ns]",
    "location": "str",
    "event": "str"
}

# Optional columns with their types
OPTIONAL_COLUMNS = {
    "cleaned_location": "str",
    "start_loc": "str",
    "end_loc": "str",
    "start_lat": "float64",
    "start_lng": "float64",
    "start_postal_code": "int64",
    "end_lat": "float64",
    "end_lng": "float64",
    "end_postal_code": "int64",
    "parent_road": "str",
    "start_planning_area": "str",
    "start_subzone": "str",
    "start_street_name": "str",
    "end_planning_area": "str",
    "end_subzone": "str",
    "end_street_name": "str",
    "start_planning_area_id": "str",
    "start_subzone_id": "str",
    "start_street_id": "str",
    "end_planning_area_id": "str",
    "end_subzone_id": "str",
    "end_street_id": "str"
}

def validate_flood_csv(df: pd.DataFrame) -> List[str]:
    """Validate uploaded CSV against floods schema"""
    errors = []
    
    # Check for required columns
    missing_cols = set(REQUIRED_COLUMNS.keys()) - set(df.columns)
    if missing_cols:
        errors.append(f"Missing required columns: {', '.join(missing_cols)}")
    
    # Validate required columns data types and formats
    for col, dtype in REQUIRED_COLUMNS.items():
        if col in df.columns:
            try:
                if dtype == "datetime64[ns]":
                    pd.to_datetime(df[col])
                else:
                    df[col].astype(dtype)
            except Exception as e:
                errors.append(f"Invalid data in required column {col}: {str(e)}")
    
    # Validate optional columns if present
    for col, dtype in OPTIONAL_COLUMNS.items():
        if col in df.columns:
            try:
                if dtype == "datetime64[ns]":
                    pd.to_datetime(df[col])
                elif dtype in ("float64", "int64") and df[col].notna().any():
                    df[col].astype(dtype)
            except Exception as e:
                errors.append(f"Invalid data in optional column {col}: {str(e)}")
    
    return errors

@router.post("/flood-data")
async def upload_flood_data(file: UploadFile = File(...)):
    """
    Upload and validate flood data CSV against floods schema.
    Returns validation results and processed record count.
    """
    try:
        # Read CSV
        if not file.filename.endswith('.csv'):
            raise HTTPException(status_code=400, detail="Only CSV files are supported")
        
        content = await file.read()
        df = pd.read_csv(StringIO(content.decode('utf-8')))
        
        # Validate format
        errors = validate_flood_csv(df)
        if errors:
            return JSONResponse(
                status_code=400,
                content={"success": False, "errors": errors}
            )
        
        # Basic data cleaning and type conversion
        df['event_date'] = pd.to_datetime(df['event_date'])
        df['location'] = df['location'].str.strip().upper()
        df['event'] = df['event'].str.strip()
        if 'text' in df.columns:
            df['text'] = df['text'].str.strip()
        
        # Convert numeric columns
        numeric_cols = {
            'start_lat': 'float64',
            'start_lng': 'float64',
            'end_lat': 'float64',
            'end_lng': 'float64',
            'start_postal_code': 'int64',
            'end_postal_code': 'int64'
        }
        
        for col, dtype in numeric_cols.items():
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')
        
        # Convert to records for Supabase insert
        records = df.to_dict('records')
        
        # Insert into floods table
        try:
            result = db.table("floods").insert(records).execute()
            inserted_count = len(result.data) if result.data else 0
            
            return {
                "success": True,
                "message": "Data uploaded successfully",
                "records_processed": len(records),
                "records_inserted": inserted_count
            }
            
        except Exception as e:
            logger.error(f"Database insert error: {str(e)}")
            raise HTTPException(status_code=500, detail="Failed to insert records")
        
    except Exception as e:
        logger.error(f"Error processing upload: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
@router.get("/template")
async def get_flood_template():
    """Download an empty CSV template with required columns"""
    try:
        from fastapi.responses import StreamingResponse
        
        # Create CSV content in memory
        output = StringIO()
        writer = csv.writer(output)
        
        # Write headers
        headers = list(REQUIRED_COLUMNS.keys()) + list(OPTIONAL_COLUMNS.keys())
        writer.writerow(headers)
        
        # Add example row
        example_row = [
            "Flash flood at Orchard Road",  # text
            "2024-01-01",                  # event_date
            "ORCHARD ROAD",                # location
            "FLOOD",                       # event
        ] + [''] * len(OPTIONAL_COLUMNS)   # empty optional columns
        writer.writerow(example_row)
        
        # Get CSV content
        output.seek(0)
        
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=flood_data_template.csv"}
        )
    
    except Exception as e:
        logger.error(f"Error creating template: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to create template")