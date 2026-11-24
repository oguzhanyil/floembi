"""PostgreSQL ikilileriyle geçici, bağımsız bir kümede dağıtım kabulü."""

import os
import secrets
import shutil
import socket
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from floem_bi.server import create_server
from floem_bi.server.deployment import settings
from floem_bi.server.pilot import bootstrap
from test_server import floem_file, login, publish


@pytest.mark.skipif(not os.environ.get("FLOEM_TEST_PG_BIN"), reason="PostgreSQL ikilileri seçilmedi")
def test_deployment_on_private_postgres(tmp_path, monkeypatch, floem_file):
    bindir = Path(os.environ["FLOEM_TEST_PG_BIN"])
    def pg(tool, *args):
        subprocess.run([str(bindir / tool), *map(str, args)], check=True, stdout=subprocess.DEVNULL, timeout=90)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = str(probe.getsockname()[1])
    cluster = tmp_path / "cluster"
    password = tmp_path / "db-password"
    password.write_text(secrets.token_urlsafe(32))
    secret = tmp_path / "server-key"
    secret.write_text(secrets.token_urlsafe(48))
    pg("initdb", "-D", cluster, "-U", "floem", "--pwfile", password, "-A", "scram-sha-256", "-E", "UTF8", "--locale=C")
    pg("pg_ctl", "-D", cluster, "-l", tmp_path / "postgres.log", "-o", f"-h 127.0.0.1 -p {port}", "-w", "start")
    try:
        for name, value in {"PGHOST":"127.0.0.1", "PGPORT":port, "PGDATABASE":"postgres", "PGUSER":"floem",
                "FLOEM_PUBLIC_URL":"https://bi.example.test", "FLOEM_SECRET_FILE":secret,
                "FLOEM_DB_PASSWORD_FILE":password, "FLOEM_SERVER_DATA":tmp_path / "reports",
                "FLOEM_WEB_DIST":tmp_path / "web"}.items():
            monkeypatch.setenv(name, str(value))
        config = settings()
        admin = ("owner@example.test", secrets.token_urlsafe(16))
        bootstrap(config.data_dir, admin[0], "Yönetici", admin[1], metadata_url=config.metadata_url)
        with TestClient(create_server(config)) as client:
            h = login(client, admin)
            result = publish(client, h, floem_file.path).json()
            dsid = result["dataset_id"]
            endpoint = f"/api/datasets/{dsid}/schedule"
            assert client.put(endpoint, headers=h, json={"enabled": True, "times": ["10:00"]}).is_success
            assert client.post(f"/api/datasets/{dsid}/refresh", headers=h).json()["stage"] == "Eşleme"
            assert client.get(endpoint, headers=h).json()["next_run"]
            assert len(client.get("/api/mail/inbox", headers=h).json()["items"]) == 1
            route = f"/api/reports/{result['report_id']}/query"
            payload = {"values": [{"table": "INV1", "column": "LineTotal"}]}
            before = client.post(route, headers=h, json=payload).json()["rows"]
            assert before[0][0] > 0
        monkeypatch.setenv("PGPASSWORD", password.read_text())
        dump = tmp_path / "metadata.dump"
        pg("pg_dump", "-Fc", "-f", dump, "postgres")
        archived_files = tmp_path / "saved-files"
        config.data_dir.rename(archived_files)
        shutil.copytree(archived_files, config.data_dir)
        pg("createdb", "restored")
        pg("pg_restore", "--single-transaction", "--exit-on-error", "-d", "restored", dump)
        monkeypatch.setenv("PGDATABASE", "restored")
        with TestClient(create_server(settings())) as restored:
            assert restored.get(endpoint, headers=h).json()["times"] == ["10:00"]
            assert restored.post(route, headers=login(restored, admin), json=payload).json()["rows"] == before
    finally:
        pg("pg_ctl", "-D", cluster, "-m", "fast", "-w", "stop")
