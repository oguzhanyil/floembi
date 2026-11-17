"""floembi.app sunucusunu yerelde başlatır.

    python -m floem_bi.server [--port 8800]

Veri klasörü: FLOEM_SERVER_DATA (varsayılan data/server). İlk açılışta iki sahte
kullanıcı oluşturulur (şifreler README'de; yalnızca geliştirme içindir).
"""

from __future__ import annotations

import argparse
import socket
import sys

import uvicorn

from .app import create_server, load_settings


def main() -> None:
    p = argparse.ArgumentParser(prog="floem-server")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8800)
    args, extra = p.parse_known_args()
    if extra:
        print(f"Not: tanınmayan argümanlar yok sayıldı: {' '.join(extra)}", flush=True)
    probe = socket.socket()
    try:
        probe.bind((args.host, args.port))
    except OSError:
        print(
            f"Hata: {args.host}:{args.port} portu kullanımda. floembi.app sunucusu zaten açık olabilir "
            f"(tarayıcıda http://{args.host}:{args.port} adresini deneyin) ya da --port ile başka bir port verin.",
            file=sys.stderr, flush=True,
        )
        sys.exit(1)
    finally:
        probe.close()
    settings = load_settings()
    if settings.public_url == "http://127.0.0.1:8800" and args.port != 8800:
        settings.public_url = f"http://{args.host}:{args.port}"
    app = create_server(settings)
    print(f"floembi.app (yerel): {settings.public_url}  ·  veri: {settings.data_dir}", flush=True)
    if settings.web_dist is None:
        print("Uyarı: web arayüzü derlenmemiş (npm run web:build); yalnızca /api çalışıyor.", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
