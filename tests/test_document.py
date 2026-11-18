"""H2: içe aktarım, ilişki algılama, model düzenleme, yenileme ve .floem dosyası.

Kaynak olarak bellekte duran sahte bir SAP B1 veritabanı kullanılır (SQL Server gerekmez).
"""

from __future__ import annotations

import struct
import threading
import time
import zipfile
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from floem_bi.connectors import ConnectionSpec, ConnectorError, ExtractColumn, ForeignKey
from floem_bi.connectors.sqlserver import _datetimeoffset
from floem_bi.desktop_service import create_app
from floem_bi.desktop_service.connections import ConnectionStore

TOKEN = "t" * 32
H = {"X-Floem-Token": TOKEN}


def col(name, typ, pk=False, p=None, s=None):
    return ExtractColumn(name, typ, typ.__name__, p, s, True, pk)


def sapb1():
    return {
        ("dbo", "OINV"): (
            [col("DocEntry", int, pk=True), col("DocNum", int), col("CardCode", str), col("SlpCode", int),
             col("DocDate", date), col("DocTotal", Decimal, p=19, s=6)],
            [(1, 1001, "C001", 1, date(2026, 1, 5), Decimal("150.500000")),
             (2, 1002, "C002", 2, date(2026, 1, 6), Decimal("80.000000")),
             (3, 1003, "C001", 1, date(2026, 2, 1), Decimal("42.250000"))],
        ),
        ("dbo", "INV1"): (
            [col("DocEntry", int, pk=True), col("LineNum", int, pk=True), col("ItemCode", str), col("SlpCode", int),
             col("Quantity", Decimal, p=19, s=6), col("LineTotal", Decimal, p=19, s=6)],
            [(1, 0, "A1", 1, Decimal("2"), Decimal("100")), (1, 1, "B1", 1, Decimal("1"), Decimal("50.5")),
             (2, 0, "A1", 2, Decimal("1"), Decimal("80")), (3, 0, "B1", 1, Decimal("3"), Decimal("42.25"))],
        ),
        ("dbo", "OCRD"): (
            [col("CardCode", str, pk=True), col("CardName", str), col("SlpCode", int)],
            [("C001", "Anadolu Gıda", 1), ("C002", "Ege Yapı", 2)],
        ),
        ("dbo", "OITM"): (
            [col("ItemCode", str, pk=True), col("ItemName", str), col("ItmsGrpCod", int)],
            [("A1", "Un 50kg", 100), ("B1", "Şeker 25kg", 101)],
        ),
        ("dbo", "OSLP"): (
            [col("SlpCode", int, pk=True), col("SlpName", str)],
            [(1, "Ayşe"), (2, "Mehmet")],
        ),
        ("dbo", "vw_Kategori"): (                         # görünüm: birincil anahtar bilgisi yok
            [col("ItmsGrpCod", int), col("ItmsGrpNam", str)],
            [(100, "Unlu mamul"), (101, "Şekerli")],
        ),
    }


class FakeExtraction:
    def __init__(self, columns, rows, delay=0.0):
        self.columns = [ExtractColumn(**c.__dict__) for c in columns]
        self.skipped = []
        self._rows = list(rows)
        self._delay = delay
        self.cancelled = threading.Event()

    def fetch(self, n):
        if self._delay:
            time.sleep(self._delay)
        if self.cancelled.is_set():
            raise ConnectorError("Sorgu iptal edildi", code="cancelled")
        out, self._rows = self._rows[:n], self._rows[n:]
        return out

    def cancel(self):
        self.cancelled.set()


class FakeSource:
    """Testler kaynağı değiştirebilsin diye paylaşılan durum."""
    def __init__(self):
        self.tables = sapb1()
        self.fail_on: str | None = None
        self.delay = 0.0
        self.fks = []


SOURCE = FakeSource()


class FakeConnector:
    def __init__(self, spec: ConnectionSpec):
        self.spec = spec

    def test(self):
        return {"version": "16.0", "edition": "Developer", "database": "SBO", "login": self.spec.user}

    def list_databases(self):
        return ["SBO_DEMO"]

    def foreign_keys(self, database):
        return list(SOURCE.fks)

    @contextmanager
    def extract(self, source, timeout=0):
        if source.table:
            if SOURCE.fail_on == source.table:
                raise ConnectorError(f"'{source.table}' tablosu okunamadı", "Invalid object name", "sql_error")
            cols, rows = SOURCE.tables[(source.schema, source.table)]
        else:
            # SQL sorgusu: aynı ad iki kez (büyük/küçük harf farkıyla) gelsin
            cols = [col("CardCode", str), col("cardcode", str), col("Toplam", float)]
            rows = [("C001", "c001", 192.75), ("C002", "c002", 80.0)]
        yield FakeExtraction(cols, rows, SOURCE.delay)


@pytest.fixture
def client(tmp_path):
    global SOURCE
    SOURCE = FakeSource()
    store = ConnectionStore(tmp_path / "store", use_keyring=False)
    app = create_app(TOKEN, store=store, connector_factory=FakeConnector, work_dir=tmp_path / "work")
    c = TestClient(app)
    r = c.post("/connections", headers=H, json={"server": "SAPSRV", "database": "SBO_DEMO", "user": "okuyucu", "password": "x"})
    assert r.status_code == 200, r.text
    c.cid = r.json()["id"]
    c.app_ = app
    return c


def wait(client, job):
    for _ in range(500):
        j = client.get(f"/jobs/{job['id']}", headers=H).json()
        if j["status"] != "running":
            return j
        time.sleep(0.01)
    raise AssertionError("iş bitmedi")


def do_import(client, tables, **extra):
    items = [{"schema": "dbo", "table": t} for t in tables]
    r = client.post("/document/import", headers=H, json={"connection_id": client.cid, "database": "SBO_DEMO", "items": items, **extra})
    assert r.status_code == 200, r.text
    return wait(client, r.json())


def doc(client):
    return client.get("/document", headers=H).json()


def rels(d):
    return {(r["kimden"], r["kime"]): r.get("aktif", True) for r in d["model"]["iliskiler"]}


def table(d, name):
    return next(t for t in d["model"]["tablolar"] if t["ad"] == name)


def column(d, t, c):
    return next(x for x in table(d, t)["sutunlar"] if x["ad"] == c)


ALL = ["OINV", "INV1", "OCRD", "OITM", "OSLP"]


# ------------------------------------------------------------------ içe aktarım
def test_import_sapb1_and_detect_relationships(client):
    job = do_import(client, ALL)
    assert job["status"] == "succeeded", job
    assert [t["rows"] for t in job["tables"]] == [3, 4, 2, 2, 2]
    d = doc(client)
    assert d["dirty"] is True
    assert {t["ad"] for t in d["model"]["tablolar"]} == set(ALL)
    assert d["stats"]["INV1"]["rows"] == 4

    # tipler ve varsayılan özet (anahtarlar toplanmaz)
    assert column(d, "OINV", "DocTotal")["tip"] == "decimal"
    assert column(d, "OINV", "DocDate")["tip"] == "date"
    assert column(d, "OINV", "DocTotal")["ozet"] == "sum"
    assert column(d, "OINV", "DocEntry")["anahtar"] is True
    assert column(d, "OINV", "DocEntry")["ozet"] == "none"
    assert column(d, "INV1", "ItemCode")["tip"] == "string"

    # kaynak bilgisi modelde (şifresiz)
    assert d["model"]["veri_kaynaklari"][0]["sunucu"] == "SAPSRV"
    assert "password" not in str(d["model"]) and "sifre" not in str(d["model"])
    assert table(d, "OINV")["sorgu"] == {"kaynak": client.cid, "veritabani": "SBO_DEMO", "sema": "dbo", "tablo": "OINV", "adimlar": []}

    r = rels(d)
    assert r[("INV1[DocEntry]", "OINV[DocEntry]")] is True        # satır → başlık
    assert r[("OINV[CardCode]", "OCRD[CardCode]")] is True
    assert r[("INV1[ItemCode]", "OITM[ItemCode]")] is True
    # Satış temsilcisine üç yol var; yalnızca biri etkin olabilir
    to_oslp = [k for k in r if k[1] == "OSLP[SlpCode]"]
    assert len(to_oslp) == 3
    assert sum(r[k] for k in to_oslp) == 1
    # INV1'in birleşik anahtarı "bir" tarafı olamaz
    assert not any(k[1].startswith("INV1[") for k in r)
    # ilişki sütunlarının özeti kapanır
    assert column(d, "INV1", "SlpCode")["ozet"] == "none"
    assert job["result"]["relationships"]


def test_view_without_pk_uses_data_uniqueness(client):
    do_import(client, ["OITM"])
    job = do_import(client, ["vw_Kategori"])
    assert job["status"] == "succeeded"
    assert rels(doc(client)) == {("OITM[ItmsGrpCod]", "vw_Kategori[ItmsGrpCod]"): True}


def test_foreign_keys_take_priority(client):
    SOURCE.fks = [(ForeignKey("dbo", "OINV", "SlpCode", "dbo", "OSLP", "SlpCode", "FK_OINV_OSLP"))]
    do_import(client, ALL)
    r = rels(doc(client))
    assert r[("OINV[SlpCode]", "OSLP[SlpCode]")] is True
    assert r[("INV1[SlpCode]", "OSLP[SlpCode]")] is False


def test_import_sql_query_dedupes_columns(client):
    r = client.post("/document/import", headers=H, json={
        "connection_id": client.cid, "database": "SBO_DEMO",
        "items": [{"sql": "SELECT CardCode, LOWER(CardCode) AS cardcode, SUM(DocTotal) AS Toplam FROM OINV GROUP BY CardCode",
                   "name": "Müşteri Özeti"}],
    })
    job = wait(client, r.json())
    assert job["status"] == "succeeded", job
    d = doc(client)
    t = table(d, "Müşteri Özeti")
    assert [c["ad"] for c in t["sutunlar"]] == ["CardCode", "cardcode (2)", "Toplam"]
    assert t["sorgu"]["sql"].startswith("SELECT")
    p = client.get("/document/tables/Müşteri Özeti/preview", headers=H).json()
    assert p["rows"][0] == ["C001", "c001", 192.75]


def test_import_twice_gets_unique_names(client):
    do_import(client, ["OSLP"])
    do_import(client, ["OSLP"])
    d = doc(client)
    assert {t["ad"] for t in d["model"]["tablolar"]} == {"OSLP", "OSLP (2)"}
    assert len({t["kaynak"]["tablo"].lower() for t in d["model"]["tablolar"]}) == 2


def test_import_failure_changes_nothing(client):
    do_import(client, ["OSLP"])
    before = doc(client)
    SOURCE.fail_on = "OCRD"
    job = do_import(client, ["OITM", "OCRD"])
    assert job["status"] == "failed"
    assert job["error"]["message"] == "'OCRD' tablosu okunamadı"
    assert [t["status"] for t in job["tables"]] == ["done", "failed"]
    after = doc(client)
    assert after["model"] == before["model"]
    # geçici tablolar silindi
    con = client.app_.state.holder["doc"].con
    assert con.execute("SELECT count(*) FROM duckdb_tables() WHERE table_name LIKE '__stg_%'").fetchone()[0] == 0


def test_cancel_import(client):
    big = [(i, f"Temsilci {i}") for i in range(200_000)]
    SOURCE.tables[("dbo", "OSLP")] = (SOURCE.tables[("dbo", "OSLP")][0], big)
    SOURCE.delay = 0.05
    r = client.post("/document/import", headers=H, json={"connection_id": client.cid, "database": "SBO_DEMO",
                                                         "items": [{"schema": "dbo", "table": "OSLP"}]})
    job = r.json()
    time.sleep(0.08)
    client.post(f"/jobs/{job['id']}/cancel", headers=H)
    job = wait(client, job)
    assert job["status"] == "cancelled"
    assert doc(client)["model"]["tablolar"] == []


def test_busy_while_importing(client):
    SOURCE.delay = 0.2
    r = client.post("/document/import", headers=H, json={"connection_id": client.cid, "database": "SBO_DEMO",
                                                         "items": [{"schema": "dbo", "table": "OSLP"}]})
    busy = client.post("/document/new", headers=H)
    assert busy.status_code == 409
    assert busy.json()["error"]["code"] == "busy"
    wait(client, r.json())


# ------------------------------------------------------------------ model işlemleri
def ops(client, *items):
    return client.post("/document/ops", headers=H, json={"ops": list(items)})


def test_rename_table_and_column_update_references(client, tmp_path):
    do_import(client, ALL)
    client.put("/document/diagram", headers=H, json={"tables": {"OINV": {"x": 10, "y": 20}}})
    r = ops(client,
            {"op": "rename_table", "table": "OINV", "new_name": "Fatura Başlık"},
            {"op": "rename_column", "table": "OCRD", "column": "CardCode", "new_name": "Müşteri Kodu"})
    assert r.status_code == 200, r.text
    d = r.json()
    rr = rels(d)
    assert ("INV1[DocEntry]", "Fatura Başlık[DocEntry]") in rr
    assert ("Fatura Başlık[CardCode]", "OCRD[Müşteri Kodu]") in rr
    assert d["diagram"]["tables"] == {"Fatura Başlık": {"x": 10.0, "y": 20.0}}
    c = column(d, "OCRD", "Müşteri Kodu")
    assert c["kaynak"] == "CardCode"
    # veri hâlâ okunuyor (fiziksel ad değişmedi)
    p = client.get("/document/tables/OCRD/preview", headers=H).json()
    assert p["columns"][0]["name"] == "Müşteri Kodu" and p["rows"][0][0] == "C001"


def test_invalid_names_rejected(client):
    do_import(client, ["OSLP", "OITM"])
    r = ops(client, {"op": "rename_table", "table": "OSLP", "new_name": "OITM"})
    assert r.status_code == 400 and "zaten var" in r.json()["error"]["message"]
    r = ops(client, {"op": "rename_column", "table": "OSLP", "column": "SlpName", "new_name": "Ad [x]"})
    assert r.status_code == 400


def test_relationship_rules(client):
    do_import(client, ["OINV", "OCRD", "OSLP"])
    d = doc(client)
    assert ("OCRD[SlpCode]", "OSLP[SlpCode]") in rels(d)

    # aynı ilişki ikinci kez eklenemez
    r = ops(client, {"op": "add_relationship", "kimden": "OINV[CardCode]", "kime": "OCRD[CardCode]"})
    assert r.status_code == 400 and "zaten" in r.json()["error"]["message"]
    # "bir" tarafı benzersiz olmalı
    ops(client, {"op": "delete_relationship", "kimden": "OINV[CardCode]", "kime": "OCRD[CardCode]"})
    r = ops(client, {"op": "add_relationship", "kimden": "OCRD[CardCode]", "kime": "OINV[CardCode]"})
    assert r.status_code == 400 and "yinelenen" in r.json()["error"]["message"]
    # tip uyumsuzluğu
    r = ops(client, {"op": "add_relationship", "kimden": "OINV[CardCode]", "kime": "OSLP[SlpCode]"})
    assert r.status_code == 400 and "uyumsuz" in r.json()["error"]["message"]
    # döngü (belirsizlik): OINV→OSLP ve OCRD→OSLP etkinken OINV→OCRD de etkin olursa üçgen oluşur
    r = ops(client, {"op": "update_relationship", "kimden": "OCRD[SlpCode]", "kime": "OSLP[SlpCode]", "aktif": True})
    assert r.status_code == 200, r.text
    r = ops(client, {"op": "add_relationship", "kimden": "OINV[CardCode]", "kime": "OCRD[CardCode]"})
    assert r.status_code == 400 and "birden fazla filtre yolu" in r.json()["error"]["message"]
    r = ops(client, {"op": "add_relationship", "kimden": "OINV[CardCode]", "kime": "OCRD[CardCode]", "aktif": False})
    assert r.status_code == 200
    # profil: ilişki penceresindeki ön kontrol
    p = client.post("/document/relationship-profile", headers=H,
                    json={"kimden": "OINV[CardCode]", "kime": "OCRD[CardCode]"}).json()
    assert p["suggested"] == "*:1" and p["matched"] == 2 and p["to"]["unique"] is True


def test_update_relationship_and_failed_batch_is_atomic(client):
    do_import(client, ["OINV", "OCRD"])
    before = doc(client)
    r = ops(client,
            {"op": "update_relationship", "kimden": "OINV[CardCode]", "kime": "OCRD[CardCode]", "filtre_yonu": "cift"},
            {"op": "rename_table", "table": "YOK", "new_name": "X"})
    assert r.status_code == 400
    assert doc(client)["model"] == before["model"]
    r = ops(client, {"op": "update_relationship", "kimden": "OINV[CardCode]", "kime": "OCRD[CardCode]", "filtre_yonu": "cift"})
    assert r.status_code == 200
    assert r.json()["model"]["iliskiler"][0]["filtre_yonu"] == "cift"
    assert r.json()["warnings"]                 # MVP: çift yön tek yön gibi uygulanır


def test_column_type_change_and_properties(client):
    do_import(client, ["OINV"])
    r = ops(client, {"op": "update_column", "table": "OINV", "column": "DocNum", "tip": "string",
                     "gizli": True, "bicim": "0"})
    assert r.status_code == 200, r.text
    c = column(r.json(), "OINV", "DocNum")
    assert (c["tip"], c["gizli"], c["bicim"]) == ("string", True, "0")
    r = ops(client, {"op": "update_column", "table": "OINV", "column": "CardCode", "tip": "int64"})
    assert r.status_code == 400 and "çevrilemedi" in r.json()["error"]["message"]
    assert column(doc(client), "OINV", "CardCode")["tip"] == "string"
    # sıralama sütunu: her değerin tek sıralama değeri olmalı
    r = ops(client, {"op": "update_column", "table": "OINV", "column": "CardCode", "siralama_sutunu": "DocEntry"})
    assert r.status_code == 400
    r = ops(client, {"op": "update_column", "table": "OINV", "column": "DocNum", "siralama_sutunu": "DocEntry"})
    assert r.status_code == 200


def test_mark_date_table(client):
    do_import(client, ["OINV"])
    r = ops(client, {"op": "mark_date_table", "table": "OINV", "column": "CardCode"})
    assert r.status_code == 400 and "tarih tipinde" in r.json()["error"]["message"]
    r = ops(client, {"op": "mark_date_table", "table": "OINV", "column": "DocDate"})
    assert r.status_code == 200          # 3 farklı tarih, tekrar yok
    assert table(r.json(), "OINV")["tarih_tablosu"] == {"anahtar_sutun": "DocDate"}
    r = ops(client, {"op": "mark_date_table", "table": "OINV"})
    assert "tarih_tablosu" not in table(r.json(), "OINV")


def test_delete_table(client):
    do_import(client, ["OINV", "OCRD"])
    r = ops(client, {"op": "delete_table", "table": "OCRD"})
    d = r.json()
    assert [t["ad"] for t in d["model"]["tablolar"]] == ["OINV"]
    assert d["model"]["iliskiler"] == []
    con = client.app_.state.holder["doc"].con
    assert con.execute("SELECT count(*) FROM duckdb_tables() WHERE table_name = 'OCRD'").fetchone()[0] == 0


# ------------------------------------------------------------------ yenileme
def test_refresh_applies_new_data_and_schema_changes(client):
    do_import(client, ["OINV", "OCRD"])
    ops(client, {"op": "update_column", "table": "OINV", "column": "DocNum", "tip": "string"})
    cols, rows = SOURCE.tables[("dbo", "OCRD")]
    # kaynakta: SlpCode kalktı, Phone eklendi, bir müşteri daha
    SOURCE.tables[("dbo", "OCRD")] = (
        [cols[0], cols[1], col("Phone1", str)],
        [("C001", "Anadolu Gıda", "0212"), ("C002", "Ege Yapı", None), ("C003", "Karadeniz Tekstil", "0462")],
    )
    r = client.post("/document/refresh", headers=H, json={})
    job = wait(client, r.json())
    assert job["status"] == "succeeded", job
    d = doc(client)
    assert d["stats"]["OCRD"]["rows"] == 3
    assert [c["ad"] for c in table(d, "OCRD")["sutunlar"]] == ["CardCode", "CardName", "Phone1"]
    assert any("SlpCode" in w for w in job["result"]["warnings"])
    assert column(d, "OINV", "DocNum")["tip"] == "string"           # kullanıcı tipi korunur
    assert ("OINV[CardCode]", "OCRD[CardCode]") in rels(d)


def test_refresh_failure_keeps_old_data(client):
    do_import(client, ["OINV", "OCRD"])
    SOURCE.tables[("dbo", "OINV")] = (SOURCE.tables[("dbo", "OINV")][0], [])
    SOURCE.fail_on = "OCRD"
    job = wait(client, client.post("/document/refresh", headers=H).json())
    assert job["status"] == "failed"
    assert "OCRD" in job["error"]["message"]
    assert doc(client)["stats"]["OINV"]["rows"] == 3                # yarım yenileme uygulanmadı


def test_refresh_without_saved_credentials(client):
    do_import(client, ["OSLP"])
    client.delete(f"/connections/{client.cid}", headers=H)
    job = wait(client, client.post("/document/refresh", headers=H).json())
    assert job["status"] == "failed"
    assert job["error"]["code"] == "credentials_required"
    assert "SAPSRV" in job["error"]["message"]


# ------------------------------------------------------------------ .floem
def test_save_and_open_roundtrip(client, tmp_path):
    do_import(client, ALL)
    ops(client, {"op": "rename_table", "table": "OINV", "new_name": "Faturalar"},
        {"op": "mark_date_table", "table": "Faturalar", "column": "DocDate"})
    client.put("/document/diagram", headers=H, json={"tables": {"Faturalar": {"x": 1, "y": 2, "collapsed": True}}})
    before = doc(client)
    target = tmp_path / "Satış Analizi"
    r = client.post("/document/save", headers=H, json={"path": str(target)})
    assert r.status_code == 200, r.text
    saved = r.json()
    assert saved["dirty"] is False and saved["name"] == "Satış Analizi"
    assert saved["path"].endswith("Satış Analizi.floem")
    with zipfile.ZipFile(saved["path"]) as z:
        assert set(z.namelist()) == {"manifest.json", "model.yaml", "diagram.json", "report.json", "data.duckdb"}
        assert "Faturalar" in z.read("model.yaml").decode("utf-8")

    client.post("/document/new", headers=H)
    assert doc(client)["model"]["tablolar"] == []
    r = client.post("/document/open", headers=H, json={"path": saved["path"]})
    assert r.status_code == 200, r.text
    after = r.json()
    assert after["model"]["tablolar"] == before["model"]["tablolar"]
    assert after["model"]["iliskiler"] == before["model"]["iliskiler"]
    assert after["diagram"]["tables"] == {"Faturalar": {"x": 1.0, "y": 2.0, "collapsed": True}}
    assert after["stats"] == before["stats"]
    p = client.get("/document/tables/Faturalar/preview", headers=H).json()
    assert p["rows"][0][-1] == 150.5
    # kaydedip yeniden kaydetmek (aynı yol)
    ops(client, {"op": "update_table", "table": "OSLP", "gizli": True})
    assert client.post("/document/save", headers=H, json={}).status_code == 200


def test_open_bad_file(client, tmp_path):
    bad = tmp_path / "bozuk.floem"
    bad.write_bytes(b"bu bir zip degil")
    r = client.post("/document/open", headers=H, json={"path": str(bad)})
    assert r.status_code == 400 and r.json()["error"]["code"] == "file_error"
    z = tmp_path / "baska.floem"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("../../kotu.txt", "x")
    r = client.post("/document/open", headers=H, json={"path": str(z)})
    assert r.status_code == 400
    assert not (tmp_path.parent / "kotu.txt").exists()


def test_save_requires_path(client):
    r = client.post("/document/save", headers=H, json={})
    assert r.status_code == 400 and r.json()["error"]["code"] == "path_required"


# ------------------------------------------------------------------ yardımcılar
def test_datetimeoffset_converter():
    raw = struct.pack("<6hI2h", 2026, 11, 17, 15, 30, 0, 500_000_000, 3, 0)
    assert _datetimeoffset(raw) == datetime(2026, 11, 17, 12, 30, 0, 500_000)


def test_dax_rename_keeps_formatting():
    from floem_bi.dax.rename import rename_column, rename_table
    src = "CALCULATE ( SUM ( Satis[Tutar] ),\n  ALL ( 'Satis' ) ) // yorum"
    assert rename_table(src, "satis", "Satış") == "CALCULATE ( SUM ( 'Satış'[Tutar] ),\n  ALL ( 'Satış' ) ) // yorum"
    assert rename_column(src, "Satis", "Tutar", "Net") == "CALCULATE ( SUM ( Satis[Net] ),\n  ALL ( 'Satis' ) ) // yorum"
    assert rename_column("[Tutar] + [Toplam Satış]", "Satis", "Tutar", "Net", "Satis") == "[Net] + [Toplam Satış]"
