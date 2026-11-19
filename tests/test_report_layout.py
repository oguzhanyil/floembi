"""Kapsayıcı ağacı doğrulaması ve .floem kayıt uyumu; gerçek kaynak gerekmez."""

from copy import deepcopy

import pytest
from pydantic import ValidationError

from floem_bi.report.schema import Report
from test_document import H, client  # noqa: F401


def report(*visuals):
    return {"version": 1, "pages": [{"id": "p1", "name": "Düzen", "visuals": list(visuals)}]}


def frame(id="frame", **extra):
    return {"id": id, "type": "container", "container": {"mode": "vertical"}, **extra}


def test_layout_file_roundtrip(client, tmp_path):
    definition = report(frame(x=50, y=60, container={"mode": "grid", "columns": 3, "gap": 20,
                       "padding": 24, "overflow": "clip", "autoHeight": True}),
                        frame("nested", parentId="frame"),
                        {"id": "text", "type": "text", "parentId": "nested", "x": 10, "y": 20,
                         "layoutItem": {"grow": 2, "minWidth": 80, "maxWidth": 400},
                         "format": {"text": "Türkçe: Çığ ÖĞÜŞİ ı", "textOverflow": "grow"}})
    response = client.put("/document/report", headers=H, json=definition)
    assert response.status_code == 200, response.text
    path = client.post("/document/save", headers=H, json={"path": str(tmp_path / "duzen")}).json()["path"]
    client.post("/document/new", headers=H)
    opened = client.post("/document/open", headers=H, json={"path": path}).json()["report"]
    nodes = opened["pages"][0]["visuals"]
    assert nodes[0]["container"]["columns"] == 3
    assert nodes[0]["container"]["overflow"] == "clip"
    assert nodes[0]["container"]["autoHeight"] is True
    assert nodes[1]["parentId"] == "frame"
    assert nodes[2]["parentId"] == "nested"
    assert nodes[2]["x"] == 10 and nodes[2]["y"] == 20
    assert nodes[2]["layoutItem"]["grow"] == 2
    assert nodes[2]["format"]["text"] == "Türkçe: Çığ ÖĞÜŞİ ı"


@pytest.mark.parametrize("nodes", [
    [frame(parentId="frame")],
    [frame(parentId="inner"), frame("inner", parentId="frame")],
    [{"id": "a", "type": "text", "parentId": "missing"}],
    [{"id": "a", "type": "text"}, {"id": "b", "type": "shape", "parentId": "a"}],
    [{"id": "a", "type": "text", "container": {"mode": "grid"}}],
])
def test_invalid_container_trees_are_rejected(nodes):
    with pytest.raises(ValidationError):
        Report.model_validate(report(*nodes))


def test_parent_cannot_be_on_another_page():
    definition = report(frame())
    definition["pages"].append({"id": "p2", "name": "İki", "visuals": [{"id": "a", "type": "text", "parentId": "frame"}]})
    with pytest.raises(ValidationError, match="aynı sayfada"):
        Report.model_validate(definition)


def test_depth_limit():
    nodes = [frame("n0")]
    for i in range(1, 16):
        nodes.append(frame(f"n{i}", parentId=f"n{i-1}"))
    Report.model_validate(report(*nodes))
    nodes.append(frame("n16", parentId="n15"))
    with pytest.raises(ValidationError, match="16"):
        Report.model_validate(report(*nodes))


@pytest.mark.parametrize("patch", [
    {"container": {"gap": -1}}, {"container": {"padding": 129}}, {"container": {"columns": 0}},
    {"container": {"columns": 2.5}}, {"container": {"mode": "unknown"}},
    {"container": {"gap": float("nan")}}, {"x": float("inf")}, {"h": float("nan")},
    {"layoutItem": {"grow": 101}}, {"layoutItem": {"minWidth": 200, "maxWidth": 100}},
    {"layoutItem": {"minHeight": 100, "maxHeight": 50}},
])
def test_layout_limits(patch):
    with pytest.raises(ValidationError):
        Report.model_validate(report(frame(**patch)))


def test_validation_does_not_mutate_and_legacy_reports_still_work():
    legacy = report({"id": "a", "type": "text", "x": 12, "format": {"text": "Eski"}})
    before = deepcopy(legacy)
    value = Report.model_validate(legacy).model_dump(mode="json", exclude_none=True)
    assert legacy == before
    assert "parentId" not in value["pages"][0]["visuals"][0]


def test_invalid_tree_api_keeps_previous_report(client):
    valid = report(frame())
    assert client.put("/document/report", headers=H, json=valid).status_code == 200
    response = client.put("/document/report", headers=H, json=report(frame(parentId="frame")))
    assert response.status_code == 400
    current = client.get("/document", headers=H).json()["report"]
    assert "parentId" not in current["pages"][0]["visuals"][0]
