from typing import Dict, List, Union
from supabase import create_client, Client
import threading
import logging
from dotenv import load_dotenv

from config.config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

load_dotenv()


class DatabaseConnection:
    def __init__(self):
        self.url = SUPABASE_URL
        self.key = SUPABASE_SERVICE_ROLE_KEY
        self._local = threading.local()

        print(f"Connecting to Supabase at {self.url}")

        if not self.url:
            raise ValueError("SUPABASE_URL environment variable is not set")
        if not self.key:
            msg = "SUPABASE_SERVICE_ROLE_KEY environment variable not set"
            raise ValueError(msg)

    def _get_connection(self) -> Client:
        """Get a Supabase client for the current thread."""
        if not hasattr(self._local, "client"):
            try:
                self._local.client = create_client(self.url, self.key)
            except Exception as e:
                raise Exception(f"Error connecting to Supabase: {e}")
        return self._local.client

    def insert(self, table: str, data: Union[Dict, List]):
        try:
            client = self._get_connection()
            logger = logging.getLogger(__name__)
            logger.debug(f"Inserting data into table '{table}': {data}")

            response = client.table(table).insert(data).execute()

            logger.debug(
                f"Insert successful. Response data count: "
                f"{len(response.data) if response.data else 0}"
            )
            return response

        except Exception as e:
            logger = logging.getLogger(__name__)
            logger.error(f"Database insert failed for table '{table}': {e}")
            logger.error(f"Data that failed to insert: {data}")
            raise e  # ✅ Properly raise the exception

    def select(self, table: str, columns: str = "*", **filters):
        """
        Query data from a table.

        Args:
            table: Table name to query
            columns: Columns to select (default: "*")
            **filters: Filter conditions as keyword arguments

        Returns:
            Query response with data
        """
        try:
            client = self._get_connection()
            logger = logging.getLogger(__name__)

            query = client.table(table).select(columns)

            # Apply filters
            for column, value in filters.items():
                query = query.eq(column, value)

            response = query.execute()

            logger.debug(
                f"Select successful. Response data count: "
                f"{len(response.data) if response.data else 0}"
            )
            return response

        except Exception as e:
            logger = logging.getLogger(__name__)
            logger.error(f"Database select failed for table '{table}': {e}")
            raise e

    def upsert(self, table: str, data: Union[Dict, List], on_conflict: str = None):
        """
        Insert or update data in a table.

        Args:
            table: Table name
            data: Data to upsert
            on_conflict: Column name(s) for conflict resolution

        Returns:
            Upsert response
        """
        try:
            client = self._get_connection()
            logger = logging.getLogger(__name__)
            logger.debug(f"Upserting data into table '{table}': {data}")

            # Use upsert with on_conflict parameter when supported
            try:
                if on_conflict:
                    response = client.table(table).upsert(data, on_conflict=on_conflict).execute()
                else:
                    response = client.table(table).upsert(data).execute()
            except TypeError:
                # Older SDKs may not accept on_conflict kwarg
                response = client.table(table).upsert(data).execute()

            logger.debug(
                f"Upsert successful. Response data count: "
                f"{len(response.data) if response.data else 0}"
            )
            return response

        except Exception as e:
            logger = logging.getLogger(__name__)
            logger.error(f"Database upsert failed for table '{table}': {e}")
            logger.error(f"Data that failed to upsert: {data}")
            raise e

    def close(self) -> None:
        """Close the Supabase client for the current thread."""
        if hasattr(self._local, "client"):
            # Supabase clients don't need explicit closing
            del self._local.client

    def table(self, table_name: str):
        """Access a table through the Supabase client."""
        client = self._get_connection()
        return client.table(table_name)


# Singleton instance of DatabaseConnection
db = DatabaseConnection()
