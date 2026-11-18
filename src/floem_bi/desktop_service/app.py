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
from pathlib import Path
from typing import Any, Callable, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..connectors import ConnectionSpec, ConnectorError, ResultSet, SourceRef, json_value
from ..connectors.sqlserver import make_connector
from ..document import Document, DocumentError, FloemFileError, ImportItem, Job, JobConflict, JobRunner, JobTable, OpsIn
from ..model.schema import VeriKaynagi
from ..model.semantic import ModelError
from ..report import QueryError, VisualQuery
from .connections import ConnectionStore
from .publish import PublishClient


class ConnectionIn(BaseModel):
    kind: Literal["sqlserver"] = "sqlserver"
    server: str = Field(min_length=1)
    database: str | None = None
    auth: Literal["sql", "windows"] = "sql"
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
    sql: str | None = None
    name: str | None = None

    @model_validator(mode="after")
    def _one(self):
        if bool(self.table) == bool(self.sql):
            raise ValueError("Her öğede 'table' ya da 'sql' alanlarından yalnızca biri olmalı")
        return self


class ImportIn(BaseModel):
    connection_id: str
    database: str | None = None
    items: list[ImportItemIn] = Field(min_length=1, max_length=200)


class RefreshIn(BaseModel):
    tables: list[str] | None = None


class PathIn(BaseModel):
    path: str = Field(min_length=1)


class SaveIn(BaseModel):
    path: str | None = None


class NewIn(BaseModel):
    name: str | None = None


class DiagramIn(BaseModel):
    tables: dict[str, dict[str, Any]]
    auto: bool = False                  # açılıştaki otomatik yerleşim belgeyi "değişti" saymaz


class PublishLoginIn(BaseModel):
    server_url: str = Field(min_length=1)
    email: str = Field(min_length=3)
    password: str = Field(min_length=1)


class PublishIn(BaseModel):
    workspace_id: int


class DaxIn(BaseModel):
    expression: str
    table: str | None = None


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
    startup_error: dict | None = None
    first: Document | None = None
    if open_path:                                   # .floem dosyasına çift tıklayarak açılış
        try:
            first = Document.open(work_dir, open_path)
        except FloemFileError as e:
            startup_error = {"code": "file_error", "message": e.message, "detail": e.detail}
    holder: dict[str, Document] = {"doc": first or Document.new(work_dir)}
    app.state.startup_error = startup_error
    app.state.runner = runner
    app.state.holder = holder

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
            user=c.user, password=c.password, trust_server_certificate=c.trust_server_certificate,
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
        replace_doc(Document.open(work_dir, body.path))
        return doc().state()

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

    @app.put("/document/report", dependencies=[Depends(auth)])
    def set_report(body: dict[str, Any]):
        try:
            doc().set_report(body)
        except ValueError as e:                      # pydantic doğrulama hatası
            raise DocumentError("Rapor tanımı geçersiz", str(e), code="report_invalid") from e
        return {"ok": True, "dirty": doc().dirty}

    @app.post("/document/query", dependencies=[Depends(auth)])
    def visual_query(body: VisualQuery):
        return doc().query(body)

    @app.get("/document/tables/{table}/preview", dependencies=[Depends(auth)])
    def table_preview(table: str, limit: int = 100):
        return doc().preview(table, max(1, min(limit, 1000)))

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
        items = [
            ImportItem(
                SourceRef(it.database or body.database, it.schema_ or "dbo", it.table, None) if it.table
                else SourceRef(it.database or body.database, sql=it.sql),
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
        return publisher.publish(body.workspace_id, d.path)

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
