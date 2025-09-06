import psycopg2
import psycopg2.extras
import threading


class DatabaseConnection:
    def __init__(self, connection_string: str):
        self.connection_string = connection_string
        self._local = threading.local()

    def get_connection(self) -> psycopg2.extensions.connection:
        """Get a database connection for the current thread."""
        if not hasattr(self._local, "connection"):
            self._local.connection = psycopg2.connect(self.connection_string)
            self._local.connection.cursor_factory = psycopg2.extras.RealDictCursor
        return self._local.connection

    def execute_query(self, query: str, params: tuple = ()) -> psycopg2.extensions.cursor:
        """Execute a query and return the cursor."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(query, params)
        return cursor

    def execute_many(self, query: str, params_list: list) -> None:
        """Execute a query with multiple parameter sets."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.executemany(query, params_list)
        conn.commit()

    def close(self) -> None:
        """Close the database connection for the current thread."""
        if hasattr(self._local, "connection"):
            self._local.connection.close()
            del self._local.connection
