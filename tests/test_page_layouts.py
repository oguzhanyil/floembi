"""F08: tek semantik tanım, sıkı yerleşim sözleşmesi, dosya ve yayınlama."""
import copy

import pytest
from pydantic import ValidationError

from floem_bi.report.schema import Report, rename_measure_refs
from test_document import H, client  # noqa: F401
from test_server import server, floem_file  # noqa: F401


def report():
    return {"pages": [{"id": "p", "name": "Rapor", "width": 1280, "height": 720, "visuals": [
        {"id": "value", "type": "card", "values": [{"measure": "Satis"}]},
        {"id": "go", "type": "button", "format": {"action": {"type": "page", "pageId": "p"}}}],
        "layouts": [{"id": "phone", "name": "Telefon", "maxWidth": 600, "width": 390, "height": 800,
                     "rootLayout": {"mode": "vertical", "autoHeight": True}, "order": ["go", "value"],
                     "overrides": {"value": {"x": 16, "w": 358, "format": {"fontSize": 20}}}}]}]}


@pytest.mark.parametrize("kind", ["unknown", "duplicate-id", "duplicate-width", "order-repeat", "order-unknown", "query", "action", "nan", "zero-size", "narrow", "too-tall", "container", "prototype", "font", "reserved"])
def test_invalid_layout_rejected(kind):
    data = report()
    layout = data["pages"][0]["layouts"][0]
    if kind == "unknown": layout["overrides"]["missing"] = {"x": 0}
    if kind in ("duplicate-id", "duplicate-width"):
        other = copy.deepcopy(layout)
        other["id" if kind == "duplicate-width" else "maxWidth"] = "tablet" if kind == "duplicate-width" else 1024
        data["pages"][0]["layouts"].append(other)
    if kind == "order-repeat": layout["order"] = ["value", "value"]
    if kind == "order-unknown": layout["order"] = ["missing"]
    if kind == "query": layout["overrides"]["value"]["values"] = [{"measure": "Other"}]
    if kind == "action": layout["overrides"]["value"]["format"]["action"] = {"type": "reset"}
    if kind == "nan": layout["overrides"]["value"]["x"] = float("nan")
    if kind == "zero-size": layout["overrides"]["value"]["w"] = 0
    if kind == "narrow": layout["width"] = 100
    if kind == "too-tall": layout["height"] = 20001
    if kind == "container": layout["overrides"]["value"]["container"] = {"mode": "grid"}
    if kind == "prototype":
        data["pages"][0]["visuals"][0]["id"] = "__proto__"
        layout["order"] = []
        layout["overrides"] = {"__proto__": {"x": 1}}
    if kind == "font": layout["overrides"]["value"]["format"]["fontSize"] = 3
    if kind == "reserved": layout["id"] = "auto"
    with pytest.raises(ValidationError): Report.model_validate(data)


def test_save_open_layout_and_shared_measure_rename(client, tmp_path):
    data = report()
    rename_measure_refs(data, "Satis", "NetSatis")
    assert client.put("/document/report", headers=H, json=data).status_code == 200
    path = client.post("/document/save", headers=H, json={"path": str(tmp_path / "responsive")}).json()["path"]
    client.post("/document/new", headers=H)
    actual = client.post("/document/open", headers=H, json={"path": path}).json()["report"]["pages"][0]
    assert actual["layouts"][0]["overrides"]["value"]["format"]["fontSize"] == 20
    assert actual["layouts"][0]["rootLayout"]["autoHeight"] is True
    assert actual["visuals"][0]["values"] == [{"measure": "NetSatis"}]
    assert "values" not in actual["layouts"][0]["overrides"]["value"]
    assert actual["visuals"][1]["format"]["action"]["pageId"] == "p"


def test_legacy_report_needs_no_layout():
    data = report(); del data["pages"][0]["layouts"]
    page = Report.model_validate(data).pages[0]
    assert page.layouts == [] and page.rootLayout is None


def test_layout_count_bounded():
    data = report(); layout = data["pages"][0]["layouts"][0]
    data["pages"][0]["layouts"] = [{**layout, "id": str(i), "maxWidth": 600 + i} for i in range(13)]
    with pytest.raises(ValidationError): Report.model_validate(data)


def test_layouts_publish_and_query_shared_data(server, floem_file):
    from test_server import YON, login, publish
    data = report()
    data["pages"][0]["visuals"][0]["values"] = [{"table": "INV1", "column": "LineTotal", "agg": "sum"}]
    assert floem_file.put("/document/report", headers=H, json=data).status_code == 200
    floem_file.post("/document/save", headers=H, json={"path": floem_file.path})
    headers = login(server, YON)
    response = publish(server, headers, floem_file.path)
    assert response.status_code == 200, response.text
    rid = response.json()["report_id"]
    page = server.get(f"/api/reports/{rid}", headers=headers).json()["definition"]["pages"][0]
    assert page["layouts"][0]["width"] == 390
    assert len(page["visuals"]) == 2 and "values" not in page["layouts"][0]["overrides"]["value"]
    query = {"group": [], "values": page["visuals"][0]["values"], "filters": []}
    result = server.post(f"/api/reports/{rid}/query", headers=headers, json=query)
    assert result.status_code == 200, result.text
    assert float(result.json()["rows"][0][0]) == 272.75
