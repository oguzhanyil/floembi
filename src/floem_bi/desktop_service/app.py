"""Floem BI Desktop yerel servisi.

Electron uygulaması bu servisi başlatır; arayüz yalnızca 127.0.0.1 üzerinden
ve oturum token'ıyla (X-Floem-Token) erişir. Desktop doğrudan kaynağa
bağlanır (Power BI Desktop gibi); gateway gerekmez.

Servis aynı anda tek bir açık belge (rapor) tutar; Power BI Desktop'taki gibi.
"""

from __future__ import annotations

import hmac
import os
import shutil
import threading
from pathlib import Path
from typing import Any, Callable, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError, BaseModel, ConfigDict, Field, model_validator

from ..connectors import ConnectionSpec, ConnectorError, ResultSet, SourceRef, json_value
from ..connectors.sqlserver import make_connector
from ..document import Document, DocumentError, FloemFileError, ImportItem, Job, JobConflict, JobRunner, JobTable, OpsIn
from ..model.schema import VeriKaynagi
from ..model.semantic import ModelError
from ..transform import parse_steps
from ..report import QueryError, VisualQuery
from .connections import ConnectionStore
from .publish import PublishClient
from .component_library import ComponentStore
from ..report.schema import ComponentDefinition
from ..document.print_forms import FormKind, PrintTemplate, read_form
from ..compiler import CompileError
from ..paginated.schema import Library, Run as PaginatedRun
from ..paginated.source import SnapshotSource
from ..paginated.service import run as run_paginated


class ConnectionIn(BaseModel):
    kind: Literal["sqlserver", "sqlite", "hana", "rest"] = "sqlserver"
    server: str = Field(min_length=1)
    database: str | None = None
    auth: Literal["sql", "windows", "none", "bearer"] = "sql"
    user: str | None = None
    password: str | None = None
    trust_server_certificate: bool = True
    remember_password: bool = True


class SqlIn(BaseModel):
    database: str | None = None
    sql: str
    limit: int = Field(default=1000, ge=1, le=100_000)
    timeout: int = Field(default=60, ge=1, le=3600)


class ImportItemIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    database: str | None = None                  # verilmezse ImportIn.database
    schema_: str | None = Field(default=None, alias="schema")
    table: str | None = None
    procedure: str | None = Field(default=None, min_length=1, max_length=128)
    arguments: list[str | float | int | bool | None] = Field(default_factory=list, max_length=64)
    sql: str | None = None
    name: str | None = None

    @model_validator(mode="after")
    def _one(self):
        if sum(bool(x) for x in (self.table, self.sql, self.procedure)) != 1 or self.arguments and not self.procedure:
            raise ValueError("Tablo, SQL sorgusu veya yordamdan birini seçin")
        return self


class ImportIn(BaseModel):
    connection_id: str
    database: str | None = None
    items: list[ImportItemIn] = Field(min_length=1, max_length=200)


class TransformIn(BaseModel):
    table: str
    adimlar: list[dict[str, Any]] = Field(default_factory=list, max_length=200)
    upto: int | None = Field(default=None, ge=0)          # yalnızca önizleme: bu adıma kadar
    limit: int = Field(default=1000, ge=1, le=5000)


class RefreshIn(BaseModel):
    tables: list[str] | None = None


class PathIn(BaseModel):
    path: str = Field(min_length=1)


class SaveIn(BaseModel):
    path: str | None = None


class NewIn(BaseModel):
    name: str | None = None


class LibraryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    components: list[ComponentDefinition] = Field(max_length=500)
    revision: int = Field(ge=0)


class DiagramIn(BaseModel):
    tables: dict[str, dict[str, Any]]
    auto: bool = False                  # açılıştaki otomatik yerleşim belgeyi "değişti" saymaz


class PublishLoginIn(BaseModel):
    server_url: str = Field(min_length=1)
    email: str = Field(min_length=3)
    password: str = Field(min_length=1)


class PublishIn(BaseModel):
    workspace_id: int
    gateway_id: int | None = None


class DaxIn(BaseModel):
    expression: str
    table: str | None = None


class RowsIn(BaseModel):
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=500, ge=1, le=5000)
    sort: dict[str, Any] | None = None                 # {"column": ad, "desc": bool}
    filters: list[dict[str, Any]] = Field(default_factory=list, max_length=50)   # [{"column", "values"}]


class ProfileIn(BaseModel):
    kimden: str
    kime: str


def default_work_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or str(Path.home())
    return Path(base) / "FloemBI" / "work"


def _result(rs: ResultSet) -> dict:
    return {
        "columns": [{"name": c.name, "type": c.data_type} for c in rs.columns],
        "rows": [[json_value(v) for v in row] for row in rs.rows],
        "truncated": rs.truncated,
        "elapsed_ms": rs.elapsed_ms,
        "row_count": len(rs.rows),
    }


def create_app(
    token: str,
    store: ConnectionStore | None = None,
    connector_factory: Callable[[ConnectionSpec], object] = make_connector,
    work_dir: Path | None = None,
    open_path: str | None = None,
) -> FastAPI:
    app = FastAPI(title="Floem BI Desktop servis", version="0.1.0", docs_url=None, redoc_url=None)
    # Geliştirme modunda arayüz Vite'tan (http://127.0.0.1:5199) yüklenir; tarayıcı bu kaynaktan
    # servise giden istekler için CORS izni ister. Yalnızca Electron'un bildirdiği o tek adrese
    # izin verilir; derlenmiş uygulamada değişken yoktur ve hiçbir kaynağa izin açılmaz.
    dev_origin = os.environ.get("FLOEM_ALLOW_ORIGIN", "").strip()
    if dev_origin:
        app.add_middleware(
            CORSMiddleware, allow_origins=[dev_origin], allow_methods=["*"],
            allow_headers=["X-Floem-Token", "Content-Type"], allow_credentials=False,
        )
    store = store or ConnectionStore()
    work_dir = Path(work_dir or default_work_dir())
    # Önceki oturumlardan kalan çalışma klasörleri (Electron tek örnek çalıştırır)
    if work_dir.exists():
        for d in work_dir.iterdir():
            shutil.rmtree(d, ignore_errors=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    runner = JobRunner()
    publisher = PublishClient(store.dir)
    component_store = ComponentStore(store.dir)
    startup_error: dict | None = None
    first: Document | None = None
    def load_document(path):
        if Path(path).suffix.lower() == ".floem": return Document.open(work_dir, path)
        from ..powerbi_worker import import_isolated
        return import_isolated(work_dir, path)
    if open_path:                                   # .floem dosyasına çift tıklayarak açılış
        try:
            first = load_document(open_path)
        except FloemFileError as e:
            startup_error = {"code": "file_error", "message": e.message, "detail": e.detail}
    holder: dict[str, Document] = {"doc": first or Document.new(work_dir)}
    app.state.startup_error = startup_error
    app.state.runner = runner
    app.state.holder = holder
    loading_lock = threading.Lock()

    def doc() -> Document:
        return holder["doc"]

    def replace_doc(new: Document) -> None:
        old = holder["doc"]
        holder["doc"] = new
        old.close()

    def ensure_idle() -> None:
        if runner.active():
            raise JobConflict("İçe aktarım ya da yenileme sürerken bu işlem yapılamaz")

    def auth(x_floem_token: str = Header(default="")) -> None:
        if not hmac.compare_digest(x_floem_token, token):
            raise HTTPException(status_code=401, detail="Geçersiz oturum")

    def _err(status: int, code: str, message: str, detail: str = ""):
        return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "detail": detail}})

    @app.exception_handler(ConnectorError)
    async def _connector_error(_: Request, e: ConnectorError):
        return _err(400, e.code, e.message, e.detail)

    @app.exception_handler(DocumentError)
    async def _document_error(_: Request, e: DocumentError):
        return _err(400, e.code, e.message, e.detail)

    @app.exception_handler(FloemFileError)
    async def _file_error(_: Request, e: FloemFileError):
        return _err(400, "file_error", e.message, e.detail)

    @app.exception_handler(ModelError)
    async def _model_error(_: Request, e: ModelError):
        return _err(400, "model_error", str(e))

    @app.exception_handler(QueryError)
    async def _query_error(_: Request, e: QueryError):
        return _err(400, "query_error", "Görsel sorgusu çalıştırılamadı", str(e))

    @app.exception_handler(JobConflict)
    async def _job_conflict(_: Request, e: JobConflict):
        return _err(409, "busy", str(e))

    def connector(cid: str):
        return connector_factory(store.get(cid))

    def connector_for_source(kaynak_id: str):
        """Modeldeki veri kaynağı için kayıtlı bağlantıyı bulur (başka makinede kaydedilmiş dosyalar dahil)."""
        k = next((x for x in doc().tanim.veri_kaynaklari if x.id == kaynak_id), None)
        try:
            return connector_factory(store.get(kaynak_id))
        except ConnectorError as e:
            if e.code != "not_found" or k is None:
                raise
        cid = store.find(k.sunucu, k.veritabani, k.kimlik, k.kullanici)
        if cid is None:
            raise ConnectorError(
                f"'{k.sunucu}' kaynağı için bu bilgisayarda kayıtlı bağlantı yok. "
                "Veri al → SQL Server ile bu sunucuya bir kez bağlanın, sonra yeniden yenileyin.",
                code="credentials_required",
            )
        return connector_factory(store.get(cid))

    @app.get("/health")
    def health():
        return {"ok": True}

    # -------------------------------------------------------- bağlantılar
    @app.post("/connections", dependencies=[Depends(auth)])
    def add_connection(c: ConnectionIn):
        spec = ConnectionSpec(
            kind=c.kind, server=c.server.strip(), database=(c.database or None), auth=c.auth,
            user=c.user, password=c.password if c.auth in ("sql", "bearer") else None,
            trust_server_certificate=c.trust_server_certificate,
        )
        conn = connector_factory(spec)
        info = conn.test()                       # başarısızsa ConnectorError → 400
        databases = conn.list_databases()
        cid = store.add(spec, c.remember_password)
        return {"id": cid, **spec.public(), "server_info": info, "databases": databases}

    @app.get("/connections", dependencies=[Depends(auth)])
    def list_connections():
        return store.list()

    @app.delete("/connections/{cid}", dependencies=[Depends(auth)])
    def delete_connection(cid: str):
        store.remove(cid)
        return {"ok": True}

    # --------------------------------------------------------- Navigator
    @app.get("/connections/{cid}/databases", dependencies=[Depends(auth)])
    def databases(cid: str):
        return connector(cid).list_databases()

    @app.get("/connections/{cid}/objects", dependencies=[Depends(auth)])
    def objects(cid: str, database: str):
        return [o.__dict__ for o in connector(cid).list_objects(database)]

    @app.get("/connections/{cid}/columns", dependencies=[Depends(auth)])
    def columns(cid: str, database: str, schema: str, table: str):
        return [c.__dict__ for c in connector(cid).columns(database, schema, table)]

    @app.get("/connections/{cid}/preview", dependencies=[Depends(auth)])
    def preview(cid: str, database: str, schema: str, table: str, limit: int = 200):
        return _result(connector(cid).preview(database, schema, table, limit))

    @app.get("/connections/{cid}/foreign-keys", dependencies=[Depends(auth)])
    def foreign_keys(cid: str, database: str):
        return [f.__dict__ for f in connector(cid).foreign_keys(database)]

    # ------------------------------------------------------ SQL penceresi
    @app.post("/connections/{cid}/sql", dependencies=[Depends(auth)])
    def run_sql(cid: str, q: SqlIn):
        return _result(connector(cid).run_query(q.database, q.sql, q.limit, q.timeout))

    # ------------------------------------------------------------- belge
    @app.get("/document", dependencies=[Depends(auth)])
    def get_document():
        state = doc().state()
        if app.state.startup_error:                 # açılışta dosya açılamadıysa bir kez bildir
            state["startup_error"] = app.state.startup_error
            app.state.startup_error = None
        return state

    @app.post("/document/new", dependencies=[Depends(auth)])
    def new_document(body: NewIn | None = None):
        ensure_idle()
        replace_doc(Document.new(work_dir, (body.name if body and body.name else None) or "Adsız rapor"))
        return doc().state()

    @app.post("/document/open", dependencies=[Depends(auth)])
    def open_document(body: PathIn):
        ensure_idle()
        if not loading_lock.acquire(blocking=False):
            raise DocumentError("Bir dosya açılıyor; işlem tamamlanana kadar bekleyin", code="file_busy")
        try:
            candidate = load_document(body.path)
            replace_doc(candidate)
            return doc().state()
        finally:
            loading_lock.release()

    @app.post("/document/save", dependencies=[Depends(auth)])
    def save_document(body: SaveIn | None = None):
        ensure_idle()
        doc().save(body.path if body else None)
        return doc().state()

    @app.post("/document/ops", dependencies=[Depends(auth)])
    def apply_ops(body: OpsIn):
        doc().apply_ops(body.ops)
        return doc().state()

    @app.put("/document/diagram", dependencies=[Depends(auth)])
    def set_diagram(body: DiagramIn):
        doc().set_diagram(body.tables, mark_dirty=not body.auto)
        return {"ok": True, "dirty": doc().dirty}

    @app.get("/library/components", dependencies=[Depends(auth)])
    def component_library():
        try:
            return component_store.load().model_dump(mode="json", exclude_none=True)
        except (ValueError, OSError) as e:
            raise DocumentError("Bileşen kitaplığı okunamadı", str(e), code="library_invalid") from e

    @app.put("/library/components", dependencies=[Depends(auth)])
    def save_component_library(body: LibraryIn):
        try:
            return component_store.save(body.components, body.revision).model_dump(mode="json", exclude_none=True)
        except FileExistsError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e
        except (ValueError, OSError) as e:
            raise DocumentError("Bileşen kitaplığı kaydedilemedi", str(e), code="library_invalid") from e

    @app.put("/document/report", dependencies=[Depends(auth)])
    def set_report(body: dict[str, Any]):
        try:
            doc().set_report(body)
        except ValueError as e:                      # pydantic doğrulama hatası
            raise DocumentError("Rapor tanımı geçersiz", str(e), code="report_invalid") from e
        return {"ok": True, "dirty": doc().dirty}

    def print_document(document_id: str):
        current = doc()
        if current.id != document_id:
            raise DocumentError("Açık rapor değişti. Belgeyi yeniden seçin.")
        return current

    @app.put("/document/{document_id}/print-template", dependencies=[Depends(auth)])
    def put_print_template(document_id: str, body: PrintTemplate):
        print_document(document_id).set_print_template(body)
        return {"ok": True}

    @app.put("/document/{document_id}/paginated", dependencies=[Depends(auth)])
    def save_paginated(document_id: str, body: Library):
        current = print_document(document_id)
        with current.lock:
            if current.closed:
                raise DocumentError("Açık rapor değişti")
            if body != current.content.paginated:
                current.content.paginated = body
                current._touch()
        return {"ok": True}

    @app.post("/document/{document_id}/paginated/run", dependencies=[Depends(auth)])
    def preview_paginated(document_id: str, body: PaginatedRun):
        current = print_document(document_id)
        try:
            with current.lock:
                return run_paginated(current.content.paginated, body, SnapshotSource(*current._semantic_engine()))
        except (ValueError, ModelError, CompileError, ArithmeticError) as e:
            raise DocumentError(str(e), code="paginated") from e

    @app.get("/document/{document_id}/print-data/{kind}", dependencies=[Depends(auth)])
    def print_data(document_id: str, kind: FormKind, record: str | None = None, search: str = ""):
        try:
            return read_form(print_document(document_id), kind, record, search)
        except ValueError as e:
            raise DocumentError(str(e), code="print_data") from e

    @app.post("/document/query", dependencies=[Depends(auth)])
    def visual_query(body: VisualQuery, view_as: list[str] = Query(default_factory=list), upn: str | None = None):
        # view_as: "Farklı görüntüle" (rollerin RLS filtreleriyle), upn: USERPRINCIPALNAME() değeri
        return doc().query(body, view_as or None, upn)

    @app.get("/document/tables/{table}/preview", dependencies=[Depends(auth)])
    def table_preview(table: str, limit: int = 100):
        return doc().preview(table, max(1, min(limit, 1000)))

    @app.post("/document/tables/{table}/rows", dependencies=[Depends(auth)])
    def table_rows(table: str, body: RowsIn):
        return doc().table_rows(table, body.offset, body.limit, body.sort, body.filters)

    @app.get("/document/tables/{table}/values", dependencies=[Depends(auth)])
    def column_values(table: str, column: str):
        return doc().column_values(table, column)

    def _steps(body: TransformIn) -> list[dict]:
        try:
            parse_steps(body.adimlar)
        except ValidationError as e:
            first = e.errors()[0]
            where = first["loc"][1] + 1 if len(first["loc"]) > 1 and isinstance(first["loc"][1], int) else None
            raise DocumentError(
                f"Adım {where}: tanım geçersiz" if where else "Adım tanımı geçersiz", first.get("msg", ""),
                code="transform_invalid",
            ) from e
        return body.adimlar

    @app.post("/document/transform/preview", dependencies=[Depends(auth)])
    def transform_preview(body: TransformIn):
        return doc().transform_preview(body.table, _steps(body), body.upto, body.limit)

    @app.post("/document/transform/apply", dependencies=[Depends(auth)])
    def transform_apply(body: TransformIn):
        result = doc().apply_steps(body.table, _steps(body))
        return {**result, "document": doc().state()}

    @app.post("/document/dax/validate", dependencies=[Depends(auth)])
    def dax_validate(body: DaxIn):
        return doc().validate_dax(body.expression, body.table)

    @app.post("/document/relationship-profile", dependencies=[Depends(auth)])
    def relationship_profile(body: ProfileIn):
        return doc().relationship_profile(body.kimden, body.kime)

    # ------------------------------------------------- içe aktarım / yenileme
    @app.post("/document/import", dependencies=[Depends(auth)])
    def start_import(body: ImportIn):
        spec = store.get(body.connection_id)          # şifre kayıtlı değilse credentials_required
        conn = connector_factory(spec)
        d = doc()
        if spec.kind != "sqlserver" and any(it.procedure for it in body.items):
            raise DocumentError("Saklı yordam için SQL Server bağlantısı seçin")
        items = [
            ImportItem(
                SourceRef(it.database or body.database, it.schema_ or ("dbo" if spec.kind == "sqlserver" else "main"),
                          it.table, it.sql, it.procedure, tuple(it.arguments)),
                it.name,
            )
            for it in body.items
        ]
        names = d.plan_names(items)
        kaynak = VeriKaynagi(
            id=body.connection_id, tur=spec.kind, sunucu=spec.server, veritabani=spec.database,
            kimlik=spec.auth, kullanici=spec.user,
        )
        job = Job("import", d.id, [JobTable(n, it.source.label()) for n, it in zip(names, items)])
        runner.start(job, lambda j: d.run_import(j, conn, kaynak, items, names))
        return job.to_dict()

    @app.post("/document/refresh", dependencies=[Depends(auth)])
    def start_refresh(body: RefreshIn | None = None):
        d = doc()
        targets = d.refresh_targets(body.tables if body else None)
        if not targets:
            raise DocumentError("Yenilenecek tablo yok (kaynağa bağlı tablo bulunmuyor)", code="nothing_to_refresh")
        job = Job("refresh", d.id, [
            JobTable(t.ad, f"{t.sorgu.sema}.{t.sorgu.tablo}" if t.sorgu.tablo else "SQL sorgusu") for t in targets
        ])
        runner.start(job, lambda j: d.run_refresh(j, connector_for_source, targets))
        return job.to_dict()

    # ------------------------------------------------------------ yayımlama
    @app.get("/publish/session", dependencies=[Depends(auth)])
    def publish_session():
        return publisher.state()

    @app.post("/publish/login", dependencies=[Depends(auth)])
    def publish_login(body: PublishLoginIn):
        return publisher.login(body.server_url, body.email, body.password)

    @app.post("/publish/logout", dependencies=[Depends(auth)])
    def publish_logout():
        publisher.logout()
        return publisher.state()

    @app.get("/publish/workspaces", dependencies=[Depends(auth)])
    def publish_workspaces():
        return publisher.workspaces()

    @app.get("/publish/gateways/{workspace_id}", dependencies=[Depends(auth)])
    def publish_gateways(workspace_id: int):
        return publisher.gateways(workspace_id)

    @app.post("/publish", dependencies=[Depends(auth)])
    def publish(body: PublishIn):
        ensure_idle()
        d = doc()
        # Power BI gibi: yayımlanan, diske kaydedilmiş dosyadır
        if not d.path or d.dirty:
            raise DocumentError(
                "Yayımlamadan önce raporu kaydedin" if d.path else "Yayımlamadan önce raporu bir dosyaya kaydedin",
                code="save_required",
            )
        if not d.tanim.tablolar:
            raise DocumentError("Yayımlanacak veri yok; önce tablo yükleyin", code="nothing_to_publish")
        sources = []
        used = {t.sorgu.kaynak for t in d.tanim.tablolar if t.sorgu}
        for k in d.tanim.veri_kaynaklari:
            if k.id not in used or k.tur != "sqlserver":
                continue
            database = k.veritabani or next((t.sorgu.veritabani for t in d.tanim.tablolar
                                               if t.sorgu and t.sorgu.kaynak == k.id and t.sorgu.veritabani), "")
            item = {"source_key": k.id, "server": k.sunucu, "database": database,
                    "username": k.kullanici or "", "auth": k.kimlik, "password": None}
            if k.kimlik == "sql":
                try:
                    try:
                        spec = store.get(k.id)
                    except ConnectorError as e:
                        if e.code != "not_found":
                            raise
                        cid = store.find(k.sunucu, database, k.kimlik, k.kullanici)
                        spec = store.get(cid) if cid else None
                    item["password"] = spec.password if spec else None
                except ConnectorError:
                    pass
            sources.append(item)
        return publisher.publish(body.workspace_id, d.path, body.gateway_id, sources)

    @app.get("/jobs/{job_id}", dependencies=[Depends(auth)])
    def get_job(job_id: str):
        job = runner.get(job_id)
        if job is None:
            raise HTTPException(404, "İş bulunamadı")
        return job.to_dict()

    @app.post("/jobs/{job_id}/cancel", dependencies=[Depends(auth)])
    def cancel_job(job_id: str):
        job = runner.get(job_id)
        if job is None:
            raise HTTPException(404, "İş bulunamadı")
        job.cancel()
        return job.to_dict()

    return app
