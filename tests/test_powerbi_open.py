"""Power BI Aç akışı: model/yerleşim, kaynak koruma, gerçek gömülü veri ve sınırlar."""
import hashlib
import json
from pathlib import Path
import zipfile

import pytest
from fastapi.testclient import TestClient

from floem_bi.desktop_service import create_app
from floem_bi.desktop_service.connections import ConnectionStore
from floem_bi.document.document import Document
from floem_bi.document.floemfile import FloemFileError
from floem_bi.powerbi_layout import project_paths, stage_pbix
from floem_bi.powerbi_model import cached_model
from floem_bi.powerbi_open import open_powerbi, _empty_table, _fill_table
from floem_bi.powerbi_worker import import_isolated
from floem_bi.report.query import VisualQuery

TOKEN = "powerbi-test-session"
HEADERS = {"X-Floem-Token": TOKEN}


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "project"
    report = root / "Ornek.Report"
    page = report / "definition/pages/p1"
    write(root / "Ornek.pbip", {"artifacts": [{"report": {"path": "Ornek.Report"}}]})
    write(report / "definition.pbir", {"datasetReference": {"byPath": {"path": "../Ornek.SemanticModel"}}})
    write(page.parent / "pages.json", {"pageOrder": ["p1"]})
    write(page / "page.json", {"displayName": "Özet", "width": 1280, "height": 720})
    write(page / "visuals/v1/visual.json", {"name": "v1", "position": {"x": 20, "y": 30, "width": 300, "height": 160}, "visual": {"visualType": "card", "query": {"queryState": {"Values": {"projections": [{"field": {"Measure": {"Expression": {"SourceRef": {"Entity": "Satis"}}, "Property": "Net"}}}]}}}}})
    write(root / "Ornek.SemanticModel/model.bim", {"model": {"tables": [{"name": "Satis", "columns": [{"name": "Tutar", "dataType": "double"}], "measures": [{"name": "Net", "expression": "SUM(Satis[Tutar])"}, {"name": "Uyarlama", "expression": "UNSUPPORTED_PBI_FUNCTION(1)"}], "partitions": [{"source": {"expression": "CONNECTION_SENTINEL"}}]}]}})
    return root / "Ornek.pbip"


def test_project_opens_original_measures_without_source_connections(project, tmp_path):
    before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in project.parent.rglob("*") if p.is_file()}
    doc = open_powerbi(tmp_path / "work", project)
    try:
        assert doc.dirty and doc.path is None and doc.tanim.model.ad == "Ornek"
        assert [m.ifade for m in doc.tanim.tablolar[0].olculer] == ["SUM(Satis[Tutar])", "UNSUPPORTED_PBI_FUNCTION(1)"]
        assert doc.tanim.veri_kaynaklari == [] and doc.tanim.tablolar[0].sorgu is None
        audit = doc.content.report["importAudit"]
        assert audit["data"]["status"] == "unavailable" and audit["data"]["rows"] == 0
        assert audit["model"]["unsupportedMeasures"] == 1
        assert "MEASURE_PLACEHOLDER" not in {i["code"] for i in audit["pages"][0]["visuals"][0]["issues"]}
        assert "CONNECTION_SENTINEL" not in doc.tanim.model_dump_json()
        target = tmp_path / "Converted.floem"; doc.save(target)
    finally: doc.close()
    opened = Document.open(tmp_path / "again", target)
    try: assert opened.content.report["importAudit"]["sourceFormat"] == "pbip"
    finally: opened.close()
    assert before == {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in project.parent.rglob("*") if p.is_file()}


@pytest.mark.parametrize("kind", ["pbib", "pbir", "folder"])
def test_project_alias_and_direct_report_selection(project, tmp_path, kind):
    source = project
    if kind == "pbib":
        source = project.with_suffix(".pbib"); source.write_bytes(project.read_bytes())
    elif kind == "pbir": source = project.parent / "Ornek.Report/definition.pbir"
    else: source = project.parent / "Ornek.Report"
    doc = open_powerbi(tmp_path / "work", source)
    try: assert len(doc.content.report["pages"]) == 1
    finally: doc.close()


def test_tmdl_project_preserves_model_and_blocks_unadapted_security(project, tmp_path):
    semantic = project.parent / "Ornek.SemanticModel"
    (semantic / "model.bim").unlink()
    tables = semantic / "definition/tables"; tables.mkdir(parents=True)
    (tables / "Satis.tmdl").write_text("table Satis\n\n    column Tutar\n        dataType: double\n\n    measure Net = SUM(Satis[Tutar])\n\n    partition Satis = m\n        source = CONNECTION_SENTINEL\n", encoding="utf-8")
    roles = semantic / "definition/roles"; roles.mkdir()
    (roles / "Viewer.tmdl").write_text("role Viewer\n    modelPermission: read\n    tablePermission Satis = [Tutar] > 5\n", encoding="utf-8")
    doc = open_powerbi(tmp_path / "work", project)
    try:
        assert doc.tanim.roller[0].tablo_izinleri[0].filtre == "1 = 0"
        assert doc.query(VisualQuery(group=[{"table": "Satis", "column": "Tutar"}]), view_as=["Viewer"])["rows"] == []
        assert "CONNECTION_SENTINEL" not in doc.tanim.model_dump_json()
    finally: doc.close()


def test_project_paths_cannot_escape_or_guess_other_reports(project):
    write(project, {"artifacts": [{"report": {"path": "../../outside.Report"}}]})
    with pytest.raises(ValueError, match="dışına"): project_paths(project)
    write(project, {"artifacts": [{"report": {"path": "Ornek.Report"}}, {"report": {"path": "Second.Report"}}]})
    with pytest.raises(ValueError, match="tek rapor"): project_paths(project)


def layout_fixture():
    return {"sections": [{"name": "page", "displayName": "Özet", "width": 1280, "height": 720, "visualContainers": [{"config": json.dumps({"name": "v1", "layouts": [{"position": {"x": 5, "y": 6, "width": 400, "height": 250}}], "singleVisual": {"visualType": "tableEx", "prototypeQuery": {"From": [{"Name": "s", "Entity": "Satis"}], "Select": [{"Name": "Sum", "Aggregation": {"Expression": {"Column": {"Expression": {"SourceRef": {"Source": "s"}}, "Property": "Tutar"}}, "Function": 1}}]}, "projections": {"Values": [{"queryRef": "Sum"}]}}})}]}]}


def make_pbix(path, layout=None, extra=None):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("Report/Layout", json.dumps(layout or layout_fixture()).encode("utf-16-le"))
        for name, content in (extra or {}).items(): z.writestr(name, content)


def test_legacy_pbix_is_editable_and_aggregation_is_not_replaced_by_sum(tmp_path):
    source = tmp_path / "Thin.pbix"; make_pbix(source)
    doc = open_powerbi(tmp_path / "work", source)
    try:
        visual = doc.content.report["pages"][0]["visuals"][0]
        assert visual["type"] == "table" and visual["x"] == 5 and visual["values"][0] == {"table": "Satis", "column": "Tutar", "agg": "avg"}
        assert doc.content.report["importAudit"]["data"]["status"] == "unavailable"
    finally: doc.close()


@pytest.mark.parametrize("member", ["../escape.json", "/absolute.json", "Report/../../escape.json", "C:/secret.json", "Report/.. /escape.json"])
def test_pbix_archive_traversal_is_rejected(tmp_path, member):
    source = tmp_path / "bad.pbix"; make_pbix(source, extra={member: "{}"})
    with pytest.raises(ValueError, match="geçersiz"): stage_pbix(source, tmp_path / "target.Report")
    assert not (tmp_path / "escape.json").exists()


def test_read_failure_keeps_open_document_and_startup_supports_powerbi(project, tmp_path):
    app = create_app(TOKEN, store=ConnectionStore(tmp_path / "store", use_keyring=False), work_dir=tmp_path / "work")
    with TestClient(app) as client:
        before = client.get("/document", headers=HEADERS).json()
        broken = tmp_path / "broken.pbix"; broken.write_bytes(b"broken")
        assert client.post("/document/open", headers=HEADERS, json={"path": str(broken)}).status_code == 400
        assert client.get("/document", headers=HEADERS).json()["id"] == before["id"]
        assert client.post("/document/open", json={"path": str(project)}).status_code == 401
        result = client.post("/document/open", headers=HEADERS, json={"path": str(project)})
        assert result.status_code == 200, result.text
        assert result.json()["path"] is None and result.json()["dirty"]
    startup = create_app(TOKEN, store=ConnectionStore(tmp_path / "store2", use_keyring=False), work_dir=tmp_path / "work2", open_path=str(project))
    with TestClient(startup) as client:
        state = client.get("/document", headers=HEADERS).json()
        assert state["name"] == "Ornek" and not state.get("startup_error")


def test_native_reader_real_rows_and_portable_roundtrip(tmp_path):
    source = Path(__file__).resolve().parents[1] / "research/repos/pbixray/data/abc.pbix"
    if not source.is_file(): pytest.skip("Yerel PBIXRay açık test korpusu yok; sentetik format testleri yine çalışır")
    doc = import_isolated(tmp_path, str(source))
    try:
        assert doc.content.report["importAudit"]["data"]["rows"] == 9
        q = VisualQuery(group=[{"table": "ABC", "column": "Col1"}], values=[{"table": "ABC", "column": "Col2", "agg": "sum"}])
        assert doc.query(q)["rows"] == [[1, 5], [2, 6], [3, 7], [4, 8], [5, 9], [11, 10]]
        output = tmp_path / "Portable.floem"; doc.save(output)
    finally: doc.close()
    opened = Document.open(tmp_path / "reopen", output)
    try: assert opened.query(q)["rows"][-1] == [11, 10]
    finally: opened.close()


def test_worker_timeout_is_clean_and_does_not_replace_a_file(project, tmp_path):
    before = project.read_bytes()
    with pytest.raises(FloemFileError, match="zaman sınırı"): import_isolated(tmp_path, str(project), timeout=0)
    assert project.read_bytes() == before
    assert not list(tmp_path.glob("powerbi-job-*"))


def test_chunk_failure_discards_previously_imported_rows(project, tmp_path):
    import pandas as pd
    doc = open_powerbi(tmp_path / "work", project)
    table = doc.tanim.tablolar[0]
    class Reader:
        tables = ["Satis"]
        def iter_table(self, *args, **kwargs):
            yield pd.DataFrame({"Tutar": [10., 20.]})
            raise ValueError("bad second chunk")
    try:
        issues = []
        assert _fill_table(doc, table, Reader(), issues) == 0
        assert doc.con.execute('SELECT count(*) FROM veri.pbi_0').fetchone()[0] == 0
        assert issues[0]["code"] == "TABLE_DATA_NOT_IMPORTED"
    finally: doc.close()


def test_measure_only_tables_and_unreadable_security_are_preserved_closed():
    import pandas as pd
    class Reader:
        tables = []
        schema = pd.DataFrame([])
        dax_measures = pd.DataFrame([{"TableName": "Measures", "Name": "Fixed", "Expression": "42"}])
        relationships = pd.DataFrame([])
        @property
        def rls(self): raise ValueError("unsupported metadata")
    issues = []
    model = cached_model(Reader(), "Demo", issues)
    assert model.tablolar[0].olculer[0].ifade == "42"
    assert model.roller[0].tablo_izinleri[0].filtre == "1 = 0"
    assert issues[0]["code"] == "SECURITY_REVIEW_REQUIRED"
