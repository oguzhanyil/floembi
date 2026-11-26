"""Windows x64 yayın paketi. Bağımsız kontrol, mevcut yayın ve tünel giriş noktaları."""

import argparse
import getpass
import json
import os
import secrets
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

import uvicorn

from floem_bi.server import ServerSettings, create_server, load_settings
from floem_bi.server import pilot_config
from floem_bi.server.pilot import run_tunnel
from windows_transfer import export_key, export_settings, import_settings, restore


def web_directory() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "web"
    return Path(__file__).resolve().parents[1] / "apps" / "web" / "dist"


class WebPage(HTMLParser):
    script = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("type") == "module":
            self.script = attrs.get("src")


def check(web: Path) -> None:
    # Geçici metadata, anahtar ve loopback portu sayesinde üretim oturumuna dokunulmaz.
    with tempfile.TemporaryDirectory(prefix="floem-yayin-kontrol-") as directory, socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        base = f"http://127.0.0.1:{sock.getsockname()[1]}"
        settings = ServerSettings(data_dir=Path(directory), secret=secrets.token_urlsafe(48),
                                  public_url=base, web_dist=web, seed_users=False)
        app = create_server(settings)
        server = uvicorn.Server(uvicorn.Config(app, log_level="error", loop="asyncio"))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
        thread.start()
        try:
            until = time.monotonic() + 25
            while not server.started:
                if not thread.is_alive() or time.monotonic() > until:
                    raise RuntimeError("Deneme sunucusu başlamadı.")
                time.sleep(.1)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(base + "/api/health", timeout=8) as response:
                if json.load(response).get("ok") is not True:
                    raise RuntimeError("Sağlık yanıtı geçersiz.")
            with opener.open(base + "/", timeout=8) as response:
                page = WebPage()
                page.feed(response.read().decode("utf-8"))
            if not page.script or not page.script.startswith("/assets/"):
                raise RuntimeError("Web arayüzünün ana dosyası bulunamadı.")
            with opener.open(base + page.script, timeout=8) as response:
                if "javascript" not in response.headers.get_content_type() or not response.read(1):
                    raise RuntimeError("Web arayüzü yüklenemedi.")
            try:
                with opener.open(base + "/api/reports/1", timeout=8):
                    raise RuntimeError("Rapor uç noktası oturum açılmadan yanıt verdi.")
            except urllib.error.HTTPError as error:
                if error.code != 401:
                    raise
                error.close()
        finally:
            server.should_exit = True
            thread.join(10)
            if thread.is_alive():
                raise RuntimeError("Deneme sunucusu kapanamadı.")
    print("KONTROL BASARILI - Web 200, API 200, oturumsuz rapor 401.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Floem BI Windows yayın sunucusu")
    commands = parser.add_subparsers(dest="islem", required=True)
    for command in ("kontrol", "sunucu", "tunel", "tunel-belirteci"):
        commands.add_parser(command)
    commands.add_parser("anahtari-aktar").add_argument("dosya", type=Path)
    for command in ("ayarlari-aktar", "ayarlari-al"):
        commands.add_parser(command).add_argument("dosya", type=Path)
    transfer = commands.add_parser("veriyi-al")
    transfer.add_argument("kaynak", type=Path)
    transfer.add_argument("anahtar_dosyasi", type=Path)
    args = parser.parse_args()
    if args.islem in ("ayarlari-aktar", "ayarlari-al"):
        try:
            code = getpass.getpass("Ayar paketi aktarım kodu: ").strip()
            if args.islem == "ayarlari-aktar":
                if code != getpass.getpass("Aktarım kodu tekrar: ").strip():
                    parser.error("Aktarım kodları eşleşmiyor.")
                export_settings(args.dosya, code)
                print("Şifreli ayar paketi hazır.")
            else:
                counts = import_settings(args.dosya, code)
                print(f"AYARLAR HAZIR - Kullanıcı: {counts['users']}, çalışma alanı: {counts['workspaces']}, "
                      f"e-posta ayarı: {counts['mail_config']}, rapor: 0, veri modeli: 0.")
        except (ValueError, OSError) as error:
            parser.exit(1, f"Hata: {error}\n")
        return
    if args.islem == "anahtari-aktar":
        export_key(args.dosya)
        return
    if args.islem == "veriyi-al":
        restore(args.kaynak, args.anahtar_dosyasi)
        return
    if args.islem == "tunel-belirteci":
        token = getpass.getpass("Bu sunucu için Cloudflare tünel belirteci: ").strip()
        if len(token) < 30 or any(c.isspace() for c in token):
            parser.error("Geçerli bir Cloudflare tünel belirteci girin.")
        pilot_config.save_tunnel_token(token)
        return
    if args.islem == "tunel":
        raise SystemExit(run_tunnel())
    web = web_directory()
    if not (web / "index.html").is_file():
        parser.error("Web paketi bulunamadı.")
    if args.islem == "kontrol":
        check(web)
        return
    if not (pilot_config.data_dir() / "floem.db").is_file():
        parser.error("Yayın verisi bulunamadı. Önce hedefte 'veriyi-al' işlemini tamamlayın.")
    os.environ["FLOEM_WEB_DIST"] = str(web)
    settings = load_settings(pilot=True)
    app = create_server(settings)
    uvicorn.run(app, host="127.0.0.1", port=8811)


if __name__ == "__main__":
    # PyInstaller alt süreçlerin ana komutu yeniden başlatmasını önler.
    from multiprocessing import freeze_support
    freeze_support()
    main()
