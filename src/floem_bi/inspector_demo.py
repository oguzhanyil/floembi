"""F13 tasarım denetimi: sentetik veriyle iyi örnek ve bilinçli inceleme örnekleri."""
from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from .document.document import Document
from .model import ModelTanimi
from .runtime_demo import runtime_report


def inspector_report() -> dict:
    report = runtime_report()
    def visual(id, type, x, y, w, h, **props):
        return {"id": id, "type": type, "x": x, "y": y, "w": w, "h": h, "group": [], "values": [], "filters": [],
                "format": {"showTitle": False}, **props}

    review = {"id": "audit-review", "name": "Denetim örnekleri", "width": 1280, "height": 900, "backgroundColor": "#f5f7fa", "visuals": [
        visual("audit-heading", "text", 40, 24, 1200, 70, format={"showTitle": False, "fontSize": 30, "bold": True, "text": "Tasarımı denetle · Bilinçli inceleme örnekleri"}),
        visual("audit-help", "text", 40, 105, 1200, 80, format={"showTitle": False, "fontSize": 16, "text": "Görselleştirmeler → Tasarımı denetle. Bu sayfada küçük yazı, metin taşması, kopuk ölçü ve farklı birim örnekleri bilerek bırakıldı. Bulgudan nesneye gidin; kendi kararınızla düzeltin."}),
        visual("audit-overflow", "text", 40, 220, 350, 64, title="Sığmayan açıklama", format={"showTitle": False, "fontSize": 18, "text": "Müşteri bakiyesi, ödeme durumu ve yaklaşan işlem ayrıntıları. " * 12}),
        visual("audit-small", "text", 40, 340, 350, 70, title="Küçük yazı", format={"showTitle": False, "fontSize": 9, "text": "Bu açıklama 9 px; telefon düzeninde de kontrol edin."}),
        visual("audit-unit", "kpi", 440, 220, 360, 210, title="Tutar ve yüzde hedefi", values=[{"measure": "Açık bakiye"}], target=[{"measure": "Tahsilat oranı"}], format={"showTitle": True}),
        visual("audit-missing", "card", 850, 220, 350, 210, title="Kopuk alan bağı", values=[{"measure": "Silinmiş örnek ölçü"}], format={"showTitle": True}),
        visual("audit-table", "table", 40, 490, 1160, 350, title="Sayfalı sonuç kapsamı", group=[{"table": "Musteri", "column": "Ad"}], values=[{"measure": "Açık bakiye"}], format={"showTitle": True, "gridDataMode": "server", "gridPageSize": 25, "gridFitColumns": True}),
    ], "layouts": [{"id": "audit-phone", "name": "Telefon incelemesi", "maxWidth": 600, "width": 390, "height": 1000,
        "overrides": {"audit-heading": {"x": 20, "y": 20, "w": 350, "h": 100, "format": {"fontSize": 24}},
                      "audit-help": {"x": 20, "y": 130, "w": 350, "h": 160},
                      "audit-overflow": {"x": 20, "y": 310, "w": 350}, "audit-small": {"x": 20, "y": 400, "w": 350},
                      "audit-unit": {"x": 20, "y": 490, "w": 350}, "audit-missing": {"x": 20, "y": 720, "w": 350},
                      "audit-table": {"x": 20, "y": 950, "w": 350}}}]}
    report["pages"].insert(0, review)
    return report


def create_demo(target: Path) -> None:
    target = target.resolve()
    if target.suffix.lower() != ".floem" or target.exists():
        raise ValueError("Önceki dosyayı korumak için yeni bir .floem hedefi seçin")
    with tempfile.TemporaryDirectory(prefix="floem-f13-") as work:
        doc = Document.new(Path(work), "F13 Tasarım Denetimi")
        try:
            doc.content.tanim = ModelTanimi.model_validate({"model": {"ad": "F13 Tasarım Denetimi"}, "tablolar": [{
                "ad": "Musteri", "kaynak": {"katman": "veri", "tablo": "f13musteri"},
                "aciklama": "Tamamen sentetik denetim örneği; harici bağlantı içermez.",
                "sutunlar": [{"ad": "Id", "tip": "int64", "anahtar": True}, {"ad": "Ad", "tip": "string"}, {"ad": "Durum", "tip": "string"}, {"ad": "Bakiye", "tip": "double"}],
                "olculer": [{"ad": "Açık bakiye", "ifade": "SUM(Musteri[Bakiye])", "bicim": "₺ #,##0.00"},
                            {"ad": "Tahsilat oranı", "ifade": "0.75", "bicim": "0.0%"}]}]})
            doc.con.execute("""CREATE TABLE veri.f13musteri AS SELECT i AS Id,
                'Örnek Müşteri ' || lpad(CAST(i AS VARCHAR), 5, '0') AS Ad,
                CASE WHEN i%3=0 THEN 'Gecikmiş' ELSE 'Güncel' END AS Durum,
                CAST(i%97*125 AS DOUBLE) AS Bakiye FROM range(12050) t(i)""")
            doc.set_report(inspector_report())
            doc.save(target)
        finally:
            doc.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path)
    create_demo(parser.parse_args().target)
    print("F13 tasarım denetimi kaydedildi: 4 sayfa, telefon düzeni ve 12.050 sentetik müşteri.")
