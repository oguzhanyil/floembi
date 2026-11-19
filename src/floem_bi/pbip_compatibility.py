"""PBIP aktarım kararlarını değer/bağlantı/formül kopyalamadan raporlar."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

APPROXIMATE_TYPES = {"lineClusteredColumnComboChart", "lineStackedColumnComboChart", "funnel"}
MESSAGES = {
    "MODEL_NOT_IMPORTED": "Veri, ilişkiler, kaynak sorguları ve özgün ölçü formülleri aktarılmadı. Bu dosya tasarım taslağıdır.",
    "TYPE_UNSUPPORTED": "Bu görselin eşdeğer Floem uygulaması yok; başka grafik anlamına dönüştürülmeden yer tutucu gösterilir.",
    "FILTER_NOT_IMPORTED": "Kaynak filtreleri aktarılmadı; filtreli sonuç eşdeğerliği sağlanmaz.",
    "FIELD_NOT_MAPPED": "Alan rolü veya ifadesi aktarılmadı; alan eşlemesi gerekli.",
    "MEASURE_PLACEHOLDER": "Ölçü başvurusu korundu; özgün formül yerine boş veri taslağı ölçüsü oluşturuldu.",
    "AGGREGATION_UNVERIFIED": "Kaynak toplama işlevi doğrulanmadı; taslak toplamı özgün hesapla eşdeğer kabul etmeyin.",
    "HIERARCHY_UNVERIFIED": "Hiyerarşi düzey adı başvuruya çevrildi; gerçek kaynak sütunu ve tarih hiyerarşisi doğrulanmalı.",
    "STYLE_PARTIAL": "Yalnız desteklenen sabit biçimler taşınır; listelenen biçim özellikleri uygulanmadı.",
    "RICH_TEXT_PARTIAL": "Metin düzleştirildi; tüm parça/paragraf stilleri ayrı ayrı korunmadı.",
    "ACTION_NOT_IMPORTED": "Düğme eylemi aktarılmadı; yalnız geçerli hedefi olan sayfa geçişi desteklenir.",
    "IMAGE_NOT_IMPORTED": "Görsel kaynağı alınamadı veya destek/sınır denetiminden geçmedi.",
    "GROUP_NOT_IMPORTED": "Kaynak grup/kapsayıcı yapısı aktarılmadı; alt nesnelerin yerleşimi kontrol edilmeli.",
    "ORDER_ENTRY_MISSING": "Sayfa sırasındaki kaynak klasör bulunamadı; sayfa aktarılmadı.",
    "PAGE_PROPERTY_NOT_IMPORTED": "Kaynak sayfa özelliği uygulanmadı.",
    "REPORT_PROPERTY_NOT_IMPORTED": "Rapor düzeyindeki özellik uygulanmadı.",
    "BUTTON_SKIPPED": "Eylemsiz saydam tıklama katmanı aktarılmadı.",
    "QUERY_OPTION_NOT_IMPORTED": "Kaynak sıralaması veya sorgu seçeneği aktarılmadı.",
}


def finding(code: str, detail: str = "", severity: str = "warning") -> dict:
    return {"code": code, "severity": severity, "message": MESSAGES[code], "detail": detail}


def _has_filter(raw: dict) -> bool:
    return bool(raw.get("filters") or (raw.get("filterConfig") or {}).get("filters"))


def _unsupported_styles(raw: dict) -> list[str]:
    visual = raw.get("visual") or {}
    kind = visual.get("visualType")
    objects = {"fill": {"fillColor", "transparency"}, "shape": {"tileShape"}, "text": {"text"}}
    if kind == "textbox":
        objects = {"general": {"paragraphs"}}
    elif kind == "image":
        objects = {"general": {"imageUrl"}}
    elif kind not in ("shape", "actionButton"):
        objects = {}
    containers = {"title": {"text"}, "background": {"color", "show"}, "border": {"color", "show", "radius"},
                  "dropShadow": {"show"}, "visualLink": {"show", "type", "navigationSection"}}
    lost = []
    for prefix, source, supported in [("objects", visual.get("objects") or {}, objects),
                                       ("container", visual.get("visualContainerObjects") or {}, containers)]:
        for category, items in source.items():
            for item in items:
                props = item.get("properties") or {}
                conditional = item.get("selector", {}).get("id", "default") != "default"
                for prop, value in props.items():
                    if prop not in supported.get(category, set()) or conditional or _dynamic(value):
                        lost.append(f"{prefix}.{category}.{prop}")
    return sorted(set(lost))


def _dynamic(value) -> bool:
    if isinstance(value, dict):
        if "expr" in value and not any(k in value["expr"] for k in ("Literal", "ResourcePackageItem")):
            return True
        return any(_dynamic(v) for v in value.values())
    return isinstance(value, list) and any(_dynamic(v) for v in value)


def audit_visual(raw: dict, targets: list[dict]) -> dict:
    from .pbip_import import TYPE_MAP, _field, _property, _button_action
    visual = raw.get("visual") or {}
    source_type = visual.get("visualType", "group" if raw.get("visualGroup") else "unknown")
    issues = []
    placeholder = source_type not in TYPE_MAP or source_type in APPROXIMATE_TYPES
    if placeholder:
        issues.append(finding("GROUP_NOT_IMPORTED" if raw.get("visualGroup") else "TYPE_UNSUPPORTED", severity="error"))
    if raw.get("parentGroupName"):
        issues.append(finding("GROUP_NOT_IMPORTED"))
    if not targets and not placeholder:
        issues.append(finding("BUTTON_SKIPPED", severity="info"))
    if _has_filter(raw):
        issues.append(finding("FILTER_NOT_IMPORTED"))
    fields = []
    kind = TYPE_MAP.get(source_type)
    roles = {"matrix": {"Rows", "Columns", "Values"}, "table": {"Values"}, "slicer": {"Values"},
             **{k: {"Values"} for k in ("card", "multicard", "kpi", "ticker")}}
    accepted = roles.get(kind, {"Category", "Series", "Y", "Y2", "X"})
    for role, state in (visual.get("query", {}).get("queryState") or {}).items():
        for index, projection in enumerate(state.get("projections", [])):
            expression = projection.get("field") or {}
            ref = _field(expression)
            bound = bool(ref) and any(
                (ref[0] == "measure" and any(v.get("measure") in (ref[2], f"{ref[1]} · {ref[2]}") for v in target.get("values", []))) or
                any(v.get("table") == ref[1] and v.get("column") == ref[2]
                    for v in [*target.get("group", []), *target.get("legend", []), *target.get("values", [])])
                for target in targets) and not placeholder and role in accepted
            if (role == "Series" or (kind in ("pie", "donut", "treemap", "card") and role in ("Y", "Y2", "X", "Values"))) and index > 0:
                bound = False
            fields.append({"role": role, "table": ref[1] if ref else "", "name": ref[2] if ref else "",
                           "kind": ref[0] if ref else "unknown", "status": "partial" if bound else "unsupported"})
            if not bound:
                issues.append(finding("FIELD_NOT_MAPPED", role))
            elif ref[0] == "measure":
                issues.append(finding("MEASURE_PLACEHOLDER", role))
            if "Aggregation" in expression:
                issues.append(finding("AGGREGATION_UNVERIFIED", role))
            if "HierarchyLevel" in expression:
                issues.append(finding("HIERARCHY_UNVERIFIED", role))
    for key, value in (visual.get("query") or {}).items():
        if key != "queryState" and value:
            issues.append(finding("QUERY_OPTION_NOT_IMPORTED", key))
    styles = _unsupported_styles(raw)
    if styles:
        issues.append(finding("STYLE_PARTIAL", ", ".join(styles)))
    paragraphs = _property(visual.get("objects") or {}, "general", "paragraphs")
    if isinstance(paragraphs, list) and (len(paragraphs) > 1 or any(len(p.get("textRuns", [])) > 1 for p in paragraphs)):
        issues.append(finding("RICH_TEXT_PARTIAL"))
    link = (visual.get("visualContainerObjects") or {}).get("visualLink")
    expected_action = _button_action(raw, {t.get("format", {}).get("action", {}).get("pageId") for t in targets})
    if link and (not expected_action or any(t.get("format", {}).get("action") != expected_action for t in targets)):
        issues.append(finding("ACTION_NOT_IMPORTED"))
    if source_type == "image" and not any(t.get("format", {}).get("imageData") for t in targets):
        issues.append(finding("IMAGE_NOT_IMPORTED"))
    # Özel veri/filtre değerleri ve özgün formüller rapora eklenmez.
    return {"sourceId": str(raw.get("name", "gorsel")), "sourceType": source_type,
            "targetIds": [t["id"] for t in targets], "targetType": targets[0]["type"] if targets else "",
            "status": "unsupported" if placeholder else "skipped" if not targets else "partial" if issues or fields else "mapped",
            "fields": fields, "issues": list({(i["code"], i["detail"]): i for i in issues}.values())}


def finish_audit(source_name: str, pages: list[dict], report_dir: Path, issues: list[dict]) -> dict:
    report_file = report_dir / "definition" / "report.json"
    if report_file.is_file():
        raw = json.loads(report_file.read_text(encoding="utf-8-sig"))
        if _has_filter(raw):
            issues.append(finding("FILTER_NOT_IMPORTED"))
        for key, value in raw.items():
            if key != "$schema" and value:
                issues.append(finding("REPORT_PROPERTY_NOT_IMPORTED", key))
    bookmarks = report_dir / "definition" / "bookmarks"
    if bookmarks.is_dir() and any(bookmarks.iterdir()):
        issues.append(finding("REPORT_PROPERTY_NOT_IMPORTED", "bookmarks"))
    counts = Counter(v["status"] for p in pages for v in p["visuals"])
    return {"version": 1, "source": source_name, "scope": "layout_only", "summary": {
        "pages": len(pages), "visuals": sum(counts.values()),
        **{status: counts[status] for status in ("mapped", "partial", "unsupported", "skipped")}},
        "issues": [finding("MODEL_NOT_IMPORTED", severity="error"), *issues], "pages": pages}


def write_audit(output: Path, audit: dict) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.with_suffix(".compatibility.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    def safe(s):
        return str(s).replace("|", "\\|").replace("\n", " ").replace("\r", " ").replace("<", "&lt;").replace(">", "&gt;")
    labels = {"mapped": "Yerleşim eşlendi", "partial": "Kısmi", "unsupported": "Desteklenmiyor", "skipped": "Atlandı"}
    lines = [f"# PBIP uyumluluk raporu: {safe(audit['source'])}", "", "Kapsam: yalnız tasarım; veri ve özgün ölçü formülleri aktarılmaz.", "",
             "Yerleşim eşlendi durumu semantik eşdeğerlik veya tam biçim sadakati onayı değildir.", ""]
    for issue in audit["issues"]:
        lines.append(f"- **{issue['code']}**: {safe(issue['message'])} {safe(issue['detail'])}")
    for page in audit["pages"]:
        lines += ["", f"## {safe(page['name'])}", ""]
        for issue in page["issues"]:
            lines.append(f"- **{issue['code']}**: {safe(issue['message'])} {safe(issue['detail'])}")
        for visual in page["visuals"]:
            lines += ["", f"### {safe(visual['sourceId'])} · {safe(visual['sourceType'])} · {labels[visual['status']]}",
                      f"Hedef: {safe(', '.join(visual['targetIds'])) or 'yok'} ({safe(visual['targetType'])})"]
            for field in visual["fields"]:
                lines.append(f"- Alan: {safe(field['role'])} · {safe(field['table'])}[{safe(field['name'])}] · {labels[field['status']]}")
            for issue in visual["issues"]:
                lines.append(f"- **{issue['code']}**: {safe(issue['message'])} {safe(issue['detail'])}")
    output.with_suffix(".compatibility.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
