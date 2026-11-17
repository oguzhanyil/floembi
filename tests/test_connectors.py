"""Bağlayıcı ve Desktop servisi testleri.

Gerçek SQL Server testleri yalnızca ortam değişkenleri verilirse çalışır:
  FLOEM_TEST_MSSQL_SERVER, FLOEM_TEST_MSSQL_USER, FLOEM_TEST_MSSQL_PASSWORD
  (isteğe bağlı) FLOEM_TEST_MSSQL_DATABASE
"""

import os

import pytest
from fastapi.testclient import TestClient

from floem_bi.connectors import ColumnInfo, ConnectionSpec, ConnectorError, DbObject, ResultSet, ensure_read_only
from floem_bi.desktop_service import create_app
from floem_bi.desktop_service.connections import ConnectionStore

TOKEN = "t" * 32


# ------------------------------------------------------------- SQL koruması
@pytest.mark.parametrize("sql", [
    "SELECT TOP 10 * FROM OINV",
    "select a, b from dbo.T where x = 1;",
    "WITH c AS (SELECT 1 AS x) SELECT x FROM c",
    "SELECT 1 UNION ALL SELECT 2",
    "SELECT * FROM [Sales Table] t JOIN OCRD c ON c.CardCode = t.CardCode -- yorum",
])
def test_select_allowed(sql):
    assert ensure_read_only(sql)


@pytest.mark.parametrize("sql,code", [
    ("DELETE FROM OINV", "not_read_only"),
    ("UPDATE OINV SET DocTotal = 0", "not_read_only"),
    ("INSERT INTO T VALUES (1)", "not_read_only"),
    ("DROP TABLE OINV", "not_read_only"),
    ("SELECT * INTO yedek FROM OINV", "not_read_only"),
    ("EXEC sp_who", "not_read_only"),
    ("SELECT 1; DELETE FROM OINV", "multi_statement"),
    ("TRUNCATE TABLE OINV", "not_read_only"),
    ("   ", "empty_query"),
])
def test_writes_rejected(sql, code):
    with pytest.raises(ConnectorError) as ei:
        ensure_read_only(sql)
    assert ei.value.code == code


# ---------------------------------------------------------- sahte bağlayıcı
class FakeConnector:
    def __init__(self, spec: ConnectionSpec):
        self.spec = spec

    def test(self):
        if self.spec.password != "dogru":
            raise ConnectorError(f"'{self.spec.user}' kullanıcısıyla oturum açılamadı: kullanıcı adı veya şifre hatalı",
                                 "Login failed for user", "login_failed")
        return {"version": "16.0", "edition": "Developer", "database": "master", "login": self.spec.user}

    def list_databases(self):
        return ["SBO_DEMO", "Muhasebe"]

    def list_objects(self, database):
        return [DbObject("dbo", "OINV", "TABLE", 1200), DbObject("dbo", "vSatis", "VIEW", None)]

    def columns(self, database, schema, table):
        return [ColumnInfo("DocEntry", "int", False, is_primary_key=True), ColumnInfo("DocTotal", "numeric", True)]

    def foreign_keys(self, database):
        return []

    def preview(self, database, schema, table, limit=200):
        return ResultSet([ColumnInfo("DocEntry", "int", False)], [[1], [2]])

    def run_query(self, database, sql, limit=1000, timeout=60):
        ensure_read_only(sql)
        return ResultSet([ColumnInfo("x", "integer", True)], [[i] for i in range(limit)], truncated=True)


@pytest.fixture
def client(tmp_path):
    store = ConnectionStore(tmp_path, use_keyring=False)
    return TestClient(create_app(TOKEN, store=store, connector_factory=FakeConnector, work_dir=tmp_path / "work"))


def H():
    return {"X-Floem-Token": TOKEN}


def test_token_required(client):
    assert client.get("/connections").status_code == 401
    assert client.get("/connections", headers={"X-Floem-Token": "yanlis"}).status_code == 401
    assert client.get("/health").status_code == 200


def test_connect_navigate_and_query(client):
    r = client.post("/connections", headers=H(), json={"server": "SUNUCU\\SQL2019", "user": "okuyucu", "password": "dogru"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["databases"] == ["SBO_DEMO", "Muhasebe"]
    assert "password" not in body
    cid = body["id"]

    objs = client.get(f"/connections/{cid}/objects", params={"database": "SBO_DEMO"}, headers=H()).json()
    assert {o["name"] for o in objs} == {"OINV", "vSatis"}
    prev = client.get(f"/connections/{cid}/preview", params={"database": "SBO_DEMO", "schema": "dbo", "table": "OINV"}, headers=H()).json()
    assert prev["rows"] == [[1], [2]]

    q = client.post(f"/connections/{cid}/sql", headers=H(), json={"database": "SBO_DEMO", "sql": "SELECT 1", "limit": 5}).json()
    assert q["row_count"] == 5 and q["truncated"] is True

    bad = client.post(f"/connections/{cid}/sql", headers=H(), json={"sql": "DELETE FROM OINV"})
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "not_read_only"


def test_login_failure_is_readable(client):
    r = client.post("/connections", headers=H(), json={"server": "S", "user": "okuyucu", "password": "yanlis"})
    assert r.status_code == 400
    err = r.json()["error"]
    assert err["code"] == "login_failed"
    assert "şifre hatalı" in err["message"] and "Login failed" in err["detail"]


def test_connection_list_has_no_password(client, tmp_path):
    client.post("/connections", headers=H(), json={"server": "S", "user": "u", "password": "dogru"})
    listed = client.get("/connections", headers=H()).json()
    assert len(listed) == 1 and "password" not in listed[0]
    assert "dogru" not in (tmp_path / "connections.json").read_text(encoding="utf-8")


# ------------------------------------------------- gerçek SQL Server (isteğe bağlı)
MSSQL = os.environ.get("FLOEM_TEST_MSSQL_SERVER")


@pytest.mark.skipif(not MSSQL, reason="FLOEM_TEST_MSSQL_SERVER verilmedi")
def test_real_sqlserver_roundtrip():
    from floem_bi.connectors.sqlserver import SqlServerConnector

    spec = ConnectionSpec(
        "sqlserver", MSSQL, os.environ.get("FLOEM_TEST_MSSQL_DATABASE"),
        user=os.environ.get("FLOEM_TEST_MSSQL_USER"), password=os.environ.get("FLOEM_TEST_MSSQL_PASSWORD"),
    )
    c = SqlServerConnector(spec)
    assert c.test()["version"]
    rs = c.run_query(None, "SELECT TOP 3 name, create_date FROM sys.objects", limit=2)
    assert len(rs.rows) <= 2
    with pytest.raises(ConnectorError):
        c.run_query(None, "DELETE FROM sys.objects")
