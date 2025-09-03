# app/db/database.py
from typing import List, Dict, Any, Optional
from supabase import Client
from app.db.supabase import get_supabase

class DatabaseService:
    def __init__(self):
        self.supabase = get_supabase()
    
    async def get_all_tables(self) -> List[str]:
        """Get list of all table names in your database"""
        try:
            # Query information_schema to get table names
            response = self.supabase.rpc('get_table_names').execute()
            return response.data
        except Exception as e:
            # Fallback: return common table names or handle manually
            print(f"Could not fetch table names: {e}")
            return []
    
    async def get_table_structure(self, table_name: str) -> Dict[str, Any]:
        """Get the structure/columns of a specific table"""
        try:
            # Get first row to understand structure
            response = self.supabase.table(table_name).select("*").limit(1).execute()
            if response.data:
                return {"columns": list(response.data[0].keys()), "sample": response.data[0]}
            return {"columns": [], "sample": {}}
        except Exception as e:
            raise Exception(f"Could not fetch structure for table {table_name}: {str(e)}")
    
    # Generic CRUD operations for any table
    async def get_all(self, table_name: str, select: str = "*") -> List[Dict[str, Any]]:
        """Get all records from any table"""
        try:
            response = self.supabase.table(table_name).select(select).execute()
            return response.data or []
        except Exception as e:
            raise Exception(f"Failed to fetch from {table_name}: {str(e)}")
    
    async def get_by_id(self, table_name: str, record_id: int, select: str = "*") -> Optional[Dict[str, Any]]:
        """Get single record by ID from any table"""
        try:
            response = self.supabase.table(table_name).select(select).eq("id", record_id).execute()
            return response.data[0] if response.data else None
        except Exception as e:
            raise Exception(f"Failed to fetch {table_name} record {record_id}: {str(e)}")
    
    async def create_record(self, table_name: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create new record in any table"""
        try:
            response = self.supabase.table(table_name).insert(data).execute()
            return response.data[0] if response.data else {}
        except Exception as e:
            raise Exception(f"Failed to create record in {table_name}: {str(e)}")
    
    async def update_record(self, table_name: str, record_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update record in any table"""
        try:
            response = self.supabase.table(table_name).update(data).eq("id", record_id).execute()
            return response.data[0] if response.data else {}
        except Exception as e:
            raise Exception(f"Failed to update {table_name} record {record_id}: {str(e)}")
    
    async def delete_record(self, table_name: str, record_id: int) -> bool:
        """Delete record from any table"""
        try:
            response = self.supabase.table(table_name).delete().eq("id", record_id).execute()
            return len(response.data) > 0 if response.data else False
        except Exception as e:
            raise Exception(f"Failed to delete {table_name} record {record_id}: {str(e)}")
    
    async def query_table(self, table_name: str, filters: Dict[str, Any] = None, 
                         select: str = "*", limit: int = None, order_by: str = None) -> List[Dict[str, Any]]:
        """Advanced query with filters"""
        try:
            query = self.supabase.table(table_name).select(select)
            
            if filters:
                for column, value in filters.items():
                    if isinstance(value, list):
                        query = query.in_(column, value)
                    else:
                        query = query.eq(column, value)
            
            if order_by:
                query = query.order(order_by)
            
            if limit:
                query = query.limit(limit)
            
            response = query.execute()
            return response.data or []
        except Exception as e:
            raise Exception(f"Failed to query {table_name}: {str(e)}")

# Global service instance
db_service = DatabaseService()