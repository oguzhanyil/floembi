"""Mevcut Cloudflare hesabında pilot için ayrı, uzaktan yönetilen tünel kurar."""

from __future__ import annotations

import base64
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from sqlalchemy import and_, select

from . import db, pilot_config
from .app import load_settings


TUNNEL_NAME = "floembi-pilot"
HOSTNAME = "bi.floemdata.com"
ORIGIN = "http://127.0.0.1:8811"
API = "https://api.cloudflare.com/client/v4"


def _certificate() -> dict[str, str]:
    path = Path.home() / ".cloudflared" / "cert.pem"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
        if lines[0] != "-----BEGIN ARGO TUNNEL TOKEN-----":
            raise ValueError("Cloudflare sertifikası tanınmadı.")
        certificate = json.loads(base64.b64decode("".join(lines[1:-1])))
        if not all(certificate.get(key) for key in ("accountID", "zoneID", "apiToken")):
            raise ValueError("Cloudflare sertifikası eksik.")
        return certificate
    except (OSError, IndexError, ValueError, KeyError) as exc:
        raise RuntimeError("Cloudflare oturumu bulunamadı; bu alan adı için cloudflared login gerekir.") from exc


def _api(certificate: dict[str, str], method: str, path: str, body: dict | None = None):
    request = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers={"Authorization": "Bearer " + certificate["apiToken"],
                 "Content-Type": "application/json", "Accept": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        try:
            errors = json.load(exc).get("errors", [])
            detail = "; ".join(str(item.get("message", "")) for item in errors)[:300]
        except (ValueError, AttributeError):
            detail = ""
        raise RuntimeError(f"Cloudflare API HTTP {exc.code}: {detail}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError("Cloudflare API erişimi başarısız.") from exc
    if not result.get("success"):
        errors = result.get("errors", [])
        detail = "; ".join(str(item.get("message", "")) for item in errors)[:300]
        raise RuntimeError(f"Cloudflare API isteği reddetti: {detail}")
    return result.get("result")


def _pilot_ready() -> None:
    settings = load_settings(pilot=True)
    if settings.web_dist is None or not (settings.web_dist / "index.html").exists():
        raise RuntimeError("Web arayüzü bulunamadı; önce 'npm run web:build' çalıştırın.")
    engine = db.make_engine(f"sqlite:///{(settings.data_dir / 'floem.db').as_posix()}")
    try:
        with engine.connect() as c:
            admin = c.execute(select(db.users.c.id).join(db.members, db.members.c.user_id == db.users.c.id)
                              .where(and_(db.users.c.is_admin.is_(True), db.members.c.role == "admin"))
                              .limit(1)).first()
            if admin is None:
                raise RuntimeError("Pilot yöneticisi yok; önce 'python -m floem_bi.server.pilot init' çalıştırın.")
    finally:
        engine.dispose()


def provision() -> str:
    """Var olan tünellere dokunmadan hostu kurar; belirteci keyring'e yazar."""
    _pilot_ready()
    certificate = _certificate()
    account = certificate["accountID"]
    zone = certificate["zoneID"]
    zone_info = _api(certificate, "GET", f"/zones/{zone}")
    if zone_info.get("name") != "floemdata.com":
        raise RuntimeError("Cloudflare oturumu floemdata.com alanına ait değil.")
    records = _api(certificate, "GET", f"/zones/{zone}/dns_records?" +
                   urllib.parse.urlencode({"name": HOSTNAME}))
    tunnels = _api(certificate, "GET", f"/accounts/{account}/cfd_tunnel?is_deleted=false")
    matches = [item for item in tunnels if item.get("name") == TUNNEL_NAME]
    if len(matches) > 1 or (matches and matches[0].get("config_src") != "cloudflare"):
        raise RuntimeError("floembi-pilot adlı tünel başka biçimde kullanılıyor.")
    tunnel = matches[0] if matches else None
    expected = f"{tunnel['id']}.cfargotunnel.com" if tunnel else None
    if records and (len(records) != 1 or records[0].get("type") != "CNAME" or
                    not records[0].get("proxied") or
                    (expected and records[0].get("content", "").rstrip(".") != expected)):
        raise RuntimeError("bi.floemdata.com DNS kaydı başka bir hedefte; kayıt değiştirilmedi.")
    if tunnel is None:
        if records:
            raise RuntimeError("bi.floemdata.com kaydı mevcut fakat pilot tüneli yok; kayıt değiştirilmedi.")
        tunnel = _api(certificate, "POST", f"/accounts/{account}/cfd_tunnel",
                      {"name": TUNNEL_NAME, "config_src": "cloudflare"})
    tunnel_id = tunnel["id"]
    _api(certificate, "PUT", f"/accounts/{account}/cfd_tunnel/{tunnel_id}/configurations",
         {"config": {"ingress": [
             {"hostname": HOSTNAME, "service": ORIGIN},
             {"service": "http_status:404"},
         ]}})
    if not records:
        _api(certificate, "POST", f"/zones/{zone}/dns_records",
             {"type": "CNAME", "name": HOSTNAME, "content": f"{tunnel_id}.cfargotunnel.com",
              "proxied": True, "ttl": 1})
    token = _api(certificate, "GET", f"/accounts/{account}/cfd_tunnel/{tunnel_id}/token")
    if not isinstance(token, str) or len(token) < 30:
        raise RuntimeError("Cloudflare tünel belirteci alınamadı.")
    pilot_config.save_tunnel_token(token)
    return tunnel_id
