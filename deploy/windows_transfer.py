"""Windows pilotunun yayın verisini başka bir Windows kullanıcısına taşır."""

import base64
import getpass
import json
import os
import secrets
import shutil
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path, PureWindowsPath

from nacl import pwhash, secret, utils
from sqlalchemy.engine import URL

from floem_bi.server import pilot_config
from floem_bi.server import db as metadata
from floem_bi.server.mail import SecretBox as MailSecretBox


# Alıcı, arşivden tablo adı veya SQL almaz. Rapor, paylaşım ve model verisi kapsam dışıdır.
ACCOUNT_TABLES = (metadata.users, metadata.workspaces, metadata.members, metadata.mail_config)


def transfer_box(password: str, salt: bytes) -> secret.SecretBox:
    key = pwhash.argon2id.kdf(secret.SecretBox.KEY_SIZE, password.encode(), salt,
                              opslimit=pwhash.argon2id.OPSLIMIT_MODERATE,
                              memlimit=pwhash.argon2id.MEMLIMIT_MODERATE)
    return secret.SecretBox(key)


def export_settings(path: Path, password: str) -> None:
    if not password:
        raise ValueError("Aktarım kodu boş.")
    source = pilot_config.data_dir()
    new_secret = secrets.token_urlsafe(48)
    tables = {}
    with closing(sqlite3.connect((source / "floem.db").as_uri() + "?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("BEGIN")
        for table in ACCOUNT_TABLES:
            fields = ", ".join(table.columns.keys())
            tables[table.name] = [dict(row) for row in conn.execute(f"SELECT {fields} FROM {table.name}")]
    for row in tables["mail_config"]:
        if row["password_enc"]:
            source_key = pilot_config.server_secret(source)
            if not source_key:
                raise ValueError("SMTP ayarını açmak için kaynak sunucu anahtarı gerekli.")
            row["password_enc"] = MailSecretBox(new_secret).seal(MailSecretBox(source_key).open(row["password_enc"]))
    payload = json.dumps({"secret": new_secret, "tables": tables}).encode()
    salt = utils.random(pwhash.argon2id.SALTBYTES)
    sealed = transfer_box(password, salt).encrypt(payload)
    with path.open("xb") as target:
        target.write(b"FLOEM-SETTINGS-1\0" + salt + sealed)


def import_settings(path: Path, password: str) -> dict[str, int]:
    from nacl.exceptions import CryptoError

    destination = pilot_config.data_dir()
    if destination.exists():
        raise ValueError("Hedef veri klasörü zaten var. Mevcut kuruluma yazılmadı.")
    header = b"FLOEM-SETTINGS-1\0"
    with path.open("rb") as archive:
        if archive.read(len(header)) != header:
            raise ValueError("Geçerli bir Floem BI ayar paketi seçin.")
        salt = archive.read(pwhash.argon2id.SALTBYTES)
        try:
            payload = json.loads(transfer_box(password, salt).decrypt(archive.read()))
        except CryptoError as error:
            raise ValueError("Aktarım kodu veya dosyanın bütünlüğü doğrulanamadı.") from error
    new_secret = payload["secret"]
    existing = pilot_config.server_secret(destination)
    if existing and existing != new_secret:
        raise ValueError("Hedef klasöre farklı bir yayın anahtarı kayıtlı.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as work:
        stage = Path(work) / "ready"
        stage.mkdir()
        database = stage / "floem.db"
        metadata.make_engine(URL.create("sqlite", database=str(database))).dispose()
        counts = {}
        with closing(sqlite3.connect(database)) as conn, conn:
            conn.execute("PRAGMA foreign_keys=ON")
            for table in ACCOUNT_TABLES:
                fields = list(table.columns.keys())
                rows = payload["tables"][table.name]
                placeholders = ",".join("?" for _ in fields)
                conn.executemany(f"INSERT INTO {table.name} ({','.join(fields)}) VALUES ({placeholders})",
                                 ([row[field] for field in fields] for row in rows))
                counts[table.name] = len(rows)
            admin = conn.execute("SELECT 1 FROM users JOIN members ON users.id=members.user_id "
                                 "WHERE users.is_admin=1 AND members.role='admin' LIMIT 1").fetchone()
            if not admin:
                raise ValueError("Kaynakta çalışma alanını yönetebilen bir yönetici bulunamadı.")
        os.rename(stage, destination)
        if not existing:
            try:
                pilot_config.save_server_secret(destination, new_secret)
            except Exception:
                os.rename(destination, stage)
                raise
    return counts


def export_key(path: Path) -> None:
    value = pilot_config.server_secret(pilot_config.data_dir())
    if not value:
        raise ValueError("Bu kullanıcı ve veri klasörü için yayın anahtarı bulunamadı.")
    password = getpass.getpass("Aktarım dosyasına bir parola belirleyin: ")
    if not password or password != getpass.getpass("Parolayı tekrarlayın: "):
        raise ValueError("Parolalar boş veya eşleşmiyor.")
    salt = utils.random(pwhash.argon2id.SALTBYTES)
    encrypted = transfer_box(password, salt).encrypt(value.encode())
    with path.open("x", encoding="ascii") as target:
        json.dump({"version": 1, "salt": base64.b64encode(salt).decode(),
                   "key": base64.b64encode(encrypted).decode()}, target)


def read_key(path: Path) -> str:
    from nacl.exceptions import CryptoError

    data = json.loads(path.read_bytes())
    if data["version"] != 1:
        raise ValueError("Aktarım dosyasının sürümü desteklenmiyor.")
    box = transfer_box(getpass.getpass("Aktarım dosyasının parolası: "),
                       base64.b64decode(data["salt"], validate=True))
    try:
        return box.decrypt(base64.b64decode(data["key"], validate=True)).decode()
    except CryptoError as error:
        raise ValueError("Aktarım parolası veya dosyanın bütünlüğü doğrulanamadı.") from error


def stage_data(source: Path, stage: Path, destination: Path) -> dict[str, int]:
    """Soğuk kopyadan okunur. Yeni kalıcı yollar yalnızca hedef SQLite kopyasında değişir."""
    for name in ("datasets", "outbox"):
        if (source / name).is_dir():
            shutil.copytree(source / name, stage / name)
    uri = (source / "floem.db").resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as original, closing(sqlite3.connect(stage / "floem.db")) as db:
        original.backup(db)
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)] or db.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("Kopyadaki metadata bütünlük denetiminden geçemedi.")
        with db:
            for dataset, version, old in db.execute("SELECT id, version, snapshot FROM datasets").fetchall():
                relative = Path("datasets", str(dataset), f"v{version}", "data.duckdb")
                old_path = PureWindowsPath(old)
                if (not old_path.is_absolute() or PureWindowsPath(*old_path.parts[-4:]) != PureWindowsPath(relative)
                        or not (stage / relative).is_file()):
                    raise ValueError(f"Model dosyası veya yolu geçersiz (model {dataset}, sürüm {version}).")
                db.execute("UPDATE datasets SET snapshot=? WHERE id=?", (str(destination / relative), dataset))
            for mail, old in db.execute("SELECT id, eml_path FROM mail_log WHERE eml_path IS NOT NULL").fetchall():
                relative = Path("outbox", PureWindowsPath(old).name)
                if not (stage / relative).is_file():
                    raise ValueError(f"Giden kutusu dosyası eksik (kayıt {mail}).")
                db.execute("UPDATE mail_log SET eml_path=? WHERE id=?", (str(destination / relative), mail))
        return {name: db.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
                for name in ("users", "workspaces", "reports", "datasets", "shares")}


def restore(source: Path, key_file: Path) -> None:
    source = source.resolve()
    destination = pilot_config.data_dir()
    if destination.exists() or destination.is_relative_to(source) or source.is_relative_to(destination):
        raise ValueError("Hedef veri klasörü yeni olmalı ve kaynak klasörden ayrı olmalı.")
    value = read_key(key_file)
    prior = pilot_config.server_secret(destination)
    if prior and prior != value:
        raise ValueError("Hedef klasöre farklı bir sunucu anahtarı kayıtlı.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as work:
        stage = Path(work) / "ready"
        stage.mkdir()
        counts = stage_data(source, stage, destination)
        pilot_config.save_server_secret(destination, value)
        # Windows'ta rename mevcut hedefin üzerine yazmaz.
        os.rename(stage, destination)
    print("Aktarım tamamlandı:", ", ".join(f"{k}={v}" for k, v in counts.items()))
