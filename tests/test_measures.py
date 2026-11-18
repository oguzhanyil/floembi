"""Ölçü yönetimi (ekle/düzenle/yeniden adlandır/sil), DAX doğrulama ucu ve tarih tablosu."""

from __future__ import annotations

import pytest

from test_document import ALL, H, client, do_import, doc, ops  # noqa: F401  (client fixture)


@pytest.fixture
def sap(client):
    do_import(client, ALL)
    return client


def measure(d, name):
    for t in d["model"]["tablolar"]:
        for m in t.get("olculer", []):
            if m["ad"] == name:
                return t["ad"], m
    return None, None


def value(c, ref, group=(), filters=()):
    r = c.post("/document/query", headers=H, json={"group": list(group), "values": [ref], "filters": list(filters)})
    assert r.status_code == 200, r.text
    return r.json()["rows"]


def test_add_measure_and_use_in_visual(sap):
    r = ops(sap, {"op": "add_measure", "table": "INV1", "name": "Toplam Satır", "expression": "SUM(INV1[LineTotal])",
                  "bicim": "#,0.00"})
    assert r.status_code == 200, r.text
    home, m = measure(r.json(), "Toplam Satır")
    assert home == "INV1" and m["ifade"] == "SUM(INV1[LineTotal])" and m["bicim"] == "#,0.00"
    assert value(sap, {"measure": "Toplam Satır"}) == [[272.75]]
    rows = value(sap, {"measure": "Toplam Satır"}, group=[{"table": "OCRD", "column": "CardName"}])
    assert rows == [["Anadolu Gıda", 192.75], ["Ege Yapı", 80.0]]


def test_invalid_measures_are_rejected_with_reason(sap):
    r = ops(sap, {"op": "add_measure", "table": "INV1", "name": "Bozuk", "expression": "SUM(INV1[Yok])"})
    assert r.status_code == 400 and "Bozuk" in r.json()["error"]["message"] and "Yok" in r.json()["error"]["message"]
    r = ops(sap, {"op": "add_measure", "table": "INV1", "name": "Bozuk", "expression": "SUM(INV1[LineTotal]"})
    assert r.status_code == 400
    r = ops(sap, {"op": "add_measure", "table": "INV1", "name": "LineTotal", "expression": "1"})
    assert r.status_code == 400                                     # sütun adıyla çakışma
    ops(sap, {"op": "add_measure", "table": "INV1", "name": "A", "expression": "1"})
    r = ops(sap, {"op": "add_measure", "table": "OINV", "name": "a", "expression": "2"})
    assert r.status_code == 400                                     # ölçü adları model genelinde benzersiz
    assert measure(doc(sap), "Bozuk") == (None, None)


def test_rename_measure_updates_references_and_report(sap):
    ops(sap, {"op": "add_measure", "table": "INV1", "name": "Satış", "expression": "SUM(INV1[LineTotal])"},
        {"op": "add_measure", "table": "INV1", "name": "Pay",
         "expression": "DIVIDE([Satış], CALCULATE([Satış], ALL(OITM)))"})
    sap.put("/document/report", headers=H, json={"version": 1, "pages": [{"id": "p1", "name": "S", "visuals": [
        {"id": "v1", "type": "card", "values": [{"measure": "Satış"}]}]}]})
    r = ops(sap, {"op": "update_measure", "name": "Satış", "new_name": "Ciro", "bicim": "₺#,0.00", "table": "OINV"})
    assert r.status_code == 200, r.text
    d = r.json()
    home, m = measure(d, "Ciro")
    assert home == "OINV" and m["bicim"] == "₺#,0.00"
    assert measure(d, "Pay")[1]["ifade"] == "DIVIDE([Ciro], CALCULATE([Ciro], ALL(OITM)))"
    assert d["report"]["pages"][0]["visuals"][0]["values"] == [{"measure": "Ciro"}]
    rows = value(sap, {"measure": "Pay"}, group=[{"table": "OITM", "column": "ItemName"}])
    assert sum(r[1] for r in rows) == pytest.approx(1.0)
    # İfade değişikliği de derlenebilir olmalı
    r = ops(sap, {"op": "update_measure", "name": "Ciro", "expression": "SUM(INV1[Yok])"})
    assert r.status_code == 400 and measure(doc(sap), "Ciro")[1]["ifade"] == "SUM(INV1[LineTotal])"
    r = ops(sap, {"op": "delete_measure", "name": "Pay"})
    assert measure(r.json(), "Pay") == (None, None)


def test_validate_endpoint_reports_position(sap):
    ok = sap.post("/document/dax/validate", headers=H, json={"expression": "SUM(INV1[LineTotal]) * 2"}).json()
    assert ok == {"ok": True, "errors": []}
    bad = sap.post("/document/dax/validate", headers=H, json={"expression": "SUM(INV1[Yok])"}).json()
    assert bad["ok"] is False and "Yok" in bad["errors"][0]["message"]
    assert bad["errors"][0]["start"] == 4                          # INV1[Yok] başladığı yer
    syn = sap.post("/document/dax/validate", headers=H, json={"expression": "SUM(INV1[LineTotal]"}).json()
    assert syn["ok"] is False and syn["errors"][0]["start"] is not None


def test_create_date_table_and_time_intelligence(sap):
    r = ops(sap, {"op": "create_date_table", "relate": ["OINV[DocDate]"]})
    assert r.status_code == 200, r.text
    d = r.json()
    t = next(x for x in d["model"]["tablolar"] if x["ad"] == "Tarih")
    assert t["tarih_tablosu"] == {"anahtar_sutun": "Tarih"}
    assert [c["ad"] for c in t["sutunlar"]][:6] == ["Tarih", "Yıl", "Çeyrek No", "Çeyrek", "Ay No", "Ay"]
    assert d["stats"]["Tarih"]["rows"] == 365                       # demo faturaları 2026'da → tam yıl
    assert any(x["kimden"] == "OINV[DocDate]" and x["kime"] == "Tarih[Tarih]" for x in d["model"]["iliskiler"])
    rows = value(sap, {"table": "OINV", "column": "DocTotal"}, group=[{"table": "Tarih", "column": "Ay"}])
    assert dict(rows) == {"Ocak": 230.5, "Şubat": 42.25}

    r = ops(sap, {"op": "add_measure", "table": "OINV", "name": "Fatura Toplamı", "expression": "SUM(OINV[DocTotal])"},
            {"op": "add_measure", "table": "OINV", "name": "Yılbaşından Bugüne",
             "expression": "TOTALYTD([Fatura Toplamı], Tarih[Tarih])"})
    assert r.status_code == 200, r.text
    rows = value(sap, {"measure": "Yılbaşından Bugüne"}, group=[{"table": "Tarih", "column": "Ay No"}])
    assert dict(rows)[1] == 230.5 and dict(rows)[2] == 272.75

    # İkinci tarih tablosu adı çakışır; tarih/saat sütunu doğrudan bağlanamaz
    assert ops(sap, {"op": "create_date_table"}).status_code == 400


def test_date_table_rejects_datetime_column(sap):
    ops(sap, {"op": "update_column", "table": "OINV", "column": "DocDate", "tip": "datetime"})
    r = ops(sap, {"op": "create_date_table", "name": "Takvim", "relate": ["OINV[DocDate]"]})
    assert r.status_code == 400 and "tipini 'Tarih' yapın" in r.json()["error"]["message"]
