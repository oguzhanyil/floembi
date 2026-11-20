"""Denetim örnekleri dosyaya gömülü sentetik veriyle yeniden açılır."""
import pytest

from floem_bi.document.document import Document
from floem_bi.inspector_demo import create_demo, inspector_report
from floem_bi.report.schema import Report


def test_inspector_demo_roundtrip_and_no_overwrite(tmp_path):
    report = Report.model_validate(inspector_report())
    assert len(report.pages) == 4
    assert report.pages[0].layouts[0].width == 390
    target = tmp_path / "Denetim.floem"
    create_demo(target)
    original = target.read_bytes()
    with pytest.raises(ValueError, match="yeni"):
        create_demo(target)
    assert target.read_bytes() == original
    doc = Document.open(tmp_path / "opened", target)
    try:
        assert len(doc.content.report["pages"]) == 4
        assert doc.con.execute("SELECT COUNT(*) FROM veri.f13musteri").fetchone()[0] == 12050
        assert not doc.content.tanim.veri_kaynaklari
    finally:
        doc.close()
