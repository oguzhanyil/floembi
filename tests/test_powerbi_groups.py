"""Power BI grup hiyerarşisi, yerel koordinat, katman ve eylem kapsamı."""
import json

import pytest

from floem_bi.powerbi_layout import legacy_layout, _id
from floem_bi.pbip_import import prepare_report, _page_appearance
from floem_bi.report.schema import Report


def visual(name, x, y, z=0, parent=None, group=False, hidden=False, **extra):
    config = {"name": name, "layouts": [{"id": 0, "position": {"x": x, "y": y, "width": 300, "height": 100, "z": z}}]}
    if group: config["singleVisualGroup"] = {"displayName": name, "groupMode": 0, "isHidden": hidden}
    else: config["singleVisual"] = {"visualType": "textbox", "objects": {"general": [{"properties": {"paragraphs": [{"textRuns": [{"value": name}]}]}}]}}
    if parent: config["parentGroupName"] = parent
    config.update(extra)
    return {"config": json.dumps(config)}


def report(tmp_path, visuals):
    target = tmp_path / "Nested.Report"
    legacy_layout({"sections": [{"name": "p1", "visualContainers": visuals}, {"name": "p2", "visualContainers": []}]}, target)
    return prepare_report(target)[0]


def test_nested_groups_keep_relative_coordinates_and_real_containers(tmp_path):
    result = report(tmp_path, [visual("outer", 200, 100, 2000, group=True), visual("inner", 30, 20, 10, "outer", group=True), visual("label", 5, 7, 1, "inner"), visual("backdrop", 0, 0, 1000)])
    page = result["pages"][0]
    nodes = {v["id"]: v for v in page["visuals"]}
    outer, inner, label = [nodes[_id(name, "unused")] for name in ["outer", "inner", "label"]]
    assert outer["type"] == inner["type"] == "container"
    assert inner["parentId"] == outer["id"] and label["parentId"] == inner["id"]
    assert (inner["x"], inner["y"], label["x"], label["y"]) == (30, 20, 5, 7)
    assert label["x"] + inner["x"] + outer["x"] == 235
    assert label["y"] + inner["y"] + outer["y"] == 127
    assert outer["container"]["kind"] == "group" and outer["container"]["mode"] == "free"
    assert outer["format"]["backgroundColor"] == "transparent"
    assert [v["id"] for v in page["visuals"]].index(outer["id"]) > [v["id"] for v in page["visuals"]].index(_id("backdrop", "unused"))
    assert not any(i["code"] == "GROUP_NOT_IMPORTED" for v in result["importAudit"]["pages"][0]["visuals"] for i in v["issues"])


def test_group_visibility_stays_on_parent_so_unhiding_restores_children(tmp_path):
    result = report(tmp_path, [visual("parent", 200, 100, group=True, hidden=True), visual("child", 5, 7, parent="parent")])
    nodes = {v["id"]: v for v in result["pages"][0]["visuals"]}
    assert nodes[_id("parent", "x")]["format"]["initiallyHidden"]
    assert nodes[_id("parent", "x")]["format"]["hideInDesign"]
    assert not nodes[_id("child", "x")]["format"].get("initiallyHidden")


def test_navigation_overlay_cannot_attach_to_another_groups_local_rectangle(tmp_path):
    button = visual("nav", 0, 0, 5, "left", singleVisual={"visualType": "actionButton", "objects": {"fill": [{"properties": {"show": {"expr": {"Literal": {"Value": "false"}}}}}]}, "vcObjects": {"visualLink": [{"properties": {"show": {"expr": {"Literal": {"Value": "true"}}}, "type": {"expr": {"Literal": {"Value": "'PageNavigation'"}}}, "navigationSection": {"expr": {"Literal": {"Value": "'p2'"}}}}}]}})
    result = report(tmp_path, [visual("left", 0, 0, group=True), visual("right", 600, 0, group=True), visual("left-text", 0, 0, parent="left"), visual("right-text", 0, 0, parent="right"), button])
    nodes = {v["id"]: v for v in result["pages"][0]["visuals"]}
    assert nodes[_id("left-text", "x")]["format"]["action"]["pageId"] == result["pages"][1]["id"]
    assert "action" not in nodes[_id("right-text", "x")]["format"]
    assert "action" not in nodes[_id("left", "x")]["format"]


@pytest.mark.parametrize("nodes", [[visual("child", 0, 0, parent="absent")], [visual("a", 0, 0, parent="b", group=True), visual("b", 0, 0, parent="a", group=True)]])
def test_missing_or_cyclic_group_parent_is_rejected_instead_of_wrong_coordinates(tmp_path, nodes):
    with pytest.raises(ValueError): report(tmp_path, nodes)


def test_svg_page_background_survives_report_roundtrip_with_its_own_alpha(tmp_path):
    resource = tmp_path / "StaticResources/RegisteredResources/background.svg"
    resource.parent.mkdir(parents=True)
    resource.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="100" fill="#123456"/></svg>', encoding="utf-8")
    info = {"objects": {"background": [{"properties": {"image": {"image": {"url": {"expr": {"ResourcePackageItem": {"ItemName": "background.svg"}}}, "scaling": {"expr": {"Literal": {"Value": "'Fit'"}}}}}, "transparency": {"expr": {"Literal": {"Value": "15D"}}}}}]}}
    appearance, handled = _page_appearance(info, tmp_path)
    assert appearance["backgroundImageData"].startswith("data:image/svg+xml;base64,")
    assert appearance["backgroundTransparency"] == 15 and appearance["backgroundImageFit"] == "contain"
    assert ("background", 0, "image") in handled
    value = Report.model_validate({"version": 1, "pages": [{"id": "p", "name": "P", "visuals": [], **appearance}]}).model_dump(mode="json")
    assert value["pages"][0]["backgroundImageData"] == appearance["backgroundImageData"]


def test_page_background_rejects_remote_urls():
    with pytest.raises(ValueError):
        Report.model_validate({"version": 1, "pages": [{"id": "p", "name": "P", "backgroundImageData": "https://example.test/image.svg", "visuals": []}]})
