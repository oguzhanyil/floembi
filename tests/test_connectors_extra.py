"""SQL Server dışındaki kaynakların salt okunur içe aktarım sözleşmesi."""

from __future__ import annotations

import json
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest

from floem_bi.connectors import ConnectionSpec, ConnectorError, SourceRef
from floem_bi.connectors.sqlserver import make_connector
from floem_bi.desktop_service import create_app
from floem_bi.desktop_service.connections import ConnectionStore
from fastapi.testclient import TestClient


def test_sqlite_navigator_extract_and_read_only(tmp_path):
    path = tmp_path / "ornek.sqlite"
    with sqlite3.connect(path) as con:
        con.execute("CREATE TABLE satis (id INTEGER PRIMARY KEY, tutar REAL, ad TEXT)")
        con.executemany("INSERT INTO satis VALUES (?, ?, ?)", [(1, 42.5, "A"), (2, 17.0, "B")])
    connector = make_connector(ConnectionSpec(kind="sqlite", server=str(path), auth="none"))
    assert connector.list_databases() == ["ornek.sqlite"]
    assert [item.name for item in connector.list_objects("ornek.sqlite")] == ["satis"]
    assert connector.columns("ornek.sqlite", "main", "satis")[0].is_primary_key
    assert connector.preview("ornek.sqlite", "main", "satis", 1).truncated
    assert connector.run_query(None, "SELECT COUNT(*) FROM satis").rows == [[2]]
    with connector.extract(SourceRef("ornek.sqlite", "main", "satis")) as extraction:
        assert [c.py_type for c in extraction.columns] == [int, float, str]
        assert extraction.fetch(10) == [(1, 42.5, "A"), (2, 17.0, "B")]
    with pytest.raises(ConnectorError):
        connector.run_query(None, "DELETE FROM satis")
    with pytest.raises(ConnectorError):
        with connector._connect() as con:
            con.execute("INSERT INTO satis VALUES (3, 5, 'C')")


@pytest.fixture
def rest_server():
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.headers.get("Authorization") != "Bearer ornek-belirtec":
                self.send_response(401)
                self.end_headers()
                return
            if self.path == "/api/orders":
                body = {"items": [{"id": 1, "tutar": 42.5}], "next": "/api/orders?page=2"}
            elif self.path == "/api/orders?page=2":
                body = {"items": [{"id": 2, "tutar": 17.0}], "next": None}
            else:
                self.send_response(404)
                self.end_headers()
                return
            payload = json.dumps(body).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/api/"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_rest_pagination_and_origin_guard(rest_server):
    connector = make_connector(ConnectionSpec(kind="rest", server=rest_server, database="orders",
                                               auth="bearer", password="ornek-belirtec"))
    assert connector.test()["sample_rows"] == 1
    assert connector.preview("orders", "api", "Kayıtlar").truncated
    with connector.extract(SourceRef("orders", "api", "Kayıtlar")) as extraction:
        assert [c.name for c in extraction.columns] == ["id", "tutar"]
        assert extraction.fetch(10) == [(1, 42.5), (2, 17.0)]
    with pytest.raises(ConnectorError) as error:
        connector._validate_url("https://example.net/private")
    assert error.value.code == "unsafe_next_url"
    with pytest.raises(ConnectorError):
        connector._validate_url(rest_server + "%2e%2e/private")
    with pytest.raises(ConnectorError):
        make_connector(ConnectionSpec(kind="rest", server=rest_server, database="%2e%2e/private", auth="none"))
    with pytest.raises(ConnectorError):
        connector.run_query(None, "SELECT * FROM orders")


def test_hana_uses_installed_odbc_driver(monkeypatch):
    import pyodbc

    monkeypatch.setattr(pyodbc, "drivers", lambda: ["HDBODBC"])
    connector = make_connector(ConnectionSpec(kind="hana", server="hana.example:30015", database="SALES",
                                               auth="sql", user="reader", password="ornek"))
    assert connector.driver == "HDBODBC"
    with pytest.raises(ConnectorError):
        connector.run_query(None, "DELETE FROM SALES")


def test_sqlite_desktop_import_flow(tmp_path):
    path = tmp_path / "kaynak.sqlite"
    with sqlite3.connect(path) as con:
        con.execute("CREATE TABLE satis (id INTEGER PRIMARY KEY, tutar REAL)")
        con.execute("INSERT INTO satis VALUES (1, 42.5)")
    token = "t" * 32
    headers = {"X-Floem-Token": token}
    with TestClient(create_app(token, store=ConnectionStore(tmp_path / "store", use_keyring=False),
                               work_dir=tmp_path / "work")) as client:
        connected = client.post("/connections", headers=headers,
                                json={"kind": "sqlite", "server": str(path), "auth": "none"})
        assert connected.status_code == 200, connected.text
        cid = connected.json()["id"]
        assert client.get(f"/connections/{cid}/objects", headers=headers,
                          params={"database": path.name}).json()[0]["name"] == "satis"
        job = client.post("/document/import", headers=headers,
                          json={"connection_id": cid, "database": path.name,
                                "items": [{"schema": "main", "table": "satis"}]}).json()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            state = client.get(f"/jobs/{job['id']}", headers=headers).json()
            if state["status"] in ("succeeded", "failed", "cancelled"):
                break
            time.sleep(.02)
        assert state["status"] == "succeeded", state
        model = client.get("/document", headers=headers).json()["model"]
        assert model["tablolar"][0]["ad"] == "satis"


def test_rest_desktop_import_flow(tmp_path, rest_server):
    token = "t" * 32
    headers = {"X-Floem-Token": token}
    with TestClient(create_app(token, store=ConnectionStore(tmp_path / "store", use_keyring=False),
                               work_dir=tmp_path / "work")) as client:
        connected = client.post("/connections", headers=headers,
                                json={"kind": "rest", "server": rest_server, "database": "orders",
                                      "auth": "bearer", "password": "ornek-belirtec"})
        assert connected.status_code == 200, connected.text
        cid = connected.json()["id"]
        assert "password" not in connected.json()
        job = client.post("/document/import", headers=headers,
                          json={"connection_id": cid, "database": "orders",
                                "items": [{"schema": "api", "table": "Kayıtlar"}]}).json()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            state = client.get(f"/jobs/{job['id']}", headers=headers).json()
            if state["status"] in ("succeeded", "failed", "cancelled"):
                break
            time.sleep(.02)
        assert state["status"] == "succeeded", state
        model = client.get("/document", headers=headers).json()["model"]
        assert model["tablolar"][0]["sutunlar"][0]["ad"] == "id"
