"""F14: aynı FDX ölçüsünden rapor ve eşik uyarısı üreten bağlantısız pilot."""
from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from .document.document import Document
from .model import ModelTanimi
from .process_demo import process_model, seed_process_data


def analytics_report() -> dict:
    def field(table, column): return {"table": table, "column": column}
    def node(id, type, x, y, w, h, **kwargs):
        return {"id": id, "type": type, "x": x, "y": y, "w": w, "h": h,
                "group": [], "values": [], "filters": [], "format": {"showTitle": False}, **kwargs}
    def text(id, y, h, content, size=16):
        return node(id, "text", 32, y, 1216, h, format={"showTitle": False, "padding": 0, "text": content, "fontSize": size, "textOverflow": "wrap", "backgroundColor": "transparent"})
    def slicer(id, x, title, f, selected):
        return node(id, "slicer", x, 156, 390, 100, title=title, group=[f], state={"selected": [selected]}, format={"showTitle": True, "slicerStyle": "dropdown"})
    def card(id, x, title, measure):
        return node(id, "card", x, 286, 594, 124, values=[{"measure": measure}], format={"showTitle": False, "text": title, "radius": 12, "padding": 16})
    visuals = [
        text("heading", 24, 48, "Analytics · aynı hesap, izlenebilir uyarı", 30),
        text("intro", 82, 56, "SENTETİK PİLOT · Kart ve uyarı aynı kayıtlı FDX ölçüsünü kullanır. Firma, dönem ve müşteri seçimi ikisine de uygulanır. Canlı Analytics bağlantısı değildir."),
        slicer("company", 32, "Firma", field("Firma", "Kod"), "F1"),
        slicer("period", 445, "Dönem", field("Tarih", "Donem"), "2026-02"),
        slicer("customer", 858, "Müşteri kodu · firma içinde", field("Musteri", "Kod"), "C001"),
        card("sales-card", 32, "Dönem net satışı · TRY", "Dönem net satışı"),
        card("balance-card", 654, "Dönem sonu bakiyesi · TRY", "Dönem sonu bakiyesi"),
        node("sales-signal", "signal", 32, 438, 594, 600, title="Satış hedefi", format={"showTitle": True, "metricId": "sales.net", "radius": 12}),
        node("balance-signal", "signal", 654, 438, 594, 600, title="Bakiye eşiği", format={"showTitle": True, "metricId": "receivable.close", "radius": 12}),
        text("instructions", 1066, 132, "Başlangıç kontrolü: F1 / 2026-02 / C001 → satış 180 TRY, bakiye 350 TRY; satış 200 altı uyarısı ve bakiye 300 üstü uyarısı görünür. F2 aynı kodu seçerseniz 1.800 / 3.500 olur. C006 hareketi olmayan müşteridir: Veri yok, eşik Hesaplanamadı. Firma seçimini temizlemek kapsam hatası üretir."),
        text("evidence-guide", 1220, 132, "Kanıt karşılaştırma: Ölçü kanıtını indir, aynı nesnede Kanıt karşılaştır ile yükle. Aynı kapsamda uyum görünür; farklı firma/dönemde yüklenen eski kanıt kapsam uyuşmazlığı verir. Eşit sayı tek başına doğrulama değildir. Kaynak veri zamanı sentetik verinin beyanıdır; dosya imzası veya canlı veri güncelliği doğrulanmaz."),
    ]
    overrides, top = {}, 20
    for v in visuals:
        height = 110 if v["id"] == "heading" else 150 if v["id"] == "intro" else 120 if v["type"] == "slicer" else 140 if v["type"] == "card" else 680 if v["type"] == "signal" else 270
        overrides[v["id"]] = {"x": 20, "y": top, "w": 350, "h": height, "format": {"fontSize": 24 if v["id"] == "heading" else 15}}
        top += height + 16
    return {"version": 1, "analytics": {"protocol": "floem-metric/v1", "dataTime": "2026-03-31T23:59:00Z",
        "metrics": [
            {"id": "sales.net", "label": "Dönem net satışı", "measure": "Dönem net satışı", "company": field("Firma", "Kod"), "unit": "TRY", "grain": "Fatura satırı · seçili dönem", "tolerance": .000001},
            {"id": "receivable.close", "label": "Dönem sonu bakiyesi", "measure": "Dönem sonu bakiyesi", "company": field("Firma", "Kod"), "unit": "TRY", "grain": "Cari hareket · seçili dönem sonu", "tolerance": .000001}],
        "rules": [
            {"id": "sales.target", "metricId": "sales.net", "label": "Örnek satış hedefinin altında", "operator": "lt", "threshold": 200, "severity": "warning"},
            {"id": "balance.limit", "metricId": "receivable.close", "label": "Örnek bakiye eşiği aşıldı", "operator": "gt", "threshold": 300, "severity": "critical"}]},
        "pages": [{"id": "analytics", "name": "Analytics ve uyarılar", "width": 1280, "height": 1384, "backgroundColor": "#f2f5fa", "visuals": visuals,
                   "layouts": [{"id": "analytics-phone", "name": "Telefon", "width": 390, "height": top + 16, "maxWidth": 620, "displayOption": "FitToWidth", "overrides": overrides}]}]}


def create_demo(target: Path) -> None:
    target = target.resolve()
    if target.exists() or target.suffix.lower() != ".floem":
        raise ValueError("Önceki dosyayı korumak için yeni bir .floem hedefi seçin")
    with tempfile.TemporaryDirectory(prefix="floem-f14-") as folder:
        doc = Document.new(Path(folder), "F14 Analytics ve Uyarılar")
        try:
            doc.content.tanim = ModelTanimi.model_validate(process_model())
            seed_process_data(doc)
            doc.set_report(analytics_report())
            doc.save(target)
        finally:
            doc.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path)
    create_demo(parser.parse_args().target)
    print("F14 ölçü/uyarı pilotu kaydedildi: 2 firma, 2 ortak ölçü, 2 eşik, telefon düzeni.")
