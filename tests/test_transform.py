"""Veri dönüştürme (Power Query karşılığı): adım motoru, önizleme, uygulama ve yenileme."""

from __future__ import annotations

import zipfile

import duckdb
import pytest

import test_document as td
from floem_bi.transform import StepError, build, parse_steps
from test_document import H, column, doc, do_import, ops, table, wait

client = td.client


# ------------------------------------------------------------------ motor (DuckDB, belgesiz)
@pytest.fixture
def con():
    c = duckdb.connect()
    c.execute("""CREATE TABLE t AS SELECT * FROM (VALUES
        ('C001', 'Ahmet Yılmaz', ' İstanbul ', 10, 2.5, '2026-01-05'),
        ('C002', 'Ayşe Kaya', 'Ankara', 5, 4.0, 'x'),
        ('C002', 'Ayşe Kaya', 'Ankara', 5, 4.0, 'x')) v(kod, ad, sehir, adet, fiyat, tarih)""")
    c.execute("CREATE TABLE ref AS SELECT * FROM (VALUES ('C001', 'Bayi'), ('C002', 'Perakende')) v(kod, grup)")
    return c


def run(con, steps, tables=None):
    b = build(con.cursor(), "t", parse_steps(steps), tables or {"ref": "ref"})
    return [c for c, _ in b.columns], con.execute(b.sql).fetchall()


def test_chain_of_steps(con):
    cols, rows = run(con, [
        {"tur": "yinelenenleri_kaldir"},
        {"tur": "metin", "sutun": "sehir", "islem": "kirp"},
        {"tur": "ozel_sutun", "ad": "tutar", "ifade": "adet * fiyat"},
        {"tur": "sutun_bol", "sutun": "ad", "ayirici": " "},
        {"tur": "yeniden_adlandir", "sutun": "ad.1", "yeni_ad": "Isim"},
        {"tur": "sorgu_birlestir", "tablo": "Ref", "sol": ["kod"], "sag": ["kod"], "sutunlar": ["grup"]},
        {"tur": "satir_filtrele", "sutun": "tutar", "islem": "buyuk", "degerler": [20]},
    ])
    assert cols == ["kod", "Isim", "ad.2", "sehir", "adet", "fiyat", "tarih", "tutar", "grup"]
    assert len(rows) == 1 and rows[0][1] == "Ahmet" and rows[0][3] == "İstanbul" and rows[0][-1] == "Bayi"


def test_type_change_turns_bad_values_into_null(con):
    b = build(con.cursor(), "t", parse_steps([{"tur": "tip_degistir", "sutun": "tarih", "tip": "date"}]), {})
    assert dict(b.columns)["tarih"] == "DATE"
    assert [r[0] for r in con.execute(f"SELECT tarih FROM ({b.sql})").fetchall()][1] is None


def test_group_and_unpivot(con):
    cols, rows = run(con, [{"tur": "grupla", "gruplar": ["kod"], "toplamalar": [
        {"sutun": "adet", "islem": "toplam", "ad": "Adet"}, {"islem": "say", "ad": "Satır"}]}])
    assert cols == ["kod", "Adet", "Satır"] and sorted(rows) == [("C001", 10, 1), ("C002", 10, 2)]
    cols, rows = run(con, [{"tur": "sutun_sec", "sutunlar": ["kod", "adet", "fiyat"]},
                           {"tur": "tip_degistir", "sutun": "adet", "tip": "double"},
                           {"tur": "tip_degistir", "sutun": "fiyat", "tip": "double"},
                           {"tur": "ters_ozet", "sutunlar": ["adet", "fiyat"]}])
    assert cols == ["kod", "Nitelik", "Değer"] and len(rows) == 6


def test_filters_and_replace(con):
    assert len(run(con, [{"tur": "satir_filtrele", "sutun": "ad", "islem": "icerir", "degerler": ["kaya"]}])[1]) == 2
    assert len(run(con, [{"tur": "satir_filtrele", "sutun": "kod", "islem": "icinde_degil", "degerler": ["C001"]}])[1]) == 2
    assert len(run(con, [{"tur": "satir_filtrele", "sutun": "adet", "islem": "arasinda", "degerler": [6, 20]}])[1]) == 1
    _, rows = run(con, [{"tur": "deger_degistir", "sutun": "kod", "bul": "C00", "yerine": "M-"}])
    assert rows[0][0] == "M-1"
    _, rows = run(con, [{"tur": "deger_degistir", "sutun": "adet", "bul": 5, "yerine": 50}])
    assert sorted(r[3] for r in rows) == [10, 50, 50]
    _, rows = run(con, [{"tur": "sutun_birlestir", "sutunlar": ["kod", "sehir"], "ayirici": "-", "yeni_ad": "Anahtar"},
                        {"tur": "sorgu_ekle", "tablolar": ["ref"]}])
    assert len(rows) == 5


@pytest.mark.parametrize("steps, index, text", [
    ([{"tur": "sutun_kaldir", "sutunlar": ["yok"]}], 0, "'yok' sütunu yok"),
    ([{"tur": "metin", "sutun": "ad", "islem": "kirp"}, {"tur": "yeniden_adlandir", "sutun": "sehir", "yeni_ad": "ad"}],
     1, "zaten var"),
    ([{"tur": "ozel_sutun", "ad": "x", "ifade": "(SELECT 1)"}], 0, "yalnızca bir ifade"),
    ([{"tur": "ozel_sutun", "ad": "x", "ifade": "read_csv('c:/a.csv')"}], 0, "kullanılamaz"),
    ([{"tur": "ozel_sutun", "ad": "x", "ifade": "getenv('PATH')"}], 0, "kullanılamaz"),
    ([{"tur": "ozel_sutun", "ad": "x", "ifade": "1; DROP TABLE t"}], 0, ""),
    ([{"tur": "sorgu_birlestir", "tablo": "Yok", "sol": ["kod"], "sag": ["kod"], "sutunlar": ["grup"]}], 0, "modelde yok"),
])
def test_step_errors_name_the_step(con, steps, index, text):
    with pytest.raises(StepError) as e:
        build(con.cursor(), "t", parse_steps(steps), {"ref": "ref"})
    assert e.value.index == index and text in e.value.message


# ------------------------------------------------------------------ belge: önizleme, uygula, yenile
def preview(client, tbl, steps, upto=None):
    r = client.post("/document/transform/preview", headers=H, json={"table": tbl, "adimlar": steps, "upto": upto})
    assert r.status_code == 200, r.text
    return r.json()


def apply(client, tbl, steps):
    return client.post("/document/transform/apply", headers=H, json={"table": tbl, "adimlar": steps})


def test_preview_steps_and_error_position(client):
    do_import(client, ["OCRD"])
    steps = [{"tur": "metin", "sutun": "CardName", "islem": "buyuk"},
             {"tur": "sutun_kaldir", "sutunlar": ["Yok"]}]
    p = preview(client, "OCRD", steps)
    assert p["error"]["step"] == 1 and "Sütunları kaldır" in p["error"]["message"]
    assert p["rows"][0][1] == "ANADOLU GIDA" and p["applied"] == 1      # son geçerli adımın sonucu
    p = preview(client, "OCRD", steps, upto=0)
    assert p["error"] is None and p["rows"][0][1] == "Anadolu Gıda"
    r = client.post("/document/transform/preview", headers=H, json={"table": "OCRD", "adimlar": [{"tur": "uydurma"}]})
    assert r.status_code == 400 and r.json()["error"]["code"] == "transform_invalid"


def test_apply_steps_updates_model_keeps_relationships(client):
    do_import(client, ["OINV", "OCRD"])
    ops(client, {"op": "update_column", "table": "OCRD", "column": "CardName", "bicim": "@"})
    r = apply(client, "OCRD", [
        {"tur": "yeniden_adlandir", "sutun": "CardName", "yeni_ad": "Müşteri"},
        {"tur": "ozel_sutun", "ad": "Bölge", "ifade": "CASE WHEN \"SlpCode\" = 1 THEN 'Batı' ELSE 'Doğu' END"},
        {"tur": "sutun_kaldir", "sutunlar": ["SlpCode"]},
    ])
    assert r.status_code == 200, r.text
    d = doc(client)
    assert [c["ad"] for c in table(d, "OCRD")["sutunlar"]] == ["CardCode", "Müşteri", "Bölge"]
    assert column(d, "OCRD", "Müşteri")["bicim"] == "@"                 # yeniden adlandırılan sütun özelliklerini korur
    assert ("OINV[CardCode]", "OCRD[CardCode]") in td.rels(d)
    rows = client.get("/document/tables/OCRD/preview", headers=H).json()["rows"]
    assert rows[0] == ["C001", "Anadolu Gıda", "Batı"]
    assert len(table(d, "OCRD")["sorgu"]["adimlar"]) == 3

    # adımlar kaldırılınca ham veri geri gelir; sütun eski adına döner, özellikleri korunur
    assert apply(client, "OCRD", []).status_code == 200
    d = doc(client)
    assert [c["ad"] for c in table(d, "OCRD")["sutunlar"]] == ["CardCode", "CardName", "SlpCode"]
    assert column(d, "OCRD", "CardName")["bicim"] == "@"


def test_type_step_changes_model_type(client):
    do_import(client, ["OINV"])
    assert apply(client, "OINV", [{"tur": "tip_degistir", "sutun": "DocNum", "tip": "string"}]).status_code == 200
    assert column(doc(client), "OINV", "DocNum")["tip"] == "string"
    # modelde yapılan tip değişikliği, adımlar yeniden uygulanınca korunur
    ops(client, {"op": "update_column", "table": "OINV", "column": "DocEntry", "tip": "string"})
    assert apply(client, "OINV", [{"tur": "tip_degistir", "sutun": "DocNum", "tip": "string"},
                                  {"tur": "satir_filtrele", "sutun": "DocTotal", "islem": "buyuk", "degerler": [50]}]
                 ).status_code == 200
    d = doc(client)
    assert column(d, "OINV", "DocEntry")["tip"] == "string" and d["stats"]["OINV"]["rows"] == 2


def test_merge_append_and_refresh_order(client):
    do_import(client, ["OINV", "OCRD", "OSLP"])
    r = apply(client, "OINV", [{"tur": "sorgu_birlestir", "tablo": "OCRD", "sol": ["CardCode"], "sag": ["CardCode"],
                                "sutunlar": ["CardName"], "onek": "Müşteri."}])
    assert r.status_code == 200, r.text
    assert column(doc(client), "OINV", "Müşteri.CardName")["tip"] == "string"
    # OCRD de dönüştürülünce ona bağlı OINV yeniden kurulur
    assert apply(client, "OCRD", [{"tur": "metin", "sutun": "CardName", "islem": "buyuk"}]).status_code == 200
    rows = client.get("/document/tables/OINV/preview", headers=H).json()["rows"]
    assert rows[0][-1] == "ANADOLU GIDA"
    # döngü reddedilir
    r = apply(client, "OCRD", [{"tur": "sorgu_ekle", "tablolar": ["OINV"]}])
    assert r.status_code == 400 and r.json()["error"]["code"] == "transform_cycle"

    # yenileme: yeni ham veri gelir, adımlar sırayla yeniden uygulanır
    cols, rows = td.SOURCE.tables[("dbo", "OCRD")]
    td.SOURCE.tables[("dbo", "OCRD")] = (cols, [("C001", "Yeni Ad", 1), ("C002", "Ege Yapı", 2)])
    job = wait(client, client.post("/document/refresh", headers=H, json={"tables": ["OCRD"]}).json())
    assert job["status"] == "succeeded", job
    rows = client.get("/document/tables/OINV/preview", headers=H).json()["rows"]
    assert rows[0][-1] == "YENI AD"


def test_refresh_fails_cleanly_when_step_breaks(client):
    do_import(client, ["OCRD"])
    apply(client, "OCRD", [{"tur": "sutun_kaldir", "sutunlar": ["SlpCode"]}])
    cols, rows = td.SOURCE.tables[("dbo", "OCRD")]
    td.SOURCE.tables[("dbo", "OCRD")] = (cols[:2], [r[:2] for r in rows])     # kaynakta SlpCode kalktı
    job = wait(client, client.post("/document/refresh", headers=H).json())
    assert job["status"] == "failed"
    assert "Adım 1" in job["error"]["message"] and "SlpCode" in job["error"]["message"]
    assert doc(client)["stats"]["OCRD"]["rows"] == 2                     # eski veri yerinde


def test_steps_survive_save_and_open(client, tmp_path):
    do_import(client, ["OCRD"])
    apply(client, "OCRD", [{"tur": "satir_filtrele", "sutun": "CardCode", "islem": "esit", "degerler": ["C002"]}])
    path = str(tmp_path / "pq.floem")
    assert client.post("/document/save", headers=H, json={"path": path}).status_code == 200
    assert client.post("/document/open", headers=H, json={"path": path}).status_code == 200
    d = doc(client)
    assert d["stats"]["OCRD"]["rows"] == 1 and table(d, "OCRD")["sorgu"]["adimlar"][0]["tur"] == "satir_filtrele"
    p = preview(client, "OCRD", [])                                        # ham veri de dosyada
    assert len(p["rows"]) == 2


def test_delete_table_drops_raw(client, tmp_path):
    do_import(client, ["OCRD", "OSLP"])
    apply(client, "OCRD", [{"tur": "metin", "sutun": "CardName", "islem": "kucuk"}])
    assert ops(client, {"op": "delete_table", "table": "OCRD"}).status_code == 200
    path = tmp_path / "sil.floem"
    assert client.post("/document/save", headers=H, json={"path": str(path)}).status_code == 200
    with zipfile.ZipFile(path) as z:
        (tmp_path / "data.duckdb").write_bytes(z.read("data.duckdb"))
    con = duckdb.connect(str(tmp_path / "data.duckdb"), read_only=True)
    names = {r[0] for r in con.execute("SELECT table_name FROM duckdb_tables()").fetchall()}
    con.close()
    assert "OSLP" in names and not any(n.startswith("OCRD") for n in names)
