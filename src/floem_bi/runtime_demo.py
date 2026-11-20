"""F11 tasarım atölyesi: bağımsız, tamamen sentetik ve kaynak bağlantısız örnek."""
from __future__ import annotations

import argparse
import json
import tempfile
from copy import deepcopy
from pathlib import Path

from .document.document import Document
from .model import ModelTanimi


def runtime_report() -> dict:
    def visual(id, type, x, y, w, h, **props):
        return {"id": id, "type": type, "x": x, "y": y, "w": w, "h": h, "group": [], "values": [], "filters": [],
                "format": {"showTitle": False, "radius": 12}, **props}

    customer = {"table": "Musteri", "column": "Ad"}
    balance = {"measure": "Açık bakiye"}
    status = {"table": "Musteri", "column": "Durum"}
    nodes = [
        visual("row", "container", 0, 0, 720, 152, container={"mode": "free", "padding": 0}, format={"showTitle": False, "backgroundColor": "#ffffff", "borderColor": "#d5dee9", "radius": 14}),
        visual("name", "text", 24, 20, 410, 36, parentId="row", format={"showTitle": False, "fontSize": 24, "bold": True, "padding": 0, "text": "Müşteri adı"},
               bindings={"text": {"source": {"kind": "row", "field": customer}}}),
        visual("status", "text", 24, 65, 310, 28, parentId="row", format={"showTitle": False, "fontSize": 14, "padding": 0}, bindings={
            "text": {"source": {"kind": "row", "field": status}, "template": "Durum: {value}"},
            "color": {"source": {"kind": "row", "field": status}, "rules": [{"op": "eq", "value": "Gecikmiş", "output": "#9f1239"}], "fallback": "#166534"}}),
        visual("amount", "card", 420, 18, 270, 64, parentId="row", format={"showTitle": False, "text": "Açık bakiye · ₺", "padding": 0, "animation": "count"}, bindings={"value": {"source": {"kind": "row", "value": balance}}}),
        visual("detail", "button", 460, 100, 230, 34, parentId="row", format={"showTitle": False, "text": "Müşteriyi incele", "buttonStyle": "solid", "buttonIcon": "arrow", "action": {"type": "page", "pageId": "detail"}},
               states={"hover": {"backgroundColor": "#0755c8"}, "selected": {"backgroundColor": "#0e7490"}}),
    ]
    slots = [
        {"id": "name", "label": "Müşteri adı", "kind": "field", "defaultBinding": customer, "sites": [{"visualId": "name", "path": ["bindings", "text", "source", "field"]}]},
        {"id": "status", "label": "Durum", "kind": "field", "defaultBinding": status, "sites": [{"visualId": "status", "path": ["bindings", target, "source", "field"]} for target in ["text", "color"]]},
        {"id": "amount", "label": "Bakiye", "kind": "value", "defaultBinding": balance, "sites": [{"visualId": "amount", "path": ["bindings", "value", "source", "value"]}]},
        {"id": "page", "label": "Detay sayfası", "kind": "page", "defaultBinding": {"pageId": "detail"}, "sites": [{"visualId": "detail", "path": ["format", "action"]}]},
    ]
    definition = {"id": "customer-card", "version": 1, "name": "Müşteri 360 kartı", "rootId": "row", "visuals": nodes, "slots": slots}
    listing = {"id": "list", "name": "Müşteri 360", "width": 1280, "height": 950, "backgroundColor": "#f5f7fa", "visuals": [
        visual("heading", "text", 40, 24, 1200, 50, format={"text": "Müşteri 360 · Tasarımınız veriye dönüşsün", "fontSize": 30, "bold": True, "showTitle": False, "padding": 0}),
        visual("help", "text", 40, 85, 1200, 54, format={"text": "12.050 sentetik müşteri. Kartları seçin, arayın veya incele düğmesiyle detay sayfasına geçin. Kart şablonu raporun içinde saklıdır.", "fontSize": 16, "showTitle": False, "padding": 0}),
        visual("customers", "repeater", 40, 154, 780, 748, group=[{"table": "Musteri", "column": "Id"}, customer, status], values=[balance],
               repeater={"definitionId": "customer-card", "version": 1, "bindings": {s["id"]: s["defaultBinding"] for s in slots}, "itemHeight": 164, "actionSourceIndex": 0},
               format={"showTitle": False, "gridPageSize": 100, "gridSearch": True, "padding": 12}),
        visual("total", "card", 850, 154, 390, 170, bindings={"value": {"source": {"kind": "value", "value": balance}}},
               format={"showTitle": False, "text": "Seçili kapsamın açık bakiyesi · ₺", "animation": "count"},
               states={"loading": {"text": "Bakiye hesaplanıyor…"}, "empty": {"text": "Bu seçimde müşteri yok"}, "error": {"text": "Bakiye alınamadı"}}),
        visual("info", "text", 850, 350, 390, 240, format={"showTitle": False, "fontSize": 16, "text": "Kendi kartını oluştur\n\n1. Atölye sayfasında tasarımı düzenle.\n2. Kapsayıcıyı bileşen kitaplığına kaydet.\n3. Tekrarlayıcıda bileşeni ve alanları eşle.\n\nŞablonun veri bağları mevcut satırdan okunur."}),
    ]}
    detail = {"id": "detail", "name": "Müşteri detayı", "width": 1280, "height": 720, "drillthrough": [{"table": "Musteri", "column": "Id"}], "visuals": [
        visual("customer-title", "text", 50, 50, 1180, 70, bindings={"text": {"source": {"kind": "field", "field": customer}}}, format={"showTitle": False, "fontSize": 32}, states={"error": {"text": "Müşteri 360 sayfasından bir müşteri seçin"}}),
        visual("detail-balance", "card", 50, 155, 560, 250, bindings={"value": {"source": {"kind": "value", "value": balance}}}, format={"showTitle": False, "text": "Açık bakiye · ₺", "animation": "count"}),
        visual("detail-rows", "table", 650, 155, 580, 400, group=[customer, status], values=[balance], format={"showTitle": False, "gridFitColumns": True}),
        visual("back", "button", 50, 455, 260, 50, format={"showTitle": False, "text": "Müşteri listesine dön", "buttonIcon": "back", "action": {"type": "page", "pageId": "list"}}),
    ]}
    # Atölyede satır kapsamı yoktur: düzenleyebilmek için tek müşteriye bağlı normal bağlar kullanılır.
    workshop_nodes = deepcopy(nodes)
    for n in workshop_nodes:
        if n["id"] == "row":
            n["x"], n["y"] = 60, 180
        for binding in n.get("bindings", {}).values():
            binding["source"]["kind"] = "field" if "field" in binding["source"] else "value"
        n["filters"] = [{"table": "Musteri", "column": "Id", "op": "eq", "values": [0]}]
    workshop = {"id": "workshop", "name": "Tasarım atölyesi", "width": 1280, "height": 720, "backgroundColor": "#f5f7fa", "visuals": [
        visual("workshop-title", "text", 60, 35, 1160, 60, format={"showTitle": False, "fontSize": 30, "bold": True, "text": "Kendi müşteri kartınızı tasarlayın"}),
        visual("workshop-help", "text", 60, 105, 1160, 55, format={"showTitle": False, "text": "Kitaplıktaki Müşteri 360 kartı mevcut satır bağlarıyla hazırdır. Aşağıdaki örnek müşteri 0 için canlıdır; şablon olarak kaydederken bağ kaynaklarını Mevcut satır yapın.", "fontSize": 15}),
        *workshop_nodes,
    ]}
    return json.loads(json.dumps({"version": 1, "components": [definition], "pages": [listing, detail, workshop]}))


def create_demo(target: Path) -> None:
    target = target.resolve()
    if target.suffix.lower() != ".floem" or target.exists():
        raise ValueError("Önceki dosyayı korumak için yeni bir .floem hedefi seçin")
    with tempfile.TemporaryDirectory(prefix="floem-f11-") as work:
        doc = Document.new(Path(work), "F11 Tasarım Atölyesi")
        try:
            doc.content.tanim = ModelTanimi.model_validate({"model": {"ad": "F11 Tasarım Atölyesi"}, "tablolar": [{
                "ad": "Musteri", "kaynak": {"katman": "veri", "tablo": "f11musteri"},
                "aciklama": "Sentetik müşteri verisi; gerçek kişi, kurum veya harici bağlantı içermez.",
                "sutunlar": [{"ad": "Id", "tip": "int64"}, {"ad": "Ad", "tip": "string"}, {"ad": "Durum", "tip": "string"}, {"ad": "Bakiye", "tip": "double"}],
                "olculer": [{"ad": "Açık bakiye", "ifade": "SUM(Musteri[Bakiye])", "bicim": "#,##0.00"}]}]})
            doc.con.execute("""CREATE TABLE veri.f11musteri AS SELECT i AS Id,
                'Örnek Müşteri ' || lpad(CAST(i AS VARCHAR), 5, '0') AS Ad,
                CASE WHEN i%3=0 THEN 'Gecikmiş' ELSE 'Güncel' END AS Durum,
                CAST(i%97*125 AS DOUBLE) AS Bakiye FROM range(12050) t(i)""")
            doc.set_report(runtime_report())
            doc.save(target)
        finally:
            doc.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path)
    create_demo(parser.parse_args().target)
    print("F11 tasarım atölyesi kaydedildi: 3 sayfa, 12.050 sentetik müşteri.")
