"""floembi.app sunucusu (MVP, yerel).

Power BI Hizmeti'nin karşılığı: giriş, çalışma alanları, Desktop'tan yayımlama,
web'de rapor görüntüleme. Aynı semantik çekirdek (model, Floem DAX derleyicisi,
DuckDB) Desktop'taki gibi kullanılır.

Uç noktalar (hepsi /api altında, yanıt hataları {"error": {code, message, detail}}):
  POST /api/auth/login                       e-posta + şifre → token
  GET  /api/me                               kullanıcı ve çalışma alanı rolleri
  GET  /api/workspaces                       görülebilen çalışma alanları
  GET  /api/workspaces/{id}/content          anlam modelleri ve raporlar
  POST /api/workspaces/{id}/publish          .floem yükle (Yönetici/Üye/Katkıda bulunan)
  GET  /api/reports/{id}                     rapor tanımı
  POST /api/reports/{id}/query               görsel sorgusu
  GET  /api/datasets/{id}                    model özeti
Web arayüzü (apps/web/dist) varsa kökten sunulur.
"""

from __future__ import annotations

import json
import os
import secrets
import shutil
import tempfile
import threading
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import timezone
from pathlib import Path

import yaml
from fastapi import Depends, FastAPI, File, Header, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.engine import Engine

from ..document import floemfile
from ..document.floemfile import FloemFileError
from ..engine.duckdb_engine import DuckDBEngine
from ..model import ModelError, SemanticModel
from ..model.schema import ModelTanimi
from ..report import QueryError, Report, VisualQuery, run_visual_query
from . import db
from .auth import CAN_PUBLISH, ROLE_LABEL, hash_password, issue_token, read_token, verify_password

MAX_UPLOAD = 2 * 1024 ** 3          # 2 GB
KEEP_VERSIONS = 2


def iso(dt) -> str:
    """SQLite saat dilimini saklamaz; değerler UTC olarak yazılır, UTC olarak döndürülür."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, detail: str = ""):
        self.status, self.code, self.message, self.detail = status, code, message, detail


FORBIDDEN = lambda what="Bu işlem için yetkiniz yok": ApiError(403, "forbidden", what)  # noqa: E731
NOT_FOUND = lambda what: ApiError(404, "not_found", f"{what} bulunamadı")  # noqa: E731


@dataclass
class ServerSettings:
    data_dir: Path
    secret: str
    public_url: str = "http://127.0.0.1:8800"
    web_dist: Path | None = None
    seed_users: bool = True
    seed_passwords: dict[str, str] = field(default_factory=dict)


# Geliştirme için iki sahte kullanıcı (gerçek kullanıcı yönetimi/SSO sonraki aşamada)
SEED_USERS = [
    ("yonetici@floembi.test", "Yönetici Kullanıcı", "FLOEM_YONETICI_PASSWORD", "Floem.Yonetici1"),
    ("izleyici@floembi.test", "İzleyici Kullanıcı", "FLOEM_IZLEYICI_PASSWORD", "Floem.Izleyici1"),
]
SEED_WORKSPACE = "Satış Ekibi"


def load_settings() -> ServerSettings:
    data = Path(os.environ.get("FLOEM_SERVER_DATA", "data/server")).resolve()
    data.mkdir(parents=True, exist_ok=True)
    secret = os.environ.get("FLOEM_SERVER_SECRET")
    if not secret:
        key = data / "secret.key"
        if not key.exists():
            key.write_text(secrets.token_urlsafe(48), encoding="utf-8")
        secret = key.read_text(encoding="utf-8").strip()
    web = os.environ.get("FLOEM_WEB_DIST")
    default_web = Path(__file__).resolve().parents[3] / "apps" / "web" / "dist"
    return ServerSettings(
        data_dir=data,
        secret=secret,
        public_url=os.environ.get("FLOEM_PUBLIC_URL", "http://127.0.0.1:8800").rstrip("/"),
        web_dist=Path(web) if web else (default_web if default_web.exists() else None),
        seed_passwords={env: os.environ.get(env, default) for _, _, env, default in SEED_USERS},
    )


def seed(engine: Engine, settings: ServerSettings) -> None:
    with engine.begin() as c:
        if c.execute(select(db.users.c.id).limit(1)).first():
            return
        ids = {}
        for email, name, env, default in SEED_USERS:
            pw = settings.seed_passwords.get(env, default)
            ids[email] = c.execute(
                db.users.insert().values(email=email, name=name, password_hash=hash_password(pw))
            ).inserted_primary_key[0]
        wid = c.execute(db.workspaces.insert().values(name=SEED_WORKSPACE)).inserted_primary_key[0]
        c.execute(db.members.insert().values(workspace_id=wid, user_id=ids["yonetici@floembi.test"], role="admin"))


# ------------------------------------------------------------------ istek gövdeleri
class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


# ------------------------------------------------------------------ sorgu motorları
class EngineCache:
    """Anlam modeli sürümü başına bir DuckDB bağlantısı."""

    def __init__(self):
        self._lock = threading.Lock()
        self._items: dict[int, tuple[int, SemanticModel, DuckDBEngine, threading.Lock]] = {}

    def get(self, ds_id: int, version: int, model_yaml: str, snapshot: str):
        with self._lock:
            item = self._items.get(ds_id)
            if item and item[0] == version:
                return item[1], item[2], item[3]
            if item:
                item[2].close()
            model = SemanticModel(ModelTanimi.model_validate(yaml.safe_load(model_yaml)))
            eng = DuckDBEngine(snapshot, model)
            self._items[ds_id] = (version, model, eng, threading.Lock())
            return model, eng, self._items[ds_id][3]

    def drop(self, ds_id: int) -> None:
        with self._lock:
            item = self._items.pop(ds_id, None)
            if item:
                item[2].close()

    def close(self) -> None:
        with self._lock:
            for item in self._items.values():
                item[2].close()
            self._items.clear()


def create_server(settings: ServerSettings | None = None) -> FastAPI:
    settings = settings or load_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    engine = db.make_engine(f"sqlite:///{(settings.data_dir / 'floem.db').as_posix()}")
    if settings.seed_users:
        seed(engine, settings)
    engines = EngineCache()
    publish_lock = threading.Lock()
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        engines.close()
        engine.dispose()

    app = FastAPI(title="floembi.app", version="0.1.0", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.state.settings = settings
    app.state.db = engine
    app.state.engines = engines

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, e: ApiError):
        return JSONResponse(status_code=e.status, content={"error": {"code": e.code, "message": e.message, "detail": e.detail}})

    # -------------------------------------------------------------- kimlik
    def current_user(authorization: str = Header(default="")) -> dict:
        token = authorization[7:] if authorization.lower().startswith("bearer ") else ""
        uid = read_token(token, settings.secret) if token else None
        if uid is None:
            raise ApiError(401, "unauthorized", "Oturumunuz sona erdi; lütfen yeniden giriş yapın")
        with engine.connect() as c:
            row = c.execute(select(db.users.c.id, db.users.c.email, db.users.c.name).where(db.users.c.id == uid)).first()
        if row is None:
            raise ApiError(401, "unauthorized", "Kullanıcı bulunamadı")
        return dict(row._mapping)

    def role_in(c, user_id: int, workspace_id: int) -> str | None:
        r = c.execute(select(db.members.c.role).where(
            and_(db.members.c.workspace_id == workspace_id, db.members.c.user_id == user_id))).first()
        return r[0] if r else None

    def report_access(c, user_id: int, report_row) -> str | None:
        role = role_in(c, user_id, report_row.workspace_id)
        if role:
            return role
        shared = c.execute(select(db.shares.c.user_id).where(
            and_(db.shares.c.report_id == report_row.id, db.shares.c.user_id == user_id))).first()
        return "viewer" if shared else None

    def user_name(c, uid: int) -> str:
        r = c.execute(select(db.users.c.name).where(db.users.c.id == uid)).first()
        return r[0] if r else ""

    @app.post("/api/auth/login")
    def login(body: LoginIn):
        with engine.connect() as c:
            row = c.execute(select(db.users).where(db.users.c.email == body.email.strip().lower())).first()
        if row is None or not verify_password(row.password_hash, body.password):
            raise ApiError(401, "login_failed", "E-posta adresi ya da şifre hatalı")
        return {
            "token": issue_token(row.id, settings.secret),
            "user": {"id": row.id, "email": row.email, "name": row.name},
        }

    @app.get("/api/me")
    def me(user: dict = Depends(current_user)):
        with engine.connect() as c:
            rows = c.execute(
                select(db.workspaces.c.id, db.workspaces.c.name, db.members.c.role)
                .join(db.members, db.members.c.workspace_id == db.workspaces.c.id)
                .where(db.members.c.user_id == user["id"])
            ).all()
        return {**user, "workspaces": [{"id": r.id, "name": r.name, "role": r.role, "role_label": ROLE_LABEL[r.role]} for r in rows]}

    # -------------------------------------------------------------- çalışma alanları
    @app.get("/api/workspaces")
    def list_workspaces(user: dict = Depends(current_user)):
        return me(user)["workspaces"]

    @app.get("/api/workspaces/{wid}/content")
    def workspace_content(wid: int, user: dict = Depends(current_user)):
        with engine.connect() as c:
            ws = c.execute(select(db.workspaces).where(db.workspaces.c.id == wid)).first()
            if ws is None:
                raise NOT_FOUND("Çalışma alanı")
            role = role_in(c, user["id"], wid)
            if role is None:
                raise FORBIDDEN("Bu çalışma alanına erişiminiz yok")
            ds = c.execute(select(db.datasets).where(db.datasets.c.workspace_id == wid).order_by(db.datasets.c.name)).all()
            rp = c.execute(select(db.reports).where(db.reports.c.workspace_id == wid).order_by(db.reports.c.name)).all()
            names = {r.published_by: user_name(c, r.published_by) for r in [*ds, *rp]}
        return {
            "workspace": {"id": ws.id, "name": ws.name, "role": role, "role_label": ROLE_LABEL[role]},
            "datasets": [{
                "id": d.id, "name": d.name, "version": d.version, "size_bytes": d.size_bytes,
                "published_at": iso(d.published_at), "published_by": names[d.published_by],
            } for d in ds],
            "reports": [{
                "id": r.id, "name": r.name, "version": r.version, "dataset_id": r.dataset_id,
                "published_at": iso(r.published_at), "published_by": names[r.published_by],
            } for r in rp],
        }

    @app.get("/api/shared-with-me")
    def shared_with_me(user: dict = Depends(current_user)):
        """Power BI "Benimle paylaşılanlar": üyesi olmadığı çalışma alanlarından paylaşılan raporlar."""
        with engine.connect() as c:
            rows = c.execute(
                select(db.reports.c.id, db.reports.c.name, db.reports.c.published_at, db.reports.c.published_by,
                       db.workspaces.c.name.label("workspace"), db.shares.c.shared_by)
                .join(db.shares, db.shares.c.report_id == db.reports.c.id)
                .join(db.workspaces, db.workspaces.c.id == db.reports.c.workspace_id)
                .where(db.shares.c.user_id == user["id"])
                .order_by(db.reports.c.name)
            ).all()
            return [{
                "id": r.id, "name": r.name, "workspace": r.workspace, "published_at": iso(r.published_at),
                "shared_by": user_name(c, r.shared_by),
            } for r in rows]

    # -------------------------------------------------------------- yayımlama
    @app.post("/api/workspaces/{wid}/publish")
    def publish(wid: int, file: UploadFile = File(...), user: dict = Depends(current_user)):
        with engine.connect() as c:
            if c.execute(select(db.workspaces.c.id).where(db.workspaces.c.id == wid)).first() is None:
                raise NOT_FOUND("Çalışma alanı")
            role = role_in(c, user["id"], wid)
        if role not in CAN_PUBLISH:
            raise FORBIDDEN("Bu çalışma alanında yayımlama yetkiniz yok (Yönetici, Üye ya da Katkıda bulunan olmalısınız)")
        tmp_root = settings.data_dir / "tmp"
        tmp_root.mkdir(exist_ok=True)
        stage = Path(tempfile.mkdtemp(dir=tmp_root))
        try:
            upload = stage / "upload.floem"
            size = 0
            with open(upload, "wb") as out:
                while chunk := file.file.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_UPLOAD:
                        raise ApiError(413, "too_large", "Dosya 2 GB sınırını aşıyor")
                    out.write(chunk)
            try:
                content = floemfile.read(upload, stage / "data.duckdb")
                SemanticModel(content.tanim)
                report_def = Report.model_validate(content.report or {"version": 1, "pages": []})
            except FloemFileError as e:
                raise ApiError(400, "file_error", e.message, e.detail) from e
            except (ModelError, ValueError) as e:
                raise ApiError(400, "file_error", "Dosyadaki model ya da rapor geçersiz", str(e)) from e
            if not (stage / "data.duckdb").exists():
                raise ApiError(400, "file_error", "Dosyada veri yok (data.duckdb)")
            name = content.tanim.model.ad
            model_yaml = floemfile.dump_model(content.tanim)
            definition = json.dumps(report_def.model_dump(mode="json", exclude_none=True), ensure_ascii=False)
            data_size = (stage / "data.duckdb").stat().st_size

            with publish_lock, engine.begin() as c:
                ds = c.execute(select(db.datasets).where(
                    and_(db.datasets.c.workspace_id == wid, db.datasets.c.name == name))).first()
                version = (ds.version + 1) if ds else 1
                if ds:
                    ds_id = ds.id
                else:
                    ds_id = c.execute(db.datasets.insert().values(
                        workspace_id=wid, name=name, version=1, model_yaml="", snapshot="",
                        published_by=user["id"])).inserted_primary_key[0]
                target = settings.data_dir / "datasets" / str(ds_id) / f"v{version}"
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.exists():
                    shutil.rmtree(target)
                target.mkdir()
                os.replace(stage / "data.duckdb", target / "data.duckdb")
                (target / "model.yaml").write_text(model_yaml, encoding="utf-8")
                c.execute(db.datasets.update().where(db.datasets.c.id == ds_id).values(
                    version=version, model_yaml=model_yaml, snapshot=str(target / "data.duckdb"),
                    size_bytes=data_size, published_by=user["id"], published_at=db.now()))
                rp = c.execute(select(db.reports).where(
                    and_(db.reports.c.workspace_id == wid, db.reports.c.name == name))).first()
                if rp:
                    rid, rversion = rp.id, rp.version + 1
                    c.execute(db.reports.update().where(db.reports.c.id == rid).values(
                        dataset_id=ds_id, version=rversion, definition=definition,
                        published_by=user["id"], published_at=db.now()))
                else:
                    rversion = 1
                    rid = c.execute(db.reports.insert().values(
                        workspace_id=wid, dataset_id=ds_id, name=name, version=1, definition=definition,
                        published_by=user["id"])).inserted_primary_key[0]
            # Eski sürümler: son KEEP_VERSIONS tutulur (açık bağlantı önce kapatılır)
            engines.drop(ds_id)
            for old in (settings.data_dir / "datasets" / str(ds_id)).glob("v*"):
                try:
                    if int(old.name[1:]) <= version - KEEP_VERSIONS:
                        shutil.rmtree(old, ignore_errors=True)
                except ValueError:
                    pass
            return {
                "dataset_id": ds_id, "report_id": rid, "name": name, "version": version, "report_version": rversion,
                "replaced": ds is not None, "url": f"{settings.public_url}/reports/{rid}",
            }
        finally:
            shutil.rmtree(stage, ignore_errors=True)

    # -------------------------------------------------------------- raporlar
    def load_report(c, rid: int, user: dict):
        rp = c.execute(select(db.reports).where(db.reports.c.id == rid)).first()
        if rp is None:
            raise NOT_FOUND("Rapor")
        role = report_access(c, user["id"], rp)
        if role is None:
            raise FORBIDDEN("Bu rapor sizinle paylaşılmamış")
        return rp, role

    @app.get("/api/reports/{rid}")
    def get_report(rid: int, user: dict = Depends(current_user)):
        with engine.connect() as c:
            rp, role = load_report(c, rid, user)
            ds = c.execute(select(db.datasets).where(db.datasets.c.id == rp.dataset_id)).first()
            ws = c.execute(select(db.workspaces).where(db.workspaces.c.id == rp.workspace_id)).first()
            by = user_name(c, rp.published_by)
        return {
            "id": rp.id, "name": rp.name, "version": rp.version, "published_at": iso(rp.published_at),
            "published_by": by, "role": role, "role_label": ROLE_LABEL[role],
            "workspace": {"id": ws.id, "name": ws.name},
            "dataset": {"id": ds.id, "name": ds.name, "version": ds.version},
            "definition": json.loads(rp.definition),
        }

    @app.post("/api/reports/{rid}/query")
    def report_query(rid: int, q: VisualQuery, user: dict = Depends(current_user)):
        with engine.connect() as c:
            rp, _ = load_report(c, rid, user)
            ds = c.execute(select(db.datasets).where(db.datasets.c.id == rp.dataset_id)).first()
        model, eng, lock = engines.get(ds.id, ds.version, ds.model_yaml, ds.snapshot)
        try:
            with lock:
                return run_visual_query(model, eng, q)
        except QueryError as e:
            raise ApiError(400, "query_error", "Görsel sorgusu çalıştırılamadı", str(e)) from e

    @app.get("/api/datasets/{dsid}")
    def get_dataset(dsid: int, user: dict = Depends(current_user)):
        with engine.connect() as c:
            ds = c.execute(select(db.datasets).where(db.datasets.c.id == dsid)).first()
            if ds is None:
                raise NOT_FOUND("Anlam modeli")
            if role_in(c, user["id"], ds.workspace_id) is None:
                raise FORBIDDEN("Bu anlam modeline erişiminiz yok")
        tanim = ModelTanimi.model_validate(yaml.safe_load(ds.model_yaml))
        return {
            "id": ds.id, "name": ds.name, "version": ds.version, "published_at": iso(ds.published_at),
            "tables": [{"ad": t.ad, "sutunlar": len(t.sutunlar), "gizli": t.gizli} for t in tanim.tablolar],
            "relationships": [r.model_dump() for r in tanim.iliskiler],
            "sources": [{"sunucu": k.sunucu, "veritabani": k.veritabani} for k in tanim.veri_kaynaklari],
        }

    @app.get("/api/health")
    def health():
        return {"ok": True}

    # -------------------------------------------------------------- web arayüzü
    web = settings.web_dist
    if web and (web / "index.html").exists():
        if (web / "assets").exists():
            app.mount("/assets", StaticFiles(directory=web / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith("api/"):
                raise NOT_FOUND("Uç nokta")
            f = (web / path).resolve()
            if path and f.is_file() and web.resolve() in f.parents:
                return FileResponse(f)
            return FileResponse(web / "index.html")      # tek sayfa uygulaması: /reports/5 vb.

    return app
