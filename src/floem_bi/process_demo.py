"""F12: bağlantısız, yeniden üretilebilir müşteri 360 ve parti/kalite süreç pilotu."""
from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from .document.document import Document
from .model import ModelTanimi


MEASURES = {
    "Satis": [
        ("Dönem net satışı", "SUM(Satis[Tutar])", "₺ #,##0.00"),
        ("Dönem belge adedi", "DISTINCTCOUNT(Satis[BelgeKey])", "#,0"),
    ],
    "Hareket": [
        ("Cari net hareket", "SUM(Hareket[Borc]) - SUM(Hareket[Alacak])", "₺ #,##0.00"),
        ("Açılış bakiyesi", "VAR Gun = MIN(Tarih[Tarih]) RETURN CALCULATE([Cari net hareket], REMOVEFILTERS(Tarih), Tarih[Tarih] < Gun)", "₺ #,##0.00"),
        ("Dönem sonu bakiyesi", "VAR Gun = MAX(Tarih[Tarih]) RETURN CALCULATE([Cari net hareket], REMOVEFILTERS(Tarih), Tarih[Tarih] <= Gun)", "₺ #,##0.00"),
        ("Vadesi geçmiş net kalem", "VAR Gun = MAX(Tarih[Tarih]) RETURN CALCULATE([Cari net hareket], REMOVEFILTERS(Tarih), Tarih[Tarih] <= Gun, Hareket[Vade] < Gun)", "₺ #,##0.00"),
        ("Dönem tahsilatı", 'CALCULATE(SUM(Hareket[Alacak]), Belge[Tur] = "Tahsilat")', "₺ #,##0.00"),
    ],
    "IsOlayi": [
        ("Açık iş · dönem sonu", "VAR Gun = MAX(Tarih[Tarih]) RETURN CALCULATE(SUM(IsOlayi[AcikDegisim]), REMOVEFILTERS(Tarih), Tarih[Tarih] <= Gun)", "#,0"),
        ("Açık fırsat · dönem sonu", "VAR Gun = MAX(Tarih[Tarih]) RETURN CALCULATE(SUM(IsOlayi[FirsatDegisim]), REMOVEFILTERS(Tarih), Tarih[Tarih] <= Gun)", "₺ #,##0.00"),
    ],
    "Olay": [("Olay adedi", "COUNTROWS(Olay)", "#,0")],
    "Parti": [("Tekil parti miktarı", "IF(HASONEVALUE(Parti[Birim]), SUM(Parti[Miktar]), BLANK())", "#,##0.00"), ("Parti adedi", "DISTINCTCOUNT(Parti[Key])", "#,0")],
    "Kalite": [("Kalite kayıt adedi", "COUNTROWS(Kalite)", "#,0"), ("Sınır dışı kayıt", "SUM(Kalite[SinirDisi])", "#,0"), ("Kararsız kayıt", "SUM(Kalite[Kararsiz])", "#,0")],
}

TABLES = {
    "Firma": [("Kod", "string"), ("Ad", "string")],
    "Musteri": [("Key", "string"), ("FirmaKod", "string"), ("Kod", "string"), ("Ad", "string"), ("Durum", "string")],
    "Tarih": [("Tarih", "date"), ("Donem", "string")],
    "Belge": [("Key", "string"), ("MusteriKey", "string"), ("Tarih", "date"), ("Kod", "string"), ("Tur", "string"), ("Aciklama", "string")],
    "Satis": [("Key", "string"), ("BelgeKey", "string"), ("Urun", "string"), ("Tutar", "double")],
    "BelgeSatir": [("Key", "string"), ("BelgeKey", "string"), ("Aciklama", "string"), ("Miktar", "double"), ("Birim", "string"), ("Tutar", "double")],
    "Hareket": [("Key", "string"), ("BelgeKey", "string"), ("Kalem", "string"), ("Vade", "date"), ("Borc", "double"), ("Alacak", "double")],
    "IsOlayi": [("Key", "string"), ("BelgeKey", "string"), ("IsKey", "string"), ("AcikDegisim", "int64"), ("FirsatDegisim", "double")],
    "Olay": [("Key", "string"), ("BelgeKey", "string"), ("Tutar", "double")],
    "Parti": [("Key", "string"), ("FirmaKod", "string"), ("Kod", "string"), ("Ad", "string"), ("Tarih", "date"), ("Tur", "string"), ("Miktar", "double"), ("Birim", "string")],
    "Baglanti": [("Key", "string"), ("FirmaKod", "string"), ("Tarih", "date"), ("Kaynak", "string"), ("Hedef", "string"), ("KaynakAd", "string"), ("HedefAd", "string"), ("Birim", "string"), ("Iliski", "string"), ("Miktar", "double")],
    "Kalite": [("Key", "string"), ("PartiKey", "string"), ("Tarih", "date"), ("Test", "string"), ("Birim", "string"), ("Sonuc", "double"), ("Alt", "double"), ("Ust", "double"), ("Hedef", "double"), ("SinirDisi", "int64"), ("Kararsiz", "int64")],
}


def process_model() -> dict:
    rels = [("Musteri[FirmaKod]", "Firma[Kod]"), ("Belge[MusteriKey]", "Musteri[Key]"), ("Belge[Tarih]", "Tarih[Tarih]"),
            ("Parti[FirmaKod]", "Firma[Kod]"), ("Parti[Tarih]", "Tarih[Tarih]"), ("Baglanti[FirmaKod]", "Firma[Kod]"),
            ("Baglanti[Tarih]", "Tarih[Tarih]"), ("Kalite[PartiKey]", "Parti[Key]"), ("Kalite[Tarih]", "Tarih[Tarih]")]
    # Kalite'nin kendi ölçüm tarihi aktiftir; Parti üretim tarihinden ikinci yol yok.
    # Parti tarih ilişkisi pasiftir; üretim dönemi parti tablosundan ayrıca seçilebilir.
    rels += [(f"{name}[BelgeKey]", "Belge[Key]") for name in ["Satis", "BelgeSatir", "Hareket", "IsOlayi", "Olay"]]
    return {"model": {"ad": "F12 · Sentetik Süreç Pilotları"}, "tablolar": [{
        "ad": name, "kaynak": {"katman": "veri", "tablo": name},
        "aciklama": "F12 sentetik doğrulama verisi; gerçek kaynak veya finansal mutabakat değildir.",
        **({"tarih_tablosu": {"anahtar_sutun": "Tarih"}} if name == "Tarih" else {}),
        "sutunlar": [{"ad": c, "tip": t, "anahtar": c in {"Key"} or name == "Firma" and c == "Kod", "gizli": c.endswith("Key") or c == "Key"} for c, t in cols],
        "olculer": [{"ad": n, "ifade": expression, "bicim": fmt, "klasor": "F12 · Doğrulamalı pilot"} for n, expression, fmt in MEASURES.get(name, [])],
    } for name, cols in TABLES.items()],
        "iliskiler": [{"kimden": f, "kime": t, "aktif": f != "Parti[Tarih]"} for f, t in rels],
        "roller": [{"ad": "Örnek Firma F1", "tablo_izinleri": [{"tablo": "Firma", "filtre": '[Kod] = "F1"'}]}]}


def seed_process_data(doc: Document) -> None:
    types = {"string": "VARCHAR", "date": "DATE", "double": "DOUBLE", "int64": "BIGINT"}
    for name, cols in TABLES.items():
        definition = ",".join(f'"{c}" {types[t]}' for c, t in cols)
        doc.con.execute(f'CREATE TABLE veri."{name}" ({definition})')
    doc.con.execute("INSERT INTO veri.Tarih SELECT CAST(d AS DATE), strftime(d,'%Y-%m') FROM generate_series(DATE '2025-12-01', DATE '2026-03-31', INTERVAL 1 DAY) t(d)")
    data = {name: [] for name in TABLES if name != "Tarih"}
    for company in ["F1", "F2"]:
        data["Firma"].append((company, f"{company} · Örnek üretim"))
        scale = 1 if company == "F1" else 10
        for i in range(1, 7):
            customer = f"{company}:C{i:03d}"
            data["Musteri"].append((customer, company, f"C{i:03d}", "Aynı adlı müşteri" if i < 3 else f"Örnek müşteri {i}", "İzlemede" if i == 1 else "Güncel"))
            # C006 hareketi olmayan müşteriyi de sınar.
            if i == 6:
                continue
            factor = scale * i

            def event(code, date, kind, description, amount=0, *, sales=None, debit=0, credit=0, due=None, task=0, opportunity=0):
                key = f"{customer}:{code}"
                data["Belge"].append((key, customer, date, code, kind, description))
                data["Olay"].append((key, key, amount * factor if amount is not None else None))
                data["BelgeSatir"].append((key + ":L1", key, description, 1, "adet", amount * factor if amount is not None else None))
                if sales is not None:
                    for line, value in enumerate(sales):
                        data["Satis"].append((key + f":L{line}", key, f"Örnek ürün {line+1}", value * factor))
                if debit or credit:
                    data["Hareket"].append((key, key, "Örnek açık kalem", due or date, debit * factor, credit * factor))
                if task or opportunity:
                    data["IsOlayi"].append((key, key, customer + ":I1", task, opportunity * factor))

            event("DEVIR", "2025-12-15", "Devir", "Dönem öncesi cari devir", 100, debit=100, due="2025-12-20")
            event("FAT-01", "2026-01-10", "Fatura", "İki satış satırı, tek fatura", 150, sales=[100, 50], debit=150, due="2026-01-31")
            event("IS-AC", "2026-01-20", "Aktivite", "Açılan takip işi ve fırsat", None, task=1, opportunity=500)
            event("FAT-02", "2026-02-10", "Fatura", "Seçili dönem faturası", 200, sales=[200], debit=200, due="2026-03-15")
            event("IADE", "2026-02-11", "İade", "Fatura düzeltmesi", -20, sales=[-20], credit=20, due="2026-03-15")
            # İade tahsilat değildir: tahsilat ölçüsü aşağıda tür filtresiyle hesaplanır.
            event("ODEME", "2026-02-15", "Tahsilat", "Ocak kalemine kısmi ödeme", -80, credit=80, due="2026-01-31")
            if i % 2 == 0:
                event("IS-KAP", "2026-02-18", "Aktivite", "İş kapandı, fırsat kapandı", None, task=-1, opportunity=-500)
            event("GELECEK", "2026-03-10", "Fatura", "Şubat kapanışına girmeyen gelecek kayıt", 999, sales=[999], debit=999, due="2026-04-15")
        batches = {"R1": ("Hammadde A", 1000, "kg", "Hammadde", "2026-01-05"), "R2": ("Hammadde B", 600, "kg", "Hammadde", "2026-01-06"),
                   "M1": ("Karışım A", 900, "kg", "Yarı mamul", "2026-02-08"), "M2": ("Karışım B", 500, "kg", "Yarı mamul", "2026-02-09"),
                   "U1": ("Ürün A", 700, "kg", "Mamul", "2026-02-12"), "U2": ("Ürün B", 600, "kg", "Mamul", "2026-02-13"),
                   "P1": ("Paketleme", 100, "adet", "Ambalaj", "2026-02-15"), "YOK": ("Bağlantısız parti", 0, "kg", "Mamul", "2026-02-16")}
        for code, (name, qty, unit, kind, date) in batches.items():
            data["Parti"].append((f"{company}:{code}", company, code, name, date, kind, qty * scale, unit))
        for n, (source, target, qty, unit, relation) in enumerate([
            ("R1", "M1", 700, "kg", "Tüketim"), ("R2", "M1", 300, "kg", "Tüketim"), ("R1", "M2", 200, "kg", "Tüketim"),
            ("M1", "U1", 500, "kg", "Üretim"), ("M2", "U1", 200, "kg", "Üretim"), ("M1", "U2", 300, "kg", "Üretim"),
            ("U1", "M1", 50, "kg", "Yeniden işleme"), ("U2", "P1", 80, "adet", "Ambalaj")]):
            data["Baglanti"].append((f"{company}:E{n}", company, "2026-02-12", f"{company}:{source}", f"{company}:{target}", batches[source][0], batches[target][0], unit, relation, qty * scale))
        for code in batches:
            for n, (test, unit, result, low, high, goal) in enumerate([
                ("Yoğunluk / A", "g/cm³", 10.0, 9.8, 10.2, 10.0), ("Yoğunluk / B", "g/cm³", 10.4 if code == "U1" else 10.1, 9.8, 10.2, 10),
                ("Sıcaklık", "°C", None if code == "U1" else 22, 20, 25, 22), ("Alt sınır kontrolü", "mm", 5.0, 5.0, 6.0, 5.5)]):
                unknown = result is None or low > high
                data["Kalite"].append((f"{company}:{code}:Q{n}", f"{company}:{code}", "2026-02-20", test, unit, result, low, high, goal,
                                       int(not unknown and (result < low or result > high)), int(unknown)))
    for name, rows in data.items():
        if rows:
            doc.con.executemany(f'INSERT INTO veri."{name}" VALUES ({",".join("?" for _ in rows[0])})', rows)


def process_report() -> dict:
    def node(id, type, x, y, w, h, **props):
        return {"id": id, "type": type, "x": x, "y": y, "w": w, "h": h, "group": [], "values": [], "filters": [],
                "format": {"showTitle": False, "radius": 12, "padding": 14, "backgroundColor": "#ffffff", "borderColor": "#dfe7f0"}, **props}

    def field(table, col): return {"table": table, "column": col}
    def value(name): return {"measure": name}
    def implicit(table, col, agg="min"): return {"table": table, "column": col, "agg": agg}
    def text(id, x, y, w, h, content, size=16):
        return node(id, "text", x, y, w, h, format={"showTitle": False, "text": content, "fontSize": size, "padding": 0, "textOverflow": "wrap", "backgroundColor": "transparent"})
    def button(id, x, y, w, content, action):
        return node(id, "button", x, y, w, 42, format={"showTitle": False, "text": content, "fontSize": 15, "buttonStyle": "solid", "buttonColor": "#175cd3", "action": action, "buttonIcon": "back" if action["type"] == "back" else "arrow"})
    def card(id, x, y, w, title, measure):
        return node(id, "card", x, y, w, 128, values=[value(measure)], format={"showTitle": False, "text": title, "padding": 16, "radius": 14, "animation": "count", "backgroundColor": "#ffffff", "borderColor": "#dfe7f0"})
    def grid(id, x, y, w, h, title, group, values, action=None):
        fmt = {"showTitle": True, "gridDataMode": "server", "gridPageSize": 25, "gridFitColumns": True, "radius": 12, "backgroundColor": "#ffffff"}
        if action: fmt["rowAction"] = {"label": "İncele", "icon": "arrow", "sourceIndex": 0, "action": action}
        return node(id, "table", x, y, w, h, title=title, group=group, values=values, format=fmt)
    def page(id, name, subtitle, visuals, detail=None):
        prefix = [text(id+"-heading", 32, 24, 920, 48, name, 30), text(id+"-subtitle", 32, 79, 1216, 52, subtitle, 15)]
        if detail: prefix.append(button(id+"-back", 1050, 26, 198, "Geri dön", {"type": "back"}))
        all_nodes = prefix + visuals
        if detail:
            for visual in all_nodes:
                if visual["type"] in {"card", "table", "tolerance"}:
                    visual["format"]["detailOnly"] = True
        # Aynı nesneler için okunabilir tek sütun telefon yerleşimi.
        overrides, top = {}, 20
        for v in all_nodes:
            height = 90 if v["id"].endswith("-heading") else 125 if v["id"].endswith("-subtitle") else 46 if v["type"] == "button" else 140 if v["type"] == "card" else 150 if v["type"] == "text" else 110 if v["type"] == "slicer" else 500
            overrides[v["id"]] = {"x": 20, "y": top, "w": 350, "h": height, "format": {"fontSize": 24 if v["id"].endswith("-heading") else 15, "titleSize": 14}}
            top += height + 16
        return {"id": id, "name": name, "width": 1280, "height": max(1000, max(v["y"] + v["h"] for v in all_nodes) + 32), "backgroundColor": "#f2f5fa", "visuals": all_nodes,
                "drillthrough": detail or [], "layouts": [{"id": id+"-phone", "name": "Telefon", "maxWidth": 620, "width": 390, "height": top+16, "displayOption": "FitToWidth", "overrides": overrides}]}

    nav_customer = {"type": "page", "pageId": "customer", "keepContext": True}
    nav_trace = {"type": "page", "pageId": "trace", "keepContext": True}
    filters = [node("company", "slicer", 32, 150, 350, 110, group=[field("Firma", "Kod")], state={"selected": ["F1"]}, format={"showTitle": True, "slicerStyle": "dropdown"}, title="Firma"),
               node("period", "slicer", 402, 150, 350, 110, group=[field("Tarih", "Donem")], state={"selected": ["2026-02"]}, format={"showTitle": True, "slicerStyle": "dropdown"}, title="Dönem")]
    listing = page("customers", "Müşteri çalışma alanı", "SENTETİK PİLOT · Firma ve dönem seçin; satırdaki İncele ile müşteri bağlamını taşıyın. Aynı ad/kod farklı firmalarda farklı müşteridir.", [
        *filters, button("to-batches", 850, 175, 350, "Parti ve kalite çalışma alanı", {"type": "page", "pageId": "batches", "keepContext": True}),
        card("list-sales", 32, 290, 380, "Seçili dönemin net satışı · ₺", "Dönem net satışı"), card("list-close", 438, 290, 380, "Seçili dönem sonu bakiyesi · ₺", "Dönem sonu bakiyesi"), card("list-tasks", 844, 290, 404, "Dönem sonunda açık takip işi", "Açık iş · dönem sonu"),
        grid("customer-list", 32, 452, 1216, 500, "Müşteriler · kod anahtarıyla incele", [field("Musteri", "Key")], [implicit("Musteri", "Ad"), implicit("Musteri", "Kod"), value("Dönem net satışı"), value("Dönem sonu bakiyesi"), value("Açık iş · dönem sonu")], nav_customer),
    ])
    customer = page("customer", "Müşteri 360°", "SENTETİK PİLOT · Satış/tahsilat seçili döneme; bakiye, vade ve açık işler dönem sonuna göredir. Vergi, kur ve kaynak muhasebe mutabakatı içermez.", [
        node("customer-name", "text", 32, 150, 850, 58, bindings={"text": {"source": {"kind": "field", "field": field("Musteri", "Ad")}, "template": "Seçili müşteri: {value}"}}, format={"showTitle": False, "fontSize": 24, "padding": 0}, states={"error": {"text": "Müşteri çalışma alanından bir müşteri seçin"}}),
        node("customer-status", "text", 920, 150, 328, 58, bindings={"text": {"source": {"kind": "field", "field": field("Musteri", "Durum")}, "template": "Durum: {value}"}}, format={"showTitle": False, "fontSize": 18, "padding": 8}),
        card("customer-sales", 32, 240, 380, "Dönem net satışı · ₺", "Dönem net satışı"), card("customer-close", 438, 240, 380, "Dönem sonu bakiyesi · ₺", "Dönem sonu bakiyesi"), card("customer-overdue", 844, 240, 404, "Vadesi geçmiş net kalem · ₺", "Vadesi geçmiş net kalem"),
        card("customer-paid", 32, 390, 380, "Dönem tahsilatı · ₺", "Dönem tahsilatı"), card("customer-jobs", 438, 390, 380, "Dönem sonunda açık takip işi", "Açık iş · dönem sonu"), card("customer-opportunity", 844, 390, 404, "Dönem sonunda açık fırsat · ₺", "Açık fırsat · dönem sonu"),
        grid("customer-events", 32, 552, 1216, 520, "Fatura, tahsilat ve aktivite akışı · belgeyi incele", [field("Belge", "Key"), field("Tarih", "Tarih"), field("Belge", "Tur"), field("Belge", "Aciklama")], [value("Olay adedi")], {"type": "page", "pageId": "document", "keepContext": True}),
    ], [field("Musteri", "Key")])
    document = page("document", "Belge ve olay ayrıntısı", "SENTETİK PİLOT · Müşteri → olay → satır yolunda firma, dönem ve anahtarlar korunur. Geri dön düğmesi seçimlerinizi geri yükler.", [
        node("document-title", "text", 32, 155, 1216, 70, bindings={"text": {"source": {"kind": "field", "field": field("Belge", "Aciklama")}}}, format={"showTitle": False, "fontSize": 24}, states={"error": {"text": "Müşteri akışından bir belge veya olay seçin"}}),
        grid("document-lines", 32, 270, 1216, 610, "Belge/olay satırları · birimler sütunlarda ayrı", [field("BelgeSatir", "Key"), field("BelgeSatir", "Aciklama"), field("BelgeSatir", "Birim")], [implicit("BelgeSatir", "Miktar", "sum"), implicit("BelgeSatir", "Tutar", "sum")]),
    ], [field("Belge", "Key")])
    batches = page("batches", "Parti ve kalite çalışma alanı", "SENTETİK PİLOT · Tekil parti miktarı ana kayıttan gelir. Bağlantı satırları üretimi çoğaltmaz; kg ile adet aynı toplamda birleştirilmez.", [
        node("batch-company", "slicer", 32, 150, 350, 110, group=[field("Firma", "Kod")], state={"selected": ["F1"]}, title="Firma", format={"showTitle": True, "slicerStyle": "dropdown"}),
        node("batch-period", "slicer", 402, 150, 350, 110, group=[field("Tarih", "Donem")], state={"selected": ["2026-02"]}, title="Bağlantı / ölçüm dönemi", format={"showTitle": True, "slicerStyle": "dropdown"}),
        button("to-customers", 850, 175, 350, "Müşteri çalışma alanı", {"type": "page", "pageId": "customers", "keepContext": True}),
        text("batch-scope", 32, 290, 1216, 76, "Parti ana kaydı güncel envanterdir; dönem filtresi bağlantı ve kalite ölçüm tarihlerine uygulanır. Düğüme tıklamak yalnız grafiği değiştirir; sağdaki kalite kartları listeden seçtiğiniz ilk partiye aittir.", 16),
        grid("batch-list", 32, 400, 1216, 550, "Partiler · tekil anahtar ve birim", [field("Parti", "Key")], [implicit("Parti", "Ad"), implicit("Parti", "Tur"), implicit("Parti", "Birim"), value("Tekil parti miktarı"), value("Sınır dışı kayıt")], nav_trace),
    ])
    trace = page("trace", "Parti inceleme", "SENTETİK PİLOT · Parti ana miktarı ile bağlantı miktarı ayrıdır. Grafikteki ok ilişki yönüdür; fiziksel dağıtım veya tamamlanmış kütle dengesi kanıtı değildir.", [
        node("batch-name", "text", 32, 150, 1216, 60, bindings={"text": {"source": {"kind": "field", "field": field("Parti", "Ad")}, "template": "Kalite kapsamındaki parti: {value}"}}, format={"showTitle": False, "fontSize": 24, "padding": 0}, states={"error": {"text": "Parti listesinden bir kayıt seçin"}}),
        card("batch-amount", 32, 240, 380, "İlk seçili partinin ana miktarı · birimi listede", "Tekil parti miktarı"), card("batch-quality-fail", 438, 240, 380, "İlk seçili partide sınır dışı ölçüm", "Sınır dışı kayıt"), card("batch-quality-unknown", 844, 240, 404, "İlk seçili partide kararsız ölçüm", "Kararsız kayıt"),
        node("batch-network", "lineage", 32, 400, 780, 560, title="Sınırlı komşuluk · düğümle gezinin", group=[field("Baglanti", c) for c in ["Kaynak", "Hedef", "KaynakAd", "HedefAd", "Birim", "Iliski"]], legend=[field("Parti", "Key")], values=[implicit("Baglanti", "Miktar", "sum")], format={"showTitle": True, "traceDirection": "both", "traceDepth": 2, "traceNodes": 40, "traceEdges": 80, "padding": 14, "backgroundColor": "#ffffff", "radius": 12}),
        node("batch-tolerance", "tolerance", 844, 400, 404, 560, title="İlk seçili partinin kalite ölçümleri", group=[field("Kalite", c) for c in ["Key", "Test", "Birim"]], values=[implicit("Kalite", c, a) for c, a in [("Sonuc", "min"), ("Alt", "min"), ("Ust", "max"), ("Hedef", "min")]], format={"showTitle": True, "padding": 14, "backgroundColor": "#ffffff", "radius": 12}),
        button("to-quality", 844, 990, 404, "Kalite kayıtlarını aç", {"type": "page", "pageId": "quality", "keepContext": True}),
    ], [field("Parti", "Key")])
    quality = page("quality", "Kalite ölçüm kayıtları", "SENTETİK PİLOT · Sonuç, hedef, alt ve üst sınır ölçüm biriminde okunur. Eksik değer uygun sayılmaz; sınırda kalan sonuç uygundur.", [
        grid("quality-rows", 32, 155, 1216, 730, "Her satır tek bir test kaydıdır", [field("Kalite", c) for c in ["Key", "Test", "Birim"]], [implicit("Kalite", c, "min") for c in ["Sonuc", "Alt", "Ust", "Hedef", "SinirDisi", "Kararsiz"]]),
    ], [field("Parti", "Key")])
    return {"version": 1, "pages": [listing, customer, document, batches, trace, quality]}


def create_demo(target: Path) -> None:
    target = target.resolve()
    if target.exists() or target.suffix.lower() != ".floem":
        raise ValueError("Önceki dosyayı korumak için yeni bir .floem hedefi seçin")
    with tempfile.TemporaryDirectory(prefix="floem-f12-") as folder:
        doc = Document.new(Path(folder), "F12 Süreç Pilotları")
        try:
            model = process_model()
            doc.content.tanim = ModelTanimi.model_validate(model)
            seed_process_data(doc)
            doc.set_report(process_report())
            doc.save(target)
        finally:
            doc.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path)
    create_demo(parser.parse_args().target)
    print("F12 sentetik süreç pilotları kaydedildi: 6 sayfa, 2 firma, müşteri 360 ve parti/kalite.")
