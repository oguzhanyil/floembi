"""F14: tek FDX hesabı, sürümlü kapsam kanıtı ve Desktop/web RLS sınırı."""
from copy import deepcopy

import pytest
from pydantic import ValidationError

from floem_bi.analytics_demo import analytics_report, create_demo
from floem_bi.document.document import Document
from floem_bi.model import ModelTanimi
from floem_bi.process_demo import process_model, seed_process_data
from floem_bi.report.analytics import MetricEvidence
from floem_bi.report.query import QueryError, VisualQuery
from floem_bi.report.schema import AnalyticsConfig, Report, rename_column_refs, rename_measure_refs, rename_table_refs


def filt(table, column, *values):
    return {"table": table, "column": column, "values": list(values)}


SCOPE = [filt("Firma", "Kod", "F1"), filt("Musteri", "Kod", "C001"), filt("Tarih", "Donem", "2026-02")]


@pytest.fixture
def pilot(tmp_path):
    doc = Document.new(tmp_path, "F14 test")
    doc.content.tanim = ModelTanimi.model_validate(process_model())
    seed_process_data(doc)
    doc.set_report(analytics_report())
    yield doc
    doc.close()


def query(doc, scope=SCOPE, metric="sales.net", evidence=None, snapshot=None, **kwargs):
    evidence = {k: evidence[k] for k in MetricEvidence.model_fields} if evidence else None
    return doc.query(VisualQuery.model_validate({"analytics": {"metricId": metric, "evidence": evidence, "snapshot": snapshot}, "filters": scope}), **kwargs)


def test_card_and_alert_match_independent_sql_and_fdX(pilot):
    sales = query(pilot)
    assert sales["rows"] == [[180]]
    receipt = sales["analytics"]
    sql = pilot.con.execute("""SELECT SUM(s.Tutar) FROM veri.Satis s JOIN veri.Belge b ON b.Key=s.BelgeKey
        WHERE b.MusteriKey='F1:C001' AND b.Tarih BETWEEN DATE '2026-02-01' AND DATE '2026-02-28'""").fetchone()[0]
    assert receipt["value"] == sql == pilot.query(VisualQuery(values=[{"measure": "Dönem net satışı"}], filters=SCOPE))["rows"][0][0]
    assert receipt["alerts"][0]["status"] == "triggered"
    assert receipt["context"]["company"] == "F1" and receipt["context"]["unit"] == "TRY"
    assert receipt["dataTimeStatus"] == "declared" and receipt["dataTime"].startswith("2026-03-31")
    assert receipt["comparison"]["status"] == "not_provided"
    balance = query(pilot, metric="receivable.close")["analytics"]
    assert balance["value"] == 350 and balance["alerts"][0]["status"] == "triggered"
    assert query(pilot, evidence=receipt)["analytics"]["comparison"]["status"] == "match"
    assert query(pilot, snapshot=receipt["snapshot"])["analytics"]["snapshot"] == receipt["snapshot"]


def test_filter_order_duplicates_and_case_preserve_comparison(pilot):
    receipt = query(pilot)["analytics"]
    reordered = [{**f, "table": f["table"].lower(), "column": f["column"].lower()} for f in reversed(SCOPE)]
    assert query(pilot, scope=[*reordered, reordered[0]], evidence=receipt)["analytics"]["comparison"]["status"] == "match"
    modified = {**receipt, "value": receipt["value"] + .0000005}
    assert query(pilot, evidence=modified)["analytics"]["comparison"]["status"] == "match"
    assert query(pilot, evidence={**receipt, "value": 181})["analytics"]["comparison"]["status"] == "value_mismatch"


@pytest.mark.parametrize("key", ["protocol", "metricId", "metricVersion", "snapshot", "contextHash", "dataTime"])
def test_equal_numbers_with_mismatched_evidence_never_verify(pilot, key):
    receipt = query(pilot)["analytics"]
    receipt[key] = "different"
    comparison = query(pilot, evidence=receipt)["analytics"]["comparison"]
    assert comparison["status"] == "context_mismatch" and comparison["reasons"]


def test_company_period_and_rls_apply_to_same_calculation(pilot):
    other = [filt("Firma", "Kod", "F2"), *SCOPE[1:]]
    receipt = query(pilot)["analytics"]
    result = query(pilot, scope=other, evidence=receipt)["analytics"]
    assert result["value"] == 1800 and result["context"]["company"] == "F2"
    assert result["comparison"]["status"] == "context_mismatch"
    restricted = query(pilot, scope=SCOPE[1:], view_as=["Örnek Firma F1"], upn="user@floem.test")["analytics"]
    assert restricted["value"] == 180 and restricted["context"]["company"] == "F1"
    assert query(pilot, evidence=restricted)["analytics"]["comparison"]["status"] == "context_mismatch"
    another_actor = query(pilot, scope=SCOPE[1:], view_as=["Örnek Firma F1"], upn="other@floem.test", evidence=restricted)["analytics"]
    assert another_actor["comparison"]["status"] == "context_mismatch"
    with pytest.raises(QueryError, match="tek bir firma"):
        query(pilot, scope=other, view_as=["Örnek Firma F1"])
    with pytest.raises(QueryError, match="tek bir firma"):
        query(pilot, scope=SCOPE[1:])
    with pytest.raises(QueryError, match="tek bir firma"):
        query(pilot, scope=[*SCOPE, filt("Firma", "Kod", "F2")])


def test_unknown_time_null_and_zero_are_distinct(pilot):
    empty = [SCOPE[0], filt("Musteri", "Kod", "C006"), SCOPE[2]]
    receipt = query(pilot, scope=empty)["analytics"]
    assert receipt["value"] is None and receipt["alerts"][0]["status"] == "unknown"
    assert query(pilot, scope=empty, evidence=receipt)["analytics"]["comparison"]["status"] == "unverified"
    # Açık ve bağımsız sıfır fixture: seçili Şubat'ın mevcut iki satırını sıfırla.
    pilot.con.execute("UPDATE veri.Satis SET Tutar=0 WHERE BelgeKey IN (SELECT Key FROM veri.Belge WHERE MusteriKey='F1:C001' AND Tarih BETWEEN DATE '2026-02-01' AND DATE '2026-02-28')")
    pilot.revision += 1
    zero = query(pilot)["analytics"]
    assert zero["value"] == 0 and zero["alerts"][0]["status"] == "triggered"
    assert query(pilot, evidence=zero)["analytics"]["comparison"]["status"] == "match"
    report = deepcopy(pilot.content.report); report["analytics"].pop("dataTime")
    pilot.set_report(report)
    unknown = query(pilot)["analytics"]
    assert unknown["dataTime"] is None and unknown["dataTimeStatus"] == "unknown"
    assert query(pilot, evidence=unknown)["analytics"]["comparison"]["status"] == "unverified"


@pytest.mark.parametrize("operator,expected", [("gt", "clear"), ("ge", "triggered"), ("lt", "clear"), ("le", "triggered")])
def test_threshold_boundaries(pilot, operator, expected):
    report = deepcopy(pilot.content.report)
    report["analytics"]["rules"][0].update(operator=operator, threshold=180)
    pilot.set_report(report)
    assert query(pilot)["analytics"]["alerts"][0]["status"] == expected


def test_fixed_metric_scope_intersects_caller_and_cannot_be_broadened(pilot):
    report = deepcopy(pilot.content.report)
    report["analytics"]["metrics"][0]["filters"] = [SCOPE[0]]
    pilot.set_report(report)
    assert query(pilot, scope=SCOPE[1:])["analytics"]["value"] == 180
    with pytest.raises(QueryError, match="tek bir firma"):
        query(pilot, scope=[filt("Firma", "Kod", "F2"), *SCOPE[1:]])


def test_semantics_rule_revision_and_stale_snapshot_invalidate_old_receipt(pilot):
    before = query(pilot)["analytics"]
    report = deepcopy(pilot.content.report); report["analytics"]["rules"][0]["threshold"] = 100
    pilot.set_report(report)
    changed = query(pilot, evidence=before)["analytics"]
    assert changed["metricVersion"] != before["metricVersion"] and changed["alerts"][0]["status"] == "clear"
    assert changed["comparison"]["status"] == "context_mismatch"
    with pytest.raises(QueryError, match="değişti"):
        query(pilot, snapshot=before["snapshot"])
    pilot.tanim.tablolar[4].olculer[0].ifade = "SUM(Satis[Tutar]) + 1"
    pilot.revision += 1
    modified = query(pilot)["analytics"]
    assert modified["value"] == 181 and modified["metricVersion"] != changed["metricVersion"]
    version = modified["metricVersion"]
    pilot.revision += 1
    next_revision = query(pilot)["analytics"]
    assert next_revision["metricVersion"] == version and next_revision["snapshot"] != modified["snapshot"]


def test_catalog_validation_and_renames():
    report = analytics_report()
    rename_measure_refs(report, "Dönem net satışı", "Net satış")
    rename_column_refs(report, "Firma", "Kod", "FirmaID")
    rename_table_refs(report, "Firma", "Company")
    metric = Report.model_validate(report).analytics.metrics[0]
    assert metric.measure == "Net satış" and metric.company.table == "Company" and metric.company.column == "FirmaID"
    for change in [lambda c: c["metrics"].append(c["metrics"][0]), lambda c: c["rules"][0].update(metricId="missing"), lambda c: c.update(dataTime="2026-03-31"), lambda c: c["metrics"][0].update(tolerance=float("nan"))]:
        config = deepcopy(report["analytics"]); change(config)
        with pytest.raises(ValidationError): AnalyticsConfig.model_validate(config)


def test_invalid_or_legacy_queries_cannot_forge_metric_definition(pilot):
    with pytest.raises(QueryError, match="kataloğunda"):
        query(pilot, metric="missing")
    with pytest.raises(QueryError, match="yalnız katalog"):
        pilot.query(VisualQuery(analytics={"metricId": "sales.net"}, values=[{"measure": "Dönem net satışı"}]))
    with pytest.raises(ValidationError):
        VisualQuery(analytics={"metricId": "sales.net", "threshold": 0})
    with pytest.raises(ValidationError):
        VisualQuery(analytics={"metricId": "sales.net", "evidence": {"value": 180}})
    for value in [float("inf"), float("nan"), "180", True]:
        evidence = {k: v for k, v in query(pilot)["analytics"].items() if k in MetricEvidence.model_fields}
        with pytest.raises(ValidationError): MetricEvidence.model_validate({**evidence, "value": value})


def test_file_roundtrip_and_authenticated_web_queries(tmp_path):
    from fastapi.testclient import TestClient
    from floem_bi.server import ServerSettings, create_server, db
    from test_server import IZL, YON, login, publish

    target = tmp_path / "F14.floem"
    create_demo(target)
    original = target.read_bytes()
    with pytest.raises(ValueError, match="yeni"): create_demo(target)
    assert target.read_bytes() == original
    doc = Document.open(tmp_path / "opened", target)
    try:
        assert query(doc)["analytics"]["value"] == 180
        assert doc.content.report["pages"][0]["layouts"][0]["width"] == 390
        assert not doc.tanim.veri_kaynaklari
    finally: doc.close()
    with TestClient(create_server(ServerSettings(data_dir=tmp_path / "server", secret="s" * 48))) as server:
        admin = login(server, YON)
        published = publish(server, admin, target)
        assert published.status_code == 200, published.text
        rid, dsid = published.json()["report_id"], published.json()["dataset_id"]
        route = f"/api/reports/{rid}/query"
        payload = {"analytics": {"metricId": "sales.net"}, "filters": SCOPE}
        assert server.post(route, json=payload).status_code == 401
        receipt = server.post(route, headers=admin, json=payload)
        assert receipt.status_code == 200, receipt.text
        receipt = receipt.json()["analytics"]
        assert receipt["value"] == 180
        evidence = {k: receipt[k] for k in MetricEvidence.model_fields}
        same = server.post(route, headers=admin, json={**payload, "analytics": {"metricId": "sales.net", "evidence": evidence}})
        assert same.status_code == 200 and same.json()["analytics"]["comparison"]["status"] == "match"
        app = server.put("/api/workspaces/1/app", headers=admin, json={"name": "F14 pilot", "items": [{"report_id": rid}]}).json()
        aid = app["app"]["id"]
        iid = server.get(f"/api/apps/{aid}", headers=admin).json()["items"][0]["id"]
        edited = Document.open(tmp_path / "edited", target)
        try:
            report = deepcopy(edited.content.report)
            report["analytics"]["rules"][0]["threshold"] = 100
            edited.set_report(report); edited.save(target)
        finally: edited.close()
        assert publish(server, admin, target).status_code == 200
        frozen = server.post(f"/api/apps/{aid}/items/{iid}/query", headers=admin, json=payload)
        assert frozen.status_code == 200, frozen.text
        assert frozen.json()["analytics"]["alerts"][0]["threshold"] == 200
        current = server.post(route, headers=admin, json=payload).json()["analytics"]
        assert current["alerts"][0]["threshold"] == 100 and current["alerts"][0]["status"] == "clear"
        assert current["metricVersion"] != frozen.json()["analytics"]["metricVersion"]
        with server.app.state.db.begin() as c:
            c.execute(db.shares.insert().values(report_id=rid, user_id=2, shared_by=1))
        reader = login(server, IZL)
        assert server.post(route, headers=reader, json=payload).status_code == 403
        assigned = server.post(f"/api/datasets/{dsid}/security/members", headers=admin, json={"role": "Örnek Firma F1", "email": IZL[0]})
        assert assigned.status_code == 200, assigned.text
        allowed = server.post(route, headers=reader, json={**payload, "filters": SCOPE[1:]})
        assert allowed.status_code == 200 and allowed.json()["analytics"]["value"] == 180
        blocked = server.post(route, headers=reader, json={**payload, "filters": [filt("Firma", "Kod", "F2"), *SCOPE[1:]]})
        assert blocked.status_code == 400, blocked.text
        mismatched = server.post(route, headers=reader, json={**payload, "analytics": {"metricId": "sales.net", "evidence": evidence}})
        assert mismatched.status_code == 200 and mismatched.json()["analytics"]["comparison"]["status"] == "context_mismatch"


def test_analytics_consumer_over_http(tmp_path):
    from fastapi.testclient import TestClient
    from floem_bi.analytics_client import report_metric
    from floem_bi.server import ServerSettings, create_server
    from test_browser_refresh import local_http
    from test_server import YON, login, publish

    target = tmp_path / "F14.floem"
    create_demo(target)
    app = create_server(ServerSettings(data_dir=tmp_path / "server", secret="s" * 48))
    client = TestClient(app)
    h = login(client, YON)
    rid = publish(client, h, target).json()["report_id"]
    token = h["Authorization"].removeprefix("Bearer ")
    with local_http(app) as url:
        receipt = report_metric(url, rid, token, "sales.net", SCOPE)
        assert receipt["value"] == 180 and receipt["alerts"][0]["status"] == "triggered"
        same = report_metric(url, rid, token, "sales.net", SCOPE, snapshot=receipt["snapshot"], evidence=receipt)
        assert same["comparison"]["status"] == "match"
        with pytest.raises(RuntimeError, match="401"):
            report_metric(url, rid, "invalid", "sales.net", SCOPE)
