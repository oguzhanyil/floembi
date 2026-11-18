"""floembi.app metadata veritabanı (SQLAlchemy Core).

MVP'de SQLite dosyası; aynı tablolar Postgres'te değişmeden çalışır.
Veri (DuckDB anlık görüntüleri) burada değil, dosya sisteminde durur.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, Integer, MetaData, String, Table, Text, UniqueConstraint, create_engine,
    event, inspect, text,
)
from sqlalchemy.engine import Engine

metadata = MetaData()


def now() -> datetime:
    return datetime.now(timezone.utc)


users = Table(
    "users", metadata,
    Column("id", Integer, primary_key=True),
    Column("email", String(254), nullable=False, unique=True),
    Column("name", String(120), nullable=False),
    Column("password_hash", String(255), nullable=False),
    # Sistem yöneticisi (Power BI'daki Fabric yöneticisi): e-posta sunucusu ve kullanıcı yetkilendirme
    Column("is_admin", Boolean, nullable=False, default=False),
    Column("created_at", DateTime(timezone=True), nullable=False, default=now),
)

workspaces = Table(
    "workspaces", metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String(120), nullable=False, unique=True),
    Column("created_at", DateTime(timezone=True), nullable=False, default=now),
)

# Power BI çalışma alanı rolleri: admin (Yönetici), member (Üye), contributor (Katkıda bulunan), viewer (İzleyici)
members = Table(
    "members", metadata,
    Column("workspace_id", Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role", String(16), nullable=False),
)

# Anlam modeli (Power BI "semantic model" / dataset): model + veri anlık görüntüsü
datasets = Table(
    "datasets", metadata,
    Column("id", Integer, primary_key=True),
    Column("workspace_id", Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
    Column("name", String(200), nullable=False),
    Column("version", Integer, nullable=False, default=1),
    Column("model_yaml", Text, nullable=False),
    Column("snapshot", String(500), nullable=False),          # data.duckdb yolu (sürüm klasörü)
    Column("size_bytes", Integer, nullable=False, default=0),
    Column("published_by", Integer, ForeignKey("users.id"), nullable=False),
    Column("published_at", DateTime(timezone=True), nullable=False, default=now),
    UniqueConstraint("workspace_id", "name"),
)

reports = Table(
    "reports", metadata,
    Column("id", Integer, primary_key=True),
    Column("workspace_id", Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
    Column("dataset_id", Integer, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False),
    Column("name", String(200), nullable=False),
    Column("version", Integer, nullable=False, default=1),
    Column("definition", Text, nullable=False),                # report.json
    Column("published_by", Integer, ForeignKey("users.id"), nullable=False),
    Column("published_at", DateTime(timezone=True), nullable=False, default=now),
    UniqueConstraint("workspace_id", "name"),
)

# Rapor paylaşımı (H6: e-postayla paylaş). Paylaşılan kullanıcı raporu İzleyici olarak görür.
shares = Table(
    "shares", metadata,
    Column("report_id", Integer, ForeignKey("reports.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("shared_by", Integer, ForeignKey("users.id"), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, default=now),
)

# App (Power BI "uygulama"): çalışma alanı başına bir tane. Yayımlanınca içerdiği raporların tanımı
# dondurulur (app_items.definition); veri anlam modelinden canlı gelir. İzleyici çalışma alanını görmez.
apps = Table(
    "apps", metadata,
    Column("id", Integer, primary_key=True),
    Column("workspace_id", Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, unique=True),
    Column("name", String(120), nullable=False),
    Column("description", Text),
    Column("color", String(16), nullable=False, default="#1f6feb"),
    Column("version", Integer, nullable=False, default=1),
    Column("published_by", Integer, ForeignKey("users.id"), nullable=False),
    Column("published_at", DateTime(timezone=True), nullable=False, default=now),
)

app_items = Table(
    "app_items", metadata,
    Column("id", Integer, primary_key=True),
    Column("app_id", Integer, ForeignKey("apps.id", ondelete="CASCADE"), nullable=False),
    Column("position", Integer, nullable=False),
    Column("section", String(120)),                               # menüde başlık (ör. "Satış")
    Column("title", String(200), nullable=False),
    Column("report_id", Integer, ForeignKey("reports.id", ondelete="CASCADE"), nullable=False),
    Column("report_version", Integer, nullable=False),             # dondurulan rapor sürümü
    Column("definition", Text, nullable=False),                    # o sürümün report.json'u
)

app_access = Table(
    "app_access", metadata,
    Column("app_id", Integer, ForeignKey("apps.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("granted_by", Integer, ForeignKey("users.id"), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, default=now),
)

# Satır düzeyi güvenlik üyelikleri (Power BI: anlam modeli → Güvenlik). Roller ve filtreleri modelde
# (Desktop'ta tanımlanır); burada yalnızca hangi kullanıcının hangi role atandığı durur. Rol adına
# bağlıdır: yeniden yayımlamada rol modelde kalırsa atama korunur.
role_members = Table(
    "role_members", metadata,
    Column("id", Integer, primary_key=True),
    Column("dataset_id", Integer, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False),
    Column("role", String(128), nullable=False),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("added_by", Integer, ForeignKey("users.id"), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, default=now),
    UniqueConstraint("dataset_id", "role", "user_id"),
)

# H7: dışa açılan Gateway, tek kullanımlık kayıt, şifreli kaynak bilgisi ve yenileme geçmişi.
gateways = Table(
    "gateways", metadata,
    Column("id", Integer, primary_key=True),
    Column("workspace_id", Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
    Column("name", String(120), nullable=False),
    Column("public_key", Text),
    Column("last_seen", DateTime(timezone=True)),
    Column("created_by", Integer, ForeignKey("users.id"), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, default=now),
)
gateway_tokens = Table(
    "gateway_tokens", metadata,
    Column("id", Integer, primary_key=True),
    Column("gateway_id", Integer, ForeignKey("gateways.id", ondelete="CASCADE"), nullable=False),
    Column("token_hash", String(64), nullable=False, unique=True),
    Column("expires_at", DateTime(timezone=True), nullable=False),
)
gateway_sources = Table(
    "gateway_sources", metadata,
    Column("id", Integer, primary_key=True),
    Column("workspace_id", Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
    Column("gateway_id", Integer, ForeignKey("gateways.id", ondelete="CASCADE"), nullable=False),
    Column("server", String(255), nullable=False),
    Column("database", String(255), nullable=False),
    Column("username", String(254), nullable=False),
    Column("password_enc", Text, nullable=False),
    Column("created_by", Integer, ForeignKey("users.id"), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, default=now),
    UniqueConstraint("workspace_id", "server", "database", "username"),
)
dataset_source_bindings = Table(
    "dataset_source_bindings", metadata,
    Column("dataset_id", Integer, ForeignKey("datasets.id", ondelete="CASCADE"), primary_key=True),
    Column("source_key", String(120), primary_key=True),
    Column("gateway_source_id", Integer, ForeignKey("gateway_sources.id", ondelete="CASCADE"), nullable=False),
)
refresh_runs = Table(
    "refresh_runs", metadata,
    Column("id", Integer, primary_key=True),
    Column("dataset_id", Integer, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False),
    Column("gateway_id", Integer, ForeignKey("gateways.id", ondelete="SET NULL")),
    Column("status", String(16), nullable=False),
    Column("stage", String(120)),
    Column("table_name", String(255)),
    Column("error", Text),
    Column("started_at", DateTime(timezone=True), nullable=False, default=now),
    Column("finished_at", DateTime(timezone=True)),
    Column("requested_by", Integer, ForeignKey("users.id"), nullable=False),
)


# Gönderilen e-postalar: durum ve hata ekranda okunabilsin (giden kutusu modunda .eml yolu)
mail_log = Table(
    "mail_log", metadata,
    Column("id", Integer, primary_key=True),
    Column("kind", String(32), nullable=False),                  # share | invite | access | test
    Column("to_email", String(254), nullable=False),
    Column("subject", String(300), nullable=False),
    Column("status", String(16), nullable=False),                # sent | outbox | failed
    Column("error", Text),
    Column("eml_path", String(500)),
    Column("report_id", Integer, ForeignKey("reports.id", ondelete="SET NULL")),
    Column("created_by", Integer, ForeignKey("users.id"), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, default=now),
)


# E-posta sunucusu ayarı (Yönetim ekranı; tek satır, id=1). Şifre şifreli saklanır, ekrana dönmez.
mail_config = Table(
    "mail_config", metadata,
    Column("id", Integer, primary_key=True),
    Column("enabled", Boolean, nullable=False, default=False),   # False: giden kutusu (geliştirme)
    Column("host", String(255), nullable=False, default=""),
    Column("port", Integer, nullable=False, default=587),
    Column("security", String(16), nullable=False, default="starttls"),
    Column("username", String(254)),
    Column("password_enc", Text),
    Column("from_address", String(254), nullable=False, default=""),
    Column("from_name", String(120), nullable=False, default="floembi.app"),
    Column("updated_by", Integer, ForeignKey("users.id", ondelete="SET NULL")),
    Column("updated_at", DateTime(timezone=True)),
)

# Davet: floembi.app'te hesabı olmayan adres yetkilendirilince. Token yalnızca e-postada; burada özeti durur.
invitations = Table(
    "invitations", metadata,
    Column("id", Integer, primary_key=True),
    Column("email", String(254), nullable=False, unique=True),
    Column("name", String(120)),
    Column("token_hash", String(64), nullable=False, unique=True),
    Column("invited_by", Integer, ForeignKey("users.id", ondelete="SET NULL")),
    Column("created_at", DateTime(timezone=True), nullable=False, default=now),
    Column("expires_at", DateTime(timezone=True), nullable=False),
)

# Henüz hesabı olmayan adrese verilen yetkiler; hesap açılınca üyeliğe/paylaşıma dönüşür
pending_grants = Table(
    "pending_grants", metadata,
    Column("id", Integer, primary_key=True),
    Column("email", String(254), nullable=False, index=True),
    Column("workspace_id", Integer, ForeignKey("workspaces.id", ondelete="CASCADE")),
    Column("role", String(16)),                                   # çalışma alanı rolü
    Column("report_id", Integer, ForeignKey("reports.id", ondelete="CASCADE")),  # ya da tek rapor paylaşımı
    Column("app_id", Integer, ForeignKey("apps.id", ondelete="CASCADE")),        # ya da App erişimi
    Column("granted_by", Integer, ForeignKey("users.id", ondelete="SET NULL")),
    Column("created_at", DateTime(timezone=True), nullable=False, default=now),
)


def _migrate(engine: Engine) -> None:
    """Eski metadata veritabanlarına yeni sütunları ekler (create_all var olan tabloyu değiştirmez)."""
    cols = {c["name"] for c in inspect(engine).get_columns("users")}
    if "is_admin" not in cols:
        with engine.begin() as c:
            c.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT 0"))
            # Mevcut kurulum: herhangi bir çalışma alanının Yöneticisi olanlar sistem yöneticisi olur
            c.execute(text("UPDATE users SET is_admin = 1 WHERE id IN (SELECT user_id FROM members WHERE role = 'admin')"))
    if "app_id" not in {c["name"] for c in inspect(engine).get_columns("pending_grants")}:
        with engine.begin() as c:
            c.execute(text("ALTER TABLE pending_grants ADD COLUMN app_id INTEGER REFERENCES apps(id) ON DELETE CASCADE"))


def make_engine(url: str) -> Engine:
    engine = create_engine(url, future=True)
    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def _fk(dbapi_con, _):  # SQLite'ta yabancı anahtarlar varsayılan kapalı
            cur = dbapi_con.cursor()
            cur.execute("PRAGMA foreign_keys = ON")
            cur.execute("PRAGMA journal_mode = WAL")
            cur.close()
    metadata.create_all(engine)
    _migrate(engine)
    return engine
