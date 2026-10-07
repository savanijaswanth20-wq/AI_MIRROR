"""Small JSON document repository shared by durable SQLite and Supabase REST.

Domain validation remains in Pydantic. Database table names are allowlisted; callers
cannot provide SQL identifiers. The optional Supabase adapter never exposes its key.
"""

import json
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import httpx

TABLES = (
    "users",
    "customers",
    "products",
    "categories",
    "product_images",
    "product_variants",
    "sizes",
    "colors",
    "inventory",
    "stores",
    "store_locations",
    "mirror_stations",
    "try_on_sessions",
    "try_on_products",
    "recommendations",
    "staff_requests",
    "carts",
    "cart_items",
    "orders",
    "analytics_events",
    "qr_transfers",
    "settings",
)


class SQLiteRepository:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.RLock()
        self._transaction_depth = 0
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA foreign_keys=ON")
        migration = Path(__file__).with_name("001_sqlite.sql").read_text(encoding="utf-8")
        self.connection.executescript(migration)
        self.connection.commit()

    def list(self, table: str) -> list[dict[str, Any]]:
        self._table(table)
        with self.lock:
            return [json.loads(row[0]) for row in self.connection.execute(f"SELECT payload FROM {table}")]

    def get(self, table: str, key: str) -> dict[str, Any] | None:
        self._table(table)
        with self.lock:
            row = self.connection.execute(f"SELECT payload FROM {table} WHERE id=?", (key,)).fetchone()
            return json.loads(row[0]) if row else None

    def put(self, table: str, key: str, value: dict[str, Any]) -> None:
        self._table(table)
        with self.lock:
            self.connection.execute(
                f"INSERT INTO {table} (id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET "
                "payload=excluded.payload, updated_at=CURRENT_TIMESTAMP",
                (key, json.dumps(value, allow_nan=False)),
            )
            if self._transaction_depth == 0:
                self.connection.commit()

    def delete(self, table: str, key: str) -> None:
        self._table(table)
        with self.lock:
            self.connection.execute(f"DELETE FROM {table} WHERE id=?", (key,))
            if self._transaction_depth == 0:
                self.connection.commit()

    @contextmanager
    def transaction(self) -> Iterator[None]:
        with self.lock:
            outer = self._transaction_depth == 0
            if outer:
                self.connection.execute("BEGIN IMMEDIATE")
            self._transaction_depth += 1
            try:
                yield
                if outer:
                    self.connection.commit()
            except Exception:
                if outer:
                    self.connection.rollback()
                raise
            finally:
                self._transaction_depth -= 1

    def _table(self, table: str) -> None:
        if table not in TABLES:
            raise ValueError("Unknown table")

    def close(self) -> None:
        self.connection.close()


class SupabaseRepository:
    def __init__(self, url: str, key: str):
        if not url.startswith("https://") or not key:
            raise ValueError("Supabase requires HTTPS SUPABASE_URL and server-only SUPABASE_SERVICE_ROLE_KEY")
        self.client = httpx.Client(
            base_url=url.rstrip("/") + "/rest/v1/",
            timeout=10,
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Prefer": "resolution=merge-duplicates",
            },
        )
        self.lock = threading.RLock()
        self._transaction_depth = 0
        self._pending: dict[tuple[str, str], dict[str, Any] | None] = {}

    def _request(self, method: str, table: str, **kwargs: Any) -> Any:
        if table not in TABLES:
            raise ValueError("Unknown table")
        response = self.client.request(method, table, **kwargs)
        response.raise_for_status()
        return response.json() if response.content else None

    def list(self, table: str) -> list[dict[str, Any]]:
        with self.lock:
            rows: list[dict[str, Any]] = []
            offset = 0
            while True:
                page = self._request(
                    "GET",
                    table,
                    params={"select": "payload", "limit": 500, "offset": offset, "order": "id.asc"},
                )
                rows.extend(row["payload"] for row in page)
                if len(page) < 500:
                    merged = {row["id"]: row for row in rows}
                    for (pending_table, key), value in self._pending.items():
                        if pending_table == table:
                            if value is None:
                                merged.pop(key, None)
                            else:
                                merged[key] = value
                    return list(merged.values())
                offset += 500

    def get(self, table: str, key: str) -> dict[str, Any] | None:
        with self.lock:
            if (table, key) in self._pending:
                return self._pending[(table, key)]
            rows = self._request("GET", table, params={"id": f"eq.{key}", "select": "payload", "limit": 1})
            return rows[0]["payload"] if rows else None

    def put(self, table: str, key: str, value: dict[str, Any]) -> None:
        with self.lock:
            if table not in TABLES:
                raise ValueError("Unknown table")
            if self._transaction_depth:
                self._pending[(table, key)] = value
                return
            self._request("POST", table, params={"on_conflict": "id"}, json={"id": key, "payload": value})

    def delete(self, table: str, key: str) -> None:
        with self.lock:
            if table not in TABLES:
                raise ValueError("Unknown table")
            if self._transaction_depth:
                self._pending[(table, key)] = None
                return
            self._request("DELETE", table, params={"id": f"eq.{key}"})

    def close(self) -> None:
        self.client.close()

    @contextmanager
    def transaction(self) -> Iterator[None]:
        with self.lock:
            outer = self._transaction_depth == 0
            self._transaction_depth += 1
            try:
                yield
                if outer and self._pending:
                    operations = [
                        {"table_name": table, "id": key, "payload": payload, "is_delete": payload is None}
                        for (table, key), payload in self._pending.items()
                    ]
                    response = self.client.post(
                        "rpc/mirror_apply_operations", json={"operations": operations}
                    )
                    response.raise_for_status()
            finally:
                self._transaction_depth -= 1
                if outer:
                    self._pending.clear()
