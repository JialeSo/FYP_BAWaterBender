import os
from typing import Dict, List, Union
from supabase import create_client, Client
import threading


class DatabaseConnection:
    def __init__(self):
        self.url = os.getenv("SUPABASE_URL")
        self.key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        self._local = threading.local()

        print(f"Connecting to Supabase at {self.url}")
        print(f"Using Supabase key: {self.key}")

        if not self.url:
            raise ValueError("SUPABASE_URL environment variable is not set")
        if not self.key:
            raise ValueError("SUPABASE_ANON_KEY environment variable is not set")

    def _get_connection(self) -> Client:
        """Get a Supabase client for the current thread."""
        if not hasattr(self._local, "client"):
            try:
                self._local.client = create_client(self.url, self.key)
            except Exception as e:
                raise Exception(f"Error connecting to Supabase: {e}")
        return self._local.client

    def insert(self, table: str, data: Union[Dict, List]) -> None:
        try:
            client = self._get_connection()
            response = client.table(table).insert(data).execute()
            return response
        except Exception as e:
            return e

    def close(self) -> None:
        """Close the Supabase client for the current thread."""
        if hasattr(self._local, "client"):
            # Supabase clients don't need explicit closing
            del self._local.client
