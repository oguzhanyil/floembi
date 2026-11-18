"""Desktop → floembi.app yayımlama (Power BI Desktop'taki "Yayımla").

Yalnızca standart kütüphane kullanılır (urllib); httpx'in certifi bağımlılığı MPL-2.0
olduğu için Desktop'a alınmadı. Oturum belirteci yalnızca bellekte tutulur; diske
sunucu adresi ve e-posta yazılır.
"""

from __future__ import annotations

import base64
import json
import os
import threading
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlparse

from nacl.public import PublicKey, SealedBox

from ..document import DocumentError

TIMEOUT = 30
UPLOAD_TIMEOUT = 600


class PublishClient:
    def __init__(self, settings_dir: Path):
        self.file = settings_dir / "publish.json"
        self._lock = threading.Lock()
        self.server_url = "http://127.0.0.1:8800"
        self.email = ""
        self.token: str | None = None
        self.user: dict | None = None
        try:
            data = json.loads(self.file.read_text(encoding="utf-8"))
            self.server_url = data.get("server_url") or self.server_url
            self.email = data.get("email") or ""
        except (OSError, ValueError):
            pass

    def _persist(self) -> None:
        try:
            self.file.parent.mkdir(parents=True, exist_ok=True)
            self.file.write_text(json.dumps({"server_url": self.server_url, "email": self.email}, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass

    def state(self) -> dict:
        return {"server_url": self.server_url, "email": self.email, "logged_in": self.token is not None, "user": self.user}

    # ------------------------------------------------------------------ HTTP
    def _call(self, method: str, path: str, body: Any = None, data=None, headers=None, timeout=TIMEOUT) -> Any:
        url = self.server_url + path
        hdrs = {"Accept": "application/json", **(headers or {})}
        if self.token:
            hdrs["Authorization"] = f"Bearer {self.token}"
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                raw = res.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read()).get("error") or {}
            except (ValueError, AttributeError):
                err = {}
            if e.code == 401 and path != "/api/auth/login":
                self.token, self.user = None, None
                raise DocumentError("floembi.app oturumunuz sona erdi; yeniden giriş yapın", code="publish_unauthorized") from e
            raise DocumentError(
                err.get("message") or f"floembi.app isteği başarısız (HTTP {e.code})",
                err.get("detail", ""),
                code=err.get("code") or f"http_{e.code}",
            ) from e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            reason = getattr(e, "reason", e)
            raise DocumentError(
                f"floembi.app sunucusuna ulaşılamadı ({self.server_url})",
                f"{reason}. Sunucunun çalıştığından emin olun: npm run server",
                code="publish_unreachable",
            ) from e

    # ------------------------------------------------------------------ oturum
    def login(self, server_url: str, email: str, password: str) -> dict:
        u = urlparse(server_url.strip())
        if u.scheme not in ("http", "https") or not u.netloc:
            raise DocumentError("Sunucu adresi http:// ya da https:// ile başlamalı", code="publish_invalid")
        if u.scheme == "http" and u.hostname not in ("localhost", "127.0.0.1"):
            raise DocumentError("Uzak sunucu için HTTPS gerekir", code="publish_invalid")
        with self._lock:
            self.server_url = f"{u.scheme}://{u.netloc}{u.path.rstrip('/')}"
            self.token = None
            res = self._call("POST", "/api/auth/login", {"email": email.strip(), "password": password})
            self.token, self.user, self.email = res["token"], res["user"], email.strip()
            self._persist()
        return {**self.state(), "workspaces": self.workspaces()}

    def logout(self) -> None:
        self.token, self.user = None, None

    def workspaces(self) -> list[dict]:
        self._require()
        return self._call("GET", "/api/me")["workspaces"]

    def gateways(self, workspace_id: int) -> list[dict]:
        self._require()
        return self._call("GET", f"/api/workspaces/{int(workspace_id)}/gateways")

    def _require(self) -> None:
        if not self.token:
            raise DocumentError("Yayımlamak için floembi.app'te oturum açın", code="publish_unauthorized")

    # ------------------------------------------------------------------ yükleme
    def publish(self, workspace_id: int, file_path: str, gateway_id: int | None = None,
                sources: list[dict] | None = None) -> dict:
        self._require()
        sources = sources or []
        try:
            registered = [g for g in self.gateways(workspace_id) if g["registered"] and g.get("public_key")]
        except DocumentError as e:
            if e.code != "forbidden":
                raise
            # Yayımlama uç noktası kendi yetki mesajını döndürür.
            registered = []
        selected = next((g for g in registered if g["id"] == gateway_id), None) if gateway_id else (
            registered[0] if len(registered) == 1 else None)
        encrypted = []
        missing = []
        if selected:
            try:
                box = SealedBox(PublicKey(base64.b64decode(selected["public_key"], validate=True)))
            except (ValueError, TypeError) as e:
                raise DocumentError("Floemway açık anahtarı geçersiz", code="gateway_invalid_key") from e
            for source in sources:
                if source["auth"] != "sql" or not source["password"] or not source["database"] or not source["username"]:
                    missing.append(source["source_key"])
                    continue
                encrypted.append({k: source[k] for k in ("source_key", "server", "database", "username")} |
                                 {"password_enc": box.encrypt(source["password"].encode("utf-8")).hex()})
        path = Path(file_path)
        boundary = "floem" + uuid.uuid4().hex
        head = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{path.name.encode("ascii", "replace").decode()}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode("utf-8")
        tail = f"\r\n--{boundary}--\r\n".encode("ascii")
        size = len(head) + os.path.getsize(path) + len(tail)

        def body() -> Iterator[bytes]:
            yield head
            with open(path, "rb") as f:
                while chunk := f.read(1024 * 1024):
                    yield chunk
            yield tail

        res = self._call(
            "POST", f"/api/workspaces/{int(workspace_id)}/publish", data=body(),
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Content-Length": str(size)},
            timeout=UPLOAD_TIMEOUT,
        )
        # Bağlantı, Desktop'un konuştuğu sunucu adresiyle kurulur (sunucunun kendi adres ayarından bağımsız)
        res["url"] = f"{self.server_url}/reports/{res['report_id']}"
        total = len(sources)
        synced = 0
        warning = ""
        if total and not selected:
            warning = ("Floemway henüz kayıtlı değil; rapor yayımlandı, bağlantılar bekliyor." if not registered else
                       "Birden fazla Floemway var; rapor yayımlandı, bağlantılar için birini seçin.")
        elif selected and encrypted:
            try:
                self._call("POST", f"/api/datasets/{res['dataset_id']}/gateway-sync",
                           {"gateway_id": selected["id"], "sources": encrypted})
                synced = len(encrypted)
            except DocumentError as e:
                warning = f"Rapor yayımlandı; Floemway bağlantıları eşlenemedi: {e.message}"
        if missing:
            warning = (warning + " " if warning else "") + (
                "Bazı bağlantıların SQL şifresi Desktop'ta kayıtlı değil veya Windows kimlik doğrulaması kullanılıyor.")
        res["gateway_sync"] = {
            "status": "not_needed" if total == 0 else "ready" if synced == total else "partial" if synced else "pending",
            "gateway_name": selected["name"] if selected else None,
            "synced": synced, "total": total,
            "message": warning or ("Floemway bağlantıları otomatik eşlendi." if total else "Bu raporda kaynak bağlantısı yok."),
        }
        return res
