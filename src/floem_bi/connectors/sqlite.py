"""Yerel SQLite dosyaları için salt okunur bağlayıcı."""

from __future__ import annotations

import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from .base import ColumnInfo, ConnectionSpec, ConnectorError, DbObject, ExtractColumn, ForeignKey, ResultSet, SourceRef
from .sqlguard import ensure_read_only


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _py_type(dtype: str) -> type:
    upper = dtype.upper()
    if "INT" in upper:
        return int
    if any(t in upper for t in ("REAL", "FLOA", "DOUB", "NUMERIC", "DECIMAL")):
        return float
    if "BLOB" in upper:
        return bytes
    return str


class _Extraction:
    def __init__(self, cursor: sqlite3.Cursor, columns: list[ColumnInfo]):
        self._cursor = cursor
        self.columns = [ExtractColumn(c.name, _py_type(c.data_type), c.data_type,
                                      nullable=c.nullable, is_primary_key=c.is_primary_key) for c in columns]
        self.skipped: list[str] = []

    def fetch(self, n: int) -> list[tuple]:
        return [tuple(row) for row in self._cursor.fetchmany(n)]

    def cancel(self) -> None:
        self._cursor.close()


class SQLiteConnector:
    def __init__(self, spec: ConnectionSpec):
        self.spec = spec
        path = Path(spec.server).expanduser().resolve()
        if not path.is_file():
            raise ConnectorError("SQLite dosyası bulunamadı", code="not_found")
        self.path = path

    @contextmanager
    def _connect(self):
        try:
            # URI read-only modu, dosyayı yanlışlıkla oluşturmayı/yazmayı engeller.
            con = sqlite3.connect(self.path.as_uri() + "?mode=ro", uri=True, timeout=self.spec.login_timeout)
            con.execute("PRAGMA query_only = ON")
            try:
                yield con
            finally:
                con.close()
        except sqlite3.Error as exc:
            raise ConnectorError("SQLite dosyası açılamadı", code="sqlite_error") from exc

    def test(self) -> dict:
        with self._connect() as con:
            version = con.execute("SELECT sqlite_version()").fetchone()[0]
        return {"version": version, "edition": "SQLite", "database": self.path.name, "login": "Salt okunur"}

    def list_databases(self) -> list[str]:
        return [self.path.name]

    def list_objects(self, database: str) -> list[DbObject]:
        with self._connect() as con:
            rows = con.execute("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') "
                               "AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
        return [DbObject("main", name, "VIEW" if kind == "view" else "TABLE") for name, kind in rows]

    def columns(self, database: str, schema: str, table: str) -> list[ColumnInfo]:
        with self._connect() as con:
            rows = con.execute(f"PRAGMA table_info({_quote(table)})").fetchall()
        if not rows:
            raise ConnectorError(f"{table} bulunamadı", code="not_found")
        return [ColumnInfo(name, dtype or "text", not bool(notnull), is_primary_key=bool(pk))
                for _cid, name, dtype, notnull, _default, pk in rows]

    def foreign_keys(self, database: str) -> list[ForeignKey]:
        out = []
        with self._connect() as con:
            for obj in self.list_objects(database):
                if obj.type != "TABLE":
                    continue
                for _id, _seq, target, src_col, dst_col, *_rest in con.execute(
                    f"PRAGMA foreign_key_list({_quote(obj.name)})"
                ):
                    out.append(ForeignKey("main", obj.name, src_col, "main", target, dst_col))
        return out

    def _execute(self, sql: str, limit: int, timeout: int) -> ResultSet:
        start = time.perf_counter()
        with self._connect() as con:
            deadline = time.monotonic() + max(1, timeout)
            con.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
            cursor = con.execute(sql)
            names = [d[0] for d in cursor.description or []]
            rows = [list(row) for row in cursor.fetchmany(limit + 1)]
        return ResultSet([ColumnInfo(name, "text", True) for name in names], rows[:limit],
                         truncated=len(rows) > limit, elapsed_ms=int((time.perf_counter() - start) * 1000))

    def preview(self, database: str, schema: str, table: str, limit: int = 200) -> ResultSet:
        self.columns(database, schema, table)
        return self._execute(f"SELECT * FROM {_quote(table)}", max(1, min(limit, 1000)), 60)

    def run_query(self, database: str | None, sql: str, limit: int = 1000, timeout: int = 60) -> ResultSet:
        return self._execute(ensure_read_only(sql, "sqlite"), limit, timeout)

    @contextmanager
    def extract(self, source: SourceRef, timeout: int = 0):
        if source.table:
            columns = self.columns(source.database or "", source.schema or "main", source.table)
            sql = f"SELECT * FROM {_quote(source.table)}"
        else:
            sql = ensure_read_only(source.sql or "", "sqlite")
            columns = []
        with self._connect() as con:
            if timeout:
                deadline = time.monotonic() + timeout
                con.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
            cursor = con.execute(sql)
            if not columns:
                columns = [ColumnInfo(d[0], "text", True) for d in cursor.description or []]
            try:
                yield _Extraction(cursor, columns)
            finally:
                cursor.close()
