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
    p.add_argument("--port", type=int)
    p.add_argument("--pilot", action="store_true", help="Gerçek adres pilotu (ayrı veri alanı, gerçek yönetici)")
    args, extra = p.parse_known_args()
    if args.pilot and extra:
        p.error(f"Tanınmayan argümanlar: {' '.join(extra)}")
    if extra:
        print(f"Not: tanınmayan argümanlar yok sayıldı: {' '.join(extra)}", flush=True)
    if args.pilot and args.host != "127.0.0.1":
        p.error("Pilot sunucu yalnızca 127.0.0.1 adresinden dinleyebilir.")
    port = args.port or (8811 if args.pilot else 8800)
    probe = socket.socket()
    try:
        probe.bind((args.host, port))
    except OSError:
        print(
            f"Hata: {args.host}:{port} portu kullanımda. floembi.app sunucusu zaten açık olabilir "
            f"(tarayıcıda http://{args.host}:{port} adresini deneyin) ya da --port ile başka bir port verin.",
            file=sys.stderr, flush=True,
        )
        sys.exit(1)
    finally:
        probe.close()
    settings = load_settings(pilot=args.pilot)
    if not args.pilot and settings.public_url == "http://127.0.0.1:8800" and port != 8800:
        settings.public_url = f"http://{args.host}:{port}"
    if args.pilot and settings.web_dist is None:
        p.error("Pilot web arayüzü bulunamadı. Önce 'npm run web:build' çalıştırın.")
    app = create_server(settings)
    print(f"floembi.app ({'pilot' if args.pilot else 'yerel'}): {settings.public_url}  ·  veri: {settings.data_dir}", flush=True)
    if settings.web_dist is None:
        print("Uyarı: web arayüzü derlenmemiş (npm run web:build); yalnızca /api çalışıyor.", flush=True)
    uvicorn.run(app, host=args.host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
