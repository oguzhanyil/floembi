from datetime import datetime, timedelta, timezone
from time import monotonic, sleep

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select

from floem_bi.server import create_server, db
from floem_bi.server.schedule import RefreshSchedule
from test_server import IZL, YON, floem_file, login, publish, server


def test_local_time_gaps_and_repeated_hours():
    daily = RefreshSchedule(enabled=True, timezone="America/New_York", times=["02:30"])
    assert daily.after(datetime(2026, 3, 8, 5, tzinfo=timezone.utc)) == datetime(2026, 3, 9, 6, 30, tzinfo=timezone.utc)
    daily = RefreshSchedule(enabled=True, timezone="America/New_York", times=["01:30"])
    assert daily.after(datetime(2026, 11, 1, 5, 30, tzinfo=timezone.utc)) == datetime(2026, 11, 2, 6, 30, tzinfo=timezone.utc)
    for args in [{"timezone": "../x"}, {"times": ["24:00"]}, {"enabled": True}]:
        with pytest.raises(ValidationError):
            RefreshSchedule(**args)


def test_schedule_recovery_history_and_owner_mail(server, floem_file):
    admin = login(server, YON)
    viewer = login(server, IZL)
    dsid = publish(server, admin, floem_file.path).json()["dataset_id"]
    endpoint = f"/api/datasets/{dsid}/schedule"
    schedule = {"enabled": True, "times": ["18:00", "08:30", "08:30"], "timezone": "Europe/Istanbul"}
    assert server.put(endpoint, headers=viewer, json=schedule).status_code == 403
    assert server.get(endpoint, headers=viewer).status_code == 403
    assert server.put(endpoint, headers=admin, json={**schedule, "timezone": "invalid"}).status_code == 422
    saved = server.put(endpoint, headers=admin, json=schedule).json()
    assert saved["next_run"] and saved["times"] == ["08:30", "18:00"]
    with server.app.state.db.begin() as c:
        c.execute(db.refresh_schedules.update().values(next_run=db.now() - timedelta(days=2)))
    settings = server.app.state.settings
    for _ in range(2):
        with TestClient(create_server(settings)) as restarted:
            until = monotonic() + 8
            while monotonic() < until:
                inbox = restarted.get("/api/mail/inbox", headers=admin).json()["items"]
                if inbox:
                    break
                sleep(.05)
            assert len(inbox) == 1
            history = restarted.get(f"/api/datasets/{dsid}/refreshes", headers=admin).json()
            assert len(history) == 1 and history[0]["trigger"] == "scheduled" and history[0]["stage"] == "Eşleme"
            assert inbox[0]["status"] == "outbox"
            mail = restarted.get(f"/api/mail/inbox/{inbox[0]['id']}", headers=admin).json()
            assert f"/datasets/{dsid}/history" in mail["html"] and "Eşleme" in mail["text"]
    assert server.put(endpoint, headers=admin, json={**schedule, "enabled": False}).json()["next_run"] is None


def test_refresh_mail_failure_keeps_result(server, floem_file, monkeypatch):
    from floem_bi.server import app, mail
    def refused(*args):
        raise mail.MailError("Deneme sunucusu kapalı")
    monkeypatch.setattr(app, "send", refused)
    h = login(server, YON)
    dsid = publish(server, h, floem_file.path).json()["dataset_id"]
    result = server.post(f"/api/datasets/{dsid}/refresh", headers=h).json()
    assert result["status"] == "failed" and result["stage"] == "Eşleme"
    with server.app.state.db.connect() as c:
        item = c.execute(select(db.mail_log)).one()
        assert item.to_email == YON[0] and item.status == "failed" and "kapalı" in item.error


def test_scheduled_job_waits_for_manual_gateway_job(server, floem_file):
    from test_gateway import connect_gateway, setup_gateway
    admin = login(server, YON)
    dsid = publish(server, admin, floem_file.path).json()["dataset_id"]
    gateway, key = setup_gateway(server, admin, dsid)
    settings = server.app.state.settings
    settings.schedule_interval = .1
    with TestClient(create_server(settings)) as app, connect_gateway(app, gateway, key, admin) as ws:
        base = f"/api/datasets/{dsid}"
        app.post(base + "/refresh", headers=admin)
        manual = ws.receive_json()
        app.put(base + "/schedule", headers=admin, json={"enabled": True, "times": ["12:00"]})
        with app.app.state.db.begin() as c:
            c.execute(db.refresh_schedules.update().values(next_run=db.now() - timedelta(minutes=1)))
        until = monotonic() + 5
        while monotonic() < until:
            rows = app.get(base + "/refreshes", headers=admin).json()
            if len(rows) == 2:
                break
            sleep(.05)
        assert len(rows) == 2 and rows[0]["status"] == "queued" and rows[0]["trigger"] == "scheduled"
        ws.send_json({"type": "error", "run_id": manual["run_id"], "message": "Deneme hatası"})
        queued = ws.receive_json()
        assert queued["run_id"] == rows[0]["id"] != manual["run_id"]
        ws.send_json({"type": "error", "run_id": queued["run_id"], "message": "Deneme sonu"})
