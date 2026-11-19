"""Veri kaynağı bağlayıcıları için ortak sözleşme.

Desktop (doğrudan bağlantı) ve Gateway (müşteri ağında) aynı bağlayıcıları
kullanır. Bağlayıcı yalnızca okur: SQL penceresine gelen sorgular
`sqlguard.ensure_read_only` ile denetlenir.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, ContextManager, Protocol


class ConnectorError(Exception):
    """Kullanıcıya gösterilecek, anlaşılır hata.

    message: Türkçe açıklama ("Kullanıcı adı veya şifre hatalı")
    detail:  kaynaktan gelen ham hata metni (destek için)
    code:    makine tarafından okunabilir kod (login_failed, unreachable, ...)
    """

    def __init__(self, message: str, detail: str = "", code: str = "error"):
        self.message = message
        self.detail = detail
        self.code = code
        super().__init__(message if not detail else f"{message} — {detail}")


@dataclass
class ConnectionSpec:
    kind: str                       # sqlserver | sqlite | hana | rest
    server: str                     # "SUNUCU\\INSTANCE" veya "10.0.0.5,1433"
    database: str | None = None     # boşsa sunucudaki varsayılan
    auth: str = "sql"               # sql | windows | none | bearer
    user: str | None = None
    password: str | None = field(default=None, repr=False)
    trust_server_certificate: bool = True
    login_timeout: int = 15

    def public(self) -> dict[str, Any]:
        """Şifresiz, dosyaya/arayüze yazılabilir hali."""
        return {
            "kind": self.kind,
            "server": self.server,
            "database": self.database,
            "auth": self.auth,
            "user": self.user,
            "trust_server_certificate": self.trust_server_certificate,
        }


@dataclass
class DbObject:
    schema: str
    name: str
    type: str                       # "TABLE" | "VIEW"
    row_count: int | None = None


@dataclass
class ColumnInfo:
    name: str
    data_type: str                  # kaynaktaki tip: nvarchar, decimal, datetime...
    nullable: bool
    max_length: int | None = None
    precision: int | None = None
    scale: int | None = None
    is_primary_key: bool = False


@dataclass
class ForeignKey:
    from_schema: str
    from_table: str
    from_column: str
    to_schema: str
    to_table: str
    to_column: str
    constraint: str = ""            # birden çok sütunlu anahtarları ayırt etmek için


@dataclass
class ResultSet:
    columns: list[ColumnInfo]
    rows: list[list[Any]]
    truncated: bool = False
    elapsed_ms: int = 0


@dataclass
class SourceRef:
    """İçe aktarılacak kaynak: tablo/görünüm ya da SQL sorgusu."""
    database: str | None
    schema: str | None = None
    table: str | None = None
    sql: str | None = None

    def label(self) -> str:
        return f"{self.schema}.{self.table}" if self.table else "SQL sorgusu"


@dataclass
class ExtractColumn:
    name: str
    py_type: type                   # pyodbc'nin bildirdiği Python tipi (Decimal, datetime, str...)
    source_type: str                # kaynaktaki tip adı (biliniyorsa)
    precision: int | None = None
    scale: int | None = None
    nullable: bool = True
    is_primary_key: bool = False


class Extraction(Protocol):
    """Açık bir okuma imleci. `fetch` boş liste döndürene kadar çağrılır."""
    columns: list[ExtractColumn]
    skipped: list[str]              # desteklenmeyen tip nedeniyle alınmayan sütunlar

    def fetch(self, n: int) -> list[tuple]: ...
    def cancel(self) -> None: ...


class Connector(Protocol):
    spec: ConnectionSpec

    def test(self) -> dict[str, Any]: ...
    def list_databases(self) -> list[str]: ...
    def list_objects(self, database: str) -> list[DbObject]: ...
    def columns(self, database: str, schema: str, table: str) -> list[ColumnInfo]: ...
    def foreign_keys(self, database: str) -> list[ForeignKey]: ...
    def preview(self, database: str, schema: str, table: str, limit: int = 200) -> ResultSet: ...
    def run_query(self, database: str | None, sql: str, limit: int = 1000, timeout: int = 60) -> ResultSet: ...
    def extract(self, source: SourceRef, timeout: int = 0) -> "ContextManager[Extraction]": ...


def json_value(v: Any) -> Any:
    """Sonuç değerlerini JSON'a güvenle çevirir."""
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, Decimal):
        # Tam sayıysa int, değilse float (önizleme için yeterli; içe aktarım Arrow ile tam hassasiyetli)
        return int(v) if v == v.to_integral_value() and abs(v) < 2**53 else float(v)
    if isinstance(v, (datetime, date, time)):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray, memoryview)):
        b = bytes(v)
        return "0x" + b[:32].hex().upper() + ("…" if len(b) > 32 else "")
    return str(v)
