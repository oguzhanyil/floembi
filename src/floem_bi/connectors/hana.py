"""SAP HANA ODBC bağlayıcısı; kurulu HDBODBC sürücüsünü kullanır."""

from __future__ import annotations

import time
from contextlib import contextmanager

import pyodbc

from .base import ColumnInfo, ConnectionSpec, ConnectorError, DbObject, ExtractColumn, ForeignKey, ResultSet, SourceRef
from .sqlguard import ensure_read_only


def _quote(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _odbc(value: str) -> str:
    return "{" + value.replace("}", "}}") + "}"


def _driver() -> str:
    drivers = [name for name in pyodbc.drivers() if "HDBODBC" in name.upper() or "SAP HANA" in name.upper()]
    if not drivers:
        raise ConnectorError("SAP HANA ODBC sürücüsü bulunamadı (HDBODBC kurulmalı)", code="driver_missing")
    return drivers[-1]


def _type_name(value: type) -> str:
    return {str: "text", int: "integer", float: "double", bool: "bool", bytes: "binary"}.get(
        value, getattr(value, "__name__", "text").lower())


class _Extraction:
    def __init__(self, cursor, metadata: list[ColumnInfo]):
        self.cursor = cursor
        by_name = {c.name: c for c in metadata}
        self.columns = [ExtractColumn(
            d[0], d[1] or str, by_name[d[0]].data_type if d[0] in by_name else _type_name(d[1] or str),
            precision=d[4], scale=d[5], nullable=bool(d[6]),
            is_primary_key=by_name[d[0]].is_primary_key if d[0] in by_name else False,
        ) for d in cursor.description]
        self.skipped: list[str] = []

    def fetch(self, n: int) -> list[tuple]:
        return [tuple(row) for row in self.cursor.fetchmany(n)]

    def cancel(self) -> None:
        self.cursor.cancel()


class HanaConnector:
    def __init__(self, spec: ConnectionSpec):
        if not spec.user or not spec.password:
            raise ConnectorError("SAP HANA kullanıcı adı ve şifresi gerekli", code="credentials_required")
        self.spec = spec
        self.driver = _driver()

    @contextmanager
    def _connect(self, timeout: int | None = None):
        connection_string = (
            f"DRIVER={_odbc(self.driver)};SERVERNODE={_odbc(self.spec.server)};"
            f"UID={_odbc(self.spec.user)};PWD={_odbc(self.spec.password)}"
        )
        try:
            con = pyodbc.connect(connection_string, timeout=self.spec.login_timeout, autocommit=True)
            if timeout:
                con.timeout = timeout
            try:
                yield con
            finally:
                con.close()
        except pyodbc.Error as exc:
            # ODBC hata metni bağlantı dizisini taşıyabileceği için açıklamaya eklenmez.
            raise ConnectorError("SAP HANA bağlantısı veya sorgusu başarısız", code="hana_error") from exc

    def _fetch(self, sql: str, params: tuple = (), database: str | None = None) -> list[tuple]:
        with self._connect() as con:
            return [tuple(row) for row in con.cursor().execute(sql, params).fetchall()]

    def test(self) -> dict:
        schema = self._fetch("SELECT CURRENT_SCHEMA FROM DUMMY")[0][0]
        return {"version": "HANA", "edition": "SAP HANA", "database": self.spec.database or schema,
                "login": self.spec.user or ""}

    def list_databases(self) -> list[str]:
        if self.spec.database:
            return [self.spec.database]
        rows = self._fetch("SELECT SCHEMA_NAME FROM SYS.SCHEMAS WHERE SCHEMA_NAME NOT LIKE '_SYS%' "
                           "ORDER BY SCHEMA_NAME LIMIT 1000")
        return [str(row[0]) for row in rows]

    def list_objects(self, database: str) -> list[DbObject]:
        tables = self._fetch("SELECT SCHEMA_NAME, TABLE_NAME FROM SYS.TABLES WHERE SCHEMA_NAME = ?", (database,))
        views = self._fetch("SELECT SCHEMA_NAME, VIEW_NAME FROM SYS.VIEWS WHERE SCHEMA_NAME = ?", (database,))
        return sorted([DbObject(s, n, "TABLE") for s, n in tables] +
                      [DbObject(s, n, "VIEW") for s, n in views], key=lambda item: item.name)

    def columns(self, database: str, schema: str, table: str) -> list[ColumnInfo]:
        rows = self._fetch(
            "SELECT COLUMN_NAME, DATA_TYPE_NAME, IS_NULLABLE, LENGTH, SCALE "
            "FROM SYS.TABLE_COLUMNS WHERE SCHEMA_NAME = ? AND TABLE_NAME = ? ORDER BY POSITION",
            (schema, table),
        )
        if not rows:
            raise ConnectorError(f"{schema}.{table} bulunamadı", code="not_found")
        return [ColumnInfo(str(name), str(dtype), str(nullable).upper() in ("TRUE", "YES", "1"),
                           max_length=length, scale=scale) for name, dtype, nullable, length, scale in rows]

    def foreign_keys(self, database: str) -> list[ForeignKey]:
        return []

    def _execute(self, sql: str, limit: int, timeout: int, metadata: list[ColumnInfo] | None = None) -> ResultSet:
        start = time.perf_counter()
        with self._connect(timeout) as con:
            cursor = con.cursor().execute(sql)
            names = [d[0] for d in cursor.description or []]
            data = [list(row) for row in cursor.fetchmany(limit + 1)]
        by_name = {c.name: c for c in metadata or []}
        columns = [by_name.get(name, ColumnInfo(name, "text", True)) for name in names]
        return ResultSet(columns, data[:limit], truncated=len(data) > limit,
                         elapsed_ms=int((time.perf_counter() - start) * 1000))

    def preview(self, database: str, schema: str, table: str, limit: int = 200) -> ResultSet:
        columns = self.columns(database, schema, table)
        return self._execute(f"SELECT * FROM {_quote(schema)}.{_quote(table)}", max(1, min(limit, 1000)), 60, columns)

    def run_query(self, database: str | None, sql: str, limit: int = 1000, timeout: int = 60) -> ResultSet:
        return self._execute(ensure_read_only(sql, None), limit, timeout)

    @contextmanager
    def extract(self, source: SourceRef, timeout: int = 0):
        if source.table:
            schema = source.schema or self.spec.database
            if not schema:
                raise ConnectorError("SAP HANA şeması gerekli", code="schema_required")
            metadata = self.columns(source.database or "", schema, source.table)
            sql = f"SELECT * FROM {_quote(schema)}.{_quote(source.table)}"
        else:
            sql = ensure_read_only(source.sql or "", None)
            metadata = []
        with self._connect(timeout or None) as con:
            cursor = con.cursor().execute(sql)
            try:
                yield _Extraction(cursor, metadata)
            finally:
                cursor.close()
