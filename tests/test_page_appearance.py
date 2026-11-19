"""F10A: kaynak görünüm, saydamlık, kayıp raporu ve gerçek dosya sözleşmesi."""
import pytest
from pydantic import ValidationError

from floem_bi.pbip_import import prepare_report
from floem_bi.report.schema import Report
from test_document import H, client  # noqa: F401
from test_pbip_import import _write


def source(tmp_path, option="FitToPage", transparency=50, **extra):
    root = tmp_path / "Gorunum.Report"
    literal = lambda value: {"expr": {"Literal": {"Value": value}}}
    info = {"name": "p1", "displayName": "Görünüm", "displayOption": option,
            "objects": {"background": [{"properties": {"color": {"solid": {"color": literal("'#123456'")}}, "transparency": literal(f"{transparency}D")}}],
                        "outspace": [{"properties": {"color": {"solid": {"color": literal("'#AABBCC80'")}}, "transparency": literal("100D")}}]}, **extra}
    _write(root / "definition/pages/pages.json", {"pageOrder": ["p1"]})
    _write(root / "definition/pages/p1/page.json", info)
    return root


@pytest.mark.parametrize("option", ["FitToPage", "FitToWidth", "ActualSize"])
@pytest.mark.parametrize("percent", [0, 50, 100])
def test_import_literal_page_properties_no_longer_report_loss(tmp_path, option, percent):
    report, _, _ = prepare_report(source(tmp_path, option, percent))
    page = report["pages"][0]
    assert page["displayOption"] == option
    assert page["backgroundColor"] == "#123456" and page["backgroundTransparency"] == percent
    assert page["outspaceColor"] == "#AABBCC80" and page["outspaceTransparency"] == 100
    assert not report["importAudit"]["pages"][0]["issues"]


def test_unknown_view_and_dynamic_color_remain_explicit_losses(tmp_path):
    root = source(tmp_path, "ActualSizeTopLeft", -1, objects={"background": [{"properties": {
        "color": {"solid": {"color": {"expr": {"ThemeDataColor": {"ColorId": 1}}}}},
        "transparency": {"expr": {"Literal": {"Value": "101D"}}}}}]})
    report, _, _ = prepare_report(root)
    page = report["pages"][0]
    assert "displayOption" not in page and "backgroundColor" not in page and "backgroundTransparency" not in page
    paths = {i["detail"] for i in report["importAudit"]["pages"][0]["issues"]}
    assert paths == {"displayOption", "objects.background.color", "objects.background.transparency"}


@pytest.mark.parametrize("patch", [{"displayOption": "Other"}, {"backgroundTransparency": -1}, {"backgroundTransparency": 101},
                                   {"outspaceTransparency": float("nan")}, {"outspaceColor": "red"}])
def test_invalid_page_appearance_rejected(patch):
    with pytest.raises(ValidationError):
        Report.model_validate({"pages": [{"id": "p1", "name": "Sayfa", **patch}]})


def test_page_appearance_file_roundtrip_and_legacy_defaults(client, tmp_path):
    page = {"id": "p1", "name": "Sayfa", "displayOption": "FitToWidth", "backgroundColor": "#123456", "backgroundTransparency": 50,
            "outspaceColor": "#abcdef", "outspaceTransparency": 100}
    assert client.put("/document/report", headers=H, json={"pages": [page]}).status_code == 200
    path = client.post("/document/save", headers=H, json={"path": str(tmp_path / "gorunum")}).json()["path"]
    client.post("/document/new", headers=H)
    actual = client.post("/document/open", headers=H, json={"path": path}).json()["report"]["pages"][0]
    assert all(actual[k] == v for k, v in page.items())
    legacy = Report.model_validate({"pages": [{"id": "old", "name": "Eski"}]}).model_dump(exclude_none=True)["pages"][0]
    assert "backgroundTransparency" not in legacy and "displayOption" not in legacy
