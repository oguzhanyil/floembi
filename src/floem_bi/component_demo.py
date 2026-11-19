"""F05 kopyasına sürümlü ve alan eşlemeli F07B kitaplık örnekleri ekler."""
from __future__ import annotations

import argparse
import copy
import tempfile
from pathlib import Path

from .document.document import Document
from .report.schema import Report


def library_report(report: dict) -> dict:
    result = copy.deepcopy(report)
    page = next((p for p in result["pages"] if p["id"] == "f05-atolye"), None)
    if not page or any(c["id"] == "demo.kpi" for c in result.get("components", [])):
        raise ValueError("Kaynak F05 atölyesi içermeli ve henüz F07B örneği olmamalı")
    nodes = {v["id"]: v for v in page["visuals"]}
    parts = ["", "-accent", "-label", "-value", "-caption"]
    keys = ["root", "accent", "label", "value", "caption"]
    template = []
    for key, suffix in zip(keys, parts):
        node = copy.deepcopy(nodes["f05-kpi-0" + suffix])
        node["id"] = key
        node.pop("component", None)
        if key == "root":
            node.pop("parentId", None)
            node.update(x=0, y=0)
        else:
            node["parentId"] = "root"
        template.append(node)
    definition = {"id": "demo.kpi", "name": "Ortak iş göstergesi", "description": "Satış, açık sipariş ve cari bakiye için aynı tasarım; farklı alan ve yerel renkler.",
                  "version": 1, "rootId": "root", "visuals": template,
                  "slots": [{"id": "metric", "label": "Gösterge ölçüsü", "kind": "value", "defaultBinding": {"measure": "Yerel net satış · satır"},
                             "sites": [{"visualId": "value", "path": ["values", "0"]}]}]}
    newer = copy.deepcopy(definition)
    newer["version"] = 2
    newer["visuals"][2]["format"]["fontSize"] = 17
    newer["visuals"][3]["format"]["fontSize"] = 34
    result["components"] = [*result.get("components", []), definition, newer]
    for i in range(3):
        node_map = {key: f"f05-kpi-{i}{suffix}" for key, suffix in zip(keys, parts)}
        nodes[node_map["root"]]["component"] = {"definitionId": "demo.kpi", "version": 1, "nodeMap": node_map,
                                                     "bindings": {"metric": copy.deepcopy(nodes[node_map["value"]]["values"][0])}}
    page["name"] = "Bileşen Atölyesi"
    nodes["f05-heading"]["w"] = 760
    nodes["f05-heading"]["format"]["text"] = "Bileşen Atölyesi"
    nodes["f05-intro"]["format"]["text"] = "Tek tasarım, farklı ölçüler · Ortak sürüm güncellemesi · Yerel renk ve başlıklar"
    nodes["f05-help"]["format"]["text"] = "DENEYİN\nBir KPI grubunu seçin → Görselleştirmeler → Bileşen kitaplığı → v2 güncellemesini incele. Tüm kullanımlara uygulayın.\nSatış, sipariş ve cari ölçüleriyle yeşil/mor yerel renkler korunur. Başka sayfadaki örnek de aynı kitaplığa bağlıdır."
    go = {"id": "f07b-go", "type": "button", "x": 870, "y": 30, "w": 362, "h": 44, "format": {"showTitle": False, "text": "Diğer sayfadaki kullanım", "action": {"type": "page", "pageId": "f07b-kullanim"}}}
    page["visuals"].append(go)
    other_nodes = copy.deepcopy(template)
    mapping = {key: "f07b-shared-" + key for key in keys}
    for node in other_nodes:
        key = node["id"]
        node["id"] = mapping[key]
        if key == "root":
            node.update(x=72, y=160, title="Sipariş bileşeni")
            node["component"] = {"definitionId": "demo.kpi", "version": 1, "nodeMap": mapping, "bindings": {"metric": {"measure": "Yerel açık satış siparişi"}}}
        else:
            node["parentId"] = mapping["root"]
        if key == "value":
            node["values"] = [{"measure": "Yerel açık satış siparişi"}]
        elif key == "accent":
            node["format"]["backgroundColor"] = "#047857"
        elif key == "label":
            node["format"]["text"] = "Açık sipariş"
        elif key == "caption":
            node["format"]["text"] = "Aynı bileşenin başka sayfadaki kullanımı"
    other_nodes.extend([
        {"id": "f07b-title", "type": "text", "x": 72, "y": 48, "w": 1100, "h": 54, "format": {"showTitle": False, "text": "Bir tasarım, birden çok kullanım", "fontSize": 30}},
        {"id": "f07b-note", "type": "text", "x": 500, "y": 170, "w": 660, "h": 190, "format": {"showTitle": False, "fontSize": 18, "text": "Bu kart, atölyedeki KPI'larla aynı tanımın v1 sürümünü kullanır.\n\nYeni sürümü tüm kullanımlara uyguladığınızda yazı boyutları birlikte değişir. Sipariş ölçüsü, yeşil vurgu ve yerel başlık korunur."}},
        {**go, "id": "f07b-back", "x": 72, "y": 400, "format": {"showTitle": False, "text": "Atölyeye dön", "action": {"type": "page", "pageId": "f05-atolye"}}},
    ])
    result["pages"].insert(1, {"id": "f07b-kullanim", "name": "Bileşen Kullanımları", "width": 1280, "height": 720, "backgroundColor": "#f5f7fa", "visuals": other_nodes})
    return Report.model_validate(result).model_dump(mode="json", exclude_none=True)


def create_demo(source: Path, target: Path) -> None:
    source, target = source.resolve(), target.resolve()
    if source == target or target.exists() or target.suffix.lower() != ".floem":
        raise ValueError("Önceki dosyayı koruyun; .floem uzantılı yeni hedef seçin")
    with tempfile.TemporaryDirectory(prefix="floem-f07b-") as work:
        doc = Document.open(Path(work), source)
        try:
            doc.set_report(library_report(doc.content.report))
            doc.save(target)
        finally:
            doc.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    create_demo(args.source, args.target)
    print("F07B bileşen atölyesi yeni yerel dosyaya kaydedildi.")


if __name__ == "__main__":
    main()
