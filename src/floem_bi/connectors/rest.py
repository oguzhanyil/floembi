"""JSON dönen REST API'ler için HTTPS, salt okunur bağlayıcı."""

from __future__ import annotations

import json
import posixpath
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager

from .base import ColumnInfo, ConnectionSpec, ConnectorError, DbObject, ExtractColumn, ForeignKey, ResultSet, SourceRef


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def _type(value: object) -> tuple[str, type]:
    if isinstance(value, bool):
        return "bool", bool
    if isinstance(value, int):
        return "integer", int
    if isinstance(value, float):
        return "double", float
    return "text", str


def _cell(value: object) -> object:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return json.dumps(value, ensure_ascii=False)


class RestConnector:
    def __init__(self, spec: ConnectionSpec):
        self.spec = spec
        parsed = urllib.parse.urlparse(spec.server.strip())
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")):
            raise ConnectorError("REST API adresi HTTPS olmalı (yerel testte HTTP kullanılabilir)", code="invalid_url")
        if not parsed.hostname or parsed.username or parsed.password or parsed.fragment or parsed.query:
            raise ConnectorError("REST API adresi geçersiz", code="invalid_url")
        endpoint = (spec.database or "").strip()
        if (not endpoint or endpoint.startswith(("http:", "https:", "//", "/"))
                or ".." in urllib.parse.unquote(endpoint).split("/") or "?" in endpoint or "#" in endpoint):
            raise ConnectorError("REST API için kaynak yolu girin (ör. orders)", code="invalid_endpoint")
        if spec.auth not in ("none", "bearer"):
            raise ConnectorError("REST API kimlik yöntemi desteklenmiyor", code="invalid_auth")
        if spec.auth == "bearer" and not spec.password:
            raise ConnectorError("Erişim belirteci gerekli", code="credentials_required")
        self.base = spec.server.rstrip("/") + "/"
        self.endpoint = endpoint.lstrip("/")
        self.start_url = urllib.parse.urljoin(self.base, self.endpoint)
        self._validate_url(self.start_url)
        self.opener = urllib.request.build_opener(_NoRedirect())

    def _validate_url(self, url: str) -> None:
        base = urllib.parse.urlparse(self.base)
        target = urllib.parse.urlparse(url)
        base_path = posixpath.normpath(urllib.parse.unquote(base.path))
        target_path = posixpath.normpath(urllib.parse.unquote(target.path))
        if ((target.scheme, target.netloc) != (base.scheme, base.netloc)
                or target.username or target.password or target.fragment
                or not target_path.startswith(base_path.rstrip("/") + "/")):
            raise ConnectorError("REST sayfalama adresi kaynak dışına çıkıyor", code="unsafe_next_url")

    def _page(self, url: str) -> tuple[list[dict], str | None]:
        self._validate_url(url)
        headers = {"Accept": "application/json", "User-Agent": "FloemBI/0.1"}
        if self.spec.auth == "bearer":
            headers["Authorization"] = "Bearer " + (self.spec.password or "")
        request = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with self.opener.open(request, timeout=self.spec.login_timeout) as response:
                raw = response.read(10_000_001)
        except urllib.error.HTTPError as exc:
            raise ConnectorError(f"REST API yanıtı: HTTP {exc.code}", code="http_error") from exc
        except (OSError, urllib.error.URLError) as exc:
            raise ConnectorError("REST API adresine ulaşılamadı", code="unreachable") from exc
        if len(raw) > 10_000_000:
            raise ConnectorError("REST API sayfası 10 MB sınırını aşıyor", code="too_large")
        try:
            payload = json.loads(raw)
        except (ValueError, UnicodeError) as exc:
            raise ConnectorError("REST API geçerli JSON döndürmedi", code="invalid_json") from exc
        next_link = None
        if isinstance(payload, list):
            records = payload
        elif isinstance(payload, dict):
            records = next((payload[key] for key in ("items", "data", "results", "records")
                            if isinstance(payload.get(key), list)), None)
            if records is None:
                records = [payload]
            next_link = payload.get("next")
            if not next_link and isinstance(payload.get("pagination"), dict):
                next_link = payload["pagination"].get("next")
        else:
            raise ConnectorError("REST API kayıt listesi döndürmedi", code="invalid_json")
        if not all(isinstance(row, dict) for row in records):
            raise ConnectorError("REST API kayıtları JSON nesnesi olmalı", code="invalid_json")
        if next_link is not None and not isinstance(next_link, str):
            raise ConnectorError("REST API sayfalama bağlantısı geçersiz", code="invalid_next_url")
        next_url = urllib.parse.urljoin(url, next_link) if next_link else None
        if next_url:
            self._validate_url(next_url)
        return records, next_url

    def _columns(self, records: list[dict]) -> list[ColumnInfo]:
        names = list(dict.fromkeys(key for row in records[:100] for key in row))
        return [ColumnInfo(name, _type(next((row[name] for row in records if row.get(name) is not None), ""))[0], True)
                for name in names]

    def test(self) -> dict:
        records, _next = self._page(self.start_url)
        return {"version": "JSON", "edition": "REST API", "database": self.endpoint, "login": self.spec.auth,
                "sample_rows": len(records)}

    def list_databases(self) -> list[str]:
        return [self.endpoint]

    def list_objects(self, database: str) -> list[DbObject]:
        return [DbObject("api", "Kayıtlar", "TABLE")]

    def columns(self, database: str, schema: str, table: str) -> list[ColumnInfo]:
        records, _next = self._page(self.start_url)
        return self._columns(records)

    def foreign_keys(self, database: str) -> list[ForeignKey]:
        return []

    def preview(self, database: str, schema: str, table: str, limit: int = 200) -> ResultSet:
        start = time.perf_counter()
        records, next_url = self._page(self.start_url)
        columns = self._columns(records)
        selected = records[:max(1, min(limit, 1000))]
        rows = [[_cell(row.get(c.name)) for c in columns] for row in selected]
        return ResultSet(columns, rows, truncated=len(records) > len(selected) or bool(next_url),
                         elapsed_ms=int((time.perf_counter() - start) * 1000))

    def run_query(self, database: str | None, sql: str, limit: int = 1000, timeout: int = 60) -> ResultSet:
        raise ConnectorError("REST API kaynağında SQL sorgusu çalıştırılamaz", code="unsupported")

    @contextmanager
    def extract(self, source: SourceRef, timeout: int = 0):
        if source.sql:
            raise ConnectorError("REST API kaynağında SQL sorgusu çalıştırılamaz", code="unsupported")
        records, next_url = self._page(self.start_url)
        columns = self._columns(records)
        if not columns:
            raise ConnectorError("REST API boş kayıt listesi döndürdü; sütunlar belirlenemedi", code="no_columns")
        extraction = _RestExtraction(self, columns, records, next_url)
        yield extraction


class _RestExtraction:
    def __init__(self, connector: RestConnector, columns: list[ColumnInfo], records: list[dict], next_url: str | None):
        self.connector = connector
        self.names = [c.name for c in columns]
        self.columns = [ExtractColumn(c.name, _type(next((r[c.name] for r in records if r.get(c.name) is not None), ""))[1],
                                      c.data_type) for c in columns]
        self.skipped: list[str] = []
        self.buffer = records
        self.next_url = next_url
        self.seen = {connector.start_url}

    def fetch(self, n: int) -> list[tuple]:
        while len(self.buffer) < n and self.next_url:
            if self.next_url in self.seen or len(self.seen) >= 1000:
                raise ConnectorError("REST API sayfalama döngüsü algılandı", code="pagination_loop")
            self.seen.add(self.next_url)
            records, self.next_url = self.connector._page(self.next_url)
            self.buffer.extend(records)
        taken, self.buffer = self.buffer[:n], self.buffer[n:]
        return [tuple(_cell(row.get(name)) for name in self.names) for row in taken]

    def cancel(self) -> None:
        self.next_url = None
        self.buffer.clear()
