"""Desktop servisini başlatır.

    python -m floem_bi.desktop_service --token <gizli> [--port 0]

Port 0 verilirse işletim sistemi boş bir port seçer. Servis hazır olunca
stdout'a tek satır yazar:  FLOEM_READY {"port": 51234}
Electron ana süreci bu satırı okuyup arayüze iletir.

Yaşam döngüsü Electron'a aittir:
- Terminal sinyalleri (Ctrl+C) yok sayılır; aksi halde `npm run desktop` terminalinde
  Ctrl+C'ye basılınca servis dinlemeyi bırakıp pencere açıkken "Failed to fetch" verir.
- FLOEM_PARENT_PID verilirse o süreç (Electron) kapanınca servis de hemen çıkar;
  asılı kalan servis süreci olmaz.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import signal
import socket
import sys
import threading
import time

import uvicorn

from .app import create_app


def _wait_for_parent_exit(pid: int) -> None:
    """Verilen süreç bitene kadar bekler (Windows'ta çekirdek nesnesiyle, diğerlerinde yoklayarak)."""
    if sys.platform == "win32":
        import ctypes

        SYNCHRONIZE, INFINITE = 0x00100000, 0xFFFFFFFF
        k32 = ctypes.windll.kernel32
        handle = k32.OpenProcess(SYNCHRONIZE, False, pid)
        if not handle:
            return                                   # süreç zaten yok
        try:
            k32.WaitForSingleObject(handle, INFINITE)
        finally:
            k32.CloseHandle(handle)
    else:
        while os.getppid() == pid:
            time.sleep(1)


def _watch_parent(pid: int, cleanup) -> None:
    def run() -> None:
        _wait_for_parent_exit(pid)
        done = threading.Event()

        def clean() -> None:
            with contextlib.suppress(Exception):
                cleanup()
            done.set()

        threading.Thread(target=clean, daemon=True).start()
        done.wait(3)                                 # temizlik takılırsa beklemeden çık
        os._exit(0)

    threading.Thread(target=run, name="floem-parent-watch", daemon=True).start()


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
    if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
        # Windows: başka bir süreç aynı porta bağlanamasın
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    sock.bind(("127.0.0.1", args.port))
    port = sock.getsockname()[1]

    app = create_app(args.token, open_path=args.open_path)
    config = uvicorn.Config(app, log_level="warning", access_log=False)

    def cleanup() -> None:
        job = app.state.runner.active()
        if job:
            job.cancel()
        app.state.holder["doc"].close()              # çalışma klasörünü sil

    parent = os.environ.get("FLOEM_PARENT_PID", "")
    if parent.isdigit():
        _watch_parent(int(parent), cleanup)

    class _Server(uvicorn.Server):
        async def startup(self, sockets=None):
            await super().startup(sockets=sockets)
            print("FLOEM_READY " + json.dumps({"port": port}), flush=True)

        @contextlib.contextmanager
        def capture_signals(self):
            # Terminal sinyallerini yok say: servisi yalnızca Electron kapatır
            ignored = [signal.SIGINT] + ([signal.SIGBREAK] if hasattr(signal, "SIGBREAK") else [])
            previous = {s: signal.signal(s, signal.SIG_IGN) for s in ignored}
            try:
                yield
            finally:
                for s, h in previous.items():
                    signal.signal(s, h)

    try:
        _Server(config).run(sockets=[sock])
    finally:
        cleanup()


if __name__ == "__main__":
    main()
