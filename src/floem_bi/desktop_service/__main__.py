"""Desktop servisini başlatır.

    python -m floem_bi.desktop_service --token <gizli> [--port 0]

Port 0 verilirse işletim sistemi boş bir port seçer. Servis hazır olunca
stdout'a tek satır yazar:  FLOEM_READY {"port": 51234}
Electron ana süreci bu satırı okuyup arayüze iletir.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys

import uvicorn

from .app import create_app


def main() -> None:
    parser = argparse.ArgumentParser(prog="floem-desktop-service")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--token", default=os.environ.get("FLOEM_TOKEN", ""))
    parser.add_argument("--open", dest="open_path", default=None, help="Açılışta açılacak .floem dosyası")
    args = parser.parse_args()
    if len(args.token) < 16:
        print("Hata: en az 16 karakterlik --token gerekli", file=sys.stderr)
        sys.exit(2)

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", args.port))
    port = sock.getsockname()[1]

    app = create_app(args.token, open_path=args.open_path)
    config = uvicorn.Config(app, log_level="warning", access_log=False)

    class _Server(uvicorn.Server):
        async def startup(self, sockets=None):
            await super().startup(sockets=sockets)
            print("FLOEM_READY " + json.dumps({"port": port}), flush=True)

    try:
        _Server(config).run(sockets=[sock])
    finally:
        job = app.state.runner.active()
        if job:
            job.cancel()
        app.state.holder["doc"].close()          # çalışma klasörünü sil


if __name__ == "__main__":
    main()
