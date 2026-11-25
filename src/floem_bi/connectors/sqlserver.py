"""SQL Server bağlayıcısı (pyodbc + Microsoft ODBC Driver).

Power BI'daki "SQL Server veritabanı" bağlayıcısının karşılığı: sunucu,
isteğe bağlı veritabanı, SQL kullanıcısı veya Windows kimliği.
"""

from __future__ import annotations

import re
import time
from contextlib import contextmanager

import pyodbc

from .base import ColumnInfo, ConnectionSpec, ConnectorError, DbObject, ExtractColumn, ForeignKey, ResultSet, SourceRef
from .sqlguard import ensure_read_only

SYSTEM_DATABASES = {"master", "tempdb", "model", "msdb"}

# İçe aktarımda alınmayan tipler (Power BI'da da modelde kullanılamazlar)
SKIP_TYPES = {"binary", "varbinary", "image", "timestamp", "rowversion", "geography", "geometry"}
# Sorgu tarafında metne/UTC'ye çevrilen tipler (pyodbc'nin desteklemediği ya da modelde karşılığı olmayan)
CAST_TYPES = {
    "datetimeoffset": "CAST(SWITCHOFFSET({c}, 0) AS datetime2(7))",
    "xml": "CAST({c} AS nvarchar(max))",
    "hierarchyid": "CAST({c} AS nvarchar(4000))",
    "sql_variant": "CAST({c} AS nvarchar(4000))",
    "time": "CONVERT(varchar(16), {c}, 114)",
}


def pick_driver() -> str:
    """Kurulu en yeni 'ODBC Driver NN for SQL Server' sürücüsünü seçer."""
    best, best_ver = None, -1
    for d in pyodbc.drivers():
        m = re.fullmatch(r"ODBC Driver (\d+) for SQL Server", d)
        if m and int(m.group(1)) > best_ver:
            best, best_ver = d, int(m.group(1))
    if best is None:
        raise ConnectorError(
            "SQL Server için ODBC sürücüsü bulunamadı",
            "Microsoft 'ODBC Driver 18 for SQL Server' kurulmalı",
            code="driver_missing",
        )
    return best


def quote(name: str) -> str:
    return "[" + name.replace("]", "]]") + "]"


def _friendly(e: pyodbc.Error, spec: ConnectionSpec, phase: str = "query") -> ConnectorError:
    raw = str(e)
    state = str(e.args[0]) if e.args else ""
    if "18456" in raw:
        return ConnectorError(f"'{spec.user}' kullanıcısıyla oturum açılamadı: kullanıcı adı veya şifre hatalı", raw, "login_failed")
    if "4060" in raw:
        return ConnectorError("Veritabanı açılamadı (yok ya da bu kullanıcının erişim yetkisi yok)", raw, "database_denied")
    if "SSL" in raw or "certificate" in raw.lower():
        return ConnectorError("Sunucu sertifikası doğrulanamadı ('Sunucu sertifikasına güven' seçeneğini deneyin)", raw, "tls")
    if phase == "connect" and (state in ("08001", "HYT00", "08S01") or "timeout" in raw.lower()):
        return ConnectorError(f"'{spec.server}' sunucusuna ulaşılamadı (ad/port, ağ veya güvenlik duvarını kontrol edin)", raw, "unreachable")
    if state == "HYT00" or "timeout" in raw.lower():
        return ConnectorError("Sorgu zaman aşımına uğradı", raw, "timeout")
    if "229" in raw or "permission" in raw.lower():
        return ConnectorError("Bu işlem için yetkiniz yok", raw, "permission_denied")
    if state.startswith("42"):
        return ConnectorError("SQL hatası", raw, "sql_error")
    return ConnectorError("SQL Server hatası", raw, "error")


class SqlServerConnector:
    def __init__(self, spec: ConnectionSpec):
        if spec.auth == "sql" and not spec.user:
            raise ConnectorError("SQL kimlik doğrulaması için kullanıcı adı gerekli", code="invalid")
        self.spec = spec
        self.driver = pick_driver()

    # ------------------------------------------------------------ bağlantı
    def _conn_str(self, database: str | None) -> str:
        parts = [
            f"DRIVER={{{self.driver}}}",
            f"SERVER={self.spec.server}",
            "APP=Floem BI",
            "ApplicationIntent=ReadOnly",
        ]
        db = database or self.spec.database
        if db:
            parts.append(f"DATABASE={{{db}}}")
        if self.spec.auth == "windows":
            parts.append("Trusted_Connection=yes")
        else:
            parts.append(f"UID={{{self.spec.user}}}")
            parts.append(f"PWD={{{(self.spec.password or '').replace('}', '}}')}}}")
        if self.spec.trust_server_certificate:
            parts.append("TrustServerCertificate=yes")
        return ";".join(parts)

    @contextmanager
    def _connect(self, database: str | None = None, timeout: int | None = None):
        try:
            cn = pyodbc.connect(self._conn_str(database), timeout=self.spec.login_timeout, autocommit=True)
        except pyodbc.Error as e:
            raise _friendly(e, self.spec, "connect") from e
        try:
            if timeout:
                cn.timeout = timeout
            yield cn
        except pyodbc.Error as e:
            raise _friendly(e, self.spec) from e
        finally:
            cn.close()

    def _fetch(self, sql: str, params=(), database: str | None = None) -> list[tuple]:
        with self._connect(database) as cn:
            return [tuple(r) for r in cn.cursor().execute(sql, params).fetchall()]

    # ------------------------------------------------------------- sözleşme
    def test(self) -> dict:
        rows = self._fetch(
            "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(64)), "
            "CAST(SERVERPROPERTY('Edition') AS nvarchar(128)), DB_NAME(), SUSER_SNAME()"
        )
        version, edition, db, login = rows[0]
        return {"version": version, "edition": edition, "database": db, "login": login}

    def list_databases(self) -> list[str]:
        rows = self._fetch(
            "SELECT name FROM sys.databases WHERE state = 0 AND HAS_DBACCESS(name) = 1 ORDER BY name"
        )
        return [r[0] for r in rows if r[0] not in SYSTEM_DATABASES]

    def list_objects(self, database: str) -> list[DbObject]:
        rows = self._fetch(
            """
            SELECT s.name, o.name, CASE o.type WHEN 'U' THEN 'TABLE' ELSE 'VIEW' END,
                   (SELECT SUM(p.rows) FROM sys.partitions p
                     WHERE p.object_id = o.object_id AND p.index_id IN (0, 1))
            FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
            WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0
            ORDER BY s.name, o.name
            """,
            database=database,
        )
        return [DbObject(r[0], r[1], r[2], int(r[3]) if r[3] is not None else None) for r in rows]

    def columns(self, database: str, schema: str, table: str) -> list[ColumnInfo]:
        rows = self._fetch(
            """
            SELECT c.name, t.name, c.is_nullable, c.max_length, c.precision, c.scale,
                   CASE WHEN EXISTS (
                     SELECT 1 FROM sys.index_columns ic JOIN sys.indexes i
                       ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                     WHERE i.is_primary_key = 1 AND ic.object_id = c.object_id AND ic.column_id = c.column_id
                   ) THEN 1 ELSE 0 END
            FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
            WHERE c.object_id = OBJECT_ID(?)
            ORDER BY c.column_id
            """,
            (f"{quote(schema)}.{quote(table)}",),
            database=database,
        )
        if not rows:
            raise ConnectorError(f"{schema}.{table} bulunamadı", code="not_found")
        return [ColumnInfo(r[0], r[1], bool(r[2]), r[3], r[4], r[5], bool(r[6])) for r in rows]

    def foreign_keys(self, database: str) -> list[ForeignKey]:
        rows = self._fetch(
            """
            SELECT ps.name, pt.name, pc.name, rs.name, rt.name, rc.name, OBJECT_NAME(k.constraint_object_id)
            FROM sys.foreign_key_columns k
            JOIN sys.tables pt ON pt.object_id = k.parent_object_id
            JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
            JOIN sys.columns pc ON pc.object_id = k.parent_object_id AND pc.column_id = k.parent_column_id
            JOIN sys.tables rt ON rt.object_id = k.referenced_object_id
            JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
            JOIN sys.columns rc ON rc.object_id = k.referenced_object_id AND rc.column_id = k.referenced_column_id
            """,
            database=database,
        )
        return [ForeignKey(*r) for r in rows]

    def preview(self, database: str, schema: str, table: str, limit: int = 200) -> ResultSet:
        limit = max(1, min(int(limit), 1000))
        sql = f"SELECT TOP ({limit}) * FROM {quote(schema)}.{quote(table)}"
        return self._execute(database, sql, limit, timeout=60)

    def run_query(self, database: str | None, sql: str, limit: int = 1000, timeout: int = 60) -> ResultSet:
        checked = ensure_read_only(sql, "tsql")
        return self._execute(database, checked, limit, timeout)

    # ------------------------------------------------------------ içe aktarım
    @contextmanager
    def extract(self, source: SourceRef, timeout: int = 0):
        """Kaynağı parça parça okumak için açık bir imleç verir (bkz. base.Extraction)."""
        skipped: list[str] = []
        pk: set[str] = set()
        src_types: dict[str, str] = {}
        if source.table:
            cols = self.columns(source.database, source.schema or "dbo", source.table)
            select = []
            for c in cols:
                t = c.data_type.lower()
                if t in SKIP_TYPES:
                    skipped.append(c.name)
                    continue
                expr = CAST_TYPES.get(t, "{c}").format(c=quote(c.name))
                select.append(expr if expr == quote(c.name) else f"{expr} AS {quote(c.name)}")
                src_types[c.name] = t
                if c.is_primary_key:
                    pk.add(c.name)
            if not select:
                raise ConnectorError(f"{source.label()}: içe aktarılabilir sütun yok", code="no_columns")
            sql = f"SELECT {', '.join(select)} FROM {quote(source.schema or 'dbo')}.{quote(source.table)}"
        elif source.procedure:
            sql = f"EXEC {quote(source.schema or 'dbo')}.{quote(source.procedure)}"
            if source.arguments:
                sql += " " + ", ".join("?" for _ in source.arguments)
        else:
            sql = ensure_read_only(source.sql or "", "tsql")
        with self._connect(source.database, timeout=timeout) as cn:
            cn.add_output_converter(-155, _datetimeoffset)
            cur = cn.cursor()
            try:
                if source.procedure:
                    cur.execute(sql, *source.arguments)
                    while cur.description is None and cur.nextset():
                        pass
                else:
                    cur.execute(sql)
            except pyodbc.Error as e:
                raise _friendly(e, self.spec) from e
            if cur.description is None:
                raise ConnectorError("Sorgu sonuç kümesi döndürmedi", code="no_result")
            yield _SqlServerExtraction(cur, self.spec, pk, src_types, skipped)

    # ------------------------------------------------------------ yürütme
    def _execute(self, database: str | None, sql: str, limit: int, timeout: int) -> ResultSet:
        started = time.perf_counter()
        with self._connect(database, timeout=timeout) as cn:
            cur = cn.cursor()
            cur.execute(sql)
            if cur.description is None:
                raise ConnectorError("Sorgu sonuç kümesi döndürmedi", code="no_result")
            cols = [
                ColumnInfo(d[0] or f"Sütun{i + 1}", _odbc_type(d[1]), bool(d[6]), d[3], d[4], d[5])
                for i, d in enumerate(cur.description)
            ]
            batch = cur.fetchmany(limit + 1)
            truncated = len(batch) > limit
            rows = [list(r) for r in batch[:limit]]
            cur.cancel() if truncated else None
        return ResultSet(cols, rows, truncated, int((time.perf_counter() - started) * 1000))


class _SqlServerExtraction:
    def __init__(self, cur, spec, pk: set[str], src_types: dict[str, str], skipped: list[str]):
        self._cur = cur
        self._spec = spec
        self.skipped = list(skipped)
        self.columns: list[ExtractColumn] = []
        self._keep: list[int] = []
        for i, d in enumerate(cur.description):
            name = d[0] or f"Sütun{i + 1}"
            if d[1] in (bytes, bytearray):
                self.skipped.append(name)          # SQL sorgusunda gelen ikili sütun
                continue
            self._keep.append(i)
            self.columns.append(ExtractColumn(
                name=name, py_type=d[1], source_type=src_types.get(name, _odbc_type(d[1])),
                precision=d[4], scale=d[5], nullable=bool(d[6]), is_primary_key=name in pk,
            ))
        self._all = len(self._keep) == len(cur.description)

    def fetch(self, n: int) -> list[tuple]:
        try:
            rows = self._cur.fetchmany(n)
        except pyodbc.Error as e:
            raise _friendly(e, self._spec) from e
        if self._all:
            return [tuple(r) for r in rows]
        keep = self._keep
        return [tuple(r[i] for i in keep) for r in rows]

    def cancel(self) -> None:
        try:
            self._cur.cancel()
        except pyodbc.Error:
            pass


def _datetimeoffset(raw: bytes):
    """ODBC SQL_SS_TIMESTAMPOFFSET (-155) → UTC datetime (SQL sorgularında gelirse)."""
    import struct
    from datetime import datetime, timedelta, timezone

    y, mo, d, h, mi, s, ns, tzh, tzm = struct.unpack("<6hI2h", raw)
    local = datetime(y, mo, d, h, mi, s, ns // 1000, tzinfo=timezone(timedelta(hours=tzh, minutes=tzm)))
    return local.astimezone(timezone.utc).replace(tzinfo=None)


def _odbc_type(py_type) -> str:
    return {
        str: "text", int: "integer", float: "float", bool: "bit", bytes: "binary", bytearray: "binary",
    }.get(py_type, getattr(py_type, "__name__", str(py_type)).lower())


def make_connector(spec: ConnectionSpec):
    if spec.kind == "sqlserver":
        return SqlServerConnector(spec)
    if spec.kind == "sqlite":
        from .sqlite import SQLiteConnector
        return SQLiteConnector(spec)
    if spec.kind == "hana":
        from .hana import HanaConnector
        return HanaConnector(spec)
    if spec.kind == "rest":
        from .rest import RestConnector
        return RestConnector(spec)
    raise ConnectorError(f"Desteklenmeyen kaynak türü: {spec.kind}", code="invalid")
