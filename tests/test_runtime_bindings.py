"""F11: şema, bileşen referansları ve gerçek dosya/yayın kalıcılığı."""
from copy import deepcopy

import pytest
from pydantic import ValidationError

from floem_bi.report.schema import Report, Visual, rename_table_refs, rename_column_refs, rename_measure_refs
from floem_bi.runtime_demo import runtime_report, create_demo
from test_document import H  # noqa: F401
from test_server import server, floem_file  # noqa: F401
from test_grid_paging import big  # noqa: F401


def test_binding_template_slots_and_report_roundtrip():
    report = Report.model_validate(runtime_report())
    assert Report.model_validate_json(report.model_dump_json()) == report
    template = report.components[0]
    assert template.visuals[1].bindings["text"].source.kind == "row"
    assert report.pages[0].visuals[2].repeater.itemHeight == 164
    assert len(template.slots) == 4


@pytest.mark.parametrize("patch", [
    {"bindings": {"value": {"source": {"kind": "field"}}}},
    {"bindings": {"value": {"source": {"kind": "value", "value": {"measure": "Net"}, "field": {"table": "T", "column": "Id"}}}}},
    {"bindings": {"visible": {"source": {"kind": "value", "value": {"measure": "Net"}}, "fallback": 0}}},
    {"bindings": {"color": {"source": {"kind": "value", "value": {"measure": "Net"}}, "rules": [{"op": "gt", "value": 0, "output": "url(x)"}]}}},
    {"bindings": {"icon": {"source": {"kind": "value", "value": {"measure": "Net"}}, "fallback": "<svg>"}}},
    {"states": {"error": {"opacity": 1.1}}},
    {"states": {"hover": {"backgroundColor": "expression(x)"}}},
    {"states": {"empty": {"icon": "invalid"}}},
    {"type": "repeater", "repeater": {"definitionId": "d", "version": 1, "itemHeight": 0}},
    {"repeater": {"definitionId": "d", "version": 1, "itemHeight": 100}},
])
def test_invalid_runtime_outputs_and_sources_rejected(patch):
    with pytest.raises(ValidationError):
        Visual.model_validate({"id": "v", "type": "card", **patch})


def test_repeater_requires_safe_row_template_and_complete_bindings():
    for mutate in [
        lambda r: r["components"].clear(),
        lambda r: r["pages"][0]["visuals"][2]["repeater"]["bindings"].clear(),
        lambda r: r["components"][0]["visuals"][2].update(type="table"),
        lambda r: r["components"][0]["visuals"][1]["bindings"]["text"]["source"].update(kind="field"),
        lambda r: r["components"][0]["slots"][0]["sites"][0].update(path=["bindings", "text", "source", "__proto__"]),
    ]:
        report = runtime_report(); mutate(report)
        with pytest.raises(ValidationError): Report.model_validate(report)


def test_rename_updates_runtime_and_usage_but_keeps_immutable_template():
    report = runtime_report(); definitions = deepcopy(report["components"])
    rename_table_refs(report, "Musteri", "Cari")
    rename_column_refs(report, "Cari", "Ad", "Unvan")
    rename_measure_refs(report, "Açık bakiye", "Net bakiye")
    usage = report["pages"][0]["visuals"][2]["repeater"]["bindings"]
    assert usage["name"] == {"table": "Cari", "column": "Unvan"}
    assert usage["amount"] == {"measure": "Net bakiye"}
    assert report["pages"][1]["visuals"][0]["bindings"]["text"]["source"]["field"] == {"table": "Cari", "column": "Unvan"}
    assert report["components"] == definitions
    Report.model_validate(report)


def test_fake_data_demo_reopens_with_large_repeater_and_scalar_bindings(tmp_path):
    from floem_bi.document.document import Document
    from floem_bi.report.query import VisualQuery
    target = tmp_path / "runtime.floem"; create_demo(target)
    with pytest.raises(ValueError, match="korumak"): create_demo(target)
    doc = Document.open(tmp_path / "opened", target)
    try:
        definition = doc.content.report
        assert len(definition["pages"]) == 3
        q = VisualQuery(group=[{"table": "Musteri", "column": "Id"}], values=[{"measure": "Açık bakiye"}], page={"search": "12049"})
        result = doc.query(q)
        assert result["page"]["totalRows"] == 1 and result["rows"][0][0] == 12049
        result = doc.query(VisualQuery(group=[], values=[{"measure": "Açık bakiye"}], filters=[{"table": "Musteri", "column": "Id", "op": "eq", "values": [0]}]))
        assert result["rows"] == [[0]]
    finally:
        doc.close()


def test_runtime_publishes_without_desktop_personal_library(server, floem_file):
    from test_server import login, publish, YON
    definition = runtime_report()
    # Şablon/bağ tanımları sunucuda korunur; yayında kaynak sorgusu çalıştırılmaz.
    assert floem_file.put("/document/report", headers=H, json=definition).status_code == 200
    assert floem_file.post("/document/save", headers=H, json={"path": floem_file.path}).status_code == 200
    h = login(server, YON)
    response = publish(server, h, floem_file.path)
    assert response.status_code == 200, response.text
    rid = response.json()["report_id"]
    opened = server.get(f"/api/reports/{rid}", headers=h)
    assert opened.status_code == 200
    actual = opened.json()["definition"]
    assert actual["pages"][0]["visuals"][2]["repeater"]["definitionId"] == "customer-card"
    assert actual["components"][0]["visuals"][1]["bindings"]["text"]["source"]["kind"] == "row"


def test_binding_and_repeater_queries_keep_rls_scope(big):
    from floem_bi.report.query import VisualQuery, run_visual_query
    model, engine, _ = big
    def run(**args):
        return run_visual_query(model, engine, VisualQuery(**args), roles=["East"], revision="runtime:1")
    # Tek alan bağı, kullanıcının erişemediği bölgenin adını da göremez.
    assert run(group=[{"table": "F", "column": "Region"}], limit=2)["rows"] == [["East"]]
    denied = [{"table": "F", "column": "Id", "op": "eq", "values": [12049]}]
    assert run(group=[], values=[{"measure": "Ortalama"}], filters=denied)["rows"] == []
    # Tekrarlayıcı da aynı VisualQuery sözleşmesini kullanır; 10.000 sonrası yasak kayıt sızmaz.
    result = run(group=[{"table": "F", "column": "Id"}], values=[{"measure": "Ortalama"}], page={"search": "12049"})
    assert result["rows"] == [] and result["page"]["totalRows"] == 0
