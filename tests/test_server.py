"""floembi.app sunucusu: giriş, yetki (iki sahte kullanıcı), yayımlama, web'de sorgu."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import test_document as td
from floem_bi.server import ServerSettings, create_server
from floem_bi.server import db

YON = ("yonetici@floembi.test", "Floem.Yonetici1")
IZL = ("izleyici@floembi.test", "Floem.Izleyici1")

REPORT = {"version": 1, "pages": [{"id": "p1", "name": "Özet", "width": 1280, "height": 720, "visuals": [
    {"id": "v1", "type": "table", "group": [{"table": "OCRD", "column": "CardName"}],
     "values": [{"table": "INV1", "column": "LineTotal"}]},
]}]}


@pytest.fixture
def floem_file(tmp_path):
    """Desktop servisinde sahte SAP B1 verisiyle rapor üretip .floem olarak kaydeder."""
    td.SOURCE = td.FakeSource()
    from floem_bi.desktop_service import create_app
    from floem_bi.desktop_service.connections import ConnectionStore
    desk = TestClient(create_app(td.TOKEN, store=ConnectionStore(tmp_path / "s", use_keyring=False),
                                 connector_factory=td.FakeConnector, work_dir=tmp_path / "w"))
    cid = desk.post("/connections", headers=td.H, json={"server": "SAPSRV", "user": "u", "password": "x"}).json()["id"]
    desk.cid = cid
    td.do_import(desk, td.ALL)
    desk.put("/document/report", headers=td.H, json=REPORT)
    path = desk.post("/document/save", headers=td.H, json={"path": str(tmp_path / "Satış Raporu")}).json()["path"]
    desk.path = path
    return desk


@pytest.fixture
def server(tmp_path):
    app = create_server(ServerSettings(data_dir=tmp_path / "srv", secret="s" * 48))
    c = TestClient(app)
    c.app_ = app
    return c


def login(server, who):
    r = server.post("/api/auth/login", json={"email": who[0], "password": who[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def publish(server, headers, path, wid=1):
    with open(path, "rb") as f:
        return server.post(f"/api/workspaces/{wid}/publish", headers=headers,
                           files={"file": ("rapor.floem", f, "application/octet-stream")})


def test_login(server):
    r = server.post("/api/auth/login", json={"email": "yonetici@floembi.test", "password": "yanlis"})
    assert r.status_code == 401 and r.json()["error"]["message"] == "E-posta adresi ya da şifre hatalı"
    h = login(server, YON)
    me = server.get("/api/me", headers=h).json()
    assert me["email"] == "yonetici@floembi.test"
    assert me["workspaces"] == [{"id": 1, "name": "Satış Ekibi", "role": "admin", "role_label": "Yönetici"}]
    assert server.get("/api/me").status_code == 401
    assert server.get("/api/me", headers={"Authorization": "Bearer bozuk.token.x"}).status_code == 401


def test_publish_view_and_republish(server, floem_file):
    h = login(server, YON)
    r = publish(server, h, floem_file.path)
    assert r.status_code == 200, r.text
    p = r.json()
    assert (p["name"], p["version"], p["replaced"]) == ("Satış Raporu", 1, False)
    assert p["url"].endswith(f"/reports/{p['report_id']}")

    content = server.get("/api/workspaces/1/content", headers=h).json()
    assert [d["name"] for d in content["datasets"]] == ["Satış Raporu"]
    assert content["reports"][0]["published_by"] == "Yönetici Kullanıcı"

    rep = server.get(f"/api/reports/{p['report_id']}", headers=h).json()
    v1 = rep["definition"]["pages"][0]["visuals"][0]
    assert v1["type"] == "table" and rep["role_label"] == "Yönetici"
    d = server.post(f"/api/reports/{p['report_id']}/query", headers=h,
                    json={"group": v1["group"], "values": v1["values"], "totals": True}).json()
    assert d["rows"] == [["Anadolu Gıda", 192.75], ["Ege Yapı", 80.0]]     # Desktop'taki sonuçla aynı
    assert d["total"] == [272.75]

    # Desktop'ta veriyi değiştirip tekrar yayımla → üzerine yazılır, sürüm artar, açık sorgu yeni veriyi görür
    td.SOURCE.tables[("dbo", "INV1")][1].append((2, 1, "B1", 2, td.Decimal("1"), td.Decimal("20")))
    job = td.wait(floem_file, floem_file.post("/document/refresh", headers=td.H).json())
    assert job["status"] == "succeeded"
    floem_file.post("/document/save", headers=td.H, json={})
    p2 = publish(server, h, floem_file.path).json()
    assert (p2["report_id"], p2["version"], p2["replaced"]) == (p["report_id"], 2, True)
    d = server.post(f"/api/reports/{p['report_id']}/query", headers=h,
                    json={"group": v1["group"], "values": v1["values"]}).json()
    assert d["rows"] == [["Anadolu Gıda", 192.75], ["Ege Yapı", 100.0]]
    ds = server.get(f"/api/datasets/{p['dataset_id']}", headers=h).json()
    assert ds["version"] == 2 and len(ds["tables"]) == 5 and ds["sources"][0]["sunucu"] == "SAPSRV"


def test_old_versions_are_cleaned(server, floem_file):
    h = login(server, YON)
    for _ in range(3):
        last = publish(server, h, floem_file.path).json()
    root = server.app_.state.settings.data_dir / "datasets" / str(last["dataset_id"])
    assert sorted(p.name for p in root.iterdir()) == ["v2", "v3"]


def test_viewer_permissions(server, floem_file):
    hy = login(server, YON)
    rid = publish(server, hy, floem_file.path).json()["report_id"]
    hi = login(server, IZL)
    assert server.get("/api/workspaces", headers=hi).json() == []
    r = server.get("/api/workspaces/1/content", headers=hi)
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    r = publish(server, hi, floem_file.path)
    assert r.status_code == 403 and "yayımlama yetkiniz yok" in r.json()["error"]["message"]
    r = server.get(f"/api/reports/{rid}", headers=hi)
    assert r.status_code == 403 and r.json()["error"]["message"] == "Bu rapor sizinle paylaşılmamış"
    assert server.post(f"/api/reports/{rid}/query", headers=hi, json={"values": []}).status_code == 403

    # Paylaşım (H6'da e-postayla yapılacak; burada doğrudan kayıt)
    with server.app_.state.db.begin() as c:
        c.execute(db.shares.insert().values(report_id=rid, user_id=2, shared_by=1))
    rep = server.get(f"/api/reports/{rid}", headers=hi).json()
    assert rep["role_label"] == "İzleyici"
    d = server.post(f"/api/reports/{rid}/query", headers=hi,
                    json={"values": [{"table": "INV1", "column": "LineTotal"}]}).json()
    assert d["rows"] == [[272.75]]
    assert publish(server, hi, floem_file.path).status_code == 403     # paylaşım yayımlama yetkisi vermez


def test_bad_upload(server, tmp_path):
    h = login(server, YON)
    bad = tmp_path / "x.floem"
    bad.write_bytes(b"zip degil")
    r = publish(server, h, bad)
    assert r.status_code == 400 and r.json()["error"]["code"] == "file_error"
    assert publish(server, h, bad, wid=99).status_code == 404


def test_query_error_is_readable(server, floem_file):
    h = login(server, YON)
    rid = publish(server, h, floem_file.path).json()["report_id"]
    r = server.post(f"/api/reports/{rid}/query", headers=h, json={"values": [{"table": "OINV", "column": "Yok"}]})
    assert r.status_code == 400 and r.json()["error"]["code"] == "query_error"


# ------------------------------------------------------------------ Desktop → floembi.app (gerçek HTTP)
@pytest.fixture
def live_server(tmp_path):
    import socket
    import threading
    import time

    import uvicorn

    app = create_server(ServerSettings(data_dir=tmp_path / "live", secret="k" * 48))
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    srv = uvicorn.Server(uvicorn.Config(app, log_level="warning"))
    t = threading.Thread(target=srv.run, kwargs={"sockets": [sock]}, daemon=True)
    t.start()
    for _ in range(200):
        if srv.started:
            break
        time.sleep(0.02)
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True
    t.join(5)


def test_desktop_publish_flow(floem_file, live_server):
    desk = floem_file
    r = desk.post("/publish/login", headers=td.H, json={"server_url": live_server, "email": YON[0], "password": "yanlis"})
    assert r.status_code == 400 and r.json()["error"]["message"] == "E-posta adresi ya da şifre hatalı"
    r = desk.post("/publish/login", headers=td.H, json={"server_url": live_server + "/", "email": YON[0], "password": YON[1]})
    assert r.status_code == 200, r.text
    assert r.json()["workspaces"][0]["name"] == "Satış Ekibi"
    assert desk.get("/publish/session", headers=td.H).json()["logged_in"] is True

    # kaydedilmemiş değişiklik varken yayımlanmaz (Power BI'daki gibi)
    td.ops(desk, {"op": "update_table", "table": "OSLP", "gizli": True})
    r = desk.post("/publish", headers=td.H, json={"workspace_id": 1})
    assert r.status_code == 400 and r.json()["error"]["code"] == "save_required"
    desk.post("/document/save", headers=td.H, json={})
    r = desk.post("/publish", headers=td.H, json={"workspace_id": 1})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Satış Raporu" and r.json()["url"].startswith(live_server)

    # izleyici: sunucunun yetki mesajı Desktop'ta okunur şekilde görünür
    desk.post("/publish/login", headers=td.H, json={"server_url": live_server, "email": IZL[0], "password": IZL[1]})
    r = desk.post("/publish", headers=td.H, json={"workspace_id": 1})
    assert r.status_code == 400 and r.json()["error"]["code"] == "forbidden"
    assert "yayımlama yetkiniz yok" in r.json()["error"]["message"]


def test_desktop_publish_unreachable(floem_file):
    r = floem_file.post("/publish/login", headers=td.H, json={"server_url": "http://127.0.0.1:1", "email": YON[0], "password": "x"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "publish_unreachable"
    assert floem_file.post("/publish", headers=td.H, json={"workspace_id": 1}).json()["error"]["code"] in ("publish_unauthorized",)
