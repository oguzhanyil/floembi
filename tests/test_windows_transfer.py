"""Windows yayın verisinde eski mutlak yollar ve yanlış anahtar ile yarım aktarım."""

import secrets
import sqlite3
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from deploy import windows_transfer as transfer
from floem_bi.server import create_server, load_settings, pilot_config
from floem_bi.server.pilot import bootstrap
from test_server import floem_file, login, publish


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
