"""Power BI PBIP rapor yerleşimini boş verili, düzenlenebilir .floem taslağına aktarır.

Bu araç PBIP'in rapor JSON'unu okur; SQL sorgusu, bağlantı kimliği veya veri kopyalamaz.
Alan bağları yerinde kalır. Kaynağa bağlanmak ve ölçüleri uyarlamak sonraki adımdır.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

from .document.document import Document
from .model.schema import ModelBilgisi, ModelTanimi, Olcu, Sutun, Tablo, TabloKaynak
from .model.semantic import SemanticModel
from .report.schema import Report


TYPE_MAP = {
    "card": "card", "multiRowCard": "multicard", "kpi": "kpi",
    "clusteredColumnChart": "column", "stackedColumnChart": "stackedcolumn",
    "clusteredBarChart": "bar", "stackedBarChart": "stackedbar",
    "lineChart": "line", "areaChart": "area", "donutChart": "donut", "pieChart": "pie",
    "tableEx": "table", "pivotTable": "matrix", "scatterChart": "scatter",
    "treemap": "treemap", "waterfallChart": "waterfall", "gauge": "gauge",
    "lineClusteredColumnComboChart": "column", "lineStackedColumnComboChart": "stackedcolumn",
    "funnel": "bar", "slicer": "slicer", "textbox": "text", "shape": "shape",
    "image": "image", "actionButton": "shape",
}
MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".svg": "image/svg+xml"}


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _literal(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    if "solid" in value:
        return _literal(value["solid"].get("color"))
    raw = value.get("expr", value)
    if isinstance(raw, dict) and "Literal" in raw:
        raw = raw["Literal"].get("Value")
    if isinstance(raw, str):
        if len(raw) >= 2 and raw[0] == raw[-1] == "'":
            return raw[1:-1].replace("''", "'")
        if raw.lower() in ("true", "false"):
            return raw.lower() == "true"
        if re.fullmatch(r"-?\d+(?:\.\d+)?[DL]?", raw):
            try:
                return float(raw.rstrip("DL"))
            except ValueError:
                pass
    return raw


def _property(objects: dict, category: str, name: str) -> Any:
    for item in objects.get(category, []):
        if item.get("selector", {}).get("id", "default") != "default":
            continue
        props = item.get("properties", {})
        if name in props:
            return _literal(props[name])
    return None


def _number(value: Any, fallback: float = 0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _field(field: dict) -> tuple[str, str, str] | None:
    for kind in ("Measure", "Column"):
        if kind in field:
            item = field[kind]
            table = (item.get("Expression") or {}).get("SourceRef", {}).get("Entity")
            name = item.get("Property")
            if table and name:
                return kind.lower(), str(table), str(name)
    if "Aggregation" in field:
        nested = field["Aggregation"].get("Expression") or {}
        result = _field(nested)
        return ("aggregation", result[1], result[2]) if result else None
    if "HierarchyLevel" in field:
        item = field["HierarchyLevel"]
        hierarchy = (item.get("Expression") or {}).get("Hierarchy") or {}
        table = (hierarchy.get("Expression") or {}).get("SourceRef", {}).get("Entity")
        if table and item.get("Level"):
            return "column", str(table), str(item["Level"])
    return None


class _Bindings:
    def __init__(self):
        self.columns: dict[str, dict[str, str]] = defaultdict(dict)
        self.measures: dict[tuple[str, str], str] = {}
        self.measure_names: set[str] = set()

    def group(self, field: dict) -> dict | None:
        ref = _field(field)
        if not ref or ref[0] == "measure":
            return None
        _kind, table, column = ref
        self.columns[table].setdefault(column, "string")
        return {"table": table, "column": column}

    def value(self, field: dict) -> dict | None:
        ref = _field(field)
        if not ref:
            return None
        kind, table, name = ref
        if kind == "measure":
            key = (table, name)
            if key not in self.measures:
                candidate = name
                if candidate.lower() in self.measure_names:
                    candidate = f"{table} · {name}"
                self.measures[key] = candidate
                self.measure_names.add(candidate.lower())
            self.columns[table].setdefault("__floem_placeholder", "double")
            return {"measure": self.measures[key]}
        self.columns[table][name] = "double"
        return {"table": table, "column": name, "agg": "sum"}


def _text(objects: dict) -> tuple[str, dict]:
    general = _property(objects, "general", "paragraphs")
    if not isinstance(general, list):
        return "", {}
    lines = []
    style: dict[str, Any] = {}
    for paragraph in general:
        runs = paragraph.get("textRuns", [])
        lines.append("".join(str(run.get("value", "")) for run in runs))
        if runs and not style:
            first = runs[0].get("textStyle", {})
            size = first.get("fontSize", "")
            try:
                points = float(str(size).replace("pt", ""))
                style["fontSize"] = min(72, max(20, round(points * 4 / 3)))
            except ValueError:
                pass
            if isinstance(first.get("color"), str):
                style["color"] = first["color"]
            alignment = paragraph.get("horizontalTextAlignment")
            if alignment in ("left", "center", "right"):
                style["align"] = alignment
    return "\n".join(lines), style


def _image(report_dir: Path, objects: dict) -> str | None:
    image = next((item.get("properties", {}).get("imageUrl") for item in objects.get("general", [])
                  if "imageUrl" in item.get("properties", {})), None)
    resource = (image or {}).get("expr", {}).get("ResourcePackageItem", {})
    name = resource.get("ItemName")
    if not isinstance(name, str) or Path(name).name != name:
        return None
    path = report_dir / "StaticResources" / "RegisteredResources" / name
    mime = MIME.get(path.suffix.lower())
    if not mime or not path.is_file() or path.stat().st_size > 2_000_000:
        return None
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def _projection(query: dict, role: str) -> list[dict]:
    return (query.get("queryState", {}).get(role) or {}).get("projections", [])


def _convert_visual(report_dir: Path, raw: dict, bindings: _Bindings) -> dict | None:
    visual = raw.get("visual") or {}
    original_type = visual.get("visualType", "unknown")
    kind = TYPE_MAP.get(original_type, "text")
    pos = raw.get("position") or {}
    name = str(raw.get("name") or "gorsel")[:64]
    objects = visual.get("objects") or {}
    container = visual.get("visualContainerObjects") or {}
    # PBIP gezinme/ayrıntı düğmelerinin çoğu tamamen şeffaf tıklama katmanıdır.
    # Floem'de düğme eylemi aktarılmadığı için bu katmanları çizmek içeriği örter.
    if original_type == "actionButton" and (
        _property(objects, "fill", "show") is False or
        _number(_property(objects, "fill", "transparency")) >= 99
    ) and _property(objects, "text", "show") is not True:
        return None
    fmt: dict[str, Any] = {}
    title = _property(container, "title", "text")
    if isinstance(title, str) and title:
        title = title[:200]
    else:
        title = None
    if kind in ("shape", "text", "image"):
        fmt["showTitle"] = False
        fmt["padding"] = 0
    if kind in ("card", "multicard", "kpi") and _number(pos.get("height"), 200) < 80:
        fmt["padding"] = 0
    if kind == "text":
        fmt["backgroundColor"] = "transparent"
    if kind == "shape":
        fill = _property(objects, "fill", "fillColor")
        if isinstance(fill, str) and re.fullmatch(r"#[0-9a-fA-F]{6,8}", fill):
            fmt["backgroundColor"] = fill[:7]
        tile = _property(objects, "shape", "tileShape")
        if tile in ("roundRect", "pill"):
            fmt["shapeStyle"] = "pill"
        if original_type == "actionButton":
            label = _property(objects, "text", "text")
            if isinstance(label, str):
                fmt["text"] = label[:200]
    elif kind == "text":
        fmt["text"], style = _text(objects)
        fmt.update(style)
        if original_type not in TYPE_MAP:
            fmt["text"] = f"PBIP görseli: {original_type}"
    elif kind == "image":
        data = _image(report_dir, objects)
        if data:
            fmt["imageData"] = data
        fmt["altText"] = name
    else:
        fmt["templatePreview"] = True
        if kind in ("card", "ticker"):
            fmt["categoryLabel"] = True
    background = _property(container, "background", "color")
    if _property(container, "background", "show") is not False and isinstance(background, str) and re.fullmatch(r"#[0-9a-fA-F]{6,8}", background):
        fmt["backgroundColor"] = background[:7]
    if _property(container, "border", "show") is True:
        border = _property(container, "border", "color")
        if isinstance(border, str) and re.fullmatch(r"#[0-9a-fA-F]{6,8}", border):
            fmt["borderColor"] = border[:7]
            fmt["borderWidth"] = 1
        fmt["radius"] = min(40, max(0, _number(_property(container, "border", "radius"), 8)))
    fmt["shadow"] = _property(container, "dropShadow", "show") is True
    transparency = _number(_property(objects, "fill", "transparency"))
    if kind == "shape" and transparency > 0:
        fmt["opacity"] = max(0, 1 - transparency / 100)

    query = visual.get("query") or {}
    if kind not in ("shape", "text", "image"):
        labels = [str(item["displayName"]) for role in ("Category", "Rows", "Values", "Y", "X")
                  for item in _projection(query, role) if isinstance(item.get("displayName"), str)]
        if labels:
            fmt["previewLabel"] = " · ".join(dict.fromkeys(labels[:2]))[:160]
        if title:
            fmt["titleSize"] = 20
    if kind in ("card", "multicard", "kpi", "gauge") and not title:
        projection = _projection(query, "Values")
        if projection and isinstance(projection[0].get("displayName"), str):
            title = projection[0]["displayName"][:200]
            fmt["showTitle"] = False
    group: list[dict] = []
    legend: list[dict] = []
    values: list[dict] = []
    if kind == "matrix":
        group_roles, legend_roles, value_roles = ("Rows",), ("Columns",), ("Values",)
    elif kind == "table":
        group_roles, legend_roles, value_roles = (), (), ("Values",)
    elif kind == "slicer":
        group_roles, legend_roles, value_roles = ("Values",), (), ()
    elif kind in ("card", "multicard", "kpi", "ticker"):
        group_roles, legend_roles, value_roles = (), (), ("Values",)
    else:
        group_roles, legend_roles, value_roles = ("Category",), ("Series",), ("Y", "Y2", "X")
    for role in group_roles:
        group += [ref for item in _projection(query, role) if (ref := bindings.group(item.get("field") or {}))]
    for role in legend_roles:
        legend += [ref for item in _projection(query, role) if (ref := bindings.group(item.get("field") or {}))]
    for role in value_roles:
        for item in _projection(query, role):
            field = item.get("field") or {}
            ref = _field(field)
            if kind == "table" and ref and ref[0] == "column":
                item_ref = bindings.group(field)
                if item_ref:
                    group.append(item_ref)
            else:
                item_ref = bindings.value(field)
                if item_ref:
                    values.append(item_ref)
    return {
        "id": name,
        "type": kind,
        "x": round(float(pos.get("x", 0)), 2), "y": round(float(pos.get("y", 0)), 2),
        "w": max(1, round(float(pos.get("width", 320)), 2)),
        "h": max(1, round(float(pos.get("height", 200)), 2)),
        "title": title,
        "group": group, "legend": legend, "values": values,
        "filters": [], "format": fmt,
    }


def _model(name: str, bindings: _Bindings) -> ModelTanimi:
    tables = []
    used: set[str] = set()
    for table_name, columns in bindings.columns.items():
        physical = re.sub(r"[^\w]+", "_", table_name, flags=re.UNICODE).strip("_") or "Tablo"
        base, number = physical, 2
        while physical.lower() in used:
            physical = f"{base}_{number}"
            number += 1
        used.add(physical.lower())
        measures = [Olcu(ad=label, ifade=f"SUM('{table_name.replace(chr(39), chr(39)*2)}'[__floem_placeholder])",
                         aciklama="PBIP taslağı: özgün ölçü formülü veri bağlandıktan sonra uyarlanmalı")
                    for (owner, _name), label in bindings.measures.items() if owner == table_name]
        tables.append(Tablo(ad=table_name, kaynak=TabloKaynak(katman="veri", tablo=physical),
                            sutunlar=[Sutun(ad=col, tip=tip, gizli=col == "__floem_placeholder")
                                      for col, tip in columns.items()], olculer=measures))
    return ModelTanimi(model=ModelBilgisi(ad=name), tablolar=tables)


def import_report(report_dir: Path, output: Path) -> dict[str, int]:
    report_dir = report_dir.resolve()
    pages_dir = report_dir / "definition" / "pages"
    if not pages_dir.is_dir() or not report_dir.name.endswith(".Report"):
        raise ValueError("PBIP .Report klasörü bulunamadı")
    meta = _read(pages_dir / "pages.json")
    order = meta.get("pageOrder") or [p.name for p in pages_dir.iterdir() if p.is_dir()]
    bindings = _Bindings()
    pages = []
    visual_total = 0
    for page_id in order:
        page_dir = pages_dir / page_id
        if not page_dir.is_dir():
            continue
        info = _read(page_dir / "page.json")
        inputs = []
        for path in (page_dir / "visuals").glob("*/visual.json"):
            raw = _read(path)
            inputs.append((float((raw.get("position") or {}).get("z", 0)), raw))
        visuals = [converted for _z, raw in sorted(inputs, key=lambda item: item[0])
                   if (converted := _convert_visual(report_dir, raw, bindings)) is not None]
        # PBIP bazı durumlarda aynı görsel adını bir sayfada tekrar kullanabilir.
        ids: set[str] = set()
        for visual in visuals:
            base, index = visual["id"], 2
            while visual["id"] in ids:
                visual["id"] = f"{base[:58]}_{index}"
                index += 1
            ids.add(visual["id"])
        page_background = _property(info.get("objects") or {}, "background", "color")
        pages.append({"id": str(page_id)[:64], "name": str(info.get("displayName") or page_id)[:120],
                      "width": int(info.get("width") or 1280), "height": int(info.get("height") or 720),
                      "backgroundColor": page_background if isinstance(page_background, str) and
                      re.fullmatch(r"#[0-9a-fA-F]{6,8}", page_background) else "#FFFFFF",
                      "visuals": visuals})
        visual_total += len(visuals)
    report = Report.model_validate({"version": 1, "pages": pages}).model_dump(mode="json", exclude_none=True)
    name = report_dir.name.removesuffix(".Report")
    model = _model(name, bindings)
    SemanticModel(model)
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="floem-pbip-") as temporary:
        doc = Document.new(Path(temporary), name)
        try:
            doc.content.tanim = model
            for table in model.tablolar:
                columns = ", ".join(
                    '"' + col.ad.replace('"', '""') + '" ' + ("DOUBLE" if col.tip == "double" else "VARCHAR")
                    for col in table.sutunlar
                )
                physical = table.kaynak.tablo.replace('"', '""')
                doc.con.execute(f'CREATE TABLE "veri"."{physical}" ({columns})')
            doc.set_report(report)
            doc.save(output)
        finally:
            doc.close()
    return {"pages": len(pages), "visuals": visual_total, "tables": len(model.tablolar)}


def main() -> None:
    parser = argparse.ArgumentParser(description="PBIP sayfa tasarımını boş verili Floem BI taslağına aktarır")
    parser.add_argument("report_dir", type=Path, help="PBIP .Report klasörü")
    parser.add_argument("output", type=Path, help="Oluşturulacak .floem dosyası")
    parser.add_argument("--all", action="store_true", help="Kaynak depodaki tüm .Report klasörlerini aktar")
    args = parser.parse_args()
    if args.all:
        sources = sorted(args.report_dir.rglob("*.Report"))
        for source in sources:
            relative = source.relative_to(args.report_dir)
            output = args.output / relative.parent / (source.name.removesuffix(".Report") + ".floem")
            result = import_report(source, output)
            print(f"{output}: {result['pages']} sayfa, {result['visuals']} görsel, {result['tables']} tablo")
        print("Veri ve özgün DAX ölçüleri aktarılmadı; dosyalar düzenlenebilir tasarım taslağıdır.")
        return
    result = import_report(args.report_dir, args.output)
    print(f"Aktarıldı: {args.output} · {result['pages']} sayfa, {result['visuals']} görsel, {result['tables']} tablo")
    print("Veri ve özgün DAX ölçüleri aktarılmadı; bu dosya düzenlenebilir tasarım taslağıdır.")


if __name__ == "__main__":
    main()
