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


# ------------------------------------------------------------------ e-postayla paylaşım (H6)
def test_share_by_email_outbox(server, floem_file):
    hy = login(server, YON)
    rid = publish(server, hy, floem_file.path).json()["report_id"]
    hi = login(server, IZL)
    # izleyici paylaşamaz, erişim listesini göremez
    assert server.post(f"/api/reports/{rid}/share", headers=hi, json={"emails": ["x@y.z"]}).status_code == 403
    r = server.post(f"/api/reports/{rid}/share", headers=hy, json={
        "emails": ["Izleyici@floembi.test", "yok@floembi.test", "bozuk", "yonetici@floembi.test"],
        "message": "Ocak rakamlarına <b>bakar mısın?</b>",
    })
    assert r.status_code == 200, r.text
    res = {x["email"]: x for x in r.json()["results"]}
    assert res["izleyici@floembi.test"]["status"] == "shared" and res["izleyici@floembi.test"]["mail"] == "outbox"
    # hesabı olmayan adres: davet gider, paylaşım bekletilir
    assert res["yok@floembi.test"]["status"] == "invited" and res["yok@floembi.test"]["mail"] == "outbox"
    assert res["bozuk"]["status"] == "invalid" and res["yonetici@floembi.test"]["status"] == "self"
    assert r.json()["mail_mode"] == "outbox"
    # izleyici artık raporu görüyor ve e-postayı gelen kutusunda okuyabiliyor
    rep = server.get(f"/api/reports/{rid}", headers=hi).json()
    assert rep["role"] == "viewer" and rep["can_share"] is False
    assert server.get("/api/shared-with-me", headers=hi).json()[0]["id"] == rid
    inbox = server.get("/api/mail/inbox", headers=hi).json()["items"]
    assert len(inbox) == 1 and inbox[0]["incoming"] and "Satış Raporu" in inbox[0]["subject"]
    msg = server.get(f"/api/mail/inbox/{inbox[0]['id']}", headers=hi).json()
    assert f"/reports/{rid}" in msg["html"] and "&lt;b&gt;bakar mısın?&lt;/b&gt;" in msg["html"]   # mesaj kaçışlı
    assert "Yönetici Kullanıcı (floembi.app)" in msg["from"]
    # tekrar paylaşım: zaten paylaşılmış, e-posta yine gider; notify=false ile gitmez
    r = server.post(f"/api/reports/{rid}/share", headers=hy, json={"emails": ["izleyici@floembi.test"], "notify": False})
    assert r.json()["results"][0]["status"] == "already" and r.json()["results"][0]["mail"] == "skipped"
    acc = server.get(f"/api/reports/{rid}/access", headers=hy).json()
    assert [s["email"] for s in acc["shares"]] == ["izleyici@floembi.test"]
    assert acc["members"][0]["role"] == "admin"
    assert server.get(f"/api/reports/{rid}/access", headers=hi).status_code == 403
    # başkası e-postayı okuyamaz; erişim kaldırılınca rapor kapanır
    assert server.get(f"/api/mail/inbox/{inbox[0]['id']}", headers=login(server, YON)).status_code == 200  # gönderen
    assert server.delete(f"/api/reports/{rid}/share/2", headers=hy).status_code == 200
    assert server.get(f"/api/reports/{rid}", headers=hi).status_code == 403


def test_share_smtp_failure_is_readable(tmp_path, floem_file, monkeypatch):
    from floem_bi.server.mail import MailSettings, SmtpSettings
    settings = ServerSettings(data_dir=tmp_path / "srv2", secret="s" * 48,
                              mail=MailSettings(smtp=SmtpSettings(host="127.0.0.1", port=1, security="none", timeout=2)))
    server = TestClient(create_server(settings))
    hy = login(server, YON)
    rid = publish(server, hy, floem_file.path).json()["report_id"]
    r = server.post(f"/api/reports/{rid}/share", headers=hy, json={"emails": ["izleyici@floembi.test"]}).json()
    item = r["results"][0]
    assert item["status"] == "shared"                 # erişim verildi, yalnızca e-posta gitmedi
    assert item["mail"] == "failed" and "127.0.0.1:1" in item["mail_error"]
    log = server.get("/api/mail/inbox", headers=hy).json()["items"][0]
    assert log["status"] == "failed" and "127.0.0.1:1" in log["error"]   # reddedildi ya da zaman aşımı (Windows)


def test_smtp_send_uses_starttls_and_login(monkeypatch, tmp_path):
    from floem_bi.server import mail as m
    calls = []

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            calls.append(("connect", host, port))
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
        def starttls(self, context):
            calls.append(("starttls",))
        def login(self, u, p):
            calls.append(("login", u))
        def send_message(self, msg):
            calls.append(("send", msg["To"], msg["Subject"]))

    monkeypatch.setattr(m.smtplib, "SMTP", FakeSMTP)
    s = m.MailSettings(smtp=m.SmtpSettings(host="smtp.sirket.local", port=587, user="bi", password="gizli"))
    status, path = m.send(s, m.share_mail(to="a@b.c", sender_name="Ayşe", report_name="R", workspace="W",
                                          url="http://x/reports/1", message=None), tmp_path)
    assert status == "sent" and path is None
    assert calls == [("connect", "smtp.sirket.local", 587), ("starttls",), ("login", "bi"), ("send", "a@b.c", "Ayşe sizinle 'R' raporunu paylaştı")]


# ------------------------------------------------------------------ yönetim: e-posta sunucusu ve yetkilendirme
class FakeSMTP:
    calls: list = []

    def __init__(self, host, port, timeout):
        FakeSMTP.calls.append(("connect", host, port))
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False
    def starttls(self, context):
        FakeSMTP.calls.append(("starttls",))
    def login(self, u, p):
        FakeSMTP.calls.append(("login", u, p))
    def send_message(self, msg):
        FakeSMTP.calls.append(("send", msg["To"], msg["From"]))


SMTP_CFG = {"enabled": True, "host": "smtp.sirket.local", "port": 587, "security": "starttls",
            "username": "bi@sirket.local", "password": "Gizli.Sifre-1", "from_address": "bi@sirket.local",
            "from_name": "Şirket BI"}


def test_admin_mail_config(server, monkeypatch):
    from floem_bi.server import mail as m
    hy, hi = login(server, YON), login(server, IZL)
    assert server.get("/api/me", headers=hy).json()["is_admin"] is True
    assert server.get("/api/me", headers=hi).json()["is_admin"] is False
    assert server.get("/api/admin/mail", headers=hi).status_code == 403
    assert server.get("/api/admin/mail", headers=hy).json()["source"] == "outbox"
    # eksik alan okunur hata verir
    r = server.put("/api/admin/mail", headers=hy, json={**SMTP_CFG, "host": ""})
    assert r.status_code == 400 and "SMTP sunucusu" in r.json()["error"]["message"]
    r = server.put("/api/admin/mail", headers=hy, json=SMTP_CFG)
    assert r.status_code == 200, r.text
    view = r.json()
    assert view["source"] == "screen" and view["config"]["has_password"] and "password" not in view["config"]
    assert "Gizli.Sifre-1" not in r.text
    # şifre veritabanında açık metin değil
    with server.app_.state.db.connect() as c:
        enc = c.execute(db.mail_config.select()).first().password_enc
    assert enc and "Gizli" not in enc
    # şifre alanı boş gönderilince kayıtlı şifre korunur; test e-postası onu kullanır
    FakeSMTP.calls = []
    monkeypatch.setattr(m.smtplib, "SMTP", FakeSMTP)
    r = server.post("/api/admin/mail/test", headers=hy, json={**SMTP_CFG, "password": None}).json()
    assert r["status"] == "sent" and r["to"] == "yonetici@floembi.test"
    assert ("login", "bi@sirket.local", "Gizli.Sifre-1") in FakeSMTP.calls
    assert server.get("/api/me", headers=hy).json()["mail_mode"] == "smtp"
    # SMTP'ye ulaşılamazsa test sonucu okunur
    monkeypatch.undo()
    r = server.post("/api/admin/mail/test", headers=hy, json={**SMTP_CFG, "host": "127.0.0.1", "port": 1,
                                                              "security": "none"}).json()
    assert r["status"] == "failed" and "127.0.0.1:1" in r["error"]
    # kapatınca giden kutusuna döner, kayıtlı şifre silinmez
    view = server.put("/api/admin/mail", headers=hy, json={**SMTP_CFG, "enabled": False, "password": None}).json()
    assert view["source"] == "outbox" and view["config"]["has_password"]


def _invite_token(server, headers, email):
    import re
    items = [i for i in server.get("/api/mail/inbox", headers=headers).json()["items"] if i["to"] == email]
    html = server.get(f"/api/mail/inbox/{items[0]['id']}", headers=headers).json()["html"]
    return re.search(r"/invite/([A-Za-z0-9_\-]+)", html).group(1)


def test_grant_and_invite_flow(server, floem_file):
    hy, hi = login(server, YON), login(server, IZL)
    assert server.get("/api/admin/users", headers=hi).status_code == 403
    r = server.post("/api/admin/users/grant", headers=hy, json={
        "emails": ["Yeni.Kisi@sirket.com", "izleyici@floembi.test", "bozuk"], "workspace_id": 1, "role": "member"})
    assert r.status_code == 200, r.text
    res = {x["email"]: x for x in r.json()["results"]}
    assert res["yeni.kisi@sirket.com"]["status"] == "invited" and res["yeni.kisi@sirket.com"]["mail"] == "outbox"
    assert res["izleyici@floembi.test"]["status"] == "granted" and res["izleyici@floembi.test"]["mail"] == "outbox"
    assert res["bozuk"]["status"] == "invalid"
    # izleyici artık çalışma alanı Üyesi ve "erişim verildi" e-postası aldı
    assert server.get("/api/me", headers=hi).json()["workspaces"][0]["role"] == "member"
    assert "erişim verdi" in server.get("/api/mail/inbox", headers=hi).json()["items"][0]["subject"]
    users = server.get("/api/admin/users", headers=hy).json()
    assert users["invitations"][0]["email"] == "yeni.kisi@sirket.com"
    assert users["invitations"][0]["grants"] == ["Satış Ekibi çalışma alanı: Üye"]
    # ayrıca bir rapor paylaşılır: davet tek, yetkiler birikir
    rid = publish(server, hy, floem_file.path).json()["report_id"]
    old = _invite_token(server, hy, "yeni.kisi@sirket.com")
    server.post(f"/api/reports/{rid}/share", headers=hy, json={"emails": ["yeni.kisi@sirket.com"]})
    token = _invite_token(server, hy, "yeni.kisi@sirket.com")
    assert token != old and server.get(f"/api/invitations/{old}").status_code == 404   # yenisi eskisini geçersiz kılar
    inv = server.get(f"/api/invitations/{token}").json()
    assert inv["email"] == "yeni.kisi@sirket.com" and inv["inviter"] == "Yönetici Kullanıcı" and len(inv["grants"]) == 2
    # kısa şifre reddedilir; kabul edince hesap açılır, oturum döner
    assert server.post(f"/api/invitations/{token}/accept", json={"name": "Yeni", "password": "kisa"}).status_code == 422
    r = server.post(f"/api/invitations/{token}/accept", json={"name": "Yeni Kişi", "password": "Uzun.Sifre1"})
    assert r.status_code == 200, r.text
    hn = {"Authorization": f"Bearer {r.json()['token']}"}
    me = server.get("/api/me", headers=hn).json()
    assert me["name"] == "Yeni Kişi" and me["workspaces"][0]["role"] == "member" and me["is_admin"] is False
    assert server.get(f"/api/reports/{rid}", headers=hn).status_code == 200
    # bağlantı ikinci kez kullanılamaz; artık şifresiyle giriş yapar
    assert server.post(f"/api/invitations/{token}/accept", json={"name": "X", "password": "Uzun.Sifre1"}).status_code == 404
    assert server.post("/api/auth/login", json={"email": "yeni.kisi@sirket.com", "password": "Uzun.Sifre1"}).status_code == 200
    assert server.get("/api/admin/users", headers=hy).json()["invitations"] == []


def test_admin_guards(server):
    hy = login(server, YON)
    # son Yönetici çıkarılamaz / rolü düşürülemez; kendi sistem yöneticiliğini kaldıramaz
    r = server.delete("/api/admin/users/1/workspaces/1", headers=hy)
    assert r.status_code == 400 and r.json()["error"]["code"] == "last_admin"
    assert server.put("/api/admin/users/1/workspaces/1", headers=hy, json={"role": "viewer"}).status_code == 400
    assert server.put("/api/admin/users/1/admin", headers=hy, json={"is_admin": False}).status_code == 400
    # iptal edilen davet ve bekleyen yetkiler silinir
    server.post("/api/admin/users/grant", headers=hy, json={"emails": ["a@b.co"], "workspace_id": 1})
    inv = server.get("/api/admin/users", headers=hy).json()["invitations"][0]
    token = _invite_token(server, hy, "a@b.co")
    assert server.delete(f"/api/admin/invitations/{inv['id']}", headers=hy).status_code == 200
    assert server.get(f"/api/invitations/{token}").status_code == 404
    with server.app_.state.db.connect() as c:
        assert c.execute(db.pending_grants.select()).all() == []
    # süresi dolmuş davet geçersiz
    server.post("/api/admin/users/grant", headers=hy, json={"emails": ["c@d.co"], "workspace_id": 1})
    token = _invite_token(server, hy, "c@d.co")
    from datetime import timedelta
    with server.app_.state.db.begin() as c:
        c.execute(db.invitations.update().values(expires_at=db.now() - timedelta(minutes=1)))
    r = server.get(f"/api/invitations/{token}")
    assert r.status_code == 404 and r.json()["error"]["code"] == "invite_invalid"


def test_old_database_gets_admin_column(tmp_path):
    """is_admin sütunu olmayan eski metadata veritabanı açılınca taşınır; çalışma alanı Yöneticileri yönetici olur."""
    import sqlite3
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.executescript("""
        CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(254) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL,
                            password_hash VARCHAR(255) NOT NULL, created_at DATETIME NOT NULL);
        CREATE TABLE workspaces (id INTEGER PRIMARY KEY, name VARCHAR(120) NOT NULL UNIQUE, created_at DATETIME NOT NULL);
        CREATE TABLE members (workspace_id INTEGER, user_id INTEGER, role VARCHAR(16) NOT NULL,
                              PRIMARY KEY (workspace_id, user_id));
        INSERT INTO users VALUES (1, 'a@x.co', 'A', 'h', '2026-01-01'), (2, 'b@x.co', 'B', 'h', '2026-01-01');
        INSERT INTO workspaces VALUES (1, 'W', '2026-01-01');
        INSERT INTO members VALUES (1, 1, 'admin'), (1, 2, 'viewer');
    """)
    con.commit()
    con.close()
    eng = db.make_engine(f"sqlite:///{path.as_posix()}")
    with eng.connect() as c:
        assert [tuple(r) for r in c.execute(db.users.select().with_only_columns(db.users.c.id, db.users.c.is_admin)
                                             .order_by(db.users.c.id))] == [(1, True), (2, False)]
    eng.dispose()


def test_smtp_errors_are_explained(monkeypatch, tmp_path):
    """Gmail yanlış girişte bağlantıyı açıklamasız keser; mesaj adıma göre anlaşılır olmalı."""
    import smtplib
    from floem_bi.server import mail as m

    class Drop(FakeSMTP):
        def login(self, u, p):
            raise smtplib.SMTPServerDisconnected("Connection unexpectedly closed")

    monkeypatch.setattr(m.smtplib, "SMTP", Drop)
    s = m.MailSettings(smtp=m.SmtpSettings(host="smtp.gmail.com", port=587, user="kisi", password="x"))
    mail = m.test_mail(to="a@b.co", by="A", url="http://x", server="s")
    try:
        m.send(s, mail, tmp_path)
        raise AssertionError("hata bekleniyordu")
    except m.MailError as e:
        assert "girişi reddetti" in e.message and "uygulama şifresi" in e.message

    def refused(*a, **k):
        raise ConnectionRefusedError(10061, "Hedef makine etkin olarak reddetti")

    monkeypatch.setattr(m.smtplib, "SMTP", refused)
    s = m.MailSettings(smtp=m.SmtpSettings(host="127.0.0.1", port=1, security="none", timeout=2))
    try:
        m.send(s, mail, tmp_path)
        raise AssertionError("hata bekleniyordu")
    except m.MailError as e:
        assert "çalışan bir e-posta sunucusu yok (127.0.0.1:1)" in e.message


def test_mail_config_hints_and_last_attempt(server, monkeypatch):
    from floem_bi.server import mail as m
    hy = login(server, YON)
    # Gmail'de kullanıcı adı tam adres değilse kaydetmeden ve test etmeden önce uyarır
    bad = {**SMTP_CFG, "host": "smtp.gmail.com", "username": "kisi"}
    r = server.put("/api/admin/mail", headers=hy, json=bad)
    assert r.status_code == 400 and "tam e-posta adresi" in r.json()["error"]["message"]
    assert server.post("/api/admin/mail/test", headers=hy, json=bad).status_code == 400
    # kaydedilince henüz deneme yok; başarısız ve başarılı deneme banda yansır
    assert server.put("/api/admin/mail", headers=hy, json=SMTP_CFG).json()["last_attempt"] is None

    class Refuse(FakeSMTP):
        def login(self, u, p):
            raise m.smtplib.SMTPAuthenticationError(535, b"bad credentials")

    monkeypatch.setattr(m.smtplib, "SMTP", Refuse)
    server.post("/api/admin/mail/test", headers=hy, json={**SMTP_CFG, "password": None})
    last = server.get("/api/admin/mail", headers=hy).json()["last_attempt"]
    assert last["status"] == "failed" and last["kind"] == "test" and "girişi reddetti" in last["error"]
    monkeypatch.setattr(m.smtplib, "SMTP", FakeSMTP)
    server.post("/api/admin/mail/test", headers=hy, json={**SMTP_CFG, "password": None})
    last = server.get("/api/admin/mail", headers=hy).json()["last_attempt"]
    assert last["status"] == "sent" and last["error"] is None
