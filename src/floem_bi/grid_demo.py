"""F09 için kaynağa bağlanmadan 12.050 gruplu sentetik .floem örneği oluşturur."""
from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from .document.document import Document
from .model import ModelTanimi
from .report.query import VisualQuery


def create_demo(target: Path) -> None:
    target = target.resolve()
    if target.suffix.lower() != ".floem" or target.exists():
        raise ValueError("Önceki dosyayı korumak için yeni bir .floem hedefi seçin")
    with tempfile.TemporaryDirectory(prefix="floem-f09-") as work:
        doc = Document.new(Path(work), "F09 Büyük Grid")
        try:
            doc.content.tanim = ModelTanimi.model_validate({"model": {"ad": "F09 Büyük Grid"}, "tablolar": [{
                "ad": "Kayit", "kaynak": {"katman": "veri", "tablo": "f09kayit"},
                "aciklama": "Tamamı sentetik; harici veri kaynağına veya yenileme bağlantısına sahip değildir.",
                "sutunlar": [{"ad": "KayitId", "tip": "int64"}, {"ad": "Bolge", "tip": "string"}, {"ad": "Tutar", "tip": "double"}],
                "olculer": [{"ad": "Tutar toplamı", "ifade": "SUM(Kayit[Tutar])", "bicim": "#,##0.00"},
                            {"ad": "Ortalama tutar", "ifade": "AVERAGE(Kayit[Tutar])", "bicim": "#,##0.00"}]}]})
            doc.con.execute("""CREATE TABLE veri.f09kayit AS SELECT i AS KayitId,
                CASE WHEN i%1000=0 THEN NULL WHEN i%2=0 THEN 'Doğu' ELSE 'Batı' END AS Bolge,
                CAST(i%3+1 AS DOUBLE) AS Tutar FROM range(12050) t(i)""")
            # Eşit olmayan grup büyüklükleri: genel ortalama, grup ortalamalarının ortalaması olamaz.
            doc.con.execute("INSERT INTO veri.f09kayit SELECT KayitId, Bolge, 100.0 FROM veri.f09kayit WHERE KayitId<100")
            pages = []
            for name, kind, groups in [("Büyük Tablo", "table", ["KayitId"]), ("Büyük Ağaç", "treegrid", ["Bolge", "KayitId"])]:
                key = "f09-table" if kind == "table" else "f09-tree"
                def visual(id, type, x, y, w, h, **props):
                    return {"id": id, "type": type, "x": x, "y": y, "w": w, "h": h, "group": [], "values": [], "filters": [], **props}
                pages.append({"id": key, "name": name, "width": 1280, "height": 900, "backgroundColor": "#f5f7fa", "visuals": [
                    visual(key+"-title", "text", 40, 24, 1200, 48, format={"text": name+" · 12.050 grup", "fontSize": 30, "bold": True, "showTitle": False, "padding": 0}),
                    visual(key+"-help", "text", 40, 80, 1200, 64, format={"text": "12.150 sentetik kayıt · 12.050 kimlik. Son sayfaya gidin veya 12049 arayın. Genel ortalama sayfalardan hesaplanmaz. Ağaçta + ile bir dal açın; arama/indirme yalnız o düzeyi kapsar.", "fontSize": 15, "showTitle": False, "padding": 0}),
                    visual(key+"-grid", kind, 40, 156, 1200, 700, title=name,
                        group=[{"table": "Kayit", "column": g} for g in groups], values=[{"measure": "Tutar toplamı"}, {"measure": "Ortalama tutar"}],
                        format={"gridDataMode": "server", "gridPageSize": 100, "gridFitColumns": True, "gridSearch": True, "gridFilters": True, "showTotals": True})]})
            doc.set_report({"version": 1, "pages": pages})
            check = doc.query(VisualQuery(group=[{"table": "Kayit", "column": "KayitId"}], values=[{"measure": "Ortalama tutar"}], page={"search": "12049"}, totals=True))
            if check["page"]["totalRows"] != 1 or check["rows"][0][0] != 12049:
                raise ValueError("Sentetik veri kontrolü başarısız")
            doc.save(target)
        finally:
            doc.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    create_demo(args.target)
    print("F09 büyük tablo/ağaç örneği yeni yerel dosyaya kaydedildi: 2 sayfa, 12.150 sentetik kayıt.")


if __name__ == "__main__":
    main()
