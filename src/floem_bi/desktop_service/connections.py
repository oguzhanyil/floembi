"""Kayıtlı bağlantılar (Power BI'daki "Veri kaynağı ayarları").

Bağlantının şifresiz bilgisi %APPDATA%/FloemBI/connections.json dosyasında,
şifresi Windows Kimlik Bilgisi Yöneticisi'nde (keyring) tutulur.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from dataclasses import asdict
from pathlib import Path

from ..connectors import ConnectionSpec, ConnectorError

KEYRING_SERVICE = "FloemBI"


def default_store_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home())
    return Path(base) / "FloemBI"


class ConnectionStore:
    def __init__(self, directory: Path | None = None, use_keyring: bool = True):
        self.dir = directory or default_store_dir()
        self.file = self.dir / "connections.json"
        self.use_keyring = use_keyring
        self._lock = threading.Lock()
        self._specs: dict[str, ConnectionSpec] = {}
        self._load()

    def _load(self) -> None:
        if not self.file.exists():
            return
        data = json.loads(self.file.read_text(encoding="utf-8"))
        for cid, d in data.items():
            self._specs[cid] = ConnectionSpec(**d)

    def _persist(self) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        data = {cid: s.public() for cid, s in self._specs.items()}
        self.file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _secret(self, cid: str) -> str | None:
        if not self.use_keyring:
            return None
        import keyring
        return keyring.get_password(KEYRING_SERVICE, cid)

    def add(self, spec: ConnectionSpec, remember_password: bool) -> str:
        with self._lock:
            for cid, s in self._specs.items():
                if s.public() == spec.public():
                    break
            else:
                cid = uuid.uuid4().hex[:12]
            self._specs[cid] = spec
            self._persist()
        if self.use_keyring and spec.password:
            import keyring
            if remember_password:
                keyring.set_password(KEYRING_SERVICE, cid, spec.password)
        return cid

    def get(self, cid: str) -> ConnectionSpec:
        spec = self._specs.get(cid)
        if spec is None:
            raise ConnectorError("Bağlantı bulunamadı", code="not_found")
        if spec.auth in ("sql", "bearer") and not spec.password:
            spec.password = self._secret(cid)
            if not spec.password:
                raise ConnectorError("Bu bağlantının şifresi kayıtlı değil; tekrar giriş yapın", code="credentials_required")
        return spec

    def find(self, server: str, database: str | None, auth: str, user: str | None) -> str | None:
        """Başka makinede kaydedilmiş bir .floem açıldığında aynı sunucuya ait kayıtlı bağlantıyı bulur."""
        norm = lambda v: (v or "").strip().lower()
        for cid, s in self._specs.items():
            if (norm(s.server), s.auth, norm(s.user)) == (norm(server), auth, norm(user)) and (
                norm(s.database) in ("", norm(database))
            ):
                return cid
        return None

    def list(self) -> list[dict]:
        return [{"id": cid, **s.public()} for cid, s in self._specs.items()]

    def remove(self, cid: str) -> None:
        with self._lock:
            self._specs.pop(cid, None)
            self._persist()
        if self.use_keyring:
            import keyring
            try:
                keyring.delete_password(KEYRING_SERVICE, cid)
            except Exception:  # kayıtlı şifre yoksa
                pass


__all__ = ["ConnectionStore", "asdict"]
