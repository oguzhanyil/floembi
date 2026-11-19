"""F06 demo yıldız modeli; tüm yazmalar yalnız yerel DuckDB anlık görüntüsünedir."""
from __future__ import annotations

from .document.document import Document
from .model.schema import Iliski, Olcu, Sutun, Tablo, TabloKaynak, TarihTablosu, parse_column_ref


# Adlar kapsamı açık tutar: kur seçimi, maliyet kapsamı, belge indirimi ve
# muhasebe mutabakatı olmayan bu ölçüler özgün Power BI ölçüleri sayılmaz.
MEASURES: dict[str, list[tuple[str, str, str]]] = {
    "Satis": [
        ("Yerel net satış · satır", "SUM(Satis[NetSatis])", "#,0.00"),
        ("Yerel satış faturası · satır", 'CALCULATE([Yerel net satış · satır], KEEPFILTERS(Satis[BelgeTuru] = "Fatura"))', "#,0.00"),
        ("Yerel satış iadesi · satır", '-CALCULATE([Yerel net satış · satır], KEEPFILTERS(Satis[BelgeTuru] = "İade"))', "#,0.00"),
        ("Yerel açık satış siparişi", "SUM(Satis[AcikSiparis])", "#,0.00"),
        ("Yerel satır brüt kârı", "SUM(Satis[BrutKar])", "#,0.00"),
        ("Yerel satır brüt kâr oranı", "DIVIDE([Yerel satır brüt kârı], [Yerel net satış · satır])", "0.0%"),
        ("Satış faturası adedi", 'CALCULATE(DISTINCTCOUNT(Satis[BelgeKimlik]), KEEPFILTERS(Satis[BelgeTuru] = "Fatura"))', "#,0"),
        ("Ortalama yerel fatura · satır", "DIVIDE([Yerel satış faturası · satır], [Satış faturası adedi])", "#,0.00"),
        ("Satış yapan muhatap", 'CALCULATE(DISTINCTCOUNT(Satis[MuhatapKey]), KEEPFILTERS(Satis[BelgeTuru] IN {"Fatura", "İade"}))', "#,0"),
        ("Satış belge satırı", "COUNTROWS(Satis)", "#,0"),
    ],
    "Satinalma": [
        ("Yerel alış faturası · satır", "SUM(Satinalma[FaturaTutar])", "#,0.00"),
        ("Yerel açık satınalma siparişi", "SUM(Satinalma[AcikSiparisTutar])", "#,0.00"),
        ("Yerel satınalma siparişi", "SUM(Satinalma[SiparisTutar])", "#,0.00"),
    ],
    "Cari": [
        ("Cari yerel borç", "SUM(Cari[Borc])", "#,0.00"),
        ("Cari yerel alacak", "SUM(Cari[Alacak])", "#,0.00"),
        ("Cari dönem hareketi", "[Cari yerel borç] - [Cari yerel alacak]", "#,0.00"),
        ("Cari açılış bakiyesi", "VAR IlkGun = MIN(Tarih[Tarih]) RETURN CALCULATE([Cari dönem hareketi], REMOVEFILTERS(Tarih), Tarih[Tarih] < IlkGun)", "#,0.00"),
        ("Cari kapanış bakiyesi", "VAR SonGun = MAX(Tarih[Tarih]) RETURN CALCULATE([Cari dönem hareketi], REMOVEFILTERS(Tarih), Tarih[Tarih] <= SonGun)", "#,0.00"),
    ],
    "Finans": [
        ("Yerel muhasebe borcu", "SUM(Finans[Borc])", "#,0.00"),
        ("Yerel muhasebe alacağı", "SUM(Finans[Alacak])", "#,0.00"),
        ("Muhasebe dönem hareketi", "[Yerel muhasebe borcu] - [Yerel muhasebe alacağı]", "#,0.00"),
        ("Muhasebe açılış bakiyesi", "VAR IlkGun = MIN(Tarih[Tarih]) RETURN CALCULATE([Muhasebe dönem hareketi], REMOVEFILTERS(Tarih), Tarih[Tarih] < IlkGun)", "#,0.00"),
        ("Muhasebe kapanış bakiyesi", "VAR SonGun = MAX(Tarih[Tarih]) RETURN CALCULATE([Muhasebe dönem hareketi], REMOVEFILTERS(Tarih), Tarih[Tarih] <= SonGun)", "#,0.00"),
    ],
    "Firsat": [
        ("Demo fırsat sayısı", "COUNTROWS(Firsat)", "#,0"),
        ("Demo açık fırsat sayısı", "SUM(Firsat[AcikAdet])", "#,0"),
        ("Demo açık fırsat tutarı", "SUM(Firsat[AcikTutar])", "#,0.00"),
        ("Demo ağırlıklı fırsat tutarı", "SUM(Firsat[AgirlikliTutar])", "#,0.00"),
    ],
    "Aktivite": [
        ("Demo aktivite sayısı", "COUNTROWS(Aktivite)", "#,0"),
        ("Demo açık aktivite sayısı", "SUM(Aktivite[AcikAdet])", "#,0"),
    ],
}


def _q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _key(column: str) -> str:
    # JSON çifti; ayraç içeren kodlar ile NULL/boş kod birbirine karışmaz.
    return f"CAST(to_json(list_value(FirmaKod, CAST({_q(column)} AS VARCHAR))) AS VARCHAR)"


def validate_keys(doc: Document) -> list[dict]:
    """Boyut tekilliği ve boş olmayan dış anahtarlar. Değerleri günlüğe dökmez."""
    result = []
    for rel in doc.tanim.iliskiler:
        fact, fk = parse_column_ref(rel.kimden)
        dimension, pk = parse_column_ref(rel.kime)
        fact_sql, dim_sql = f"veri.{_q(fact)}", f"veri.{_q(dimension)}"
        duplicate, nulls = doc.con.execute(
            f"SELECT COUNT(*) - COUNT(DISTINCT {_q(pk)}), COUNT(*) FILTER (WHERE {_q(pk)} IS NULL) FROM {dim_sql}"
        ).fetchone()
        orphan = doc.con.execute(
            f"SELECT COUNT(*) FROM {fact_sql} f WHERE f.{_q(fk)} IS NOT NULL AND NOT EXISTS "
            f"(SELECT 1 FROM {dim_sql} d WHERE f.{_q(fk)} = d.{_q(pk)})"
        ).fetchone()[0]
        missing = doc.con.execute(f"SELECT COUNT(*) FROM {fact_sql} WHERE {_q(fk)} IS NULL").fetchone()[0]
        result.append({"from": rel.kimden, "to": rel.kime, "duplicateKeys": duplicate,
                       "nullDimensionKeys": nulls, "orphanRows": orphan, "nullFactKeys": missing})
        if duplicate or nulls or orphan:
            raise ValueError(f"{fact} → {dimension}: tekillik veya referans bütünlüğü sağlanmadı; dosya kaydedilmedi")
    return result


def annotate_audit(audit: dict, doc: Document) -> None:
    """135 kaynak ölçü satırını korur; sınırlı demo uyarlamalarını ayrıca işaretler."""
    measures = {
        "Net Satış": "Yerel net satış · satır", "Satış Faturası Tutarı": "Yerel satış faturası · satır",
        "Satış İadesi Tutarı": "Yerel satış iadesi · satır", "Satış Brüt Kârı": "Yerel satır brüt kârı",
        "Satış Brüt Kâr Marjı": "Yerel satır brüt kâr oranı", "Satış Fatura Adedi": "Satış faturası adedi",
        "Ortalama Fatura Tutarı": "Ortalama yerel fatura · satır", "Müşteri Sayısı": "Satış yapan muhatap",
        "Açık Satış Siparişi": "Yerel açık satış siparişi", "Alış Faturası Tutarı": "Yerel alış faturası · satır",
        "Açık Satınalma Siparişi": "Yerel açık satınalma siparişi", "Satınalma Siparişi Tutarı": "Yerel satınalma siparişi",
        "Yerel Borç": "Yerel muhasebe borcu", "Yerel Alacak": "Yerel muhasebe alacağı",
        "Devir Bakiye": "Muhasebe açılış bakiyesi", "Kapanış Bakiye": "Muhasebe kapanış bakiyesi",
        "Fırsat Sayısı": "Demo fırsat sayısı", "Açık Fırsat Sayısı": "Demo açık fırsat sayısı",
        "Açık Fırsat Tutarı": "Demo açık fırsat tutarı", "Ağırlıklı Beklenen Gelir": "Demo ağırlıklı fırsat tutarı",
        "Aktivite Sayısı": "Demo aktivite sayısı",
    }
    installed = {m.ad for table in doc.tanim.tablolar for m in table.olculer}
    scope = "Tek firma / yerel satır tutarı; kur, maliyet kapsamı, belge indirimi ve kaynak sonuç eşdeğerliği doğrulanmadı."
    for item in audit["measures"]:
        name = measures.get(item["name"])
        if name in installed:
            item.update(demoMeasure=name, adaptationScope=scope, sourceEquivalent=False)

    tables = {"Firma": "Firma", "Tarih": "Tarih", "Muhatap": "MuhatapBoyut", "Kalem": "Urun",
              "Hesap": "HesapBoyut", "Satış Elemanı": "SatisTemsilcisi", "Hareket": "Cari",
              "Satış Belge": "Satis", "Satınalma Belge": "Satinalma", "Fırsat": "Firsat", "Aktivite": "Aktivite"}
    columns = {"Firma": "FirmaKod", "FirmaAdi": "Firma", "Yıl": "Yil", "Dönem": "Donem",
               "KalemKey": "UrunKey", "KalemKodu": "UrunKod", "MuhatapKodu": "MuhatapKod",
               "HesapKodu": "HesapKod", "FisTarihi": "Tarih", "BorcTutar": "Borc", "AlacakTutar": "Alacak"}
    actual = {t.ad: {c.ad for c in t.sutunlar} for t in doc.tanim.tablolar}
    scopes = {
        "Hareket": "Yalnız muhatap yevmiye kayıtları; tam muhasebe hareketi değildir.",
        "Kalem": "Satır kodundan ürün boyutu; ürün ana verisi/adı/grubu taşınmadı.",
        "Hesap": "Yalnız hareket bulunan hesaplar; kaynak hesap planı hiyerarşisi taşınmadı.",
        "Satış Belge": "Yerel satırlar; kaynak belge/kur/maliyet kapsamı doğrulanmadı.",
        "Satınalma Belge": "Fatura ve sipariş satırları; satınalma iadeleri kapsamda yok.",
    }
    mappings = []
    for table in audit["tables"]:
        target_table = tables.get(table["table"])
        for column in table["columns"]:
            target_column = columns.get(column, column)
            # MuhatapBoyut ve Urun yalnız kod/etiket taşır; ana veri ayrıntıları
            # (grup, ülke, ürün adı vb.) varmış gibi eşlenmez.
            target = f"{target_table}[{target_column}]" if target_column in actual.get(target_table, set()) else None
            mappings.append({"source": f"{table['table']}[{column}]", "target": target,
                             "keyEncodingChanged": column.endswith("Key") and target is not None,
                             "equivalenceVerified": False,
                             "scope": scopes.get(table["table"], "Tek firmalı yerel demo alt kümesi; kaynak sonuç eşdeğerliği doğrulanmadı.")})
    audit.update(fieldMappings=mappings, keyChecks=validate_keys(doc),
                 installedDemoMeasures=sorted(installed), demoValidated=True)
    audit["summary"].update(installedDemoMeasures=len(installed),
                            demoAdaptations=sum("demoMeasure" in item for item in audit["measures"]),
                            mappedFields=sum(m["target"] is not None for m in mappings),
                            exactTransfers=0)


def apply_semantic_model(doc: Document, report: dict) -> list[dict]:
    """Yeni üretilen demo üzerinde ortak boyutlar ve gerçek FDX ölçüleri kurar."""
    facts = list(doc.tanim.tablolar)
    for table in facts:
        doc.con.execute(f"ALTER TABLE veri.{_q(table.ad)} ADD COLUMN FirmaKod VARCHAR DEFAULT 'DEMO_FIRMA1'")
        table.sutunlar.append(Sutun(ad="FirmaKod", gizli=True, ozet="none"))
        for code, key in (("MuhatapKod", "MuhatapKey"), ("UrunKod", "UrunKey"),
                          ("HesapKod", "HesapKey"), ("SatisElemaniKod", "SatisElemaniKey")):
            if not any(c.ad == code for c in table.sutunlar):
                continue
            doc.con.execute(f"ALTER TABLE veri.{_q(table.ad)} ADD COLUMN {_q(key)} VARCHAR")
            doc.con.execute(f"UPDATE veri.{_q(table.ad)} SET {_q(key)} = {_key(code)}")
            table.sutunlar.append(Sutun(ad=key, gizli=True, ozet="none"))

    def dimension(name: str, columns: list[tuple[str, str]], query: str) -> Tablo:
        doc.con.execute(f"CREATE TABLE veri.{_q(name)} AS {query}")
        table = Tablo(ad=name, kaynak=TabloKaynak(katman="veri", tablo=name),
                      sutunlar=[Sutun(ad=col, tip=typ, anahtar=i == 0, gizli=col.endswith("Key"), ozet="none")
                                for i, (col, typ) in enumerate(columns)])
        doc.tanim.tablolar.append(table)
        return table

    dimension("Firma", [("FirmaKod", "string"), ("Firma", "string")],
              "SELECT 'DEMO_FIRMA1' AS FirmaKod, 'Demo Sanayi ve Ticaret A.Ş.' AS Firma")
    date_union = " UNION ALL ".join(f"SELECT Tarih FROM veri.{_q(t.ad)}" for t in facts if any(c.ad == "Tarih" for c in t.sutunlar))
    date = dimension("Tarih", [("Tarih", "date"), ("Yil", "int64"), ("Ay", "int64"), ("Donem", "string")], f"""
        WITH sinir AS (SELECT MIN(Tarih) AS ilk, MAX(Tarih) AS son FROM ({date_union}))
        SELECT CAST(d AS DATE) AS Tarih, YEAR(d) AS Yil, MONTH(d) AS Ay, strftime(d, '%Y-%m') AS Donem
        FROM sinir, generate_series(date_trunc('year', ilk), date_trunc('year', son) + INTERVAL '1 year' - INTERVAL '1 day', INTERVAL '1 day') t(d)
    """)
    date.tarih_tablosu = TarihTablosu(anahtar_sutun="Tarih")
    dimension("MuhatapBoyut", [("MuhatapKey", "string"), ("MuhatapKod", "string"), ("Muhatap", "string"), ("Tur", "string")], """
        SELECT MuhatapKey, MuhatapKod, Muhatap, Tur FROM veri.Muhatap
        UNION ALL SELECT '["DEMO_FIRMA1",null]', NULL, 'Muhatap atanmamış', 'Belirsiz'
    """)
    dimension("Urun", [("UrunKey", "string"), ("UrunKod", "string"), ("Urun", "string")], """
        SELECT DISTINCT UrunKey, UrunKod, COALESCE(UrunKod, 'Hizmet / ürün atanmamış') AS Urun
        FROM (SELECT UrunKey, UrunKod FROM veri.Satis UNION ALL SELECT UrunKey, UrunKod FROM veri.Satinalma)
    """)
    dimension("HesapBoyut", [("HesapKey", "string"), ("HesapKod", "string"), ("Hesap", "string")],
              "SELECT DISTINCT HesapKey, HesapKod, Hesap FROM veri.Finans")
    salesperson = " UNION ALL ".join(f"SELECT SatisElemaniKey, SatisElemaniKod, SatisElemani FROM veri.{_q(t.ad)}"
                                    for t in facts if any(c.ad == "SatisElemaniKey" for c in t.sutunlar))
    dimension("SatisTemsilcisi", [("SatisElemaniKey", "string"), ("SatisElemaniKod", "int64"), ("SatisElemani", "string")],
              f"SELECT DISTINCT * FROM ({salesperson})")
    for table in facts:
        for fk, target, pk in (("FirmaKod", "Firma", "FirmaKod"), ("Tarih", "Tarih", "Tarih"),
                               ("MuhatapKey", "MuhatapBoyut", "MuhatapKey"), ("UrunKey", "Urun", "UrunKey"),
                               ("HesapKey", "HesapBoyut", "HesapKey"), ("SatisElemaniKey", "SatisTemsilcisi", "SatisElemaniKey")):
            if any(c.ad == fk for c in table.sutunlar):
                doc.tanim.iliskiler.append(Iliski(kimden=f"{table.ad}[{fk}]", kime=f"{target}[{pk}]"))
        table.olculer = [Olcu(ad=name, ifade=expression, bicim=fmt, klasor="F06 · Yerel demo",
                             aciklama="Yerel anlık görüntü; kur seçimi ve belge düzeyi indirim/vergi içermez. Özgün Power BI ölçüsüyle eşdeğerliği doğrulanmadı.")
                        for name, expression, fmt in MEASURES.get(table.ad, [])]
    Document.validate(doc.tanim)
    checks = validate_keys(doc)
    _bind_report(report)
    return checks


def _bind_report(report: dict) -> None:
    # Kullanıcı yeni dosyayı açınca kartların gerçek ölçüleri kullanması ve ortak
    # müşteri/tarih seçimlerinin diğer olgu tablolarına yayılması sağlanır.
    metrics = {
        ("Satis", "NetSatis"): "Yerel net satış · satır", ("Satis", "AcikSiparis"): "Yerel açık satış siparişi",
        ("Satis", "BrutKar"): "Yerel satır brüt kârı", ("Satis", "SatirAdedi"): "Satış belge satırı",
        ("Satinalma", "FaturaTutar"): "Yerel alış faturası · satır", ("Satinalma", "AcikSiparisTutar"): "Yerel açık satınalma siparişi",
        ("Satinalma", "SiparisTutar"): "Yerel satınalma siparişi", ("Cari", "Borc"): "Cari yerel borç",
        ("Cari", "Alacak"): "Cari yerel alacak", ("Cari", "Bakiye"): "Cari dönem hareketi",
        ("Finans", "Borc"): "Yerel muhasebe borcu", ("Finans", "Alacak"): "Yerel muhasebe alacağı",
        ("Finans", "Bakiye"): "Muhasebe dönem hareketi", ("Firsat", "Adet"): "Demo fırsat sayısı",
        ("Firsat", "AcikAdet"): "Demo açık fırsat sayısı", ("Firsat", "AcikTutar"): "Demo açık fırsat tutarı",
        ("Firsat", "AgirlikliTutar"): "Demo ağırlıklı fırsat tutarı", ("Aktivite", "Adet"): "Demo aktivite sayısı",
        ("Aktivite", "AcikAdet"): "Demo açık aktivite sayısı",
    }
    for page in report["pages"]:
        for visual in page["visuals"]:
            for index, ref in enumerate(visual.get("values", [])):
                name = metrics.get((ref.get("table"), ref.get("column")))
                if name and ref.get("agg", "sum") == "sum":
                    visual["values"][index] = {"measure": name}
            for ref in visual.get("group", []):
                column = ref.get("column")
                if column in ("Tarih", "Donem"):
                    ref["table"] = "Tarih"
                elif column in ("Muhatap", "MuhatapKod"):
                    ref["table"] = "MuhatapBoyut"

    from .demo_port import _base, _cards, _visual, _field

    page = _base("ortak-model", "Ortak Model · Dönem ve Muhatap", "Ortak tarih ve muhatap filtresi · Yerel para birimi · Açılış/kapanış tarih sınırını esas alır")
    _cards(page, [("Yerel net satış · satır", "Satis", "NetSatis"), ("Açık satış siparişi", "Satis", "AcikSiparis"),
                  ("Cari dönem hareketi", "Cari", "Bakiye"), ("Cari kapanış bakiyesi", "Cari", "Bakiye")])
    for visual, name in zip([v for v in page["visuals"] if v["type"] == "card"],
                            ["Yerel net satış · satır", "Yerel açık satış siparişi", "Cari dönem hareketi", "Cari kapanış bakiyesi"]):
        visual["values"] = [{"measure": name}]
    page["visuals"].extend([
        _visual("slicer", "ortak-tarih", "Dönem", 24, 305, 250, 220, "Tarih", ("Donem",)),
        _visual("slicer", "ortak-muhatap", "Muhatap", 24, 541, 250, 275, "MuhatapBoyut", ("Muhatap",)),
        {**_visual("table", "ortak-karsilastirma", "Muhatap bazında ortak filtre", 290, 305, 966, 511,
                   extra={"gridFitColumns": True}),
         "group": [_field("MuhatapBoyut", "Muhatap")],
         "values": [{"measure": n} for n in ["Yerel net satış · satır", "Yerel açık satış siparişi",
                                             "Cari açılış bakiyesi", "Cari dönem hareketi", "Cari kapanış bakiyesi"]]},
    ])
    # Menüye yeni sayfaya geçiş; mevcut sayfaların nesne yerleşimini değiştirmez.
    report["pages"].append(page)
    for item in report["pages"]:
        buttons = [v for v in item["visuals"] if v["id"].startswith(item["id"] + "-nav-")]
        for index, button in enumerate(buttons):
            button.update(x=30 + index * 136, w=125)
        button = _visual("button", f"{item['id']}-nav-ortak", "", 1118, 109, 125, 42,
                         extra={"showTitle": False, "text": "Model", "buttonStyle": "solid", "padding": 0, "shadow": False,
                                "buttonColor": "#0ea5e9" if item["id"] == "ortak-model" else "#264a72",
                                "buttonTextColor": "#ffffff", "action": {"type": "page", "pageId": "ortak-model"}})
        item["visuals"].append(button)
