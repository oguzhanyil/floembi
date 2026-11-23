"""PBIX tasarım dönüşümü: gizli katman, tema, masaüstü geometri ve yeni kart."""
import json
from pathlib import Path
import zipfile

import pytest

from floem_bi.powerbi_layout import legacy_layout, stage_pbix
from floem_bi.powerbi_theme import resolve_theme
from floem_bi.pbip_import import _Bindings, _convert_visual, prepare_report


def literal(value): return {"expr": {"Literal": {"Value": "'" + value + "'" if isinstance(value, str) else str(value).lower()}}}
def obj(**props): return [{"properties": {k: literal(v) for k, v in props.items()}}]


def test_legacy_preserves_hidden_layers_and_uses_desktop_layout_even_if_phone_is_first(tmp_path):
    target = tmp_path / "Sample.Report"
    desktop = {"x": 280.45, "y": 120.25, "width": 500, "height": 90, "z": 20000}
    visual = {"name": "mask", "layouts": [{"id": 1, "position": {"x": 0, "y": 0, "width": 300, "height": 90}}, {"id": 0, "position": desktop}], "singleVisual": {"visualType": "shape", "display": {"mode": "hidden"}, "objects": {"fill": obj(fillColor="#ffffff")}}}
    legacy_layout({"sections": [{"name": "page", "width": 1920, "height": 1110, "visualContainers": [{"config": json.dumps(visual)}]}]}, target)
    report, _, _ = prepare_report(target)
    item = report["pages"][0]["visuals"][0]
    assert [item[k] for k in ("x", "y", "w", "h")] == [280.45, 120.25, 500, 90]
    assert item["format"]["initiallyHidden"] and item["format"]["hideInDesign"]


def test_pbix_embedded_palette_and_tints_are_resolved_without_changing_source(tmp_path):
    source = tmp_path / "Palette.pbix"
    color = {"solid": {"color": {"expr": {"ThemeDataColor": {"ColorId": 2, "Percent": .6}}}}}
    layout = {"config": json.dumps({"themeCollection": {"baseTheme": {"name": "Sample"}}}), "sections": [{"name": "p", "config": json.dumps({"objects": {"background": [{"properties": {"color": color}}]}})}]}
    with zipfile.ZipFile(source, "w") as z:
        z.writestr("Report/Layout", json.dumps(layout).encode("utf-16-le"))
        z.writestr("Report/StaticResources/SharedResources/BaseThemes/Sample.json", json.dumps({"background": "#FFFFFF", "foreground": "#252423", "dataColors": ["#118DFF"]}))
    before = source.read_bytes()
    target = tmp_path / "Palette.Report"
    stage_pbix(source, target)
    report, _, _ = prepare_report(target)
    assert report["pages"][0]["backgroundColor"] == "#A0D1FF"
    assert source.read_bytes() == before
    original = {"ThemeDataColor": {"ColorId": 900, "Percent": .6}}
    assert resolve_theme(original, target) == original


@pytest.mark.parametrize("count,kind", [(1, "card"), (2, "multicard")])
def test_new_card_data_role_maps_all_values(tmp_path, count, kind):
    query = {"queryState": {"Data": {"projections": [{"field": {"Measure": {"Expression": {"SourceRef": {"Entity": "Sales"}}, "Property": f"Metric{i}"}}} for i in range(count)]}}}
    raw = {"name": "card", "position": {"x": 40, "y": 12, "width": 220, "height": 65}, "visual": {"visualType": "cardVisual", "query": query, "objects": {"value": obj(fontSize=11)}}}
    item = _convert_visual(tmp_path, raw, _Bindings())
    assert item["type"] == kind and len(item["values"]) == count
    assert item["format"]["fontSize"] == pytest.approx(11 * 4 / 3)
    assert not item["format"]["showTitle"]


@pytest.mark.parametrize("fill", [obj(show=False), []])
def test_transparent_image_and_icon_button_do_not_paint_opaque_frames(tmp_path, fill):
    resource = tmp_path / "StaticResources/RegisteredResources/icon.png"
    resource.parent.mkdir(parents=True); resource.write_bytes(b"synthetic-image")
    url = {"expr": {"ResourcePackageItem": {"ItemName": "icon.png"}}}
    icon = {"image": {"url": url}}
    raw = {"name": "button", "position": {"width": 160, "height": 220}, "visual": {"visualType": "actionButton", "objects": {"icon": [{"properties": {"image": icon, "iconSize": literal(80)}}], "fill": obj(show=False), "text": obj(show=True, text="Open", verticalAlignment="bottom"), "shape": obj(roundEdge=30)}}}
    raw["visual"]["objects"]["fill"] = fill
    item = _convert_visual(tmp_path, raw, _Bindings())
    assert item["type"] == "button"
    assert item["format"]["buttonColor"] == "transparent"
    assert item["format"]["buttonIconPosition"] == "top" and item["format"]["buttonIconSize"] == 80
    assert item["format"]["buttonIconData"].startswith("data:image/png;base64,")
    assert item["format"]["radius"] == 30
    image = _convert_visual(tmp_path, {"name": "image", "visual": {"visualType": "image", "objects": {"general": [{"properties": {"imageUrl": url}}]}}}, _Bindings())
    assert image["format"]["backgroundColor"] == "transparent" and image["format"]["borderWidth"] == 0


def test_container_transparency_is_background_alpha_not_whole_visual_opacity(tmp_path):
    raw = {"name": "card", "visual": {"visualType": "card", "visualContainerObjects": {"background": obj(color="#FFFFFF", transparency=40)}}}
    item = _convert_visual(tmp_path, raw, _Bindings())
    assert item["format"]["backgroundColor"] == "rgba(255, 255, 255, 0.600)"
    assert "opacity" not in item["format"]
