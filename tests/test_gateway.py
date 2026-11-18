"""H7: sahte Gateway ile kayıt, Arrow yenileme ve hata geçmişi."""

from __future__ import annotations

import base64
import time
from contextlib import contextmanager

import duckdb
from nacl.public import PrivateKey, SealedBox

import test_document as td
from floem_bi.gateway import __main__ as gateway_agent
from test_server import YON, floem_file, login, publish, server


def setup_gateway(client, headers, dataset_id):
    registration = client.post("/api/gateways", headers=headers,
                               json={"workspace_id": 1, "name": "Test Gateway"}).json()
    assert registration["registration_token"].startswith("fw_")
    key = PrivateKey.generate()
    result = client.post("/api/gateways/register", json={
        "token": registration["registration_token"],
        "public_key": base64.b64encode(bytes(key.public_key)).decode(),
    })
    assert result.status_code == 200, result.text
    assert client.post("/api/gateways/register", json={
        "token": registration["registration_token"],
        "public_key": base64.b64encode(bytes(key.public_key)).decode(),
    }).status_code == 401
    source = client.post("/api/gateway-sources", headers=headers, json={
        "gateway_id": registration["id"], "server": "SAPSRV", "database": "SBO_DEMO",
        "username": "okuyucu", "password": "yalnızca-gateway-bilir",
    })
    assert source.status_code == 200, source.text
    sid = source.json()["id"]
    model_sources = client.get(f"/api/datasets/{dataset_id}/source-bindings", headers=headers).json()["sources"]
    bindings = {s["id"]: sid for s in model_sources}
    result = client.put(f"/api/datasets/{dataset_id}/source-bindings", headers=headers, json={"sources": bindings})
    assert result.status_code == 200, result.text
    return registration["id"], key


def test_published_source_is_visible_before_floemway_registration(server, floem_file):
    headers = login(server, YON)
    published = publish(server, headers, floem_file.path).json()
    status = server.get("/api/workspaces/1/source-status", headers=headers).json()
    assert len(status) == 1
    assert status[0]["dataset_id"] == published["dataset_id"]
    assert status[0]["server"] == "SAPSRV" and status[0]["database"] == "SBO_DEMO"
    assert status[0]["ready"] is False and status[0]["gateway_name"] is None
    content = server.get("/api/workspaces/1/content", headers=headers).json()
    assert content["datasets"][0]["gateway_source_count"] == 1
    assert content["datasets"][0]["gateway_ready"] is False


@contextmanager
def connect_gateway(client, gateway_id, key, headers):
    with client.websocket_connect(f"/api/gateways/connect/{gateway_id}") as ws:
        challenge = ws.receive_json()
        answer = SealedBox(key).decrypt(bytes.fromhex(challenge["value"])).decode()
        ws.send_json({"type": "challenge_response", "value": answer})
        for _ in range(100):
            if client.get("/api/workspaces/1/gateways", headers=headers).json()[0]["online"]:
                break
            time.sleep(0.02)
        yield ws


def wait_run(client, headers, dataset_id, status):
    for _ in range(100):
        run = client.get(f"/api/datasets/{dataset_id}/refreshes", headers=headers).json()[0]
        if run["status"] == status:
            return run
        time.sleep(0.05)
    assert False, run


def test_gateway_refresh_success(server, floem_file, monkeypatch):
    headers = login(server, YON)
    published = publish(server, headers, floem_file.path).json()
    dsid, rid = published["dataset_id"], published["report_id"]
    gateway_id, key = setup_gateway(server, headers, dsid)
    before = server.post(f"/api/reports/{rid}/query", headers=headers,
                         json={"values": [{"table": "INV1", "column": "LineTotal"}]}).json()["rows"][0][0]
    td.SOURCE.tables[("dbo", "INV1")][1].append((2, 1, "B1", 2, td.Decimal("1"), td.Decimal("20")))
    monkeypatch.setattr(gateway_agent, "make_connector", td.FakeConnector)
    with connect_gateway(server, gateway_id, key, headers) as ws:
        assert server.get("/api/workspaces/1/gateways", headers=headers).json()[0]["online"] is True
        started = server.post(f"/api/datasets/{dsid}/refresh", headers=headers)
        assert started.status_code == 200 and started.json()["status"] == "queued"
        job = ws.receive_json()
        assert job["type"] == "refresh" and len(job["tables"]) == 5
        assert job["tables"][0]["source"]["password_enc"] != "yalnızca-gateway-bilir"
        gateway_agent.extract_job(job, key, lambda payload: ws.send_bytes(payload) if isinstance(payload, bytes)
                                  else ws.send_json(payload))
        run = wait_run(server, headers, dsid, "succeeded")
        assert run["elapsed_ms"] >= 0
    after = server.post(f"/api/reports/{rid}/query", headers=headers,
                        json={"values": [{"table": "INV1", "column": "LineTotal"}]}).json()["rows"][0][0]
    assert after == before + 20
    assert server.get(f"/api/datasets/{dsid}", headers=headers).json()["version"] == 2


def test_gateway_login_failure_and_offline_keep_snapshot(server, floem_file):
    headers = login(server, YON)
    published = publish(server, headers, floem_file.path).json()
    dsid = published["dataset_id"]
    gateway_id, key = setup_gateway(server, headers, dsid)
    with connect_gateway(server, gateway_id, key, headers) as ws:
        server.post(f"/api/datasets/{dsid}/refresh", headers=headers)
        job = ws.receive_json()
        ws.send_json({"type": "start", "run_id": job["run_id"]})
        ws.send_json({"type": "error", "run_id": job["run_id"], "stage": "SQL Server bağlantısı ve sorgu",
                      "table_name": "OINV", "message": "SQL Server'a bağlanılamadı",
                      "detail": "Login failed for user 'okuyucu'"})
        failed = wait_run(server, headers, dsid, "failed")
        assert failed["table_name"] == "OINV" and "Login failed" in failed["error"]["detail"]
        server.post(f"/api/datasets/{dsid}/refresh", headers=headers)
        interrupted = ws.receive_json()
        ws.send_json({"type": "start", "run_id": interrupted["run_id"]})
        wait_run(server, headers, dsid, "running")
        ws.close()
    stopped = wait_run(server, headers, dsid, "failed")
    assert stopped["id"] == interrupted["run_id"] and stopped["error"]["message"] == "Floemway çevrimdışı"
    offline = server.post(f"/api/datasets/{dsid}/refresh", headers=headers).json()
    assert offline["status"] == "failed" and offline["error"]["message"] == "Floemway çevrimdışı"
    assert server.get(f"/api/datasets/{dsid}", headers=headers).json()["version"] == 1


def test_gateway_permissions(server, floem_file):
    from test_server import IZL

    manager = login(server, YON)
    viewer = login(server, IZL)
    dsid = publish(server, manager, floem_file.path).json()["dataset_id"]
    assert server.post("/api/gateways", headers=viewer,
                       json={"workspace_id": 1, "name": "Yetkisiz"}).status_code == 403
    assert server.get("/api/workspaces/1/gateway-sources", headers=viewer).status_code == 403
    assert server.get(f"/api/datasets/{dsid}/source-bindings", headers=viewer).status_code == 403
    assert server.post(f"/api/datasets/{dsid}/refresh", headers=viewer).status_code == 403
    assert server.get(f"/api/datasets/{dsid}/refreshes", headers=viewer).status_code == 403


def test_gateway_reapplies_floem_query(server, floem_file, monkeypatch):
    desk = floem_file
    step = {"tur": "metin", "sutun": "CardName", "islem": "buyuk"}
    applied = desk.post("/document/transform/apply", headers=td.H,
                        json={"table": "OCRD", "adimlar": [step]})
    assert applied.status_code == 200, applied.text
    desk.post("/document/save", headers=td.H, json={})
    headers = login(server, YON)
    dsid = publish(server, headers, desk.path).json()["dataset_id"]
    gateway_id, key = setup_gateway(server, headers, dsid)
    monkeypatch.setattr(gateway_agent, "make_connector", td.FakeConnector)
    with connect_gateway(server, gateway_id, key, headers) as ws:
        server.post(f"/api/datasets/{dsid}/refresh", headers=headers)
        job = ws.receive_json()
        gateway_agent.extract_job(job, key, lambda payload: ws.send_bytes(payload) if isinstance(payload, bytes)
                                  else ws.send_json(payload))
        wait_run(server, headers, dsid, "succeeded")
    from floem_bi.server import db
    with server.app_.state.db.connect() as c:
        snapshot = c.execute(db.datasets.select().where(db.datasets.c.id == dsid)).first().snapshot
    con = duckdb.connect(snapshot)
    try:
        assert con.execute('SELECT "CardName" FROM veri.OCRD ORDER BY "CardCode"').fetchone()[0] == "ANADOLU GIDA"
        assert con.execute('SELECT "CardName" FROM veri.OCRD__ham ORDER BY "CardCode"').fetchone()[0] == "Anadolu Gıda"
    finally:
        con.close()
