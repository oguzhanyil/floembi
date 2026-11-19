"""Aktarım kayıpları görünür, gizli değerler taşınmaz, bilinmeyen tür anlam değiştirmez."""
import json
import zipfile

from floem_bi.pbip_import import import_report, prepare_report
from test_pbip_import import _write


def field(kind="Column", name="Tutar"):
    return {kind: {"Expression": {"SourceRef": {"Entity": "Satis"}}, "Property": name}}


def source(tmp_path):
    root = tmp_path / "Test.Report"
    page = root / "definition/pages/p1"
    _write(page.parent / "pages.json", {"pageOrder": ["p1", "missing"]})
    _write(page / "page.json", {"displayName": "Özet", "visibility": "HiddenInViewMode",
        "filterConfig": {"filters": [{"value": "FILTER_SECRET"}]}})
    _write(root / "definition/report.json", {"themeCollection": {"secret": "THEME_SECRET"}})
    _write(root / "definition/bookmarks/bookmarks.json", {"bookmarks": ["SECRET_BOOKMARK"]})
    for index, kind in enumerate(["lineClusteredColumnComboChart", "funnel", "customVisual", "card", "tableEx"]):
        raw = {"name": f"v{index}", "position": {"z": index}, "filterConfig": {"filters": [{"value": "FILTER_SECRET"}]},
            "visual": {"visualType": kind, "query": {"queryState": {"Values": {"projections": [
                {"field": field("Measure", "Satış")}, {"field": {"Aggregation": {"Expression": field(), "Function": 4}}}]}},
                "sortDefinition": {"secret": "SORT_SECRET"}},
                "objects": {"dataPoint": [{"properties": {"fill": {"expr": {"Measure": {"secret": "FORMAT_SECRET"}}}}}]},
                "visualContainerObjects": {"visualLink": [{"properties": {"type": {"expr": {"Literal": {"Value": "'Bookmark'"}}}}}]}}}
        _write(page / f"visuals/v{index}/visual.json", raw)
    return root


def test_analysis_preserves_loss_inventory_without_writing_floem(tmp_path):
    root = source(tmp_path)
    output = tmp_path / "analiz.floem"
    import_report(root, output, analyze_only=True)
    assert not output.exists()
    audit = json.loads(output.with_suffix(".compatibility.json").read_text(encoding="utf-8"))
    assert audit["summary"] == {"pages": 1, "visuals": 5, "mapped": 0, "partial": 2, "unsupported": 3, "skipped": 0}
    assert {i["code"] for i in audit["issues"]} >= {"MODEL_NOT_IMPORTED", "ORDER_ENTRY_MISSING", "REPORT_PROPERTY_NOT_IMPORTED"}
    assert {i["code"] for i in audit["pages"][0]["issues"]} == {"FILTER_NOT_IMPORTED", "PAGE_PROPERTY_NOT_IMPORTED"}
    table = audit["pages"][0]["visuals"][-1]
    assert {i["code"] for i in table["issues"]} >= {"MEASURE_PLACEHOLDER", "AGGREGATION_UNVERIFIED", "FILTER_NOT_IMPORTED", "STYLE_PARTIAL", "ACTION_NOT_IMPORTED", "QUERY_OPTION_NOT_IMPORTED"}
    text = output.with_suffix(".compatibility.json").read_text(encoding="utf-8") + output.with_suffix(".compatibility.md").read_text(encoding="utf-8")
    for secret in ["FILTER_SECRET", "THEME_SECRET", "SORT_SECRET", "FORMAT_SECRET", "SECRET_BOOKMARK"]:
        assert secret not in text


def test_unsupported_types_are_explicit_placeholders_and_audit_survives_file(tmp_path):
    root = source(tmp_path)
    report, _model, _stats = prepare_report(root)
    for v in report["pages"][0]["visuals"][:3]:
        assert v["type"] == "text"
        assert v["format"]["importWarning"] == "TYPE_UNSUPPORTED"
    output = tmp_path / "test.floem"
    import_report(root, output)
    with zipfile.ZipFile(output) as z:
        reopened = json.loads(z.read("report.json"))
    assert reopened["importAudit"] == report["importAudit"]


def test_unknown_role_and_duplicate_source_ids_do_not_claim_mapping(tmp_path):
    root = source(tmp_path)
    for index in ("a", "b"):
        _write(root / f"definition/pages/p1/visuals/{index}/visual.json", {"name": "duplicate", "visual": {
            "visualType": "card", "query": {"queryState": {"UnknownRole": {"projections": [{"field": field()}]}}}}})
    report, _, _ = prepare_report(root)
    items = report["importAudit"]["pages"][0]["visuals"]
    duplicates = [v for v in items if v["sourceId"] == "duplicate"]
    assert len(duplicates) == 2 and duplicates[0]["targetIds"] != duplicates[1]["targetIds"]
    assert all(v["fields"][0]["status"] == "unsupported" for v in duplicates)
