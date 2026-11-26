"""Windows pilotunun yayın verisini başka bir Windows kullanıcısına taşır."""

import base64
import getpass
import json
import os
import shutil
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path, PureWindowsPath

from nacl import pwhash, secret, utils

from floem_bi.server import pilot_config


def transfer_box(password: str, salt: bytes) -> secret.SecretBox:
    key = pwhash.argon2id.kdf(secret.SecretBox.KEY_SIZE, password.encode(), salt,
                              opslimit=pwhash.argon2id.OPSLIMIT_MODERATE,
                              memlimit=pwhash.argon2id.MEMLIMIT_MODERATE)
    return secret.SecretBox(key)


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
