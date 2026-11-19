"""Gerçek adres pilotunu hazırlama ve Cloudflare tünelini çalıştırma.

    python -m floem_bi.server.pilot init
    python -m floem_bi.server.pilot tunnel-token
    python -m floem_bi.server.pilot tunnel
"""

from __future__ import annotations

import argparse
import getpass
import os
import secrets
import shutil
import subprocess
from pathlib import Path

import keyring
from sqlalchemy import select

from . import db, pilot_config
from .auth import hash_password


def bootstrap(directory: Path, email: str, name: str, password: str) -> None:
    """Boş pilot veritabanına tek gerçek yönetici ve çalışma alanı ekler."""
    email = email.strip().lower()
    name = name.strip()
    local, _, domain = email.partition("@")
    if not local or "." not in domain or any(ch.isspace() for ch in email) or len(email) > 254:
        raise ValueError("Geçerli bir yönetici e-posta adresi girin.")
    if not name or len(name) > 120:
        raise ValueError("Yönetici adı 1-120 karakter olmalı.")
    if len(password) < 8 or len(password) > 200:
        raise ValueError("Yönetici şifresi 8-200 karakter olmalı.")
    directory = directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    engine = db.make_engine(f"sqlite:///{(directory / 'floem.db').as_posix()}")
    try:
        with engine.begin() as c:
            if c.execute(select(db.users.c.id).limit(1)).first():
                raise ValueError("Pilot veritabanında kullanıcı var; başlangıç hesabı tekrar oluşturulmadı.")
            if not pilot_config.server_secret(directory):
                pilot_config.save_server_secret(directory, secrets.token_urlsafe(48))
            uid = c.execute(db.users.insert().values(
                email=email, name=name, password_hash=hash_password(password), is_admin=True,
            )).inserted_primary_key[0]
            wid = c.execute(db.workspaces.insert().values(name="Pilot Raporlar")).inserted_primary_key[0]
            c.execute(db.members.insert().values(workspace_id=wid, user_id=uid, role="admin"))
    finally:
        engine.dispose()


def run_tunnel() -> int:
    token = pilot_config.tunnel_token()
    if not token:
        raise RuntimeError("Tünel belirteci yok. Önce 'python -m floem_bi.server.pilot tunnel-token' çalıştırın.")
    cloudflared = shutil.which("cloudflared")
    if not cloudflared:
        raise RuntimeError("cloudflared bulunamadı; kurulu cloudflared.exe yolunu PATH'e ekleyin.")
    env = os.environ.copy()
    env["TUNNEL_TOKEN"] = token
    return subprocess.call([cloudflared, "tunnel", "run"], env=env)


def change_admin_password(directory: Path, password: str) -> None:
    """Yerel yönetici şifresini gizli istemden değiştirir."""
    if len(password) < 8 or len(password) > 200:
        raise ValueError("Yönetici şifresi 8-200 karakter olmalı.")
    if not pilot_config.server_secret(directory):
        raise ValueError("Pilot sunucu anahtarı yok; şifre değiştirilmedi.")
    engine = db.make_engine(f"sqlite:///{(directory.resolve() / 'floem.db').as_posix()}")
    try:
        with engine.begin() as c:
            admins = c.execute(select(db.users.c.id).where(db.users.c.is_admin.is_(True))).all()
            if len(admins) != 1:
                raise ValueError("Pilot veritabanında tek yönetici bulunamadı; şifre değiştirilmedi.")
            c.execute(db.users.update().where(db.users.c.id == admins[0].id)
                      .values(password_hash=hash_password(password)))
        if keyring.get_password(pilot_config.KEYRING_SERVICE, pilot_config.TEMP_ADMIN_PASSWORD_NAME):
            keyring.delete_password(pilot_config.KEYRING_SERVICE, pilot_config.TEMP_ADMIN_PASSWORD_NAME)
    finally:
        engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(prog="floem-pilot")
    parser.add_argument("command", choices=("init", "admin-password", "cloudflare-setup", "tunnel-token", "tunnel"))
    args = parser.parse_args()
    try:
        if args.command == "init":
            directory = pilot_config.data_dir()
            email = input("Yönetici e-postası: ")
            name = input("Yönetici adı: ")
            password = getpass.getpass("Yönetici şifresi (en az 8 karakter): ")
            if password != getpass.getpass("Şifre tekrar: "):
                raise ValueError("Şifreler eşleşmiyor.")
            bootstrap(directory, email, name, password)
            print(f"Pilot alanı hazır: {directory}")
        elif args.command == "admin-password":
            password = getpass.getpass("Yeni yönetici şifresi (en az 8 karakter): ")
            if password != getpass.getpass("Şifre tekrar: "):
                raise ValueError("Şifreler eşleşmiyor.")
            change_admin_password(pilot_config.data_dir(), password)
            print("Pilot yöneticisinin şifresi değiştirildi.")
        elif args.command == "tunnel-token":
            token = getpass.getpass("Yeni floembi-pilot tünelinin belirteci: ").strip()
            if len(token) < 30 or any(ch.isspace() for ch in token):
                raise ValueError("Geçerli bir Cloudflare tünel belirteci girin.")
            pilot_config.save_tunnel_token(token)
            print("Tünel belirteci Windows Kimlik Bilgisi Yöneticisi'ne kaydedildi.")
        elif args.command == "cloudflare-setup":
            from .cloudflare_pilot import provision
            tunnel_id = provision()
            print(f"Cloudflare tüneli hazır: floembi-pilot ({tunnel_id}); adres: {pilot_config.PILOT_URL}")
        else:
            raise SystemExit(run_tunnel())
    except (ValueError, RuntimeError, keyring.errors.KeyringError) as exc:
        parser.exit(1, f"Hata: {exc}\n")


if __name__ == "__main__":
    main()
