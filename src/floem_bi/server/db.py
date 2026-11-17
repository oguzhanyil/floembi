"""floembi.app metadata veritabanı (SQLAlchemy Core).

MVP'de SQLite dosyası; aynı tablolar Postgres'te değişmeden çalışır.
Veri (DuckDB anlık görüntüleri) burada değil, dosya sisteminde durur.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Column, DateTime, ForeignKey, Integer, MetaData, String, Table, Text, UniqueConstraint, create_engine, event,
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
    return engine
