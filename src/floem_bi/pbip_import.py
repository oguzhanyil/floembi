"""Power BI PBIP rapor yerleşimini boş verili, düzenlenebilir .floem taslağına aktarır.

Bu araç PBIP'in rapor JSON'unu okur; SQL sorgusu, bağlantı kimliği veya veri kopyalamaz.
Alan bağları yerinde kalır. Kaynağa bağlanmak ve ölçüleri uyarlamak sonraki adımdır.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import re
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

from .pbip_compatibility import APPROXIMATE_TYPES, audit_visual, finding, finish_audit, write_audit
from .document.document import Document
from .model.schema import ModelBilgisi, ModelTanimi, Olcu, Sutun, Tablo, TabloKaynak
from .model.semantic import SemanticModel
from .report.schema import Report


TYPE_MAP = {
    "card": "card", "cardVisual": "card", "multiRowCard": "multicard", "kpi": "kpi",
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


def _page_appearance(info: dict, report_dir: Path | None = None) -> tuple[dict, set[tuple[str, int, str]]]:
    """Yalnız desteklenen sabit/default sayfa özellikleri başarılı sayılır."""
    result, handled = {}, set()
    # Microsoft page/2.1.0: eski dinamik ve sol-üst seçenekleri farklı semantiktedir.
    if info.get("displayOption") in ("FitToPage", "FitToWidth", "ActualSize"):
        result["displayOption"] = info["displayOption"]
    for category, prefix in (("background", "background"), ("outspace", "outspace")):
        for prop in ("color", "transparency"):
            for index, item in enumerate((info.get("objects") or {}).get(category, [])):
                if item.get("selector") not in (None, {}, {"id": "default"}):
                    continue
                if prop not in item.get("properties", {}):
                    continue
                value = _literal(item["properties"][prop])
                valid = isinstance(value, str) and re.fullmatch(r"#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?", value) if prop == "color" else \
                    type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 100
                if valid:
                    result[prefix + ("Color" if prop == "color" else "Transparency")] = value
                    handled.add((category, index, prop))
                break
    if report_dir is not None:
        for index, item in enumerate((info.get("objects") or {}).get("background", [])):
            if item.get("selector") not in (None, {}, {"id": "default"}): continue
            image = _literal(item.get("properties", {}).get("image"))
            image = (image.get("image") or image) if isinstance(image, dict) else {}
            data = _image(report_dir, {"general": [{"properties": {"imageUrl": image.get("url")}}]})
            if data:
                result["backgroundImageData"] = data
                result["backgroundImageFit"] = "cover" if _literal(image.get("scaling")) == "Fill" else "contain"
                handled.add(("background", index, "image"))
                break
    return result, handled


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
        agg = {0: "sum", 1: "avg", 2: "distinctcount", 3: "min", 4: "max", 5: "count"}.get(field.get("Aggregation", {}).get("Function"), None) if kind == "aggregation" else "sum"
        return {"table": table, "column": name, "agg": agg} if agg else None


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
                style["fontSize"] = min(144, max(8, round(points * 4 / 3, 2)))
            except ValueError:
                pass
            if isinstance(first.get("color"), str):
                style["color"] = first["color"]
            if isinstance(first.get("fontFamily"), str):
                style["fontFamily"] = first["fontFamily"][:100]
            if first.get("fontWeight") in ("bold", "600", "700"):
                style["bold"] = True
            style["textOverflow"] = "wrap"
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


def _button_action(raw: dict, page_ids: set[str]) -> dict | None:
    visual = raw.get("visual") or {}
    if visual.get("visualType") != "actionButton":
        return None
    container = visual.get("visualContainerObjects") or {}
    if _property(container, "visualLink", "show") is False:
        return None
    if _property(container, "visualLink", "type") != "PageNavigation":
        return None
    page_id = _property(container, "visualLink", "navigationSection")
    return {"type": "page", "pageId": page_id} if isinstance(page_id, str) and page_id in page_ids else None


def _inside(inner: dict, outer: dict) -> bool:
    a, b = inner.get("position") or {}, outer.get("position") or {}
    return (float(a.get("x", 0)) >= float(b.get("x", 0)) - 2 and
            float(a.get("y", 0)) >= float(b.get("y", 0)) - 2 and
            float(a.get("x", 0)) + float(a.get("width", 0)) <= float(b.get("x", 0)) + float(b.get("width", 0)) + 2 and
            float(a.get("y", 0)) + float(a.get("height", 0)) <= float(b.get("y", 0)) + float(b.get("height", 0)) + 2)


def _color_alpha(color: str, transparency: float) -> str:
    if not isinstance(color, str): return "transparent"
    if not transparency: return color
    if transparency >= 100: return "transparent"
    if not re.fullmatch(r"#[0-9a-fA-F]{6,8}", color): return color
    return f"rgba({int(color[1:3], 16)}, {int(color[3:5], 16)}, {int(color[5:7], 16)}, {max(0, 1-transparency/100):.3f})"


def _import_appearance(report_dir: Path, visual: dict, kind: str, fmt: dict) -> None:
    objects = visual.get("objects") or {}
    container = visual.get("visualContainerObjects") or {}
    if (visual.get("display") or {}).get("mode") == "hidden":
        fmt.update(initiallyHidden=True, hideInDesign=True)
    fmt.setdefault("radius", 0)
    fmt.setdefault("borderWidth", 0)
    if kind in ("image", "text"): fmt.setdefault("backgroundColor", "transparent")
    background = _property(container, "background", "color")
    transparency = _number(_property(container, "background", "transparency"))
    if _property(container, "background", "show") is False or transparency >= 100:
        fmt["backgroundColor"] = "transparent"
    elif background or transparency:
        fmt["backgroundColor"] = _color_alpha(background if isinstance(background, str) else "#FFFFFF", transparency)
    radius = _property(objects, "shape", "roundEdge")
    if isinstance(radius, (int, float)): fmt["radius"] = min(40, max(0, radius))
    if kind == "image":
        fmt["imageFit"] = "cover" if _property(objects, "imageScaling", "imageScalingType") == "Fill" else "contain"
    if visual.get("visualType") == "actionButton" and kind == "shape":
        if _property(objects, "fill", "show") is False or not objects.get("fill"): fmt["backgroundColor"] = "transparent"
        color = _property(objects, "text", "fontColor")
        if isinstance(color, str): fmt["color"] = color
        font = _property(objects, "text", "fontSize")
        if isinstance(font, (int, float)): fmt["fontSize"] = font * 4 / 3
    if visual.get("visualType") == "cardVisual":
        fmt["padding"] = 0
        fmt["categoryLabel"] = _property(objects, "label", "show") is not False
        font = _property(objects, "value", "fontSize")
        if isinstance(font, (int, float)): fmt["fontSize"] = font * 4 / 3
        color = _property(objects, "value", "fontColor")
        if isinstance(color, str): fmt["color"] = color
    if kind == "button":
        image = _property(objects, "icon", "image")
        icon = _image(report_dir, {"general": [{"properties": {"imageUrl": (image.get("image") or {}).get("url")}}]}) if isinstance(image, dict) else None
        fmt.update(buttonStyle="solid", buttonColor="transparent" if _property(objects, "fill", "show") is False or not objects.get("fill") else _color_alpha(_property(objects, "fill", "fillColor") or "#FFFFFF", _number(_property(objects, "fill", "transparency"))),
                   buttonTextColor=_property(objects, "text", "fontColor") if isinstance(_property(objects, "text", "fontColor"), str) else "#605E5C", text=_property(objects, "text", "text") or "", showTitle=False, padding=0)
        if icon: fmt["buttonIconData"] = icon
        fmt["buttonIconPosition"] = "top" if _property(objects, "text", "verticalAlignment") == "bottom" else "left"
        fmt["buttonIconSize"] = min(200, max(12, _number(_property(objects, "icon", "iconSize"), 24)))
        font = _property(objects, "text", "fontSize")
        if isinstance(font, (int, float)): fmt["fontSize"] = font * 4 / 3
        family = _property(objects, "text", "fontFamily")
        if isinstance(family, str): fmt["fontFamily"] = family


def _convert_visual(report_dir: Path, raw: dict, bindings: _Bindings) -> dict | None:
    if raw.get("visualGroup") is not None:
        group = raw["visualGroup"]
        pos = raw.get("position") or {}
        hidden = group.get("isHidden") is True or (group.get("display") or {}).get("mode") == "hidden"
        return {"id": str(raw.get("name") or "grup")[:64], "type": "container", "title": str(group.get("displayName") or "Grup")[:200],
                **({"parentId": raw["parentGroupName"]} if raw.get("parentGroupName") else {}),
                "x": round(float(pos.get("x", 0)), 2), "y": round(float(pos.get("y", 0)), 2),
                "w": max(1, round(float(pos.get("width", 320)), 2)), "h": max(1, round(float(pos.get("height", 200)), 2)),
                "group": [], "values": [], "filters": [],
                "container": {"kind": "group", "mode": "free", "padding": 0, "gap": 0, "autoHeight": False, "overflow": "visible"},
                "format": {"showTitle": False, "padding": 0, "borderWidth": 0, "radius": 0, "backgroundColor": "transparent",
                           **({"initiallyHidden": True, "hideInDesign": True} if hidden else {})}}
    visual = raw.get("visual") or {}
    original_type = visual.get("visualType", "unknown")
    kind = TYPE_MAP.get(original_type, "text")
    if original_type == "cardVisual" and (len(_projection(visual.get("query") or {}, "Values") or _projection(visual.get("query") or {}, "Data")) > 1 or _projection(visual.get("query") or {}, "Rows")):
        kind = "multicard"
    if original_type in APPROXIMATE_TYPES:
        kind = "text"
    pos = raw.get("position") or {}
    name = str(raw.get("name") or "gorsel")[:64]
    objects = visual.get("objects") or {}
    if original_type == "actionButton" and _property(objects, "icon", "image"):
        kind = "button"
    container = visual.get("visualContainerObjects") or {}
    # Tamamen şeffaf tıklama katmanları alttaki nesneye bağlanır; burada çizilmez.
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
    subtitle = _property(container, "subTitle", "text")
    if not title and _property(container, "subTitle", "show") is True and isinstance(subtitle, str): title = subtitle[:200]
    if _property(container, "title", "show") is False or kind in ("table", "matrix", "card", "multicard") and not title:
        fmt["showTitle"] = False
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
        if original_type not in TYPE_MAP or original_type in APPROXIMATE_TYPES:
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
    if original_type == "cardVisual" and "Data" in query.get("queryState", {}) and "Values" not in query.get("queryState", {}):
        query = {**query, "queryState": {**query["queryState"], "Values": query["queryState"]["Data"]}}
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
        group_roles, legend_roles, value_roles = (("Rows",) if original_type == "cardVisual" else ()), (), ("Values",)
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
    _import_appearance(report_dir, visual, kind, fmt)
    source_title_size = _property(container, "title", "fontSize")
    if isinstance(source_title_size, (int, float)): fmt["titleSize"] = min(28, max(10, source_title_size * 4 / 3))
    return {
        "id": name,
        **({"parentId": raw["parentGroupName"]} if raw.get("parentGroupName") else {}),
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


def prepare_report(report_dir: Path) -> tuple[dict, ModelTanimi, dict[str, int]]:
    report_dir = report_dir.resolve()
    pages_dir = report_dir / "definition" / "pages"
    if not pages_dir.is_dir() or not report_dir.name.endswith(".Report"):
        raise ValueError("PBIP .Report klasörü bulunamadı")
    meta = _read(pages_dir / "pages.json")
    order = meta.get("pageOrder") or sorted(p.name for p in pages_dir.iterdir() if p.is_dir())
    bindings = _Bindings()
    pages = []
    visual_total = 0
    audit_pages = []
    report_issues = []
    for page_id in order:
        page_dir = pages_dir / page_id
        if page_dir.parent != pages_dir or not page_dir.is_dir():
            report_issues.append(finding("ORDER_ENTRY_MISSING", str(page_id)))
            continue
        info = _read(page_dir / "page.json")
        inputs = []
        for path in sorted((page_dir / "visuals").glob("*/visual.json")):
            raw = _read(path)
            inputs.append((float((raw.get("position") or {}).get("z", 0)), raw))
        mapped_targets: dict[int, list[dict]] = {}
        converted_items: list[tuple[float, dict, dict]] = []
        buttons: list[tuple[float, dict, dict]] = []
        for z, raw in sorted(inputs, key=lambda item: item[0]):
            action = _button_action(raw, set(order))
            converted = _convert_visual(report_dir, raw, bindings)
            if converted is not None:
                if action:
                    converted["format"]["action"] = action
                converted_items.append((z, raw, converted))
                mapped_targets[id(raw)] = [converted]
            elif action:
                buttons.append((z, raw, action))
        for z, button, action in buttons:
            underneath = [item for item_z, raw, item in converted_items
                          if item_z < z and raw.get("parentGroupName") == button.get("parentGroupName") and _inside(raw, button)]
            if underneath:
                mapped_targets[id(button)] = underneath
                for item in underneath:
                    item["format"]["action"] = action
            else:
                pos = button.get("position") or {}
                converted_items.append((z, button, {
                    "id": str(button.get("name") or "dugme")[:64], "type": "button",
                    **({"parentId": button["parentGroupName"]} if button.get("parentGroupName") else {}),
                    "x": float(pos.get("x", 0)), "y": float(pos.get("y", 0)),
                    "w": max(1, float(pos.get("width", 180))), "h": max(1, float(pos.get("height", 52))),
                    "group": [], "values": [], "filters": [],
                    "format": {"showTitle": False, "padding": 0, "text": "Sayfaya git", "buttonStyle": "ghost",
                               "buttonInvisible": True, "action": action},
                }))
        for _z, raw, item in converted_items:
            mapped_targets.setdefault(id(raw), [item])
        visuals = [item for _z, _raw, item in sorted(converted_items, key=lambda entry: entry[0])]
        # PBIP bazı durumlarda aynı görsel adını bir sayfada tekrar kullanabilir.
        ids: set[str] = set()
        for visual in visuals:
            base, index = visual["id"], 2
            while visual["id"] in ids:
                visual["id"] = f"{base[:58]}_{index}"
                index += 1
            ids.add(visual["id"])
        appearance, handled = _page_appearance(info, report_dir)
        pages.append({"id": str(page_id)[:64], "name": str(info.get("displayName") or page_id)[:120],
                      "width": int(info.get("width") or 1280), "height": int(info.get("height") or 720),
                      **appearance,
                      "visuals": visuals})
        page_issues = []
        if info.get("filterConfig", {}).get("filters") or info.get("filters"):
            page_issues.append(finding("FILTER_NOT_IMPORTED"))
        for key in info:
            if (info.get(key) or key == "displayOption") and key not in appearance and key not in ("$schema", "name", "displayName", "width", "height", "objects", "filterConfig", "filters"):
                page_issues.append(finding("PAGE_PROPERTY_NOT_IMPORTED", key))
        for category, items in (info.get("objects") or {}).items():
            for index, item in enumerate(items):
                for prop in item.get("properties", {}):
                    if (category, index, prop) not in handled:
                        page_issues.append(finding("PAGE_PROPERTY_NOT_IMPORTED", f"objects.{category}.{prop}"))
        audited_visuals = []
        for _z, raw in sorted(inputs, key=lambda item: item[0]):
            targets = mapped_targets.get(id(raw), [])
            entry = audit_visual(raw, targets)
            audited_visuals.append(entry)
            if entry["status"] == "unsupported":
                for target in targets:
                    target["format"]["importWarning"] = "TYPE_UNSUPPORTED"
        page_audit = {"id": pages[-1]["id"], "name": pages[-1]["name"], "issues": page_issues, "visuals": audited_visuals}
        audit_pages.append(page_audit)
        visual_total += len(visuals)
    report = Report.model_validate({"version": 1, "pages": pages}).model_dump(mode="json", exclude_none=True)
    name = report_dir.name.removesuffix(".Report")
    model = _model(name, bindings)
    SemanticModel(model)
    report["importAudit"] = finish_audit(name, audit_pages, report_dir, report_issues)
    report = Report.model_validate(report).model_dump(mode="json", exclude_none=True)
    return report, model, {"pages": len(pages), "visuals": visual_total, "tables": len(model.tablolar)}


def import_report(report_dir: Path, output: Path, *, analyze_only: bool = False) -> dict[str, int]:
    report, model, stats = prepare_report(report_dir)
    output = output.resolve()
    if analyze_only:
        write_audit(output, report["importAudit"])
        return stats
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="floem-pbip-") as temporary:
        doc = Document.new(Path(temporary), model.model.ad)
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
    write_audit(output, report["importAudit"])
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="PBIP sayfa tasarımını boş verili Floem BI taslağına aktarır")
    parser.add_argument("report_dir", type=Path, help="PBIP .Report klasörü")
    parser.add_argument("output", type=Path, help="Oluşturulacak .floem dosyası")
    parser.add_argument("--all", action="store_true", help="Kaynak depodaki tüm .Report klasörlerini aktar")
    parser.add_argument("--analyze-only", action="store_true", help="Yalnız uyumluluk JSON/Markdown raporu oluştur; .floem yazma")
    args = parser.parse_args()
    if args.all:
        sources = sorted(args.report_dir.rglob("*.Report"))
        for source in sources:
            relative = source.relative_to(args.report_dir)
            output = args.output / relative.parent / (source.name.removesuffix(".Report") + ".floem")
            result = import_report(source, output, analyze_only=args.analyze_only)
            print(f"{output}: {result['pages']} sayfa, {result['visuals']} görsel, {result['tables']} tablo")
            print(f"Uyumluluk raporu: {output.with_suffix('.compatibility.md')} ve .json")
        print("Yalnız uyumluluk raporları oluşturuldu; .floem yazılmadı." if args.analyze_only else
              "Veri ve özgün DAX ölçüleri aktarılmadı; dosyalar düzenlenebilir tasarım taslağıdır.")
        return
    result = import_report(args.report_dir, args.output, analyze_only=args.analyze_only)
    print(f"{'İncelendi' if args.analyze_only else 'Aktarıldı'}: {args.output} · {result['pages']} sayfa, {result['visuals']} görsel, {result['tables']} tablo")
    print(f"Uyumluluk raporu: {args.output.with_suffix('.compatibility.md')} ve .json")
    print("Yalnız uyumluluk raporları oluşturuldu; .floem yazılmadı." if args.analyze_only else
          "Veri ve özgün DAX ölçüleri aktarılmadı; bu dosya düzenlenebilir tasarım taslağıdır.")


if __name__ == "__main__":
    main()
