"""Windows yayın verisinde eski mutlak yollar ve yanlış anahtar ile yarım aktarım."""

import secrets
import sqlite3
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from deploy import windows_transfer as transfer
from floem_bi.server import create_server, load_settings, pilot_config
from floem_bi.server.pilot import bootstrap
from test_server import SMTP_CFG, floem_file, login, publish


def test_restore_windows_pilot(tmp_path, monkeypatch, floem_file):
    source, dest = tmp_path / "eski", tmp_path / "yeni"
    key_file = tmp_path / "gecis.enc"
    keys = {}
    monkeypatch.setattr(pilot_config, "server_secret", keys.get)
    monkeypatch.setattr(pilot_config, "save_server_secret", keys.__setitem__)
    monkeypatch.setenv("FLOEM_SERVER_DATA", str(source))
    account = ("owner@example.test", secrets.token_hex(12))
    bootstrap(source, account[0], "Yönetici", account[1])
    with TestClient(create_server(load_settings(pilot=True))) as client:
        headers = login(client, account)
        result = publish(client, headers, floem_file.path)
        assert result.status_code == 200
        rid = result.json()["report_id"]
        q = {"group": [{"table": "OCRD", "column": "CardName"}],
             "values": [{"table": "INV1", "column": "LineTotal"}]}
        url = f"/api/reports/{rid}/query"
        before = client.post(url, headers=headers, json=q).json()["rows"]
        assert before
    archived_path = r"C:\Eski Hesap\pilot-server\datasets\1\v1\data.duckdb"
    with closing(sqlite3.connect(source / "floem.db")) as db:
        db.execute("UPDATE datasets SET snapshot=?", (archived_path,))
        db.commit()
    password = secrets.token_urlsafe(20)
    monkeypatch.setattr(transfer.getpass, "getpass", lambda _: password)
    transfer.export_key(key_file)
    assert keys[source].encode() not in key_file.read_bytes()
    monkeypatch.setenv("FLOEM_SERVER_DATA", str(dest))
    monkeypatch.setattr(transfer.getpass, "getpass", lambda _: "yanlis")
    with pytest.raises(ValueError, match="doğrulanamadı"):
        transfer.restore(source, key_file)
    assert not dest.exists() and dest not in keys
    monkeypatch.setattr(transfer.getpass, "getpass", lambda _: password)
    transfer.restore(source, key_file)
    assert keys[dest] == keys[source]
    with TestClient(create_server(load_settings(pilot=True))) as client:
        assert client.get(f"/api/reports/{rid}").status_code == 401
        assert client.post(url, headers=headers, json=q).json()["rows"] == before
        assert login(client, account)
    with closing(sqlite3.connect(source / "floem.db")) as db:
        assert db.execute("SELECT snapshot FROM datasets").fetchone()[0] == archived_path
    with pytest.raises(ValueError, match="yeni olmalı"):
        transfer.restore(source, key_file)


def test_accounts_and_mail_only(tmp_path, monkeypatch, floem_file):
    source, dest = tmp_path / "kaynak", tmp_path / "hedef"
    keys = {}
    monkeypatch.setattr(pilot_config, "server_secret", keys.get)
    monkeypatch.setattr(pilot_config, "save_server_secret", keys.__setitem__)
    monkeypatch.setenv("FLOEM_SERVER_DATA", str(source))
    account = ("owner@example.test", secrets.token_hex(12))
    bootstrap(source, account[0], "Yönetici", account[1])
    with TestClient(create_server(load_settings(pilot=True))) as client:
        old_session = login(client, account)
        assert publish(client, old_session, floem_file.path).status_code == 200
        assert client.put("/api/admin/mail", headers=old_session, json=SMTP_CFG).status_code == 200
    bundle = tmp_path / "ayarlar.enc"
    code = secrets.token_urlsafe(24)
    transfer.export_settings(bundle, code)
    assert account[0].encode() not in bundle.read_bytes()
    monkeypatch.setenv("FLOEM_SERVER_DATA", str(dest))
    with pytest.raises(ValueError, match="doğrulanamadı"):
        transfer.import_settings(bundle, "yanlis")
    assert not dest.exists() and dest not in keys
    counts = transfer.import_settings(bundle, code)
    assert counts == {"users": 1, "workspaces": 1, "members": 1, "mail_config": 1}
    assert keys[source] != keys[dest]
    with TestClient(create_server(load_settings(pilot=True))) as client:
        assert client.get("/api/me", headers=old_session).status_code == 401
        headers = login(client, account)
        assert client.get("/api/reports/1", headers=headers).status_code == 404
        assert client.get("/api/admin/mail", headers=headers).json()["config"]["host"] == SMTP_CFG["host"]
    with closing(sqlite3.connect(dest / "floem.db")) as db:
        cipher = db.execute("SELECT password_enc FROM mail_config").fetchone()[0]
        assert transfer.MailSecretBox(keys[dest]).open(cipher) == SMTP_CFG["password"]
        for table in ("reports", "datasets", "shares", "mail_log"):
            assert db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
    assert not (dest / "datasets").exists()
    with pytest.raises(ValueError, match="zaten var"):
        transfer.import_settings(bundle, code)
