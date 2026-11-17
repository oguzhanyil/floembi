"""Rapor tanımı ve görsel sorguları (Desktop yerel servisi üzerinden)."""

from __future__ import annotations

import pytest

from test_document import ALL, H, client, do_import, doc, ops  # noqa: F401  (client fixture)


def q(client, **body):
    return client.post("/document/query", headers=H, json=body)


@pytest.fixture
def sap(client):
    do_import(client, ALL)
    return client


def test_table_visual_with_implicit_sum_and_totals(sap):
    r = q(sap, group=[{"table": "OCRD", "column": "CardName"}],
          values=[{"table": "INV1", "column": "LineTotal"}], totals=True)
    assert r.status_code == 200, r.text
    d = r.json()
    assert [c["name"] for c in d["columns"]] == ["CardName", "Toplam LineTotal"]
    assert d["columns"][1]["kind"] == "value" and d["columns"][1]["type"] == "decimal"
    # INV1 → OINV → OCRD yolu: Anadolu = 100 + 50.5 + 42.25
    assert d["rows"] == [["Anadolu Gıda", 192.75], ["Ege Yapı", 80.0]]
    assert d["total"] == [272.75]
    assert d["truncated"] is False


def test_card_distinct_count(sap):
    d = q(sap, values=[{"table": "OINV", "column": "DocEntry", "agg": "distinctcount"}]).json()
    assert d["columns"][0]["name"] == "DocEntry Sayısı (Farklı)"
    assert d["rows"] == [[3]]


def test_filter_through_relationship(sap):
    d = q(sap, group=[{"table": "OITM", "column": "ItemName"}],
          values=[{"table": "INV1", "column": "Quantity"}],
          filters=[{"table": "OSLP", "column": "SlpName", "values": ["Ayşe"]}]).json()
    assert d["rows"] == [["Un 50kg", 2.0], ["Şeker 25kg", 4.0]] or d["rows"] == [["Şeker 25kg", 4.0], ["Un 50kg", 2.0]]


def test_order_limit_and_truncation(sap):
    d = q(sap, group=[{"table": "OITM", "column": "ItemCode"}],
          values=[{"table": "INV1", "column": "LineTotal", "agg": "avg"}],
          order_by=[{"index": 1, "desc": True}], limit=1).json()
    assert d["columns"][1]["name"] == "Ortalama LineTotal"
    assert d["rows"] == [["A1", 90.0]]          # A1: (100 + 80) / 2, B1: (50.5 + 42.25) / 2
    assert d["truncated"] is True


def test_same_value_twice_gets_unique_labels(sap):
    d = q(sap, values=[{"table": "INV1", "column": "Quantity"}, {"table": "INV1", "column": "Quantity"}]).json()
    assert [c["name"] for c in d["columns"]] == ["Toplam Quantity", "Toplam Quantity (2)"]
    assert d["rows"] == [[7.0, 7.0]]


def test_query_errors_are_readable(sap):
    r = q(sap, values=[{"table": "INV1", "column": "Yok"}])
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "query_error"
    assert "Yok" in r.json()["error"]["detail"]
    r = q(sap, values=[{"measure": "Toplam Satış"}])
    assert r.status_code == 400 and "Toplam Satış" in r.json()["error"]["detail"]


def test_empty_query(sap):
    assert q(sap).json() == {"columns": [], "rows": [], "truncated": False, "total": None}


REPORT = {
    "version": 1,
    "pages": [{
        "id": "p1", "name": "Satış", "width": 1280, "height": 720,
        "visuals": [
            {"id": "v1", "type": "table", "x": 20, "y": 20, "w": 500, "h": 300,
             "group": [{"table": "OCRD", "column": "CardName"}],
             "values": [{"table": "INV1", "column": "LineTotal"}]},
            {"id": "v2", "type": "card", "x": 540, "y": 20, "w": 240, "h": 120,
             "values": [{"table": "OINV", "column": "DocEntry", "agg": "distinctcount"}]},
        ],
    }],
}


def test_new_document_has_one_empty_page(client):
    assert doc(client)["report"]["pages"][0]["name"] == "Sayfa 1"


def test_save_report_and_rename_updates_visuals(sap, tmp_path):
    r = sap.put("/document/report", headers=H, json=REPORT)
    assert r.status_code == 200 and r.json()["dirty"] is True
    rep = doc(sap)["report"]
    assert rep["pages"][0]["visuals"][0]["values"][0]["agg"] == "sum"     # varsayılan toplama yazıldı
    ops(sap, {"op": "rename_table", "table": "OCRD", "new_name": "Müşteri"},
        {"op": "rename_column", "table": "INV1", "column": "LineTotal", "new_name": "Satır Tutarı"})
    v1 = doc(sap)["report"]["pages"][0]["visuals"][0]
    assert v1["group"] == [{"table": "Müşteri", "column": "CardName"}]
    assert v1["values"][0]["column"] == "Satır Tutarı"
    # yeniden adlandırılan alanlarla sorgu hâlâ çalışıyor
    d = q(sap, group=v1["group"], values=v1["values"]).json()
    assert d["rows"][0] == ["Anadolu Gıda", 192.75]
    # .floem içinde rapor korunuyor
    path = sap.post("/document/save", headers=H, json={"path": str(tmp_path / "rapor")}).json()["path"]
    sap.post("/document/new", headers=H)
    opened = sap.post("/document/open", headers=H, json={"path": path}).json()
    assert opened["report"]["pages"][0]["visuals"][1]["type"] == "card"
    assert opened["report"]["pages"][0]["visuals"][0]["values"][0]["column"] == "Satır Tutarı"


def test_invalid_report_rejected(sap):
    bad = {"version": 1, "pages": [{"id": "p1", "name": "A", "visuals": [
        {"id": "v1", "type": "table"}, {"id": "v1", "type": "card"}]}]}
    r = sap.put("/document/report", headers=H, json=bad)
    assert r.status_code == 400 and r.json()["error"]["code"] == "report_invalid"
    r = sap.put("/document/report", headers=H, json={"version": 1, "pages": [{"id": "p1", "name": "A", "visuals": [
        {"id": "v1", "type": "pie"}]}]})
    assert r.status_code == 400


def test_refresh_resets_time_maps(sap):
    con = sap.app_.state.holder["doc"].con
    q(sap, values=[{"table": "INV1", "column": "Quantity"}])        # motor kurulur, floem şeması oluşur
    con.execute("INSERT INTO floem.tarih_map VALUES ('YTD', DATE '2026-01-01', DATE '2026-01-01')")
    from test_document import wait
    job = wait(sap, sap.post("/document/refresh", headers=H).json())
    assert job["status"] == "succeeded"
    n = con.execute("SELECT count(*) FROM duckdb_tables() WHERE schema_name = 'floem' AND table_name = 'tarih_map'").fetchone()[0]
    assert n == 0 or con.execute("SELECT count(*) FROM floem.tarih_map").fetchone()[0] == 0
