import pytest
from fastapi.testclient import TestClient

from floem_bi.api.app import create_app

from .conftest import MODEL_PATH


@pytest.fixture(scope="module")
def client(demo_db):
    return TestClient(create_app(str(MODEL_PATH), str(demo_db)))


def test_model_endpoint(client):
    body = client.get("/model").json()
    names = {t["ad"] for t in body["tablolar"]}
    assert {"Satis", "Musteri", "Urun", "Temsilci", "Tarih"} <= names


def test_query_endpoint(client):
    r = client.post("/query", json={
        "group_by": ["Tarih[Yil]"],
        "measures": ["Toplam Satış", "Geçen Yıl Satış"],
        "filters": [{"column": "Musteri[Grup]", "op": "in", "values": ["Bayi"]}],
        "order_by": [{"name": "Tarih[Yil]", "desc": True}],
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["columns"] == ["Tarih[Yil]", "Toplam Satış", "Geçen Yıl Satış"]
    years = [row[0] for row in body["rows"]]
    assert years == sorted(years, reverse=True)
    assert "WITH" in body["sql"]


def test_compile_tsql(client):
    r = client.post("/compile", json={"group_by": ["Urun[Kategori]"], "measures": ["Kategori Payı"], "dialect": "tsql"})
    assert r.status_code == 200
    assert r.json()["dialect"] == "tsql"


def test_bad_request_is_400(client):
    r = client.post("/query", json={"measures": ["Olmayan Ölçü"]})
    assert r.status_code == 400
    assert "Ölçü bulunamadı" in r.json()["detail"]


def test_dax_validate(client):
    ok = client.post("/dax/validate", json={"expression": "SUM(Satis[Tutar]) * 2"}).json()
    assert ok == {"ok": True, "errors": []}
    bad = client.post("/dax/validate", json={"expression": "SUM(Satis[Tutar]"}).json()
    assert bad["ok"] is False and bad["errors"][0]["start"] == len("SUM(Satis[Tutar]")
    sem = client.post("/dax/validate", json={"expression": "SUM(Satis[Olmayan])"}).json()
    assert sem["ok"] is False and "Sütun bulunamadı" in sem["errors"][0]["message"]
