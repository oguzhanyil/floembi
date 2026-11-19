"""F06 yerel kopyasına düzenlenebilir F05 tasarım atölyesi ekler; kaynağa bağlanmaz."""
from __future__ import annotations

import argparse
import copy
import tempfile
from pathlib import Path

from .document.document import Document


def workshop_page() -> dict:
    nodes = []

    def add(id, type, x, y, w, h, *, parent=None, title=None, format=None, **extra):
        item = {"id": "f05-" + id, "type": type, "x": x, "y": y, "w": w, "h": h,
                "group": [], "values": [], "filters": [], "format": {"showTitle": False, **(format or {})}, **extra}
        if parent:
            item["parentId"] = "f05-" + parent
        if title:
            item["title"] = title
        nodes.append(item)
        return item

    add("heading", "text", 48, 28, 1120, 54, format={"text": "Tasarım Atölyesi", "fontSize": 32, "bold": True, "backgroundColor": "transparent", "padding": 0})
    add("intro", "text", 48, 88, 1120, 38, format={"text": "Düzenlenebilir birleşik KPI'lar · Ortak veri modeli · Serbest tasarım ve otomatik yerleşim", "fontSize": 16, "backgroundColor": "transparent", "padding": 0})
    add("kpis", "container", 48, 150, 1184, 174, title="Yatay KPI şeridi",
        container={"mode": "horizontal", "padding": 0, "gap": 20, "align": "stretch", "wrap": True, "autoHeight": True},
        format={"backgroundColor": "transparent", "borderWidth": 0, "padding": 0})
    metrics = [("Satış", "Yerel net satış · satır", "Satış ve iadelerin yerel satır toplamı", "#0866e8"),
               ("Açık sipariş", "Yerel açık satış siparişi", "Yerel açık satış siparişi tutarı", "#047857"),
               ("Cari kapanış", "Cari kapanış bakiyesi", "Seçili dönemin son günündeki bakiye", "#7c3aed")]
    for i, (label, measure, caption, color) in enumerate(metrics):
        group = f"kpi-{i}"
        add(group, "container", i * 400, 0, 380, 174, parent="kpis", title=label + " bileşeni",
            container={"kind": "group", "mode": "free", "padding": 0}, layoutItem={"grow": 1, "minWidth": 300},
            format={"padding": 0, "radius": 12, "borderColor": "#d5dee9", "shadow": True})
        add(group + "-accent", "shape", 0, 20, 5, 72, parent=group, format={"backgroundColor": color, "borderWidth": 0, "padding": 0, "radius": 2})
        add(group + "-label", "text", 22, 17, 330, 28, parent=group, format={"text": label, "fontSize": 15, "backgroundColor": "transparent", "padding": 0})
        add(group + "-value", "card", 22, 50, 330, 66, parent=group, values=[{"measure": measure}],
            format={"backgroundColor": "transparent", "borderWidth": 0, "fontSize": 30, "padding": 0})
        add(group + "-caption", "text", 22, 127, 330, 32, parent=group,
            format={"text": caption, "fontSize": 11, "backgroundColor": "transparent", "padding": 0})
    add("notes", "container", 48, 354, 510, 310, title="Dikey açıklama ve eylem",
        container={"mode": "vertical", "padding": 22, "gap": 16, "autoHeight": True}, format={"padding": 0, "radius": 12})
    add("notes-heading", "text", 22, 22, 466, 36, parent="notes", format={"text": "İçeriğe göre düzen", "fontSize": 22, "bold": True, "padding": 0})
    add("notes-body", "text", 22, 74, 466, 96, parent="notes", title="Büyüyen açıklama",
        format={"text": "Bu açıklamayı Biçim → Metin bölümünden uzatın. Altındaki düğme otomatik olarak aşağı taşınır.\n\nSağdaki katman ağacından iç nesneleri seçebilir, KPI parçalarını Ctrl+tık ile düzenleyebilirsiniz.", "fontSize": 15, "textOverflow": "grow", "padding": 0})
    add("toggle", "button", 22, 186, 466, 48, parent="notes", format={"text": "Detay tablosunu aç / kapat", "buttonStyle": "solid", "buttonColor": "#0866e8", "buttonTextColor": "#ffffff", "padding": 0, "action": {"type": "toggle", "visualId": "f05-detail"}})
    add("detail", "container", 582, 354, 650, 310, title="Izgara detay bölümü",
        container={"mode": "vertical", "padding": 18, "gap": 12}, format={"padding": 0, "radius": 12})
    add("detail-heading", "text", 18, 18, 614, 30, parent="detail", format={"text": "Muhatap bazında satış", "fontSize": 20, "padding": 0})
    add("detail-table", "table", 18, 60, 614, 232, parent="detail", group=[{"table": "MuhatapBoyut", "column": "Muhatap"}],
        values=[{"measure": name} for name in ["Yerel net satış · satır", "Yerel açık satış siparişi", "Cari kapanış bakiyesi"]],
        layoutItem={"grow": 1}, format={"gridFitColumns": True, "gridSearch": True, "padding": 0})
    add("help", "text", 48, 714, 1184, 100, format={"text": "DENEYİN\nShift+tık ile çoklu seçim → Ctrl+G ile grupla. Ctrl+Shift+G ile çözün. Ctrl+Z / Ctrl+Y ile geri alın veya yineleyin.\nKapsayıcı seçiliyken Düzen ve katmanlar bölümünden yatay, dikey veya ızgara düzeni seçin. Telefon için ayrı düzen varyantları F08 kapsamındadır.", "fontSize": 14, "padding": 0, "backgroundColor": "transparent"})
    return {"id": "f05-atolye", "name": "Tasarım Atölyesi", "width": 1280, "height": 860,
            "backgroundColor": "#f5f7fa", "visuals": nodes}


def create_demo(source: Path, target: Path) -> None:
    source, target = source.resolve(), target.resolve()
    if target.suffix.lower() != ".floem":
        raise ValueError("Hedef .floem uzantılı olmalı")
    if source == target or target.exists():
        raise ValueError("Önceki dosya korunmalı; yeni bir hedef dosya adı seçin")
    page = workshop_page()
    with tempfile.TemporaryDirectory(prefix="floem-f05-") as work:
        doc = Document.open(Path(work), source)
        try:
            measures = {m.ad for table in doc.tanim.tablolar for m in table.olculer}
            needed = {ref["measure"] for visual in page["visuals"] for ref in visual["values"]}
            if needed - measures:
                raise ValueError("Kaynakta F06 ortak model ölçüleri eksik")
            if not any(t.ad == "MuhatapBoyut" and any(c.ad == "Muhatap" for c in t.sutunlar) for t in doc.tanim.tablolar):
                raise ValueError("Kaynakta F06 muhatap boyutu eksik")
            definition = copy.deepcopy(doc.content.report)
            reserved = {v["id"] for p in definition["pages"] for v in p["visuals"]}
            if any(p["id"] == page["id"] for p in definition["pages"]) or any(v["id"] in reserved for v in page["visuals"]):
                raise ValueError("Kaynak zaten F05 atölyesi içeriyor")
            definition["pages"].insert(0, page)
            doc.set_report(definition)
            doc.save(target)
        finally:
            doc.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    create_demo(args.source, args.target)
    print("F05 tasarım atölyesi yeni yerel dosyaya kaydedildi.")


if __name__ == "__main__":
    main()
