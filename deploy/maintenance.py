"""Compose dağıtımında tutarlı metadata ve rapor yedeği. Docker komutları ikili akışlarla çalışır."""

import argparse
import base64
import getpass
import hashlib
import json
import os
import secrets
import subprocess
import tempfile
from pathlib import Path

import keyring
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

HERE = Path(__file__).resolve().parent
FILES = ("metadata.dump", "reports.tar.gz")
KEYS = ("FLOEM_DEPLOY_DB_PASSWORD", "FLOEM_DEPLOY_SERVER_KEY")


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def credentials(create=False):
    service = "FloemBI.Compose." + os.environ.get("FLOEM_CREDENTIAL_PROFILE", "floembi")
    for name in KEYS:
        value = os.environ.get(name) or keyring.get_password(service, name)
        if not value:
            if not create:
                raise ValueError("Dağıtım anahtarı bulunamadı. Yeni kurulumda init-secrets, kurtarmada import-keys kullanın.")
            value = secrets.token_urlsafe(48)
            keyring.set_password(service, name, value)
        os.environ[name] = value


def transfer_keys(path, importing):
    password = getpass.getpass("Anahtar yedeğinin parolası: ")
    if not password:
        raise ValueError("Yedek parolası boş bırakılamaz")
    if importing:
        envelope = json.loads(path.read_bytes())
        salt = base64.b64decode(envelope["salt"], validate=True)
    else:
        if password != getpass.getpass("Parola tekrar: "):
            raise ValueError("Parolalar eşleşmedi")
        salt = secrets.token_bytes(16)
    kdf = Scrypt(salt=salt, length=32, n=2**17, r=8, p=1)
    cipher = Fernet(base64.urlsafe_b64encode(kdf.derive(password.encode())))
    if importing:
        payload = json.loads(cipher.decrypt(envelope["keys"]))
        service = "FloemBI.Compose." + os.environ.get("FLOEM_CREDENTIAL_PROFILE", "floembi")
        for name in KEYS:
            prior = os.environ.get(name) or keyring.get_password(service, name)
            if prior and prior != payload[name]:
                raise ValueError("Mevcut anahtarlar farklı. Yeni bir FLOEM_CREDENTIAL_PROFILE seçin.")
        for name in KEYS:
            keyring.set_password(service, name, payload[name])
    else:
        credentials()
        token = cipher.encrypt(json.dumps({key: os.environ[key] for key in KEYS}).encode())
        with path.open("x", encoding="ascii") as target:
            json.dump({"salt": base64.b64encode(salt).decode(), "keys": token.decode()}, target)


def backup(compose, dest):
    if dest.exists():
        raise ValueError("Yeni bir yedek klasörü seçin")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=dest.parent) as work:
        staged = Path(work) / "backup"
        staged.mkdir()
        was_running = bool(subprocess.check_output([*compose, "ps", "-q", "--status", "running", "server"]).strip())
        if was_running:
            subprocess.run([*compose, "stop", "server"], check=True)
        try:
            with (staged / FILES[0]).open("wb") as target:
                subprocess.run([*compose, "exec", "-T", "postgres", "pg_dump", "-U", "floem", "-Fc", "floem"],
                               stdout=target, check=True)
            with (staged / FILES[1]).open("wb") as target:
                subprocess.run([*compose, "run", "--rm", "--no-deps", "-T", "--entrypoint", "tar", "server",
                                "-C", "/data", "-czf", "-", "."], stdout=target, check=True)
        finally:
            if was_running:
                subprocess.run([*compose, "start", "server"], check=True)
        (staged / "sha256.json").write_text(json.dumps({f: digest(staged / f) for f in FILES}))
        staged.rename(dest)


def restore(compose, source):
    checks = json.loads((source / "sha256.json").read_text())
    if any(digest(source / f) != checks[f] for f in FILES):
        raise ValueError("Yedek dosyası sağlaması uyuşmuyor")
    if subprocess.check_output([*compose, "ps", "-a", "-q", "server"]).strip():
        raise ValueError("Geri yükleme için yeni bir Compose projesi seçin")
    subprocess.run([*compose, "up", "-d", "--wait", "postgres"], check=True)
    sql = ["exec", "-T", "postgres", "psql", "-U", "floem", "-d", "floem", "-Atc"]
    if subprocess.check_output([*compose, *sql, "SELECT count(*) FROM pg_tables WHERE schemaname='public'"]).strip() != b"0":
        raise ValueError("Hedef metadata veritabanı dolu")
    helper = [*compose, "run", "--rm", "--no-deps", "-T", "--entrypoint"]
    if subprocess.check_output([*helper, "find", "server", "/data", "-mindepth", "1", "-print", "-quit"]).strip():
        raise ValueError("Hedef rapor birimi dolu")
    # Operatörün kendi güvenilir yedeği. Hedef temiz olmadığı sürece üzerine yazılmaz.
    with (source / FILES[1]).open("rb") as archive:
        subprocess.run([*helper, "tar", "server", "-C", "/data", "--no-same-owner", "-xzf", "-"],
                       stdin=archive, check=True)
    with (source / FILES[0]).open("rb") as archive:
        subprocess.run([*compose, "exec", "-T", "postgres", "pg_restore", "-U", "floem", "-d", "floem",
                        "--single-transaction", "--exit-on-error", "--no-owner"], stdin=archive, check=True)


def main():
    parser = argparse.ArgumentParser()
    subs = parser.add_subparsers(dest="action", required=True)
    subs.add_parser("init-secrets")
    for action in ("export-keys", "import-keys"):
        subs.add_parser(action).add_argument("path", type=Path)
    subs.add_parser("compose").add_argument("arguments", nargs=argparse.REMAINDER)
    for action in ("backup", "restore"):
        op = subs.add_parser(action)
        op.add_argument("folder", type=Path)
        op.add_argument("--project", required=action == "restore")
    args = parser.parse_args()
    if args.action == "init-secrets":
        credentials(create=True)
        return
    if args.action in ("export-keys", "import-keys"):
        transfer_keys(args.path, args.action == "import-keys")
        return
    compose = ["docker", "compose", "-f", str(HERE / "docker-compose.yml")]
    credentials()
    if args.action == "compose":
        options = args.arguments
        if options[:1] == ["--"]:
            options = options[1:]
        raise SystemExit(subprocess.call([*compose, *options]))
    if args.project:
        compose.extend(["--project-name", args.project])
    if args.action == "backup":
        backup(compose, args.folder.resolve())
    else:
        restore(compose, args.folder.resolve())


if __name__ == "__main__":
    main()
