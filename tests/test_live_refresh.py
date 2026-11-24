"""İsteğe bağlı H7 saha testi. Kaynağa yalnızca sunucu saatini sorar."""

import base64
import os
import secrets
from datetime import datetime, timezone

import duckdb
import pytest
from nacl.public import PrivateKey

from floem_bi.connectors.sqlserver import make_connector
from floem_bi.desktop_service.connections import ConnectionStore
from floem_bi.document import floemfile
from floem_bi.gateway.__main__ import extract_job
from floem_bi.model.schema import ModelTanimi
from test_gateway import connect_gateway, wait_run
from test_server import YON, login, publish, server


@pytest.mark.skipif(not os.environ.get("FLOEM_TEST_SQL_CONNECTION"),
                    reason="Saha testi için kayıtlı Desktop bağlantısını seçin")
def test_live_sql_snapshot_and_failure_history(tmp_path, server):
    store = ConnectionStore()
    choice = os.environ["FLOEM_TEST_SQL_CONNECTION"]
    if choice == "auto":
        ids = [r["id"] for r in store.list() if r["kind"] == "sqlserver" and r["auth"] == "sql"]
        assert len(ids) == 1, "Birden fazla bağlantı varsa Desktop bağlantı kimliğini seçin"
        choice = ids[0]
    spec = store.get(choice)
    database = spec.database or make_connector(spec).test()["database"]
    model = ModelTanimi.model_validate({
        "model": {"ad": "Saha kabulü"},
        "veri_kaynaklari": [{"id": "sql", "sunucu": spec.server, "veritabani": database}],
        "tablolar": [{"ad": "Saat", "kaynak": {"katman": "veri", "tablo": "Saat"},
                      "sorgu": {"kaynak": "sql", "veritabani": database,
                                "sql": "SELECT DATEPART(year, SYSUTCDATETIME()) AS Deger"},
                      "sutunlar": [{"ad": "Deger", "tip": "int32"}]}],
    })
    dbfile = tmp_path / "saha.duckdb"
    with duckdb.connect(str(dbfile)) as con:
        con.execute("CREATE SCHEMA veri")
        con.execute("CREATE TABLE veri.Saat AS SELECT 0 AS Deger")
    doc = tmp_path / "Saha.floem"
    floemfile.write(doc, floemfile.FloemContent(model), dbfile, "saha")
    h = login(server, YON)
    published = publish(server, h, doc).json()
    ds = f"/api/datasets/{published['dataset_id']}"
    query = f"/api/reports/{published['report_id']}/query"
    def value():
        return server.post(query, headers=h, json={"values": [{"table": "Saat", "column": "Deger"}]}).json()["rows"][0][0]

    reg = server.post("/api/gateways", headers=h, json={"workspace_id": 1, "name": "Saha"}).json()
    key = PrivateKey.generate()
    assert server.post("/api/gateways/register", json={"token": reg["registration_token"],
                       "public_key": base64.b64encode(bytes(key.public_key)).decode()}).is_success
    def bind(username, password):
        source = server.post("/api/gateway-sources", headers=h, json={"gateway_id": reg["id"],
            "server": spec.server, "database": database, "username": username, "password": password})
        assert source.is_success
        assert server.put(ds + "/source-bindings", headers=h, json={"sources": {"sql": source.json()["id"]}}).is_success

    bind(spec.user, spec.password)
    assert value() == 0
    with connect_gateway(server, reg["id"], key, h) as socket:
        def refresh(status):
            assert server.post(ds + "/refresh", headers=h).is_success
            extract_job(socket.receive_json(), key, lambda msg: socket.send_bytes(msg)
                        if isinstance(msg, bytes) else socket.send_json(msg))
            return wait_run(server, h, published["dataset_id"], status)
        refresh("succeeded")
        current = value()
        assert abs(current - datetime.now(timezone.utc).year) <= 1
        # Var olmayan tek seferlik kullanıcıyla kontrol edilir, gerçek hesap kilitlenmez.
        bind("floem_test_" + secrets.token_hex(12), secrets.token_urlsafe(32))
        failure = refresh("failed")
        assert failure["table_name"] == "Saat" and "SQL Server" in failure["stage"]
        assert value() == current
    offline = server.post(ds + "/refresh", headers=h).json()
    assert offline["status"] == "failed" and "çevrimdışı" in offline["error"]["message"]
    assert server.get(ds, headers=h).json()["version"] == 2 and value() == current
