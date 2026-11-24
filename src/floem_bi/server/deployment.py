"""PostgreSQL metadata kullanan dağıtımın ilklendirme ve sunucu giriş noktası."""

import argparse
import getpass
import os
from pathlib import Path
from urllib.parse import urlsplit

import uvicorn
from sqlalchemy.engine import URL

from .app import ServerSettings, create_server
from .mail import load_mail_settings
from .pilot import bootstrap


def settings() -> ServerSettings:
    public = os.environ["FLOEM_PUBLIC_URL"].rstrip("/")
    address = urlsplit(public)
    if (not address.hostname or address.username or address.password or address.query or address.fragment
            or address.path or not (address.scheme == "https" or
                (address.scheme == "http" and address.hostname in {"127.0.0.1", "localhost"}))):
        raise ValueError("FLOEM_PUBLIC_URL için HTTPS alan adı veya yerel HTTP adresi gerekir")
    secret = Path(os.environ["FLOEM_SECRET_FILE"]).read_text().strip()
    if len(secret) < 32:
        raise ValueError("Sunucu anahtarı en az 32 karakter olmalı")
    password = Path(os.environ["FLOEM_DB_PASSWORD_FILE"]).read_text().strip()
    url = URL.create("postgresql+pg8000", username=os.environ.get("PGUSER", "floem"),
                     database=os.environ.get("PGDATABASE", "floem"), host=os.environ.get("PGHOST", "postgres"),
                     port=int(os.environ.get("PGPORT", "5432")), password=password)
    return ServerSettings(data_dir=Path(os.environ["FLOEM_SERVER_DATA"]).resolve(), public_url=public,
                          secret=secret, metadata_url=url, seed_users=False, deployment=True,
                          web_dist=Path(os.environ["FLOEM_WEB_DIST"]), mail=load_mail_settings())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["init", "serve"])
    args = parser.parse_args()
    config = settings()
    if args.command == "init":
        email, name = input("Yönetici e-postası: "), input("Yönetici adı: ")
        password = getpass.getpass("Yönetici şifresi: ")
        if password != getpass.getpass("Şifre tekrar: "):
            parser.error("Şifreler eşleşmiyor")
        bootstrap(config.data_dir, email, name, password, metadata_url=config.metadata_url)
        return
    uvicorn.run(create_server(config), host="0.0.0.0", port=8800)


if __name__ == "__main__":
    main()
