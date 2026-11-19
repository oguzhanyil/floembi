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
  POST /api/reports/{id}/share               e-postayla paylaş (hesabı olmayana davet)
  GET|PUT /api/admin/mail, POST /api/admin/mail/test        e-posta sunucusu (sistem yöneticisi)
  GET  /api/admin/users, POST /api/admin/users/grant        kullanıcı yetkilendirme + otomatik e-posta
  GET  /api/invitations/{token}, POST …/accept              davet kabulü (oturumsuz)
Web arayüzü (apps/web/dist) varsa kökten sunulur.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
from email import policy as email_policy
from email.parser import BytesParser
import secrets
import shutil
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import timedelta, timezone
from pathlib import Path

import yaml
from fastapi import Depends, FastAPI, File, Header, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.engine import Engine

from ..compiler import UserInfo
from ..document import floemfile
from ..document.floemfile import FloemFileError
from ..engine.duckdb_engine import DuckDBEngine
from ..model import ModelError, SemanticModel
from ..model.schema import ModelTanimi
from ..report import QueryError, Report, VisualQuery, run_visual_query
from . import db
from .mail import (
    SECURITY, Mail, MailError, MailSettings, SecretBox, SmtpSettings, access_mail, app_mail, invite_mail,
    load_mail_settings,
    login_hint, send, sender_display, settings_from_row, share_mail, test_mail,
)
from . import pilot_config
from .events import EventHub
from .refresh import RefreshError, SnapshotBuilder
from .auth import CAN_PUBLISH, ROLE_LABEL, ROLES, hash_password, issue_token, read_token, verify_password

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
    pilot: bool = False
    seed_passwords: dict[str, str] = field(default_factory=dict)
    mail: MailSettings = field(default_factory=MailSettings)   # ortam değişkenlerinden; ekran ayarı önceliklidir
    invite_days: int = 7
    events_keepalive: float = 20.0                             # SSE: boşta yorum satırı aralığı (sn)


# Geliştirme için iki sahte kullanıcı (gerçek kullanıcı yönetimi/SSO sonraki aşamada)
SEED_USERS = [
    ("yonetici@floembi.test", "Yönetici Kullanıcı", "FLOEM_YONETICI_PASSWORD", "Floem.Yonetici1"),
    ("izleyici@floembi.test", "İzleyici Kullanıcı", "FLOEM_IZLEYICI_PASSWORD", "Floem.Izleyici1"),
]
SEED_WORKSPACE = "Satış Ekibi"


def load_settings(*, pilot: bool = False) -> ServerSettings:
    data = pilot_config.data_dir() if pilot else Path(os.environ.get("FLOEM_SERVER_DATA", "data/server")).resolve()
    data.mkdir(parents=True, exist_ok=True)
    if pilot:
        secret = pilot_config.server_secret(data)
        if not secret:
            raise RuntimeError("Pilot sunucu anahtarı bulunamadı. Önce 'python -m floem_bi.server.pilot init' çalıştırın.")
    else:
        secret = os.environ.get("FLOEM_SERVER_SECRET")
    if not secret:
        key = data / "secret.key"
        if not key.exists():
            key.write_text(secrets.token_urlsafe(48), encoding="utf-8")
        secret = key.read_text(encoding="utf-8").strip()
    web = os.environ.get("FLOEM_WEB_DIST")
    default_web = Path(__file__).resolve().parents[3] / "apps" / "web" / "dist"
    public_url = os.environ.get("FLOEM_PUBLIC_URL", pilot_config.PILOT_URL if pilot else "http://127.0.0.1:8800").rstrip("/")
    if pilot and public_url != pilot_config.PILOT_URL:
        raise RuntimeError(f"Pilot için FLOEM_PUBLIC_URL yalnızca {pilot_config.PILOT_URL} olabilir.")
    return ServerSettings(
        data_dir=data,
        secret=secret,
        public_url=public_url,
        web_dist=Path(web) if web else (default_web if default_web.exists() else None),
        seed_users=not pilot,
        pilot=pilot,
        seed_passwords={env: os.environ.get(env, default) for _, _, env, default in SEED_USERS},
        mail=load_mail_settings(),
    )


def seed(engine: Engine, settings: ServerSettings) -> None:
    with engine.begin() as c:
        if c.execute(select(db.users.c.id).limit(1)).first():
            return
        ids = {}
        for email, name, env, default in SEED_USERS:
            pw = settings.seed_passwords.get(env, default)
            ids[email] = c.execute(db.users.insert().values(
                email=email, name=name, password_hash=hash_password(pw), is_admin=email.startswith("yonetici@"),
            )).inserted_primary_key[0]
        wid = c.execute(db.workspaces.insert().values(name=SEED_WORKSPACE)).inserted_primary_key[0]
        c.execute(db.members.insert().values(workspace_id=wid, user_id=ids["yonetici@floembi.test"], role="admin"))


class LoginThrottle:
    """Pilot girişinde e-posta başına hatalı deneme sınırı (tek sunucu süreci)."""

    def __init__(self, limit: int = 10, window_seconds: float = 900):
        self.limit = limit
        self.window_seconds = window_seconds
        self._lock = threading.Lock()
        self._failures: dict[str, tuple[int, float]] = {}

    def allow(self, email: str) -> bool:
        with self._lock:
            count, started = self._failures.get(email, (0, 0.0))
            if time.monotonic() - started >= self.window_seconds:
                self._failures.pop(email, None)
                return True
            return count < self.limit

    def failure(self, email: str) -> None:
        now = time.monotonic()
        with self._lock:
            count, started = self._failures.get(email, (0, now))
            if now - started >= self.window_seconds:
                count, started = 0, now
            self._failures[email] = (count + 1, started)
            if len(self._failures) > 10000:
                self._failures = {key: value for key, value in self._failures.items()
                                  if now - value[1] < self.window_seconds}

    def success(self, email: str) -> None:
        with self._lock:
            self._failures.pop(email, None)


# ------------------------------------------------------------------ istek gövdeleri
class ShareIn(BaseModel):
    emails: list[str] = Field(min_length=1, max_length=50)
    message: str | None = Field(default=None, max_length=2000)
    notify: bool = True


class MailConfigIn(BaseModel):
    enabled: bool = False
    host: str = Field(default="", max_length=255)
    port: int = Field(default=587, ge=1, le=65535)
    security: str = "starttls"
    username: str | None = Field(default=None, max_length=254)
    password: str | None = Field(default=None, max_length=500)   # None: kayıtlı şifre korunur, "": silinir
    from_address: str = Field(default="", max_length=254)
    from_name: str = Field(default="floembi.app", max_length=120)


class MailTestIn(MailConfigIn):
    to: str | None = Field(default=None, max_length=254)


class GrantIn(BaseModel):
    emails: list[str] = Field(min_length=1, max_length=50)
    workspace_id: int
    role: str = "viewer"
    message: str | None = Field(default=None, max_length=2000)
    notify: bool = True


class RoleIn(BaseModel):
    role: str


class AppItemIn(BaseModel):
    report_id: int
    title: str | None = Field(default=None, max_length=200)
    section: str | None = Field(default=None, max_length=120)


class AppIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    color: str = Field(default="#1f6feb", pattern=r"^#[0-9a-fA-F]{6}$")
    items: list[AppItemIn] = Field(min_length=1, max_length=100)


class AppAccessIn(BaseModel):
    emails: list[str] = Field(min_length=1, max_length=50)
    message: str | None = Field(default=None, max_length=1000)
    notify: bool = True


class RoleMemberIn(BaseModel):
    role: str = Field(min_length=1)
    email: str = Field(min_length=3)


class AdminFlagIn(BaseModel):
    is_admin: bool


class AcceptIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=200)


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


class GatewayCreateIn(BaseModel):
    workspace_id: int
    name: str = Field(min_length=1, max_length=120)


class GatewayRegisterIn(BaseModel):
    token: str
    public_key: str


class GatewaySourceIn(BaseModel):
    gateway_id: int
    server: str = Field(min_length=1, max_length=255)
    database: str = Field(min_length=1, max_length=255)
    username: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=500)


class GatewaySyncSourceIn(BaseModel):
    source_key: str = Field(min_length=1, max_length=120)
    server: str = Field(min_length=1, max_length=255)
    database: str = Field(min_length=1, max_length=255)
    username: str = Field(min_length=1, max_length=254)
    password_enc: str = Field(min_length=98, max_length=4096)


class GatewaySyncIn(BaseModel):
    gateway_id: int
    sources: list[GatewaySyncSourceIn] = Field(min_length=1, max_length=500)


class SourceBindingsIn(BaseModel):
    sources: dict[str, int]


@dataclass
class ActiveRefresh:
    id: int
    dataset_id: int
    gateway_id: int
    version: int
    snapshot: Path
    model_yaml: str
    stage: Path
    builder: SnapshotBuilder | None = None
    timeout: asyncio.Task | None = None


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
    if settings.pilot and settings.seed_users:
        raise RuntimeError("Pilot modunda geliştirme kullanıcıları oluşturulamaz.")
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    engine = db.make_engine(f"sqlite:///{(settings.data_dir / 'floem.db').as_posix()}")
    if settings.seed_users:
        seed(engine, settings)
    if settings.pilot:
        with engine.connect() as c:
            seeded = c.execute(select(db.users.c.id).where(
                db.users.c.email.in_([email for email, *_ in SEED_USERS])).limit(1)).first()
            admin = c.execute(select(db.users.c.id).join(db.members, db.members.c.user_id == db.users.c.id)
                              .where(and_(db.users.c.is_admin.is_(True), db.members.c.role == "admin"))
                              .limit(1)).first()
        if seeded is not None:
            engine.dispose()
            raise RuntimeError("Pilot veritabanında geliştirme hesabı bulundu; ayrı boş veri klasörü kullanın.")
        if admin is None:
            engine.dispose()
            raise RuntimeError("Pilot yönetici hesabı yok. Önce 'python -m floem_bi.server.pilot init' çalıştırın.")
    with engine.begin() as c:
        c.execute(db.refresh_runs.update().where(db.refresh_runs.c.status.in_(["queued", "running"])).values(
            status="failed", stage="Sunucu yeniden başlatıldı", finished_at=db.now(),
            error=json.dumps({"message": "Sunucu yeniden başlatıldığı için yenileme durdu", "detail": ""},
                             ensure_ascii=False)))
    engines = EngineCache()
    publish_lock = threading.Lock()
    login_throttle = LoginThrottle()
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        engines.close()
        engine.dispose()

    app = FastAPI(title="floembi.app", version="0.1.0", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.state.settings = settings
    app.state.db = engine

    if settings.pilot:
        @app.middleware("http")
        async def pilot_headers(request: Request, call_next):
            response = await call_next(request)
            response.headers["Referrer-Policy"] = "no-referrer"
            response.headers["X-Content-Type-Options"] = "nosniff"
            if request.url.path.startswith("/api/") or request.url.path.startswith("/invite/"):
                response.headers["Cache-Control"] = "no-store"
            return response
    app.state.engines = engines
    hub = EventHub()
    app.state.events = hub
    gateway_sockets: dict[int, tuple[WebSocket, asyncio.Lock]] = {}
    active_refreshes: dict[int, ActiveRefresh] = {}
    gateway_lock = threading.Lock()

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, e: ApiError):
        return JSONResponse(status_code=e.status, content={"error": {"code": e.code, "message": e.message, "detail": e.detail}})

    # -------------------------------------------------------------- e-posta altyapısı
    box = SecretBox(settings.secret)
    outbox = settings.data_dir / "outbox"

    def mail_row():
        with engine.connect() as c:
            return c.execute(select(db.mail_config).where(db.mail_config.c.id == 1)).first()

    def mail_settings() -> MailSettings:
        """Öncelik: Yönetim ekranındaki ayar (etkinse) → ortam değişkenleri → giden kutusu."""
        row = mail_row()
        if row is not None and row.enabled:
            return settings_from_row(row, box)          # şifre çözülemezse MailError
        return settings.mail

    def mail_mode() -> str:
        row = mail_row()
        return "smtp" if (row is not None and row.enabled) else settings.mail.mode

    def deliver(kind: str, mail: Mail, user: dict, *, report_id: int | None = None,
                ms: MailSettings | None = None) -> tuple[str, str | None, str | None]:
        """E-postayı gönderir ve kaydeder. Dönüş: (sent|outbox|failed, okunur hata, ham hata ayrıntısı)."""
        status, path, error, shown, detail = "failed", None, None, None, None
        try:
            ms = ms or mail_settings()
            sender = MailSettings(sender=sender_display(user["name"], ms), smtp=ms.smtp, source=ms.source)
            status, path = send(sender, mail, outbox)
        except MailError as e:
            error = f"{e.message}: {e.detail}" if e.detail else e.message
            shown, detail = e.message, e.detail or None
        with engine.begin() as c:
            c.execute(db.mail_log.insert().values(
                kind=kind, to_email=mail.to, subject=mail.subject, status=status, error=error,
                eml_path=path, report_id=report_id, created_by=user["id"],
            ))
        return status, shown, detail

    def deliver_result(item: dict, res: tuple[str, str | None, str | None]) -> None:
        item["mail"] = res[0]
        if res[1]:
            item["mail_error"] = res[1]

    def token_hash(token: str) -> str:
        return hashlib.sha256(token.encode("ascii", "ignore")).hexdigest()

    def grant_texts(c, email: str) -> list[str]:
        """Davet e-postası ve kabul ekranı için bekleyen yetkilerin okunur listesi."""
        out = []
        for g in c.execute(select(db.pending_grants).where(db.pending_grants.c.email == email)
                           .order_by(db.pending_grants.c.id)).all():
            if g.workspace_id:
                ws = c.execute(select(db.workspaces.c.name).where(db.workspaces.c.id == g.workspace_id)).scalar()
                out.append(f"{ws} çalışma alanı: {ROLE_LABEL.get(g.role or 'viewer', g.role)}")
            elif g.report_id:
                rn = c.execute(select(db.reports.c.name).where(db.reports.c.id == g.report_id)).scalar()
                out.append(f"'{rn}' raporu (görüntüleme)")
            elif g.app_id:
                an = c.execute(select(db.apps.c.name).where(db.apps.c.id == g.app_id)).scalar()
                out.append(f"'{an}' uygulaması (görüntüleme)")
        return out

    def send_invite(email: str, inviter: dict, message: str | None = None) -> tuple[str, str | None, str | None]:
        """Daveti oluşturur ya da yeniler (yeni bağlantı, eskisi geçersiz) ve e-postayı gönderir."""
        token = secrets.token_urlsafe(32)
        expires = db.now() + timedelta(days=settings.invite_days)
        with engine.begin() as c:
            inv = c.execute(select(db.invitations.c.id).where(db.invitations.c.email == email)).first()
            values = dict(token_hash=token_hash(token), invited_by=inviter["id"], created_at=db.now(), expires_at=expires)
            if inv:
                c.execute(db.invitations.update().where(db.invitations.c.id == inv.id).values(**values))
            else:
                c.execute(db.invitations.insert().values(email=email, **values))
            grants = grant_texts(c, email)
        mail = invite_mail(to=email, inviter=inviter["name"], grants=grants, url=f"{settings.public_url}/invite/{token}",
                           days=settings.invite_days, message=message)
        return deliver("invite", mail, inviter)

    def drop_orphan_invitation(c, email: str) -> None:
        """Bekleyen yetkisi kalmayan davet geçersiz olur."""
        if not c.execute(select(db.pending_grants.c.id).where(db.pending_grants.c.email == email)).first():
            c.execute(db.invitations.delete().where(db.invitations.c.email == email))

    def valid_email(e: str) -> bool:
        local, _, domain = e.partition("@")
        return bool(local) and "." in domain and len(e) <= 254 and not any(ch.isspace() for ch in e)


    # -------------------------------------------------------------- kimlik
    def current_user(authorization: str = Header(default="")) -> dict:
        token = authorization[7:] if authorization.lower().startswith("bearer ") else ""
        uid = read_token(token, settings.secret) if token else None
        if uid is None:
            raise ApiError(401, "unauthorized", "Oturumunuz sona erdi; lütfen yeniden giriş yapın")
        with engine.connect() as c:
            row = c.execute(select(db.users.c.id, db.users.c.email, db.users.c.name, db.users.c.is_admin)
                            .where(db.users.c.id == uid)).first()
        if row is None:
            raise ApiError(401, "unauthorized", "Kullanıcı bulunamadı")
        return {**row._mapping, "is_admin": bool(row.is_admin)}

    def admin_user(user: dict = Depends(current_user)) -> dict:
        if not user["is_admin"]:
            raise FORBIDDEN("Bu ekran yalnızca sistem yöneticilerine açık")
        return user

    def role_in(c, user_id: int, workspace_id: int) -> str | None:
        r = c.execute(select(db.members.c.role).where(
            and_(db.members.c.workspace_id == workspace_id, db.members.c.user_id == user_id))).first()
        return r[0] if r else None

    # -------------------------------------------------------------- H7 Gateway
    def source_database(model: ModelTanimi, source_id: str) -> str:
        source = next(s for s in model.veri_kaynaklari if s.id == source_id)
        return source.veritabani or next((t.sorgu.veritabani for t in model.tablolar
                                          if t.sorgu and t.sorgu.kaynak == source_id and t.sorgu.veritabani), "")

    def source_status(c, ds) -> list[dict]:
        model = ModelTanimi.model_validate(yaml.safe_load(ds.model_yaml))
        bindings = {r.source_key: r.gateway_source_id for r in c.execute(select(db.dataset_source_bindings).where(
            db.dataset_source_bindings.c.dataset_id == ds.id)).all()}
        used = {t.sorgu.kaynak for t in model.tablolar if t.sorgu}
        out = []
        for source in model.veri_kaynaklari:
            if source.id not in used:
                continue
            linked = c.execute(select(db.gateway_sources.c.id, db.gateway_sources.c.server,
                                      db.gateway_sources.c.database, db.gateway_sources.c.username,
                                      db.gateways.c.id.label("gateway_id"), db.gateways.c.name.label("gateway_name"))
                               .join(db.gateways, db.gateways.c.id == db.gateway_sources.c.gateway_id)
                               .where(db.gateway_sources.c.id == bindings.get(source.id, -1))).first()
            ready = linked is not None and (
                linked.server.casefold(), linked.database.casefold()
            ) == (source.sunucu.casefold(), source_database(model, source.id).casefold()) and (
                not source.kullanici or linked.username.casefold() == source.kullanici.casefold())
            out.append({"dataset_id": ds.id, "dataset_name": ds.name, "source_key": source.id,
                        "server": source.sunucu, "database": source_database(model, source.id),
                        "username": source.kullanici or "", "ready": ready,
                        "gateway_id": linked.gateway_id if linked else None,
                        "gateway_name": linked.gateway_name if linked else None})
        return out

    @app.post("/api/gateways")
    def create_gateway(body: GatewayCreateIn, user: dict = Depends(current_user)):
        with engine.begin() as c:
            role = role_in(c, user["id"], body.workspace_id)
            if role not in ("admin", "member"):
                raise FORBIDDEN("Floemway oluşturmak için çalışma alanı Yöneticisi ya da Üyesi olmalısınız")
            gid = c.execute(db.gateways.insert().values(
                workspace_id=body.workspace_id, name=body.name, created_by=user["id"]
            )).inserted_primary_key[0]
            token = "fw_" + secrets.token_urlsafe(32)
            c.execute(db.gateway_tokens.insert().values(
                gateway_id=gid, token_hash=hashlib.sha256(token.encode()).hexdigest(),
                expires_at=db.now() + timedelta(minutes=15),
            ))
        return {"id": gid, "name": body.name, "registration_token": token, "expires_in": 900}

    @app.get("/api/workspaces/{wid}/gateways")
    def list_gateways(wid: int, user: dict = Depends(current_user)):
        with engine.connect() as c:
            if role_in(c, user["id"], wid) is None:
                raise FORBIDDEN("Bu çalışma alanına erişiminiz yok")
            rows = c.execute(select(db.gateways).where(db.gateways.c.workspace_id == wid)).all()
        with gateway_lock:
            online = set(gateway_sockets)
        return [{"id": r.id, "name": r.name, "registered": bool(r.public_key), "online": r.id in online,
                 "public_key": r.public_key, "last_seen": iso(r.last_seen) if r.last_seen else None} for r in rows]

    @app.post("/api/gateways/register")
    def register_gateway(body: GatewayRegisterIn):
        from nacl.public import PublicKey
        try:
            PublicKey(base64.b64decode(body.public_key, validate=True))
        except Exception as e:
            raise ApiError(400, "invalid_key", "Floemway açık anahtarı geçersiz") from e
        digest = hashlib.sha256(body.token.encode()).hexdigest()
        with engine.begin() as c:
            row = c.execute(select(db.gateway_tokens).where(db.gateway_tokens.c.token_hash == digest)).first()
            if row is None or row.expires_at.replace(tzinfo=timezone.utc) < db.now():
                raise ApiError(401, "invalid_registration", "Kayıt anahtarı geçersiz ya da süresi dolmuş")
            c.execute(db.gateways.update().where(db.gateways.c.id == row.gateway_id).values(public_key=body.public_key))
            c.execute(db.gateway_tokens.delete().where(db.gateway_tokens.c.id == row.id))
        return {"gateway_id": row.gateway_id}

    @app.post("/api/gateway-sources")
    def create_gateway_source(body: GatewaySourceIn, user: dict = Depends(current_user)):
        from nacl.public import PublicKey, SealedBox
        with engine.connect() as c:
            gw = c.execute(select(db.gateways).where(db.gateways.c.id == body.gateway_id)).first()
            if gw is None:
                raise NOT_FOUND("Floemway")
            if role_in(c, user["id"], gw.workspace_id) not in ("admin", "member"):
                raise FORBIDDEN()
            if not gw.public_key:
                raise ApiError(409, "gateway_unregistered", "Floemway henüz kaydolmadı")
        encrypted = SealedBox(PublicKey(base64.b64decode(gw.public_key))).encrypt(body.password.encode()).hex()
        with engine.begin() as c:
            existing = c.execute(select(db.gateway_sources.c.id).where(and_(
                db.gateway_sources.c.workspace_id == gw.workspace_id,
                db.gateway_sources.c.server == body.server.strip(),
                db.gateway_sources.c.database == body.database.strip(),
                db.gateway_sources.c.username == body.username.strip(),
            ))).first()
            values = dict(gateway_id=gw.id, password_enc=encrypted, created_by=user["id"])
            if existing:
                sid = existing.id
                c.execute(db.gateway_sources.update().where(db.gateway_sources.c.id == sid).values(**values))
            else:
                sid = c.execute(db.gateway_sources.insert().values(
                    workspace_id=gw.workspace_id, server=body.server.strip(), database=body.database.strip(),
                    username=body.username.strip(), **values,
                )).inserted_primary_key[0]
        return {"id": sid}

    @app.get("/api/workspaces/{wid}/gateway-sources")
    def list_gateway_sources(wid: int, user: dict = Depends(current_user)):
        with engine.connect() as c:
            if role_in(c, user["id"], wid) not in ("admin", "member"):
                raise FORBIDDEN()
            rows = c.execute(select(db.gateway_sources.c.id, db.gateway_sources.c.gateway_id,
                                    db.gateway_sources.c.server, db.gateway_sources.c.database,
                                    db.gateway_sources.c.username, db.gateways.c.name.label("gateway_name"))
                             .join(db.gateways, db.gateways.c.id == db.gateway_sources.c.gateway_id)
                             .where(db.gateway_sources.c.workspace_id == wid).order_by(db.gateway_sources.c.id)).all()
        return [dict(r._mapping) for r in rows]

    @app.get("/api/workspaces/{wid}/source-status")
    def workspace_source_status(wid: int, user: dict = Depends(current_user)):
        with engine.connect() as c:
            if role_in(c, user["id"], wid) is None:
                raise FORBIDDEN()
            datasets = c.execute(select(db.datasets).where(db.datasets.c.workspace_id == wid)
                                 .order_by(db.datasets.c.name)).all()
            return [status for ds in datasets for status in source_status(c, ds)]

    @app.post("/api/datasets/{dsid}/gateway-sync")
    def sync_gateway_sources(dsid: int, body: GatewaySyncIn, user: dict = Depends(current_user)):
        """Desktop'tan gelen sealed box bilgilerini saklar ve model kaynaklarını bağlar."""
        with engine.begin() as c:
            ds = c.execute(select(db.datasets).where(db.datasets.c.id == dsid)).first()
            if ds is None:
                raise NOT_FOUND("Anlam modeli")
            role = role_in(c, user["id"], ds.workspace_id)
            if role not in ("admin", "member") and not (role == "contributor" and ds.published_by == user["id"]):
                raise FORBIDDEN("Floemway bağlantısını yalnızca yayımlayan veya çalışma alanı yöneticisi eşleyebilir")
            gateway = c.execute(select(db.gateways).where(db.gateways.c.id == body.gateway_id)).first()
            if gateway is None or gateway.workspace_id != ds.workspace_id or not gateway.public_key:
                raise ApiError(400, "gateway_unavailable", "Kayıtlı Floemway bulunamadı")
            model = ModelTanimi.model_validate(yaml.safe_load(ds.model_yaml))
            by_key = {s.id: s for s in model.veri_kaynaklari}
            if len({s.source_key for s in body.sources}) != len(body.sources):
                raise ApiError(400, "source_mismatch", "Aynı veri kaynağı birden fazla gönderildi")
            for incoming in body.sources:
                expected = by_key.get(incoming.source_key)
                if expected is None or expected.kimlik != "sql":
                    raise ApiError(400, "source_mismatch", "Modelde SQL veri kaynağı bulunamadı")
                if (incoming.server.casefold(), incoming.database.casefold()) != (
                    expected.sunucu.casefold(), source_database(model, expected.id).casefold()
                ) or (expected.kullanici and incoming.username.casefold() != expected.kullanici.casefold()):
                    raise ApiError(400, "source_mismatch", f"{expected.sunucu} bağlantı bilgileri modelle uyuşmuyor")
                try:
                    if len(bytes.fromhex(incoming.password_enc)) <= 48:
                        raise ValueError("kısa şifreli metin")
                except ValueError as e:
                    raise ApiError(400, "invalid_secret", "Şifreli bağlantı bilgisi geçersiz") from e
            synced = []
            for incoming in body.sources:
                existing = c.execute(select(db.gateway_sources.c.id).where(and_(
                    db.gateway_sources.c.workspace_id == ds.workspace_id,
                    db.gateway_sources.c.server == incoming.server,
                    db.gateway_sources.c.database == incoming.database,
                    db.gateway_sources.c.username == incoming.username,
                ))).first()
                values = dict(gateway_id=gateway.id, password_enc=incoming.password_enc, created_by=user["id"])
                if existing:
                    sid = existing.id
                    c.execute(db.gateway_sources.update().where(db.gateway_sources.c.id == sid).values(**values))
                else:
                    sid = c.execute(db.gateway_sources.insert().values(
                        workspace_id=ds.workspace_id, server=incoming.server, database=incoming.database,
                        username=incoming.username, **values)).inserted_primary_key[0]
                old = c.execute(select(db.dataset_source_bindings).where(and_(
                    db.dataset_source_bindings.c.dataset_id == dsid,
                    db.dataset_source_bindings.c.source_key == incoming.source_key))).first()
                if old:
                    c.execute(db.dataset_source_bindings.update().where(and_(
                        db.dataset_source_bindings.c.dataset_id == dsid,
                        db.dataset_source_bindings.c.source_key == incoming.source_key)).values(gateway_source_id=sid))
                else:
                    c.execute(db.dataset_source_bindings.insert().values(
                        dataset_id=dsid, source_key=incoming.source_key, gateway_source_id=sid))
                synced.append(incoming.source_key)
        return {"gateway_id": gateway.id, "gateway_name": gateway.name, "sources": synced}

    @app.get("/api/datasets/{dsid}/source-bindings")
    def get_source_bindings(dsid: int, user: dict = Depends(current_user)):
        with engine.connect() as c:
            ds = c.execute(select(db.datasets).where(db.datasets.c.id == dsid)).first()
            if ds is None:
                raise NOT_FOUND("Anlam modeli")
            if role_in(c, user["id"], ds.workspace_id) not in ("admin", "member"):
                raise FORBIDDEN()
            bindings = c.execute(select(db.dataset_source_bindings).where(
                db.dataset_source_bindings.c.dataset_id == dsid)).all()
        model = ModelTanimi.model_validate(yaml.safe_load(ds.model_yaml))
        return {"dataset_id": dsid,
                "sources": [{"id": s.id, "server": s.sunucu, "database": source_database(model, s.id),
                             "username": s.kullanici or "", "binding_id": next((b.gateway_source_id for b in bindings
                                                                           if b.source_key == s.id), None)}
                            for s in model.veri_kaynaklari]}

    @app.put("/api/datasets/{dsid}/source-bindings")
    def set_source_bindings(dsid: int, body: SourceBindingsIn, user: dict = Depends(current_user)):
        with engine.begin() as c:
            ds = c.execute(select(db.datasets).where(db.datasets.c.id == dsid)).first()
            if ds is None:
                raise NOT_FOUND("Anlam modeli")
            if role_in(c, user["id"], ds.workspace_id) not in ("admin", "member"):
                raise FORBIDDEN()
            model = ModelTanimi.model_validate(yaml.safe_load(ds.model_yaml))
            keys = {s.id for s in model.veri_kaynaklari}
            if set(body.sources) != keys:
                raise ApiError(400, "source_mismatch", "Tüm model veri kaynaklarını eşleştirin")
            for key, sid in body.sources.items():
                source = next(s for s in model.veri_kaynaklari if s.id == key)
                row = c.execute(select(db.gateway_sources).where(db.gateway_sources.c.id == sid)).first()
                if row is None or row.workspace_id != ds.workspace_id or (
                    row.server.casefold(), row.database.casefold()) != (
                        source.sunucu.casefold(), source_database(model, source.id).casefold()
                ):
                    raise ApiError(400, "source_mismatch",
                                   f"{source.sunucu} / {source.veritabani} için uygun Floemway bağlantısı seçin")
            c.execute(db.dataset_source_bindings.delete().where(db.dataset_source_bindings.c.dataset_id == dsid))
            for key, sid in body.sources.items():
                c.execute(db.dataset_source_bindings.insert().values(
                    dataset_id=dsid, source_key=key, gateway_source_id=sid))
        return get_source_bindings(dsid, user)

    def refresh_view(row) -> dict:
        error = json.loads(row.error) if row.error else None
        elapsed = int(((row.finished_at or db.now()).replace(tzinfo=timezone.utc) -
                       row.started_at.replace(tzinfo=timezone.utc)).total_seconds() * 1000)
        return {"id": row.id, "dataset_id": row.dataset_id, "gateway_id": row.gateway_id,
                "status": row.status, "stage": row.stage, "table_name": row.table_name,
                "error": error, "started_at": iso(row.started_at),
                "finished_at": iso(row.finished_at) if row.finished_at else None, "elapsed_ms": max(0, elapsed)}

    def refresh_row(run_id: int) -> dict:
        with engine.connect() as c:
            return refresh_view(c.execute(select(db.refresh_runs).where(db.refresh_runs.c.id == run_id)).one())

    async def fail_refresh(gateway_id: int, message: str, *, stage: str = "Floemway", table: str | None = None,
                           detail: str = "") -> None:
        with gateway_lock:
            task = active_refreshes.pop(gateway_id, None)
        if task is None:
            return
        if task.timeout and task.timeout is not asyncio.current_task():
            task.timeout.cancel()
        with engine.begin() as c:
            c.execute(db.refresh_runs.update().where(db.refresh_runs.c.id == task.id).values(
                status="failed", stage=stage, table_name=table,
                error=json.dumps({"message": message, "detail": detail}, ensure_ascii=False), finished_at=db.now()))
        try:
            if task.builder:
                await asyncio.to_thread(task.builder.close)
        finally:
            await asyncio.to_thread(shutil.rmtree, task.stage, True)

    async def complete_refresh(task: ActiveRefresh) -> None:
        if task.builder is None:
            raise RefreshError("Aktarım başlamadı", stage="Aktarım")
        await asyncio.to_thread(task.builder.finish)
        with publish_lock, engine.begin() as c:
            ds = c.execute(select(db.datasets).where(db.datasets.c.id == task.dataset_id)).one()
            if ds.version != task.version:
                raise RefreshError("Yenileme sürerken anlam modeli yeniden yayımlandı", stage="Sürüm kontrolü")
            version = ds.version + 1
            target = settings.data_dir / "datasets" / str(ds.id) / f"v{version}"
            if target.exists():
                raise RefreshError("Yeni sürüm klasörü zaten var", stage="Anlık görüntü")
            target.mkdir(parents=True)
            try:
                os.replace(task.builder.path, target / "data.duckdb")
                (target / "model.yaml").write_text(task.model_yaml, encoding="utf-8")
                c.execute(db.datasets.update().where(db.datasets.c.id == ds.id).values(
                    version=version, snapshot=str(target / "data.duckdb"),
                    size_bytes=(target / "data.duckdb").stat().st_size))
                c.execute(db.refresh_runs.update().where(db.refresh_runs.c.id == task.id).values(
                    status="succeeded", stage="Tamamlandı", table_name=None, finished_at=db.now()))
            except BaseException:
                shutil.rmtree(target, ignore_errors=True)
                raise
        with gateway_lock:
            active_refreshes.pop(task.gateway_id, None)
        if task.timeout:
            task.timeout.cancel()
        await asyncio.to_thread(shutil.rmtree, task.stage, True)
        engines.drop(task.dataset_id)
        for old in (settings.data_dir / "datasets" / str(task.dataset_id)).glob("v*"):
            try:
                if int(old.name[1:]) <= version - KEEP_VERSIONS:
                    shutil.rmtree(old, ignore_errors=True)
            except ValueError:
                pass
        notify_dataset(task.dataset_id, version)

    @app.post("/api/datasets/{dsid}/refresh")
    async def start_refresh(dsid: int, user: dict = Depends(current_user)):
        with engine.connect() as c:
            ds = c.execute(select(db.datasets).where(db.datasets.c.id == dsid)).first()
            if ds is None:
                raise NOT_FOUND("Anlam modeli")
            if role_in(c, user["id"], ds.workspace_id) not in ("admin", "member"):
                raise FORBIDDEN("Şimdi yenile için Yönetici ya da Üye olmalısınız")
            model = ModelTanimi.model_validate(yaml.safe_load(ds.model_yaml))
            bindings = {r.source_key: r.gateway_source_id for r in c.execute(select(db.dataset_source_bindings).where(
                db.dataset_source_bindings.c.dataset_id == dsid)).all()}
            sources = {r.id: r for r in c.execute(select(db.gateway_sources).where(
                db.gateway_sources.c.workspace_id == ds.workspace_id)).all()}
        tables = [t for t in model.tablolar if t.sorgu]
        source_keys = {t.sorgu.kaynak for t in tables}
        selected = [sources.get(bindings.get(k)) for k in source_keys]
        gateway_id = selected[0].gateway_id if selected and selected[0] else None
        error = None
        if not tables:
            error = "Yenilenebilir kaynak tablosu yok"
        elif any(s is None for s in selected):
            error = "Veri kaynağı Floemway bağlantısıyla eşleştirilmedi"
        elif len({s.gateway_id for s in selected}) != 1:
            error = "Bir anlam modeli için aynı Floemway üzerindeki bağlantıları seçin"
        with engine.begin() as c:
            run_id = c.execute(db.refresh_runs.insert().values(
                dataset_id=dsid, gateway_id=gateway_id, status="queued", stage="Kuyruk",
                requested_by=user["id"])).inserted_primary_key[0]
        if error:
            with engine.begin() as c:
                c.execute(db.refresh_runs.update().where(db.refresh_runs.c.id == run_id).values(
                    status="failed", stage="Eşleme", error=json.dumps({"message": error, "detail": ""}, ensure_ascii=False),
                    finished_at=db.now()))
            return refresh_row(run_id)
        with gateway_lock:
            connected = gateway_sockets.get(gateway_id)
            busy = gateway_id in active_refreshes
        if busy:
            with engine.begin() as c:
                c.execute(db.refresh_runs.update().where(db.refresh_runs.c.id == run_id).values(
                    status="failed", stage="Kuyruk", error=json.dumps({"message": "Floemway üzerinde başka bir yenileme sürüyor", "detail": ""}, ensure_ascii=False),
                    finished_at=db.now()))
            return refresh_row(run_id)
        if connected is None:
            with engine.begin() as c:
                c.execute(db.refresh_runs.update().where(db.refresh_runs.c.id == run_id).values(
                    status="failed", stage="Bağlantı", error=json.dumps({"message": "Floemway çevrimdışı", "detail": ""}, ensure_ascii=False),
                    finished_at=db.now()))
            return refresh_row(run_id)
        tmp_root = settings.data_dir / "tmp"
        tmp_root.mkdir(exist_ok=True)
        stage = Path(tempfile.mkdtemp(dir=tmp_root))
        task = ActiveRefresh(run_id, dsid, gateway_id, ds.version, Path(ds.snapshot), ds.model_yaml, stage)
        with gateway_lock:
            still_connected = gateway_sockets.get(gateway_id) == connected
            reserved = still_connected and gateway_id not in active_refreshes
            if reserved:
                active_refreshes[gateway_id] = task
        if not reserved:
            shutil.rmtree(stage, ignore_errors=True)
            with engine.begin() as c:
                c.execute(db.refresh_runs.update().where(db.refresh_runs.c.id == run_id).values(
                    status="failed", stage="Kuyruk", finished_at=db.now(),
                    error=json.dumps({"message": "Floemway bağlantısı değişti; yeniden deneyin", "detail": ""},
                                     ensure_ascii=False)))
            return refresh_row(run_id)
        payload = {"type": "refresh", "run_id": run_id, "tables": []}
        for table in tables:
            source = sources[bindings[table.sorgu.kaynak]]
            payload["tables"].append({"name": table.ad, "query": table.sorgu.model_dump(),
                                      "source": {"server": source.server, "database": source.database,
                                                 "username": source.username, "password_enc": source.password_enc}})
        try:
            socket, send_lock = connected
            async with send_lock:
                await socket.send_json(payload)
        except Exception:
            await fail_refresh(gateway_id, "Floemway çevrimdışı", stage="Bağlantı")
            return refresh_row(run_id)

        async def watchdog() -> None:
            await asyncio.sleep(300)
            await fail_refresh(gateway_id, "Zaman aşımı (300 sn)", stage="Aktarım")
            with gateway_lock:
                current = gateway_sockets.get(gateway_id)
            if current:
                await current[0].close(code=4001)

        task.timeout = asyncio.create_task(watchdog())
        return refresh_row(run_id)

    @app.get("/api/datasets/{dsid}/refreshes")
    def refresh_history(dsid: int, user: dict = Depends(current_user)):
        with engine.connect() as c:
            ds = c.execute(select(db.datasets).where(db.datasets.c.id == dsid)).first()
            if ds is None:
                raise NOT_FOUND("Anlam modeli")
            if role_in(c, user["id"], ds.workspace_id) not in ("admin", "member"):
                raise FORBIDDEN()
            rows = c.execute(select(db.refresh_runs).where(db.refresh_runs.c.dataset_id == dsid)
                             .order_by(db.refresh_runs.c.id.desc()).limit(30)).all()
        return [refresh_view(r) for r in rows]

    @app.websocket("/api/gateways/connect/{gateway_id}")
    async def gateway_connect(websocket: WebSocket, gateway_id: int):
        with engine.connect() as c:
            gw = c.execute(select(db.gateways).where(db.gateways.c.id == gateway_id)).first()
        if gw is None or not gw.public_key:
            await websocket.close(code=4404)
            return
        await websocket.accept()
        try:
            from nacl.public import PublicKey, SealedBox
            challenge = secrets.token_urlsafe(24)
            public = PublicKey(base64.b64decode(gw.public_key))
            await websocket.send_json({"type": "challenge", "value": SealedBox(public).encrypt(challenge.encode()).hex()})
            proof = await asyncio.wait_for(websocket.receive_json(), timeout=20)
            if proof.get("type") != "challenge_response" or proof.get("value") != challenge:
                raise ValueError("geçersiz yanıt")
        except Exception:
            await websocket.close(code=4401)
            return
        send_lock = asyncio.Lock()
        with gateway_lock:
            prior = gateway_sockets.get(gateway_id)
            gateway_sockets[gateway_id] = (websocket, send_lock)
        if prior:
            await fail_refresh(gateway_id, "Floemway bağlantısı yeniden kuruldu", stage="Bağlantı")
            await prior[0].close(code=4000)
        with engine.begin() as c:
            c.execute(db.gateways.update().where(db.gateways.c.id == gateway_id).values(last_seen=db.now()))
        try:
            while True:
                packet = await asyncio.wait_for(websocket.receive(), timeout=65)
                if packet["type"] == "websocket.disconnect":
                    break
                raw = packet.get("text")
                message = json.loads(raw) if raw else None
                if message and message.get("type") == "heartbeat":
                    with engine.begin() as c:
                        c.execute(db.gateways.update().where(db.gateways.c.id == gateway_id).values(last_seen=db.now()))
                    continue
                with gateway_lock:
                    task = active_refreshes.get(gateway_id)
                if task is None:
                    continue
                try:
                    if packet.get("bytes") is not None:
                        data = packet["bytes"]
                        if len(data) > 32 * 1024 * 1024:
                            raise RefreshError("Arrow parçası 32 MB sınırını aşıyor", stage="Aktarım")
                        if task.builder is None:
                            raise RefreshError("Aktarım başlamadı", stage="Aktarım")
                        await asyncio.to_thread(task.builder.add_batch, data)
                    elif message and message.get("run_id") == task.id:
                        kind = message.get("type")
                        if kind == "start":
                            model = ModelTanimi.model_validate(yaml.safe_load(task.model_yaml))
                            task.builder = await asyncio.to_thread(
                                SnapshotBuilder, task.snapshot, task.stage / "data.duckdb", model)
                            with engine.begin() as c:
                                c.execute(db.refresh_runs.update().where(db.refresh_runs.c.id == task.id).values(
                                    status="running", stage="SQL Server bağlantısı"))
                        elif kind == "table_start":
                            task.builder.start_table(message["name"])
                            with engine.begin() as c:
                                c.execute(db.refresh_runs.update().where(db.refresh_runs.c.id == task.id).values(
                                    stage="Tablo aktarımı", table_name=message["name"]))
                        elif kind == "table_end":
                            task.builder.end_table(message["name"])
                        elif kind == "error":
                            await fail_refresh(gateway_id, message.get("message", "Floemway hatası"),
                                               stage=message.get("stage") or "Floemway",
                                               table=message.get("table_name"), detail=message.get("detail") or "")
                        elif kind == "done":
                            await complete_refresh(task)
                except RefreshError as e:
                    await fail_refresh(gateway_id, e.message, stage=e.stage, table=e.table, detail=e.detail)
                except Exception as e:
                    await fail_refresh(gateway_id, "Yenileme tamamlanamadı", stage="Sunucu", detail=str(e))
        except (WebSocketDisconnect, asyncio.TimeoutError):
            pass
        finally:
            with gateway_lock:
                current = gateway_sockets.get(gateway_id)
                was_current = current is not None and current[0] is websocket
                if was_current:
                    del gateway_sockets[gateway_id]
            if was_current:
                await fail_refresh(gateway_id, "Floemway çevrimdışı", stage="Bağlantı")

    def report_access(c, user_id: int, report_row) -> str | None:
        role = role_in(c, user_id, report_row.workspace_id)
        if role:
            return role
        shared = c.execute(select(db.shares.c.user_id).where(
            and_(db.shares.c.report_id == report_row.id, db.shares.c.user_id == user_id))).first()
        return "viewer" if shared else None

    def rls_roles(c, user: dict, ds, access_role: str, model_roles: list[str]) -> list[str] | None:
        """Kullanıcıya uygulanacak RLS rolleri; None = kısıtlama yok.

        Power BI'daki gibi: RLS yalnızca İzleyicilere (ve raporu paylaşımla görenlere) uygulanır;
        Yönetici, Üye ve Katkıda bulunan modeli düzenleyebildiği için tüm veriyi görür. Modelde rol
        varsa ve izleyiciye hiçbir rol atanmamışsa veri gösterilmez."""
        if access_role != "viewer" or not model_roles:
            return None
        by_lower = {r.lower(): r for r in model_roles}
        rows = c.execute(select(db.role_members.c.role).where(and_(
            db.role_members.c.dataset_id == ds.id, db.role_members.c.user_id == user["id"]))).all()
        mine = sorted({by_lower[r.role.lower()] for r in rows if r.role.lower() in by_lower})
        if not mine:
            raise ApiError(
                403, "rls_no_role",
                "Bu raporun verisi satır düzeyi güvenlikle korunuyor ve size henüz bir rol atanmamış",
                f"Çalışma alanı yöneticisinden '{ds.name}' anlam modelinin Güvenlik ekranında sizi bir role eklemesini isteyin.",
            )
        return mine

    def model_role_names(ds) -> list[str]:
        tanim = ModelTanimi.model_validate(yaml.safe_load(ds.model_yaml))
        return [r.ad for r in tanim.roller]

    def user_name(c, uid: int) -> str:
        r = c.execute(select(db.users.c.name).where(db.users.c.id == uid)).first()
        return r[0] if r else ""

    @app.post("/api/auth/login")
    def login(body: LoginIn):
        email = body.email.strip().lower()
        if settings.pilot and not login_throttle.allow(email):
            raise ApiError(429, "login_limited", "Çok fazla hatalı giriş denemesi. 15 dakika sonra tekrar deneyin.")
        with engine.connect() as c:
            row = c.execute(select(db.users).where(db.users.c.email == email)).first()
        if row is None or not verify_password(row.password_hash, body.password):
            if settings.pilot:
                login_throttle.failure(email)
            raise ApiError(401, "login_failed", "E-posta adresi ya da şifre hatalı")
        if settings.pilot:
            login_throttle.success(email)
        return {
            "token": issue_token(row.id, settings.secret),
            "user": {"id": row.id, "email": row.email, "name": row.name, "is_admin": bool(row.is_admin)},
        }

    @app.get("/api/me")
    def me(user: dict = Depends(current_user)):
        with engine.connect() as c:
            rows = c.execute(
                select(db.workspaces.c.id, db.workspaces.c.name, db.members.c.role)
                .join(db.members, db.members.c.workspace_id == db.workspaces.c.id)
                .where(db.members.c.user_id == user["id"])
            ).all()
        return {
            **user, "mail_mode": mail_mode(),
            "workspaces": [{"id": r.id, "name": r.name, "role": r.role, "role_label": ROLE_LABEL[r.role]} for r in rows],
        }

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
            app_sum = app_summary(c, wid)
            source_summaries = {d.id: source_status(c, d) for d in ds}
        return {
            "workspace": {"id": ws.id, "name": ws.name, "role": role, "role_label": ROLE_LABEL[role]},
            "datasets": [{
                "id": d.id, "name": d.name, "version": d.version, "size_bytes": d.size_bytes,
                "published_at": iso(d.published_at), "published_by": names[d.published_by],
                "gateway_ready": bool(source_summaries[d.id]) and all(s["ready"] for s in source_summaries[d.id]),
                "gateway_source_count": len(source_summaries[d.id]),
            } for d in ds],
            "reports": [{
                "id": r.id, "name": r.name, "version": r.version, "dataset_id": r.dataset_id,
                "published_at": iso(r.published_at), "published_by": names[r.published_by],
            } for r in rp],
            "app": app_sum,
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
            notify_report(rid, rversion, ds_id, version)
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
            rls = rls_roles(c, user, ds, role, model_role_names(ds))
        return {
            "id": rp.id, "name": rp.name, "version": rp.version, "published_at": iso(rp.published_at),
            "published_by": by, "role": role, "role_label": ROLE_LABEL[role], "can_share": role in ("admin", "member"),
            "rls_roles": rls,
            "workspace": {"id": ws.id, "name": ws.name},
            "dataset": {"id": ds.id, "name": ds.name, "version": ds.version},
            "definition": json.loads(rp.definition),
        }

    @app.post("/api/reports/{rid}/query")
    def report_query(rid: int, q: VisualQuery, user: dict = Depends(current_user)):
        with engine.connect() as c:
            rp, role = load_report(c, rid, user)
        return dataset_query(user, rp.dataset_id, role, q)

    def dataset_query(user: dict, dataset_id: int, role: str, q: VisualQuery) -> dict:
        """Görsel sorgusu; İzleyiciye RLS rolleri uygulanır (rapor ve App ortak)."""
        with engine.connect() as c:
            ds = c.execute(select(db.datasets).where(db.datasets.c.id == dataset_id)).first()
            model, eng, lock = engines.get(ds.id, ds.version, ds.model_yaml, ds.snapshot)
            roles = rls_roles(c, user, ds, role, [r.ad for r in model.tanim.roller])
        try:
            with lock:
                if roles is None:
                    return run_visual_query(model, eng, q)
                # RLS: rol filtreleri her sorguya eklenir; USERPRINCIPALNAME() oturumdaki e-posta
                return run_visual_query(model, eng, q, user=UserInfo(upn=user["email"]), roles=roles)
        except QueryError as e:
            raise ApiError(400, "query_error", "Görsel sorgusu çalıştırılamadı", str(e)) from e

    # -------------------------------------------------------------- paylaşım
    SHARE_ROLES = {"admin", "member"}

    def can_share(c, user_id: int, rp) -> bool:
        return role_in(c, user_id, rp.workspace_id) in SHARE_ROLES

    @app.get("/api/reports/{rid}/access")
    def report_access_list(rid: int, user: dict = Depends(current_user)):
        """Rapora erişimi olanlar: çalışma alanı üyeleri ve raporun paylaşıldığı kişiler."""
        with engine.connect() as c:
            rp, _ = load_report(c, rid, user)
            if not can_share(c, user["id"], rp):
                raise FORBIDDEN("Erişimi yalnızca çalışma alanı Yöneticisi ve Üyeleri görebilir")
            members = c.execute(
                select(db.users.c.id, db.users.c.email, db.users.c.name, db.members.c.role)
                .join(db.members, db.members.c.user_id == db.users.c.id)
                .where(db.members.c.workspace_id == rp.workspace_id)
            ).all()
            shared = c.execute(
                select(db.users.c.id, db.users.c.email, db.users.c.name, db.shares.c.shared_by, db.shares.c.created_at)
                .join(db.shares, db.shares.c.user_id == db.users.c.id)
                .where(db.shares.c.report_id == rid)
            ).all()
            pending = c.execute(select(db.pending_grants).where(db.pending_grants.c.report_id == rid)).all()
            return {
                "members": [{"id": m.id, "email": m.email, "name": m.name, "role": m.role, "role_label": ROLE_LABEL[m.role]}
                            for m in members],
                "shares": [{"id": s.id, "email": s.email, "name": s.name, "shared_by": user_name(c, s.shared_by),
                            "shared_at": iso(s.created_at)} for s in shared],
                "pending": [{"id": g.id, "email": g.email, "shared_by": user_name(c, g.granted_by) if g.granted_by else "",
                             "shared_at": iso(g.created_at)} for g in pending],
                "mail_mode": mail_mode(),
            }

    @app.post("/api/reports/{rid}/share")
    def share_report(rid: int, body: ShareIn, user: dict = Depends(current_user)):
        """Power BI "Paylaş": alıcıya rapor erişimi verir, istenirse bağlantılı e-posta gönderir."""
        results, invites = [], []
        with engine.begin() as c:
            rp, _ = load_report(c, rid, user)
            if not can_share(c, user["id"], rp):
                raise FORBIDDEN("Raporu yalnızca çalışma alanı Yöneticisi ve Üyeleri paylaşabilir")
            ws = c.execute(select(db.workspaces.c.name).where(db.workspaces.c.id == rp.workspace_id)).scalar_one()
            for raw in dict.fromkeys(e.strip().lower() for e in body.emails if e.strip()):
                item = {"email": raw, "status": "", "mail": "skipped", "message": ""}
                results.append(item)
                if "@" not in raw or len(raw) > 254:
                    item.update(status="invalid", message="Geçerli bir e-posta adresi değil")
                    continue
                target = c.execute(select(db.users.c.id, db.users.c.name).where(db.users.c.email == raw)).first()
                if target is None:
                    # Hesabı yok: yetki bekletilir, davet e-postası gider; hesap açılınca rapor paylaşılmış olur
                    if not c.execute(select(db.pending_grants.c.id).where(and_(
                            db.pending_grants.c.email == raw, db.pending_grants.c.report_id == rid))).first():
                        c.execute(db.pending_grants.insert().values(email=raw, report_id=rid, granted_by=user["id"]))
                    invites.append(raw)
                    item.update(status="invited", message="floembi.app hesabı yok; davet gönderilir, hesabını "
                                                         "açınca raporu görür")
                    continue
                if target.id == user["id"]:
                    item.update(status="self", message="Rapor zaten sizin")
                    continue
                if role_in(c, target.id, rp.workspace_id):
                    item.update(status="member", message="Çalışma alanının üyesi; rapora zaten erişebiliyor")
                elif c.execute(select(db.shares.c.user_id).where(
                        and_(db.shares.c.report_id == rid, db.shares.c.user_id == target.id))).first():
                    item.update(status="already", message="Rapor bu kişiyle zaten paylaşılmış")
                else:
                    c.execute(db.shares.insert().values(report_id=rid, user_id=target.id, shared_by=user["id"]))
                    item.update(status="shared", message="Erişim verildi")
                item["name"] = target.name
        # E-postalar transaction dışında: SMTP yavaşsa ya da hata verirse paylaşım geri alınmaz
        url = f"{settings.public_url}/reports/{rid}"
        for item in results:
            if item["status"] == "invited":             # davet bildirim seçeneğinden bağımsız gider (tek giriş yolu)
                deliver_result(item, send_invite(item["email"], user, body.message))
            elif body.notify and item["status"] in ("shared", "already", "member"):
                mail = share_mail(to=item["email"], sender_name=user["name"], report_name=rp.name, workspace=ws,
                                  url=url, message=body.message)
                deliver_result(item, deliver("share", mail, user, report_id=rid))
        return {"results": results, "mail_mode": mail_mode()}

    @app.delete("/api/reports/{rid}/share/{uid}")
    def unshare_report(rid: int, uid: int, user: dict = Depends(current_user)):
        with engine.begin() as c:
            rp, _ = load_report(c, rid, user)
            if not can_share(c, user["id"], rp):
                raise FORBIDDEN("Erişimi yalnızca çalışma alanı Yöneticisi ve Üyeleri kaldırabilir")
            c.execute(db.shares.delete().where(and_(db.shares.c.report_id == rid, db.shares.c.user_id == uid)))
        return {"ok": True}

    @app.delete("/api/reports/{rid}/pending/{gid}")
    def cancel_pending_share(rid: int, gid: int, user: dict = Depends(current_user)):
        """Hesabı henüz açılmamış alıcıya bekleyen paylaşımı geri alır."""
        with engine.begin() as c:
            rp, _ = load_report(c, rid, user)
            if not can_share(c, user["id"], rp):
                raise FORBIDDEN("Erişimi yalnızca çalışma alanı Yöneticisi ve Üyeleri kaldırabilir")
            g = c.execute(select(db.pending_grants).where(
                and_(db.pending_grants.c.id == gid, db.pending_grants.c.report_id == rid))).first()
            if g is None:
                raise NOT_FOUND("Bekleyen paylaşım")
            c.execute(db.pending_grants.delete().where(db.pending_grants.c.id == gid))
            drop_orphan_invitation(c, g.email)
        return {"ok": True}

    # -------------------------------------------------------------- geliştirme: gelen e-postalar
    @app.get("/api/mail/inbox")
    def mail_inbox(user: dict = Depends(current_user)):
        """Giden kutusu modunda: bu kullanıcıya gönderilen (ya da onun gönderdiği) e-postalar."""
        with engine.connect() as c:
            rows = c.execute(
                select(db.mail_log).where(
                    (db.mail_log.c.to_email == user["email"]) | (db.mail_log.c.created_by == user["id"])
                ).order_by(db.mail_log.c.id.desc()).limit(200)
            ).all()
            return {
                "mail_mode": mail_mode(),
                "items": [{
                    "id": r.id, "to": r.to_email, "subject": r.subject, "status": r.status, "error": r.error,
                    "from": user_name(c, r.created_by), "incoming": r.to_email == user["email"],
                    "created_at": iso(r.created_at), "readable": bool(r.eml_path),
                } for r in rows],
            }

    @app.get("/api/mail/inbox/{mid}")
    def mail_message(mid: int, user: dict = Depends(current_user)):
        with engine.connect() as c:
            r = c.execute(select(db.mail_log).where(db.mail_log.c.id == mid)).first()
        if r is None or (r.to_email != user["email"] and r.created_by != user["id"]):
            raise NOT_FOUND("E-posta")
        if not r.eml_path or not Path(r.eml_path).exists():
            raise ApiError(404, "not_found", "Bu e-postanın içeriği saklanmadı (SMTP ile gönderildi)")
        msg = BytesParser(policy=email_policy.default).parsebytes(Path(r.eml_path).read_bytes())
        html = msg.get_body(preferencelist=("html",))
        text = msg.get_body(preferencelist=("plain",))
        return {
            "id": r.id, "subject": msg["Subject"], "from": msg["From"], "to": msg["To"],
            "created_at": iso(r.created_at),
            "html": html.get_content() if html else None, "text": text.get_content() if text else "",
        }

    # -------------------------------------------------------------- yönetim: e-posta sunucusu
    def mail_config_view() -> dict:
        row = mail_row()
        env = settings.mail
        source = "screen" if (row is not None and row.enabled) else ("env" if env.smtp else "outbox")
        cfg = {
            "enabled": bool(row.enabled) if row else False,
            "host": row.host if row else "", "port": row.port if row else 587,
            "security": row.security if row else "starttls", "username": (row.username if row else None) or "",
            "has_password": bool(row and row.password_enc),
            "from_address": row.from_address if row else "", "from_name": row.from_name if row else "floembi.app",
            "updated_at": iso(row.updated_at) if row and row.updated_at else None,
        }
        if row and row.updated_by:
            with engine.connect() as c:
                cfg["updated_by"] = user_name(c, row.updated_by)
        # Ayar son değiştirildikten sonraki son gönderim denemesi: bant ayarın gerçekten çalışıp çalışmadığını gösterir
        last = None
        with engine.connect() as c:
            q = select(db.mail_log).order_by(db.mail_log.c.id.desc()).limit(1)
            if row is not None and row.updated_at:
                q = q.where(db.mail_log.c.created_at >= row.updated_at)
            r = c.execute(q).first()
            if r is not None and r.status in ("sent", "failed"):
                last = {"kind": r.kind, "status": r.status, "to": r.to_email, "at": iso(r.created_at),
                        "error": (r.error or "").split(": ", 1)[0] if r.error else None}
        return {
            "source": source, "config": cfg, "public_url": settings.public_url, "last_attempt": last,
            "env": ({"host": env.smtp.host, "port": env.smtp.port, "security": env.smtp.security,
                     "username": env.smtp.user or "", "sender": env.sender} if env.smtp else None),
        }

    def check_mail_config(body: MailConfigIn) -> None:
        if body.security not in SECURITY:
            raise ApiError(400, "invalid", "Güvenlik türü starttls, ssl ya da none olmalı")
        if body.enabled:
            if not body.host.strip():
                raise ApiError(400, "invalid", "SMTP sunucusu adresini yazın")
            if not valid_email(body.from_address.strip()):
                raise ApiError(400, "invalid", "Gönderen adresi geçerli bir e-posta adresi olmalı")
            hint = login_hint(body.host, (body.username or "").strip())
            if hint:
                raise ApiError(400, "invalid", hint)

    def sealed_password(body: MailConfigIn, row) -> str | None:
        if body.password is None:                      # alan boş bırakıldı: kayıtlı şifre korunur
            return row.password_enc if row else None
        return box.seal(body.password) if body.password else None

    @app.get("/api/admin/mail")
    def get_mail_config(user: dict = Depends(admin_user)):
        return mail_config_view()

    @app.put("/api/admin/mail")
    def put_mail_config(body: MailConfigIn, user: dict = Depends(admin_user)):
        check_mail_config(body)
        row = mail_row()
        values = dict(
            enabled=body.enabled, host=body.host.strip(), port=body.port, security=body.security,
            username=(body.username or "").strip() or None, password_enc=sealed_password(body, row),
            from_address=body.from_address.strip(), from_name=body.from_name.strip() or "floembi.app",
            updated_by=user["id"], updated_at=db.now(),
        )
        with engine.begin() as c:
            if row is None:
                c.execute(db.mail_config.insert().values(id=1, **values))
            else:
                c.execute(db.mail_config.update().where(db.mail_config.c.id == 1).values(**values))
        return mail_config_view()

    @app.post("/api/admin/mail/test")
    def test_mail_config(body: MailTestIn, user: dict = Depends(admin_user)):
        """Ekrandaki (henüz kaydedilmemiş olabilir) ayarla test e-postası gönderir."""
        check_mail_config(body)
        to = (body.to or user["email"]).strip().lower()
        if not valid_email(to):
            raise ApiError(400, "invalid", "Test alıcısı geçerli bir e-posta adresi olmalı")
        try:
            if body.enabled:
                row = mail_row()
                sealed = sealed_password(body, row)
                ms = MailSettings(
                    sender=f"{body.from_name or 'floembi.app'} <{body.from_address.strip()}>", source="screen",
                    smtp=SmtpSettings(host=body.host.strip(), port=body.port, security=body.security,
                                      user=(body.username or "").strip() or None,
                                      password=box.open(sealed) if sealed else None),
                )
                server_txt = f"{body.host.strip()}:{body.port}"
            else:
                ms, server_txt = MailSettings(), "giden kutusu"
        except MailError as e:
            raise ApiError(400, "mail_error", e.message, e.detail) from e
        status, error, detail = deliver("test", test_mail(to=to, by=user["name"], url=settings.public_url,
                                                          server=server_txt), user, ms=ms)
        return {"to": to, "status": status, "error": error, "detail": detail}

    # -------------------------------------------------------------- yönetim: kullanıcılar ve yetkilendirme
    def aware(dt):
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt

    def admins_left(c, wid: int, without_uid: int) -> int:
        return len(c.execute(select(db.members.c.user_id).where(and_(
            db.members.c.workspace_id == wid, db.members.c.role == "admin", db.members.c.user_id != without_uid))).all())

    def check_role(role: str) -> None:
        if role not in ROLES:
            raise ApiError(400, "invalid", "Rol admin, member, contributor ya da viewer olmalı")

    @app.get("/api/admin/users")
    def admin_users(user: dict = Depends(admin_user)):
        with engine.connect() as c:
            wss = {w.id: w.name for w in c.execute(select(db.workspaces).order_by(db.workspaces.c.name)).all()}
            mem: dict[int, list] = {}
            for m in c.execute(select(db.members)).all():
                mem.setdefault(m.user_id, []).append({
                    "workspace_id": m.workspace_id, "workspace": wss.get(m.workspace_id, ""),
                    "role": m.role, "role_label": ROLE_LABEL[m.role]})
            users = c.execute(select(db.users).order_by(db.users.c.name)).all()
            invs = c.execute(select(db.invitations).order_by(db.invitations.c.created_at.desc())).all()
            now = db.now()
            return {
                "users": [{"id": u.id, "email": u.email, "name": u.name, "is_admin": bool(u.is_admin),
                           "created_at": iso(u.created_at), "workspaces": mem.get(u.id, [])} for u in users],
                "invitations": [{"id": i.id, "email": i.email, "created_at": iso(i.created_at),
                                 "expires_at": iso(i.expires_at), "expired": aware(i.expires_at) < now,
                                 "invited_by": user_name(c, i.invited_by) if i.invited_by else "",
                                 "grants": grant_texts(c, i.email)} for i in invs],
                "workspaces": [{"id": k, "name": v} for k, v in wss.items()],
                "roles": [{"value": r, "label": ROLE_LABEL[r]} for r in reversed(ROLES)],
                "mail_mode": mail_mode(),
            }

    @app.post("/api/admin/users/grant")
    def admin_grant(body: GrantIn, user: dict = Depends(admin_user)):
        """Adreslere çalışma alanı yetkisi verir ve otomatik e-posta gönderir.
        Hesabı olan: üyelik eklenir/güncellenir, "erişim verildi" e-postası gider (notify ise).
        Hesabı olmayan: yetki bekletilir, davet e-postası gider; hesabını açınca üye olur."""
        check_role(body.role)
        results, invites = [], []
        with engine.begin() as c:
            ws = c.execute(select(db.workspaces).where(db.workspaces.c.id == body.workspace_id)).first()
            if ws is None:
                raise NOT_FOUND("Çalışma alanı")
            for raw in dict.fromkeys(e.strip().lower() for e in body.emails if e.strip()):
                item = {"email": raw, "status": "", "mail": "skipped", "message": ""}
                results.append(item)
                if not valid_email(raw):
                    item.update(status="invalid", message="Geçerli bir e-posta adresi değil")
                    continue
                target = c.execute(select(db.users.c.id, db.users.c.name).where(db.users.c.email == raw)).first()
                if target is None:
                    g = c.execute(select(db.pending_grants.c.id).where(and_(
                        db.pending_grants.c.email == raw, db.pending_grants.c.workspace_id == ws.id))).first()
                    if g:
                        c.execute(db.pending_grants.update().where(db.pending_grants.c.id == g.id).values(role=body.role))
                    else:
                        c.execute(db.pending_grants.insert().values(
                            email=raw, workspace_id=ws.id, role=body.role, granted_by=user["id"]))
                    item.update(status="invited", message="Hesabı yok; davet gönderilir")
                    continue
                item["name"] = target.name
                current = role_in(c, target.id, ws.id)
                if current == body.role:
                    item.update(status="unchanged", message=f"Zaten {ROLE_LABEL[current]}")
                elif current:
                    if current == "admin" and admins_left(c, ws.id, target.id) == 0:
                        item.update(status="last_admin", message="Çalışma alanının son Yöneticisi; rolü düşürülemez")
                        continue
                    c.execute(db.members.update().where(and_(
                        db.members.c.workspace_id == ws.id, db.members.c.user_id == target.id)).values(role=body.role))
                    item.update(status="updated", message=f"Rol değişti: {ROLE_LABEL[current]} → {ROLE_LABEL[body.role]}")
                else:
                    c.execute(db.members.insert().values(workspace_id=ws.id, user_id=target.id, role=body.role))
                    item.update(status="granted", message=f"{ROLE_LABEL[body.role]} olarak eklendi")
        url = f"{settings.public_url}/workspaces/{ws.id}"
        for item in results:
            if item["status"] == "invited":
                deliver_result(item, send_invite(item["email"], user, body.message))
            elif body.notify and item["status"] in ("granted", "updated"):
                mail = access_mail(to=item["email"], granter=user["name"], workspace=ws.name,
                                   role_label=ROLE_LABEL[body.role], url=url)
                deliver_result(item, deliver("access", mail, user))
        return {"results": results, "mail_mode": mail_mode()}

    @app.put("/api/admin/users/{uid}/workspaces/{wid}")
    def admin_set_role(uid: int, wid: int, body: RoleIn, user: dict = Depends(admin_user)):
        check_role(body.role)
        with engine.begin() as c:
            current = role_in(c, uid, wid)
            if current is None:
                raise NOT_FOUND("Üyelik")
            if current == "admin" and body.role != "admin" and admins_left(c, wid, uid) == 0:
                raise ApiError(400, "last_admin", "Çalışma alanının son Yöneticisinin rolü düşürülemez",
                               "Önce başka birini Yönetici yapın")
            c.execute(db.members.update().where(and_(db.members.c.workspace_id == wid, db.members.c.user_id == uid))
                      .values(role=body.role))
        return {"ok": True}

    @app.delete("/api/admin/users/{uid}/workspaces/{wid}")
    def admin_remove_member(uid: int, wid: int, user: dict = Depends(admin_user)):
        with engine.begin() as c:
            current = role_in(c, uid, wid)
            if current is None:
                raise NOT_FOUND("Üyelik")
            if current == "admin" and admins_left(c, wid, uid) == 0:
                raise ApiError(400, "last_admin", "Çalışma alanının son Yöneticisi çıkarılamaz",
                               "Önce başka birini Yönetici yapın")
            c.execute(db.members.delete().where(and_(db.members.c.workspace_id == wid, db.members.c.user_id == uid)))
        return {"ok": True}

    @app.put("/api/admin/users/{uid}/admin")
    def admin_set_flag(uid: int, body: AdminFlagIn, user: dict = Depends(admin_user)):
        if uid == user["id"] and not body.is_admin:
            raise ApiError(400, "invalid", "Kendi sistem yöneticisi yetkinizi kaldıramazsınız")
        with engine.begin() as c:
            if c.execute(db.users.update().where(db.users.c.id == uid).values(is_admin=body.is_admin)).rowcount == 0:
                raise NOT_FOUND("Kullanıcı")
        return {"ok": True}

    @app.post("/api/admin/invitations/{iid}/resend")
    def admin_resend(iid: int, user: dict = Depends(admin_user)):
        with engine.connect() as c:
            inv = c.execute(select(db.invitations).where(db.invitations.c.id == iid)).first()
        if inv is None:
            raise NOT_FOUND("Davet")
        status, error, detail = send_invite(inv.email, user)
        return {"status": status, "error": error, "detail": detail}

    @app.delete("/api/admin/invitations/{iid}")
    def admin_revoke(iid: int, user: dict = Depends(admin_user)):
        with engine.begin() as c:
            inv = c.execute(select(db.invitations).where(db.invitations.c.id == iid)).first()
            if inv is None:
                raise NOT_FOUND("Davet")
            c.execute(db.pending_grants.delete().where(db.pending_grants.c.email == inv.email))
            c.execute(db.invitations.delete().where(db.invitations.c.id == iid))
        return {"ok": True}

    # -------------------------------------------------------------- davet kabulü (oturumsuz)
    INVITE_INVALID = lambda: ApiError(  # noqa: E731
        404, "invite_invalid", "Davet bağlantısı geçersiz ya da süresi dolmuş",
        "Bağlantı yalnızca bir kez kullanılabilir. Sizi davet eden kişiden yeni bir davet isteyin.")

    def find_invitation(c, token: str):
        inv = c.execute(select(db.invitations).where(db.invitations.c.token_hash == token_hash(token))).first()
        if inv is None or aware(inv.expires_at) < db.now():
            raise INVITE_INVALID()
        return inv

    @app.get("/api/invitations/{token}")
    def get_invitation(token: str):
        with engine.connect() as c:
            inv = find_invitation(c, token)
            return {
                "email": inv.email, "inviter": user_name(c, inv.invited_by) if inv.invited_by else "",
                "grants": grant_texts(c, inv.email), "expires_at": iso(inv.expires_at),
            }

    @app.post("/api/invitations/{token}/accept")
    def accept_invitation(token: str, body: AcceptIn):
        with engine.begin() as c:
            inv = find_invitation(c, token)
            if c.execute(select(db.users.c.id).where(db.users.c.email == inv.email)).first():
                raise ApiError(409, "exists", "Bu e-posta adresiyle zaten bir hesap var; oturum açın")
            uid = c.execute(db.users.insert().values(
                email=inv.email, name=body.name.strip(), password_hash=hash_password(body.password), is_admin=False,
            )).inserted_primary_key[0]
            for g in c.execute(select(db.pending_grants).where(db.pending_grants.c.email == inv.email)).all():
                if g.workspace_id:
                    if role_in(c, uid, g.workspace_id) is None:
                        c.execute(db.members.insert().values(workspace_id=g.workspace_id, user_id=uid,
                                                             role=g.role or "viewer"))
                elif g.report_id:
                    rp = c.execute(select(db.reports).where(db.reports.c.id == g.report_id)).first()
                    if rp and report_access(c, uid, rp) is None:
                        c.execute(db.shares.insert().values(report_id=rp.id, user_id=uid,
                                                            shared_by=g.granted_by or uid))
                elif g.app_id:
                    a = c.execute(select(db.apps).where(db.apps.c.id == g.app_id)).first()
                    if a and app_role(c, uid, a) is None:
                        c.execute(db.app_access.insert().values(app_id=a.id, user_id=uid,
                                                                granted_by=g.granted_by or uid))
            c.execute(db.pending_grants.delete().where(db.pending_grants.c.email == inv.email))
            c.execute(db.invitations.delete().where(db.invitations.c.id == inv.id))
        return {
            "token": issue_token(uid, settings.secret),
            "user": {"id": uid, "email": inv.email, "name": body.name.strip(), "is_admin": False},
        }


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
            "workspace_id": ds.workspace_id,
            "tables": [{"ad": t.ad, "sutunlar": len(t.sutunlar), "gizli": t.gizli} for t in tanim.tablolar],
            "relationships": [r.model_dump() for r in tanim.iliskiler],
            "sources": [{"sunucu": k.sunucu, "veritabani": k.veritabani} for k in tanim.veri_kaynaklari],
        }

    # -------------------------------------------------------------- anlık güncelleme (SSE)
    def notify_report(rid: int, version: int, dataset_id: int, dataset_version: int) -> None:
        """Rapor yeniden yayımlandı: raporu ya da onu içeren App'i açabilenlere bildir."""
        def allowed(uid: int) -> bool:
            with engine.connect() as c:
                rp = c.execute(select(db.reports).where(db.reports.c.id == rid)).first()
                if rp is None:
                    return False
                if report_access(c, uid, rp):
                    return True
                for a in c.execute(select(db.apps).join(db.app_items, db.app_items.c.app_id == db.apps.c.id)
                                   .where(db.app_items.c.report_id == rid)).all():
                    if app_role(c, uid, a):
                        return True
                return False
        hub.emit({"type": "report", "report_id": rid, "version": version, "dataset_id": dataset_id,
                  "dataset_version": dataset_version}, allowed)

    def notify_dataset(dataset_id: int, version: int) -> None:
        """Yenilenen veri hem rapor hem de dondurulmuş App tasarımında yeniden sorgulanır."""
        def allowed(uid: int) -> bool:
            with engine.connect() as c:
                reports = c.execute(select(db.reports).where(db.reports.c.dataset_id == dataset_id)).all()
                for rp in reports:
                    if report_access(c, uid, rp):
                        return True
                    for a in c.execute(select(db.apps).join(db.app_items, db.app_items.c.app_id == db.apps.c.id)
                                       .where(db.app_items.c.report_id == rp.id)).all():
                        if app_role(c, uid, a):
                            return True
                return False
        hub.emit({"type": "dataset", "dataset_id": dataset_id, "version": version}, allowed)

    def notify_app(aid: int, version: int) -> None:
        def allowed(uid: int) -> bool:
            with engine.connect() as c:
                a = c.execute(select(db.apps).where(db.apps.c.id == aid)).first()
                return a is not None and app_role(c, uid, a) is not None
        hub.emit({"type": "app", "app_id": aid, "version": version, "removed": False}, allowed)

    @app.post("/api/events/ticket")
    def events_ticket(user: dict = Depends(current_user)):
        return {"ticket": hub.ticket(user["id"])}

    @app.get("/api/events")
    async def events(request: Request, ticket: str = ""):
        uid = hub.redeem(ticket)
        if uid is None:
            raise ApiError(401, "unauthorized", "Bildirim bileti geçersiz ya da süresi dolmuş")
        sub = hub.subscribe(uid)

        async def stream():
            try:
                yield "retry: 5000\n\n"
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        ev = await asyncio.wait_for(sub.queue.get(), timeout=settings.events_keepalive)
                    except asyncio.TimeoutError:
                        yield ": canlı\n\n"          # vekil sunucular bağlantıyı kapatmasın
                        continue
                    yield f"event: {ev['type']}\ndata: {json.dumps(ev)}\n\n"
            finally:
                hub.unsubscribe(sub)

        return StreamingResponse(stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # -------------------------------------------------------------- App (uygulama)
    def app_summary(c, wid: int) -> dict | None:
        a = c.execute(select(db.apps).where(db.apps.c.workspace_id == wid)).first()
        if a is None:
            return None
        items = c.execute(select(db.app_items.c.report_version, db.reports.c.version)
                          .join(db.reports, db.reports.c.id == db.app_items.c.report_id)
                          .where(db.app_items.c.app_id == a.id)).all()
        return {
            "id": a.id, "name": a.name, "version": a.version, "published_at": iso(a.published_at),
            # Çalışma alanındaki rapor App'teki dondurulmuş sürümden yeni: "App'i güncelle" gerekir
            "outdated": any(frozen < current for frozen, current in items),
        }

    def app_role(c, user_id: int, a) -> str | None:
        """Çalışma alanı üyesi kendi rolüyle; App erişimi verilen kişi İzleyici olarak görür."""
        role = role_in(c, user_id, a.workspace_id)
        if role:
            return role
        ok = c.execute(select(db.app_access.c.user_id).where(and_(
            db.app_access.c.app_id == a.id, db.app_access.c.user_id == user_id))).first()
        return "viewer" if ok else None

    def load_app(c, aid: int, user: dict):
        a = c.execute(select(db.apps).where(db.apps.c.id == aid)).first()
        if a is None:
            raise NOT_FOUND("Uygulama")
        role = app_role(c, user["id"], a)
        if role is None:
            raise FORBIDDEN("Bu uygulamaya erişiminiz yok")
        return a, role

    def managed_app(c, aid: int, user: dict):
        a = c.execute(select(db.apps).where(db.apps.c.id == aid)).first()
        if a is None:
            raise NOT_FOUND("Uygulama")
        if role_in(c, user["id"], a.workspace_id) not in SHARE_ROLES:
            raise FORBIDDEN("Uygulamayı yalnızca çalışma alanı Yöneticisi ve Üyeleri yönetebilir")
        return a

    def app_info(c, a, role: str) -> dict:
        ws = c.execute(select(db.workspaces.c.name).where(db.workspaces.c.id == a.workspace_id)).scalar_one()
        items = c.execute(select(db.app_items).where(db.app_items.c.app_id == a.id)
                          .order_by(db.app_items.c.position)).all()
        return {
            "id": a.id, "name": a.name, "description": a.description, "color": a.color, "version": a.version,
            "published_at": iso(a.published_at), "published_by": user_name(c, a.published_by),
            "workspace": {"id": a.workspace_id, "name": ws}, "role": role, "role_label": ROLE_LABEL[role],
            "can_manage": role in SHARE_ROLES,
            "items": [{"id": i.id, "title": i.title, "section": i.section, "report_id": i.report_id} for i in items],
        }

    def app_admin_view(c, wid: int) -> dict:
        a = c.execute(select(db.apps).where(db.apps.c.workspace_id == wid)).first()
        reports = c.execute(select(db.reports.c.id, db.reports.c.name, db.reports.c.version)
                            .where(db.reports.c.workspace_id == wid).order_by(db.reports.c.name)).all()
        out: dict = {"app": None, "items": [], "access": [], "pending": [],
                     "reports": [{"id": r.id, "name": r.name, "version": r.version} for r in reports]}
        if a is None:
            return out
        out["app"] = {**app_info(c, a, "admin"), **(app_summary(c, wid) or {})}
        current = {r.id: r.version for r in reports}
        out["items"] = [{
            "report_id": i.report_id, "title": i.title, "section": i.section, "report_version": i.report_version,
            "current_version": current.get(i.report_id),
        } for i in c.execute(select(db.app_items).where(db.app_items.c.app_id == a.id)
                             .order_by(db.app_items.c.position)).all()]
        out["access"] = [{
            "id": r.id, "email": r.email, "name": r.name, "granted_by": user_name(c, r.granted_by),
            "granted_at": iso(r.created_at),
        } for r in c.execute(
            select(db.users.c.id, db.users.c.email, db.users.c.name, db.app_access.c.granted_by, db.app_access.c.created_at)
            .join(db.app_access, db.app_access.c.user_id == db.users.c.id)
            .where(db.app_access.c.app_id == a.id).order_by(db.users.c.name)).all()]
        out["pending"] = [{
            "id": g.id, "email": g.email, "granted_by": user_name(c, g.granted_by) if g.granted_by else "",
            "granted_at": iso(g.created_at),
        } for g in c.execute(select(db.pending_grants).where(db.pending_grants.c.app_id == a.id)
                             .order_by(db.pending_grants.c.email)).all()]
        return out

    def manage_workspace(c, wid: int, user: dict) -> None:
        if c.execute(select(db.workspaces.c.id).where(db.workspaces.c.id == wid)).first() is None:
            raise NOT_FOUND("Çalışma alanı")
        if role_in(c, user["id"], wid) not in SHARE_ROLES:
            raise FORBIDDEN("Uygulamayı yalnızca çalışma alanı Yöneticisi ve Üyeleri yönetebilir")

    @app.get("/api/workspaces/{wid}/app")
    def get_workspace_app(wid: int, user: dict = Depends(current_user)):
        with engine.connect() as c:
            manage_workspace(c, wid, user)
            return app_admin_view(c, wid)

    @app.put("/api/workspaces/{wid}/app")
    def publish_app(wid: int, body: AppIn, user: dict = Depends(current_user)):
        """Power BI "Uygulamayı yayımla / güncelle": seçili raporların o anki tanımı dondurulur."""
        name = " ".join(body.name.split())
        if not name:
            raise ApiError(400, "invalid", "Uygulama adı boş olamaz")
        with engine.begin() as c:
            manage_workspace(c, wid, user)
            ids = [it.report_id for it in body.items]
            if len(set(ids)) != len(ids):
                raise ApiError(400, "invalid", "Aynı rapor uygulamaya iki kez eklenemez")
            reports = {r.id: r for r in c.execute(select(db.reports).where(and_(
                db.reports.c.workspace_id == wid, db.reports.c.id.in_(ids)))).all()}
            missing = [i for i in ids if i not in reports]
            if missing:
                raise ApiError(400, "invalid", "Uygulamaya yalnızca bu çalışma alanının raporları eklenebilir")
            a = c.execute(select(db.apps).where(db.apps.c.workspace_id == wid)).first()
            values = dict(name=name, description=(body.description or "").strip() or None, color=body.color,
                          published_by=user["id"], published_at=db.now())
            if a is None:
                aid = c.execute(db.apps.insert().values(workspace_id=wid, version=1, **values)).inserted_primary_key[0]
            else:
                aid = a.id
                c.execute(db.apps.update().where(db.apps.c.id == aid).values(version=a.version + 1, **values))
                c.execute(db.app_items.delete().where(db.app_items.c.app_id == aid))
            for pos, it in enumerate(body.items):
                rp = reports[it.report_id]
                c.execute(db.app_items.insert().values(
                    app_id=aid, position=pos, section=(it.section or "").strip() or None,
                    title=(it.title or "").strip() or rp.name, report_id=rp.id, report_version=rp.version,
                    definition=rp.definition,
                ))
            view = app_admin_view(c, wid)
        notify_app(aid, view["app"]["version"])
        return view

    @app.delete("/api/workspaces/{wid}/app")
    def unpublish_app(wid: int, user: dict = Depends(current_user)):
        with engine.begin() as c:
            manage_workspace(c, wid, user)
            a = c.execute(select(db.apps).where(db.apps.c.workspace_id == wid)).first()
            audience: set[int] = set()
            if a is not None:
                audience = {r.user_id for r in c.execute(select(db.app_access.c.user_id)
                                                         .where(db.app_access.c.app_id == a.id)).all()}
                audience |= {r.user_id for r in c.execute(select(db.members.c.user_id)
                                                          .where(db.members.c.workspace_id == wid)).all()}
                emails = [g.email for g in c.execute(select(db.pending_grants.c.email)
                                                     .where(db.pending_grants.c.app_id == a.id)).all()]
                c.execute(db.pending_grants.delete().where(db.pending_grants.c.app_id == a.id))
                c.execute(db.app_access.delete().where(db.app_access.c.app_id == a.id))
                c.execute(db.app_items.delete().where(db.app_items.c.app_id == a.id))
                c.execute(db.apps.delete().where(db.apps.c.id == a.id))
                for e in emails:
                    drop_orphan_invitation(c, e)
            view = app_admin_view(c, wid)
        if a is not None:
            hub.emit({"type": "app", "app_id": a.id, "removed": True}, lambda uid: uid in audience)
        return view

    @app.post("/api/apps/{aid}/access")
    def grant_app_access(aid: int, body: AppAccessIn, user: dict = Depends(current_user)):
        results = []
        with engine.begin() as c:
            a = managed_app(c, aid, user)
            for raw in dict.fromkeys(e.strip().lower() for e in body.emails if e.strip()):
                item = {"email": raw, "status": "", "mail": "skipped", "message": ""}
                results.append(item)
                if not valid_email(raw):
                    item.update(status="invalid", message="Geçerli bir e-posta adresi değil")
                    continue
                target = c.execute(select(db.users.c.id, db.users.c.name).where(db.users.c.email == raw)).first()
                if target is None:
                    if not c.execute(select(db.pending_grants.c.id).where(and_(
                            db.pending_grants.c.email == raw, db.pending_grants.c.app_id == aid))).first():
                        c.execute(db.pending_grants.insert().values(email=raw, app_id=aid, granted_by=user["id"]))
                    item.update(status="invited", message="floembi.app hesabı yok; davet gönderilir, hesabını "
                                                         "açınca uygulamayı görür")
                    continue
                item["name"] = target.name
                if role_in(c, target.id, a.workspace_id):
                    item.update(status="member", message="Çalışma alanının üyesi; uygulamayı zaten görüyor")
                elif c.execute(select(db.app_access.c.user_id).where(and_(
                        db.app_access.c.app_id == aid, db.app_access.c.user_id == target.id))).first():
                    item.update(status="already", message="Bu kişinin zaten erişimi var")
                else:
                    c.execute(db.app_access.insert().values(app_id=aid, user_id=target.id, granted_by=user["id"]))
                    item.update(status="shared", message="Erişim verildi")
        url = f"{settings.public_url}/apps/{aid}"
        for item in results:
            if item["status"] == "invited":
                deliver_result(item, send_invite(item["email"], user, body.message))
            elif body.notify and item["status"] == "shared":
                mail = app_mail(to=item["email"], sender_name=user["name"], app_name=a.name,
                                description=a.description, url=url, message=body.message)
                deliver_result(item, deliver("app", mail, user))
        with engine.connect() as c:
            view = app_admin_view(c, a.workspace_id)
        return {"results": results, "mail_mode": mail_mode(), **view}

    @app.delete("/api/apps/{aid}/access/{uid}")
    def revoke_app_access(aid: int, uid: int, user: dict = Depends(current_user)):
        with engine.begin() as c:
            a = managed_app(c, aid, user)
            c.execute(db.app_access.delete().where(and_(db.app_access.c.app_id == aid, db.app_access.c.user_id == uid)))
            return app_admin_view(c, a.workspace_id)

    @app.delete("/api/apps/{aid}/pending/{gid}")
    def cancel_app_pending(aid: int, gid: int, user: dict = Depends(current_user)):
        with engine.begin() as c:
            a = managed_app(c, aid, user)
            g = c.execute(select(db.pending_grants).where(and_(
                db.pending_grants.c.id == gid, db.pending_grants.c.app_id == aid))).first()
            if g is not None:
                c.execute(db.pending_grants.delete().where(db.pending_grants.c.id == gid))
                drop_orphan_invitation(c, g.email)
            return app_admin_view(c, a.workspace_id)

    @app.get("/api/apps")
    def list_apps(user: dict = Depends(current_user)):
        """Power BI "Uygulamalar": erişim verilen ve üyesi olunan çalışma alanlarının uygulamaları."""
        with engine.connect() as c:
            rows = c.execute(select(db.apps).order_by(db.apps.c.name)).all()
            out = []
            for a in rows:
                role = app_role(c, user["id"], a)
                if role is None:
                    continue
                info = app_info(c, a, role)
                out.append({k: info[k] for k in ("id", "name", "description", "color", "version", "published_at",
                                                 "published_by", "workspace")} | {"items": len(info["items"])})
            return out

    @app.get("/api/apps/{aid}")
    def get_app(aid: int, user: dict = Depends(current_user)):
        with engine.connect() as c:
            a, role = load_app(c, aid, user)
            return app_info(c, a, role)

    def load_item(c, aid: int, iid: int, user: dict):
        a, role = load_app(c, aid, user)
        it = c.execute(select(db.app_items).where(and_(db.app_items.c.id == iid, db.app_items.c.app_id == aid))).first()
        if it is None:
            raise NOT_FOUND("Uygulamadaki rapor")
        rp = c.execute(select(db.reports.c.dataset_id).where(db.reports.c.id == it.report_id)).first()
        return a, role, it, rp.dataset_id

    @app.get("/api/apps/{aid}/items/{iid}")
    def get_app_item(aid: int, iid: int, user: dict = Depends(current_user)):
        with engine.connect() as c:
            a, role, it, dsid = load_item(c, aid, iid, user)
            ds = c.execute(select(db.datasets).where(db.datasets.c.id == dsid)).first()
            rls = rls_roles(c, user, ds, role, model_role_names(ds))
        return {
            "id": it.id, "title": it.title, "report_version": it.report_version, "rls_roles": rls,
            "dataset": {"id": ds.id, "name": ds.name, "version": ds.version},
            "definition": json.loads(it.definition),
        }

    @app.post("/api/apps/{aid}/items/{iid}/query")
    def app_item_query(aid: int, iid: int, q: VisualQuery, user: dict = Depends(current_user)):
        with engine.connect() as c:
            _, role, _, dsid = load_item(c, aid, iid, user)
        return dataset_query(user, dsid, role, q)

    # -------------------------------------------------------------- satır düzeyi güvenlik (RLS)
    def security_dataset(c, dsid: int, user: dict):
        ds = c.execute(select(db.datasets).where(db.datasets.c.id == dsid)).first()
        if ds is None:
            raise NOT_FOUND("Anlam modeli")
        if role_in(c, user["id"], ds.workspace_id) not in SHARE_ROLES:
            raise FORBIDDEN("Güvenlik ayarlarını yalnızca çalışma alanı Yöneticisi ve Üyeleri yönetebilir")
        return ds

    def security_view(c, ds) -> dict:
        tanim = ModelTanimi.model_validate(yaml.safe_load(ds.model_yaml))
        rows = c.execute(
            select(db.role_members.c.id, db.role_members.c.role, db.users.c.id.label("uid"), db.users.c.email,
                   db.users.c.name)
            .join(db.users, db.users.c.id == db.role_members.c.user_id)
            .where(db.role_members.c.dataset_id == ds.id).order_by(db.users.c.name)).all()
        member = lambda r: {"id": r.id, "user_id": r.uid, "email": r.email, "name": r.name}  # noqa: E731
        known = {r.ad.lower() for r in tanim.roller}
        ws = c.execute(select(db.workspaces.c.id, db.workspaces.c.name).where(db.workspaces.c.id == ds.workspace_id)).first()
        return {
            "dataset": {"id": ds.id, "name": ds.name, "version": ds.version},
            "workspace": {"id": ws.id, "name": ws.name},
            "roles": [{
                "name": rol.ad,
                "filters": [{"table": iz.tablo, "filtre": iz.filtre} for iz in rol.tablo_izinleri],
                "members": [member(r) for r in rows if r.role.lower() == rol.ad.lower()],
            } for rol in tanim.roller],
            # Yeniden yayımlamada modelden kalkan rollerin atamaları: etkisiz, temizlenebilir
            "orphans": [{**member(r), "role": r.role} for r in rows if r.role.lower() not in known],
        }

    @app.get("/api/datasets/{dsid}/security")
    def get_security(dsid: int, user: dict = Depends(current_user)):
        with engine.connect() as c:
            return security_view(c, security_dataset(c, dsid, user))

    @app.post("/api/datasets/{dsid}/security/members")
    def add_role_member(dsid: int, body: RoleMemberIn, user: dict = Depends(current_user)):
        email = body.email.strip().lower()
        with engine.begin() as c:
            ds = security_dataset(c, dsid, user)
            roles = {r.lower(): r for r in model_role_names(ds)}
            role = roles.get(body.role.strip().lower())
            if role is None:
                raise ApiError(400, "invalid", f"Modelde '{body.role}' adlı rol yok")
            target = c.execute(select(db.users.c.id).where(db.users.c.email == email)).first()
            if target is None:
                raise ApiError(
                    400, "unknown_user", f"{email} adresiyle kayıtlı kullanıcı yok",
                    "Önce raporu bu kişiyle paylaşın ya da sistem yöneticisi Yönetim → Kullanıcılar ekranından davet etsin; "
                    "hesabını oluşturunca role ekleyebilirsiniz.",
                )
            exists = c.execute(select(db.role_members.c.id).where(and_(
                db.role_members.c.dataset_id == ds.id, db.role_members.c.role == role,
                db.role_members.c.user_id == target.id))).first()
            if exists is None:
                c.execute(db.role_members.insert().values(dataset_id=ds.id, role=role, user_id=target.id, added_by=user["id"]))
            return security_view(c, ds)

    @app.delete("/api/datasets/{dsid}/security/members/{mid}")
    def remove_role_member(dsid: int, mid: int, user: dict = Depends(current_user)):
        with engine.begin() as c:
            ds = security_dataset(c, dsid, user)
            c.execute(db.role_members.delete().where(and_(
                db.role_members.c.id == mid, db.role_members.c.dataset_id == ds.id)))
            return security_view(c, ds)

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
