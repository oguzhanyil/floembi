"""Tek alıcılı gerçek adres pilotunun yerel ayarları ve gizli bilgileri."""

from __future__ import annotations

import os
from pathlib import Path

import keyring


PILOT_URL = "https://bi.floemdata.com"
KEYRING_SERVICE = "FloemBI.Pilot"
TEMP_ADMIN_PASSWORD_NAME = "admin-bootstrap:bi.floemdata.com"


def data_dir() -> Path:
    override = os.environ.get("FLOEM_SERVER_DATA")
    if override:
        return Path(override).resolve()
    local = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".local" / "share")
    return (local / "FloemBI" / "pilot-server").resolve()


def secret_name(directory: Path) -> str:
    return f"server:{directory.resolve()}"


def server_secret(directory: Path) -> str | None:
    return keyring.get_password(KEYRING_SERVICE, secret_name(directory))


def save_server_secret(directory: Path, secret: str) -> None:
    keyring.set_password(KEYRING_SERVICE, secret_name(directory), secret)


def tunnel_token() -> str | None:
    return keyring.get_password(KEYRING_SERVICE, "tunnel:bi.floemdata.com")


def save_tunnel_token(token: str) -> None:
    keyring.set_password(KEYRING_SERVICE, "tunnel:bi.floemdata.com", token)
