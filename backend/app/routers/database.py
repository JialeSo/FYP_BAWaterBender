# app/routers/database.py - New router for database operations
from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any, List, Optional
from app.db.database import db_service
from pydantic import BaseModel

router = APIRouter(prefix="/db", tags=["database"])

class CreateRecordRequest(BaseModel):
    data: Dict[str, Any]

class UpdateRecordRequest(BaseModel):
    data: Dict[str, Any]

class QueryRequest(BaseModel):
    filters: Optional[Dict[str, Any]] = None
    select: Optional[str] = "*"
    limit: Optional[int] = None
    order_by: Optional[str] = None

@router.get("/tables")
async def get_all_tables():
    """Get list of all tables"""
    try:
        tables = await db_service.get_all_tables()
        return {"tables": tables}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/tables/{table_name}/structure")
async def get_table_structure(table_name: str):
    """Get structure of a specific table"""
    try:
        structure = await db_service.get_table_structure(table_name)
        return {"table": table_name, "structure": structure}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/tables/{table_name}")
async def get_table_data(table_name: str, limit: Optional[int] = None):
    """Get all data from a table"""
    try:
        if limit:
            data = await db_service.query_table(table_name, limit=limit)
        else:
            data = await db_service.get_all(table_name)
        return {"table": table_name, "data": data, "count": len(data)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/tables/{table_name}/{record_id}")
async def get_record(table_name: str, record_id: int):
    """Get single record by ID"""
    try:
        record = await db_service.get_by_id(table_name, record_id)
        if not record:
            raise HTTPException(status_code=404, detail="Record not found")
        return {"table": table_name, "record": record}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/tables/{table_name}")
async def create_record(table_name: str, request: CreateRecordRequest):
    """Create new record in table"""
    try:
        record = await db_service.create_record(table_name, request.data)
        return {"table": table_name, "record": record, "message": "Record created successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/tables/{table_name}/{record_id}")
async def update_record(table_name: str, record_id: int, request: UpdateRecordRequest):
    """Update record in table"""
    try:
        record = await db_service.update_record(table_name, record_id, request.data)
        if not record:
            raise HTTPException(status_code=404, detail="Record not found")
        return {"table": table_name, "record": record, "message": "Record updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/tables/{table_name}/{record_id}")
async def delete_record(table_name: str, record_id: int):
    """Delete record from table"""
    try:
        success = await db_service.delete_record(table_name, record_id)
        if not success:
            raise HTTPException(status_code=404, detail="Record not found")
        return {"table": table_name, "message": "Record deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/tables/{table_name}/query")
async def query_table(table_name: str, request: QueryRequest):
    """Advanced query with filters"""
    try:
        data = await db_service.query_table(
            table_name, 
            request.filters, 
            request.select, 
            request.limit, 
            request.order_by
        )
        return {"table": table_name, "data": data, "count": len(data)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))