"""Floemway: müşteri ağından yalnızca dışa açılan bağlantı kurar."""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

import keyring
import pyarrow as pa
from nacl.public import PrivateKey, SealedBox
from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException

from ..connectors import ConnectionSpec, SourceRef
from ..connectors.base import ConnectorError
from ..connectors.sqlserver import make_connector
from ..importer.types import arrow_type, to_arrow, unique_names

KEY_SERVICE = "Floemway"
LEGACY_KEY_SERVICE = "FloemBI Gateway"
BATCH_ROWS = 50_000


def _websocket_url(server: str) -> str:
    parsed = urlsplit(server)
    if parsed.scheme == "https":
        return "wss://" + server.split("://", 1)[1].rstrip("/")
    if parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1"):
        return "ws://" + server.split("://", 1)[1].rstrip("/")
    raise ValueError("Uzak sunucu için HTTPS gerekir")


def post(url: str, payload: dict) -> dict:
    req = urllib.request.Request(url, json.dumps(payload).encode("utf-8"),
                                 {"Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.loads(response.read())


def _key_name(server: str, gateway_id: int) -> str:
    return f"{server.rstrip('/')}|{gateway_id}"


def enroll(server: str, gateway_id: int, token: str, config: Path) -> PrivateKey:
    _websocket_url(server)
    key = PrivateKey.generate()
    # Önce Windows Kimlik Bilgisi Yöneticisi'ne koy: kayıt tamamlanıp dosya yazılamazsa anahtar kaybolmaz.
    keyring.set_password(KEY_SERVICE, _key_name(server, gateway_id), base64.b64encode(bytes(key)).decode("ascii"))
    result = post(server.rstrip("/") + "/api/gateways/register", {
        "token": token, "public_key": base64.b64encode(bytes(key.public_key)).decode("ascii"),
    })
    if result["gateway_id"] != gateway_id:
        raise ValueError("Kayıt anahtarı başka bir Floemway'e ait")
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text(json.dumps({"gateway_id": gateway_id, "server": server.rstrip("/")}), encoding="utf-8")
    return key


def load(config: Path) -> tuple[str, int, PrivateKey]:
    saved = json.loads(config.read_text(encoding="utf-8"))
    server, gateway_id = saved["server"], int(saved["gateway_id"])
    secret = keyring.get_password(KEY_SERVICE, _key_name(server, gateway_id)) or keyring.get_password(
        LEGACY_KEY_SERVICE, _key_name(server, gateway_id))
    if not secret:
        raise ValueError("Floemway özel anahtarı Windows Kimlik Bilgisi Yöneticisi'nde bulunamadı")
    return server, gateway_id, PrivateKey(base64.b64decode(secret, validate=True))


def _arrow_bytes(batch: pa.Table) -> bytes:
    sink = io.BytesIO()
    with pa.ipc.new_stream(sink, batch.schema) as writer:
        writer.write_table(batch)
    return sink.getvalue()


def extract_job(job: dict, key: PrivateKey, send) -> None:
    """SQL okumaları iş parçacığında; Arrow parçaları aynı WebSocket üzerinden akar."""
    run_id = job["run_id"]
    table_name = None
    stage = "Bağlantı"
    password = ""
    try:
        send({"type": "start", "run_id": run_id})
        for table in job["tables"]:
            table_name = table["name"]
            source = table["source"]
            password = SealedBox(key).decrypt(bytes.fromhex(source["password_enc"])).decode("utf-8")
            spec = ConnectionSpec(kind="sqlserver", server=source["server"], database=source["database"],
                                  auth="sql", user=source["username"], password=password)
            connector = make_connector(spec)
            query = table["query"]
            ref = SourceRef(query.get("veritabani") or source["database"], query.get("sema"),
                            query.get("tablo"), query.get("sql"))
            stage = "SQL Server bağlantısı ve sorgu"
            send({"type": "table_start", "run_id": run_id, "name": table_name})
            with connector.extract(ref, timeout=300) as extraction:
                names = unique_names([c.name for c in extraction.columns])
                for col, name in zip(extraction.columns, names):
                    col.name = name
                schema = pa.schema([pa.field(c.name, arrow_type(c)) for c in extraction.columns])
                rows_total = 0
                while True:
                    rows = extraction.fetch(BATCH_ROWS)
                    batch = to_arrow(rows, schema)
                    send(_arrow_bytes(batch))
                    rows_total += len(rows)
                    if len(rows) < BATCH_ROWS:
                        break
            send({"type": "table_end", "run_id": run_id, "name": table_name, "rows": rows_total})
        send({"type": "done", "run_id": run_id})
    except Exception as e:
        if isinstance(e, ConnectorError):
            message, detail = e.message, e.detail
        else:
            message, detail = str(e), repr(e)
        # Sürücüden dönen ham hata bağlantı metnini içerirse şifreyi ayıkla.
        if password:
            message, detail = message.replace(password, "***"), detail.replace(password, "***")
        send({"type": "error", "run_id": run_id, "table_name": table_name, "stage": stage,
              "message": message, "detail": detail})


async def run(server: str, gateway_id: int, key: PrivateKey) -> None:
    ws_url = _websocket_url(server)
    while True:
        try:
            async with connect(f"{ws_url}/api/gateways/connect/{gateway_id}", ping_interval=20,
                               ping_timeout=20, max_size=32 * 1024 * 1024) as ws:
                challenge = json.loads(await ws.recv())
                answer = SealedBox(key).decrypt(bytes.fromhex(challenge["value"])).decode("utf-8")
                await ws.send(json.dumps({"type": "challenge_response", "value": answer}))
                loop = asyncio.get_running_loop()
                send_lock = asyncio.Lock()

                async def send_async(payload) -> None:
                    async with send_lock:
                        await ws.send(payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False))

                def send(payload) -> None:
                    asyncio.run_coroutine_threadsafe(send_async(payload), loop).result(timeout=60)

                async def heartbeat() -> None:
                    while True:
                        await send_async({"type": "heartbeat", "at": time.time()})
                        await asyncio.sleep(20)

                beat = asyncio.create_task(heartbeat())
                active: asyncio.Task | None = None
                try:
                    async for raw in ws:
                        msg = json.loads(raw)
                        if msg.get("type") == "refresh":
                            if active and not active.done():
                                await send_async({"type": "error", "run_id": msg["run_id"], "stage": "Kuyruk",
                                                  "message": "Floemway üzerinde başka bir yenileme sürüyor", "detail": ""})
                            else:
                                active = asyncio.create_task(asyncio.to_thread(extract_job, msg, key, send))
                finally:
                    beat.cancel()
                    if active:
                        active.cancel()
        except (OSError, ConnectionError, TimeoutError, ValueError, WebSocketException) as e:
            print(f"Floemway bağlantısı kesildi: {e}; 5 saniye sonra yeniden denenecek", flush=True)
        await asyncio.sleep(5)


def main() -> None:
    parser = argparse.ArgumentParser(description="Floemway")
    parser.add_argument("--server", help="floembi.app HTTPS adresi")
    parser.add_argument("--id", type=int, help="Floemway numarası")
    parser.add_argument("--token", help="İlk kayıt için tek kullanımlık anahtar")
    parser.add_argument("--config", type=Path, help="Şifresiz Floemway ayar dosyası")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--copy-to-service", action="store_true", help="Konsol kaydını kurulu Windows hizmetine aktar")
    mode.add_argument("--service", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    default_dir = Path(os.environ.get("APPDATA", str(Path.home()))) / "FloemBI"
    config = args.config or default_dir / f"gateway-{args.id or 1}.json"
    try:
        if args.copy_to_service or args.service:
            from .service_identity import read_identity, store_identity
            private = Path(sys.executable).resolve().parent.parent / "Private" / "identity.json"
            if not getattr(sys, "frozen", False) or not private.parent.is_dir():
                parser.error("Önce Floemway Windows hizmeti yükleyicisini çalıştırın")
            if args.copy_to_service:
                server, gateway_id, key = load(config)
                store_identity(private, server, gateway_id, key)
                registration = private.parent.parent / "registration.json"
                temp = registration.with_suffix(".tmp")
                temp.write_text(json.dumps({"server": server, "gateway_id": gateway_id}), encoding="utf-8")
                temp.replace(registration)
                print("Floemway kaydı hizmete aktarıldı.")
                return
            server, gateway_id, key = read_identity(private)
        elif args.token:
            if not args.server or not args.id:
                parser.error("İlk kayıt için --server ve --id gerekir")
            key = enroll(args.server, args.id, args.token, config)
            server, gateway_id = args.server, args.id
        else:
            server, gateway_id, key = load(config)
        print(f"Floemway {gateway_id} bağlanıyor: {server}", flush=True)
        asyncio.run(run(server, gateway_id, key))
    except (ValueError, OSError, urllib.error.URLError, keyring.errors.KeyringError) as e:
        parser.exit(1, f"Floemway başlatılamadı: {e}\n")


if __name__ == "__main__":
    main()
