"""Tema, rapor dosyası ve sunucu tanımı arasında aynı değerlerle taşınır."""
import json

import pytest
from pydantic import ValidationError

from floem_bi.report.schema import Report


def test_theme_snapshot_roundtrip_and_legacy():
    theme = {"id": "electric", "version": 1, "mode": "dark", "colors": {"text": "#F5F8FF", "surface": "#12233B"},
             "series": ["#76ACFF", "#5EEAD4"], "density": "comfortable", "reducedMotion": True}
    raw = {"version": 1, "pages": [{"id": "p1", "name": "Tema", "visuals": [
        {"id": "v1", "type": "text", "format": {"color": "#FF0000", "text": "İstanbul"}}]}], "theme": theme}
    saved = Report.model_validate(raw).model_dump(mode="json", exclude_none=True)
    reopened = Report.model_validate_json(json.dumps(saved)).model_dump(mode="json", exclude_none=True)
    assert reopened["theme"] == theme
    assert reopened["pages"][0]["visuals"][0]["format"]["color"] == "#FF0000"
    assert "theme" not in Report.model_validate({"pages": []}).model_dump(exclude_none=True)


@pytest.mark.parametrize("patch", [{"version": 2}, {"mode": "invalid"}, {"series": []},
                                   {"colors": {"text": "url(https://example.com)"}}, {"series": ["red"]}])
def test_reject_invalid_theme_snapshot(patch):
    theme = {"id": "electric", "mode": "light", "colors": {"text": "#172033"}, "series": ["#0866E8"], **patch}
    with pytest.raises(ValidationError):
        Report.model_validate({"pages": [], "theme": theme})
