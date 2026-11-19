"""PBIP yerleşiminin veri ve kimlik bilgisi taşımadan Floem taslağına aktarımı."""

from __future__ import annotations

import json
import tempfile
import zipfile
from pathlib import Path

from floem_bi.document import Document
from floem_bi.pbip_import import import_report


def _write(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def test_pbip_import_creates_editable_empty_report(tmp_path):
    source = tmp_path / "Ornek.Report"
    pages = source / "definition" / "pages"
    _write(pages / "pages.json", {"pageOrder": ["p1"]})
    _write(pages / "p1" / "page.json", {"displayName": "Özet", "width": 1280, "height": 720})
    _write(pages / "p1" / "visuals" / "shape1" / "visual.json", {
        "name": "shape1", "position": {"x": 0, "y": 0, "width": 1280, "height": 80, "z": 1},
        "visual": {"visualType": "shape", "objects": {"fill": [{"properties": {
            "fillColor": {"solid": {"color": {"expr": {"Literal": {"Value": "'#123456'"}}}}}
        }}]}}
    })
    _write(pages / "p1" / "visuals" / "card1" / "visual.json", {
        "name": "card1", "position": {"x": 40, "y": 100, "width": 280, "height": 150, "z": 2},
        "visual": {"visualType": "card", "query": {"queryState": {"Values": {"projections": [{
            "field": {"Measure": {"Expression": {"SourceRef": {"Entity": "Satis"}}, "Property": "Toplam Satış"}}
        }]}}}},
        "connectionString": "gizli-baglanti-bilgisi"
    })
    output = tmp_path / "rapor.floem"
    result = import_report(source, output)
    assert result == {"pages": 1, "visuals": 2, "tables": 1}
    with zipfile.ZipFile(output) as archive:
        report_bytes = archive.read("report.json")
        assert b"gizli-baglanti-bilgisi" not in report_bytes
        report = json.loads(report_bytes)
        assert [v["type"] for v in report["pages"][0]["visuals"]] == ["shape", "card"]
        assert report["pages"][0]["visuals"][0]["format"]["backgroundColor"] == "#123456"
    with tempfile.TemporaryDirectory() as directory:
        doc = Document.open(Path(directory), output)
        try:
            state = doc.state()
            assert state["warnings"] == []
            assert len(state["model"]["tablolar"]) == 1
        finally:
            doc.close()
