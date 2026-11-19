"""Pilotun Cloudflare kurulumunda başka tünel ve DNS kayıtları korunur."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from floem_bi.server import cloudflare_pilot, pilot_config
from floem_bi.server import ServerSettings, create_server
from floem_bi.server.pilot import bootstrap, change_admin_password
from floem_bi.desktop_service.publish import PublishClient
from floem_bi.document import DocumentError


def test_cloudflare_provision_isolated_and_repeatable(monkeypatch):
    calls = []
    saved = []
    monkeypatch.setattr(cloudflare_pilot, "_pilot_ready", lambda: None)
    monkeypatch.setattr(cloudflare_pilot, "_certificate", lambda: {
        "accountID": "account", "zoneID": "zone", "apiToken": "private",
    })
    monkeypatch.setattr(pilot_config, "save_tunnel_token", saved.append)
    tunnel = None
    dns = []

    def api(_cert, method, path, body=None):
        nonlocal tunnel, dns
        calls.append((method, path, body))
        if path == "/zones/zone":
            return {"name": "floemdata.com"}
        if path.startswith("/zones/zone/dns_records?"):
            return dns
        if path == "/accounts/account/cfd_tunnel?is_deleted=false":
            return ([{"id": "other", "name": "sapb1-asistan", "config_src": "local"}] +
                    ([tunnel] if tunnel else []))
        if path == "/accounts/account/cfd_tunnel" and method == "POST":
            tunnel = {"id": "pilot-id", "name": body["name"], "config_src": body["config_src"]}
            return tunnel
        if path.endswith("/configurations"):
            assert body["config"]["ingress"] == [
                {"hostname": "bi.floemdata.com", "service": "http://127.0.0.1:8811"},
                {"service": "http_status:404"},
            ]
            return {}
        if path == "/zones/zone/dns_records" and method == "POST":
            dns = [body]
            return body
        if path.endswith("/token"):
            return "t" * 40
        raise AssertionError((method, path))

    monkeypatch.setattr(cloudflare_pilot, "_api", api)
    assert cloudflare_pilot.provision() == "pilot-id"
    assert cloudflare_pilot.provision() == "pilot-id"
    assert len([c for c in calls if c[0] == "POST" and c[1] == "/accounts/account/cfd_tunnel"]) == 1
    assert len([c for c in calls if c[0] == "POST" and c[1] == "/zones/zone/dns_records"]) == 1
    assert saved == ["t" * 40, "t" * 40]


def test_cloudflare_provision_refuses_existing_hostname(monkeypatch):
    monkeypatch.setattr(cloudflare_pilot, "_pilot_ready", lambda: None)
    monkeypatch.setattr(cloudflare_pilot, "_certificate", lambda: {
        "accountID": "account", "zoneID": "zone", "apiToken": "private",
    })

    def api(_cert, _method, path, _body=None):
        if path == "/zones/zone":
            return {"name": "floemdata.com"}
        if path.startswith("/zones/zone/dns_records?"):
            return [{"type": "A", "name": "bi.floemdata.com", "content": "192.0.2.1"}]
        if path == "/accounts/account/cfd_tunnel?is_deleted=false":
            return []
        raise AssertionError("Çakışan DNS kaydı değiştirilmemeli")

    monkeypatch.setattr(cloudflare_pilot, "_api", api)
    with pytest.raises(RuntimeError, match="başka bir hedefte"):
        cloudflare_pilot.provision()


def test_pilot_admin_password_rotation(tmp_path, monkeypatch):
    directory = tmp_path / "pilot"
    secrets = {}
    temp = {pilot_config.TEMP_ADMIN_PASSWORD_NAME: "temporary"}
    monkeypatch.setattr(pilot_config, "server_secret", lambda path: secrets.get(str(path)))
    monkeypatch.setattr(pilot_config, "save_server_secret", lambda path, value: secrets.__setitem__(str(path), value))
    monkeypatch.setattr("floem_bi.server.pilot.keyring.get_password", lambda _service, name: temp.get(name))
    monkeypatch.setattr("floem_bi.server.pilot.keyring.delete_password", lambda _service, name: temp.pop(name))
    with pytest.raises(ValueError, match="8-200"):
        bootstrap(directory, "admin@floemdata.com", "Yönetici", "1234567")
    bootstrap(directory, "admin@floemdata.com", "Yönetici", "Abc12345")
    with pytest.raises(ValueError, match="8-200"):
        change_admin_password(directory, "1234567")
    change_admin_password(directory, "Sifre123")
    assert pilot_config.TEMP_ADMIN_PASSWORD_NAME not in temp
    app = TestClient(create_server(ServerSettings(data_dir=directory, secret=secrets[str(directory)],
                                                 seed_users=False, pilot=True)))
    assert app.post("/api/auth/login", json={"email": "admin@floemdata.com",
                                               "password": "Abc12345"}).status_code == 401
    assert app.post("/api/auth/login", json={"email": "admin@floemdata.com",
                                               "password": "Sifre123"}).status_code == 200
    for _ in range(10):
        assert app.post("/api/auth/login", json={"email": "admin@floemdata.com",
                                                   "password": "yanlis"}).status_code == 401
    assert app.post("/api/auth/login", json={"email": "admin@floemdata.com",
                                               "password": "Sifre123"}).status_code == 429


def test_pilot_refuses_development_users(tmp_path):
    directory = tmp_path / "development"
    create_server(ServerSettings(data_dir=directory, secret="s" * 48))
    with pytest.raises(RuntimeError, match="geliştirme hesabı"):
        create_server(ServerSettings(data_dir=directory, secret="p" * 48, seed_users=False, pilot=True))


def test_pilot_upload_limit_is_checked_before_network(tmp_path, monkeypatch):
    file = tmp_path / "report.floem"
    file.write_bytes(b"small")
    client = PublishClient(tmp_path)
    client.server_url = pilot_config.PILOT_URL
    client.token = "session"
    monkeypatch.setattr(client, "gateways", lambda _workspace: [])
    monkeypatch.setattr(os.path, "getsize", lambda _path: 100_000_001)
    with pytest.raises(DocumentError, match="100 MB"):
        client.publish(1, str(file))
