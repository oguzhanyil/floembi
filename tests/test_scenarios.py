"""F15: istek kapsamında FDX varsayımları, RLS ve kalıcı/idempotent öneri akışı."""
from copy import deepcopy

import pytest
from pydantic import ValidationError

from floem_bi.document.document import Document
from floem_bi.model import ModelTanimi
from floem_bi.report.query import QueryError, VisualQuery
from floem_bi.report.schema import Report, rename_measure_refs, rename_table_refs
from floem_bi.scenario_demo import create_demo, scenario_model, scenario_report, seed_scenario_data


def filt(table, column, value): return {"table": table, "column": column, "values": [value]}
SCOPE = [filt("Firma", "Kod", "F1"), filt("Musteri", "Kod", "C001"), filt("Tarih", "Donem", "2026-02")]


@pytest.fixture
def pilot(tmp_path):
    doc = Document.new(tmp_path, "F15 test")
    doc.content.tanim = ModelTanimi.model_validate(scenario_model())
    seed_scenario_data(doc)
    doc.set_report(scenario_report())
    yield doc
    doc.close()


def query(doc, values=None, filters=SCOPE, **kwargs):
    return doc.query(VisualQuery(scenario={"id": "sales.margin", "values": values or {}}, filters=filters), **kwargs)


def test_independent_math_and_original_model_are_preserved(pilot):
    before = pilot.tanim.model_dump_json()
    baseline = query(pilot)["scenario"]
    assert [(o["baseline"], o["value"]) for o in baseline["outputs"][:3]] == [(180, 180), (108, 108), (72, 72)]
    receipt = query(pilot, {"discount": 10, "volume": 20, "cost": 5})["scenario"]
    outputs = receipt["outputs"]
    assert outputs[0]["value"] == pytest.approx(180 * .9 * 1.2)
    assert outputs[1]["value"] == pytest.approx(108 * 1.05 * 1.2)
    assert outputs[2]["value"] == pytest.approx(180 * .9 * 1.2 - 108 * 1.05 * 1.2)
    assert outputs[0]["delta"] == pytest.approx(14.4)
    assert outputs[0]["percent"] == pytest.approx(.08)
    assert pilot.tanim.model_dump_json() == before
    assert pilot.query(VisualQuery(values=[{"measure": "Senaryo net satışı"}], filters=SCOPE))["rows"] == [[180]]
    assert query(pilot)["scenario"]["outputs"][0]["value"] == 180


@pytest.mark.parametrize("values", [{"discount": 51}, {"discount": -.1}, {"discount": .5}, {"volume": -51}, {"cost": 101}, {"unknown": 1}])
def test_invalid_ranges_steps_and_unknown_parameters(pilot, values):
    with pytest.raises(QueryError): query(pilot, values)


@pytest.mark.parametrize("value", [True, "10", float("inf"), float("nan")])
def test_non_numeric_values_are_rejected(value):
    with pytest.raises(ValidationError): VisualQuery(scenario={"id": "sales.margin", "values": {"discount": value}})


def test_constant_binding_default_and_schema_validation(pilot):
    for expression in ["SUM(Satis[Tutar])", "1 + 0", "BLANK()", "broken("]:
        param = next(m for t in pilot.tanim.tablolar for m in t.olculer if m.ad == "Varsayım iskonto yüzdesi")
        param.ifade = expression; pilot.revision += 1
        with pytest.raises(QueryError, match="sayısal sabit"): query(pilot)
    report = scenario_report()
    for field, value in [("step", 0), ("maximum", -1), ("defaultValue", 99)]:
        bad = deepcopy(report); bad["scenarios"][0]["parameters"][0][field] = value
        with pytest.raises(ValidationError): Report.model_validate(bad)
    rename_measure_refs(report, "Varsayım iskonto yüzdesi", "Yeni varsayım")
    rename_table_refs(report, "Firma", "Company")
    assert report["scenarios"][0]["parameters"][0]["measure"] == "Yeni varsayım"
    assert report["scenarios"][0]["company"]["table"] == "Company"


def test_company_period_rls_null_zero_and_snapshot(pilot):
    with pytest.raises(QueryError, match="tek bir firma"): query(pilot, filters=SCOPE[1:])
    secured = query(pilot, {"discount": 10}, filters=SCOPE[1:], view_as=["Örnek Firma F1"], upn="user@floem.test")["scenario"]
    assert secured["context"]["company"] == "F1" and secured["outputs"][0]["value"] == 162
    other = [filt("Firma", "Kod", "F2"), *SCOPE[1:]]
    assert query(pilot, {"discount": 10}, filters=other)["scenario"]["outputs"][0]["value"] == 1620
    with pytest.raises(QueryError): query(pilot, filters=other, view_as=["Örnek Firma F1"])
    empty = [SCOPE[0], filt("Musteri", "Kod", "C006"), SCOPE[2]]
    assert all(o["value"] is None and o["delta"] is None for o in query(pilot, filters=empty)["scenario"]["outputs"])
    pilot.con.execute("UPDATE veri.Satis SET Tutar=0, Maliyet=0"); pilot.revision += 1
    zero = query(pilot)["scenario"]
    assert zero["outputs"][0]["value"] == 0 and zero["outputs"][0]["percent"] is None
    q = VisualQuery(scenario={"id": "sales.margin", "snapshot": zero["snapshot"]}, filters=SCOPE)
    pilot.revision += 1
    with pytest.raises(QueryError, match="değişti"): pilot.query(q)


@pytest.fixture
def web(tmp_path):
    from fastapi.testclient import TestClient
    from floem_bi.server import ServerSettings, create_server, db
    from test_server import IZL, YON, login, publish
    target = tmp_path / "Pilot.floem"
    create_demo(target)
    with TestClient(create_server(ServerSettings(data_dir=tmp_path / "srv", secret="s" * 48))) as server:
        admin, reader = login(server, YON), login(server, IZL)
        published = publish(server, admin, target).json()
        rid, dsid = published["report_id"], published["dataset_id"]
        with server.app.state.db.begin() as c: c.execute(db.shares.insert().values(report_id=rid, user_id=2, shared_by=1))
        assert server.post(f"/api/datasets/{dsid}/security/members", headers=admin, json={"role": "Örnek Firma F1", "email": IZL[0]}).status_code == 200
        yield server, admin, reader, rid, target


def proposal(server, headers, rid, key="f15-sample-request-001", filters=SCOPE, values=None):
    result = server.post(f"/api/reports/{rid}/query", headers=headers, json={"scenario": {"id": "sales.margin", "values": values or {"discount": 10}}, "filters": filters})
    assert result.status_code == 200, result.text
    receipt = result.json()["scenario"]
    return {"scenarioId": receipt["id"], "values": receipt["values"], "filters": filters, "version": receipt["version"], "snapshot": receipt["snapshot"], "requestKey": key, "note": "Örnek öneri"}


def test_proposal_auth_idempotence_decision_and_immutable_history(web):
    from floem_bi.server import db
    server, admin, reader, rid, _ = web
    path = f"/api/reports/{rid}/scenario-proposals"
    body = proposal(server, reader, rid, filters=SCOPE[1:])
    assert server.post(path, json=body).status_code == 401
    created = server.post(path, headers=reader, json=body)
    assert created.status_code == 200, created.text
    record = created.json()["proposal"]; id = record["id"]
    assert record["status"] == "pending" and len(record["events"]) == 1
    retry = server.post(path, headers=reader, json=body).json()
    assert retry["replayed"] and retry["proposal"]["id"] == id
    assert server.post(path, headers=reader, json={**body, "note": "farklı"}).status_code == 409
    assert server.post(f"{path}/{id}/decision", headers=reader, json={"status": "approved"}).status_code == 403
    approved = server.post(f"{path}/{id}/decision", headers=admin, json={"status": "approved", "note": "Uygulama içi onay"})
    assert approved.status_code == 200, approved.text
    assert approved.json()["proposal"]["status"] == "approved"
    assert len(approved.json()["proposal"]["events"]) == 2
    assert server.post(f"{path}/{id}/decision", headers=admin, json={"status": "approved"}).json()["replayed"]
    assert server.post(f"{path}/{id}/decision", headers=admin, json={"status": "rejected"}).status_code == 409
    hist = server.post(f"{path}/history", headers=reader, json={"scenarioId": "sales.margin", "filters": SCOPE}).json()
    assert len(hist["items"]) == 1 and not hist["canReview"] and hist["canSubmit"]
    with server.app.state.db.connect() as c:
        assert len(c.execute(db.scenario_proposals.select()).all()) == 1
        assert len(c.execute(db.scenario_events.select()).all()) == 2


def test_stale_snapshot_and_scope_cannot_create_or_approve(web):
    from floem_bi.server import db
    from test_server import publish
    server, admin, reader, rid, target = web
    path = f"/api/reports/{rid}/scenario-proposals"
    body = proposal(server, reader, rid)
    created = server.post(path, headers=reader, json=body).json()["proposal"]
    assert publish(server, admin, target).status_code == 200
    assert server.post(path, headers=reader, json={**body, "requestKey": "f15-stale-request-002"}).status_code == 409
    assert server.post(f"{path}/{created['id']}/decision", headers=admin, json={"status": "approved"}).status_code == 409
    assert server.post(f"{path}/{created['id']}/decision", headers=admin, json={"status": "rejected"}).status_code == 200
    assert server.post(path, headers=reader, json={**body, "values": {"discount": True}}).status_code == 422
    assert server.post(f"{path}/history", headers=reader, json={"scenarioId": "sales.margin", "filters": [filt("Firma", "Kod", "F2")]}).status_code == 400
    with server.app.state.db.begin() as c: c.execute(db.role_members.delete())
    assert server.post(f"{path}/history", headers=reader, json={"scenarioId": "sales.margin", "filters": SCOPE}).status_code == 403


def test_saved_file_no_overwrite_and_frozen_app_definition(web, tmp_path):
    from floem_bi.server import db
    from test_server import publish
    server, admin, reader, rid, target = web
    original = target.read_bytes()
    with pytest.raises(ValueError): create_demo(target)
    assert target.read_bytes() == original
    app = server.put("/api/workspaces/1/app", headers=admin, json={"name": "F15", "items": [{"report_id": rid}]}).json()
    aid = app["app"]["id"]
    assert server.post(f"/api/apps/{aid}/access", headers=admin, json={"emails": ["izleyici@floembi.test"], "notify": False}).status_code == 200
    iid = server.get(f"/api/apps/{aid}", headers=reader).json()["items"][0]["id"]
    doc = Document.open(tmp_path / "edited", target)
    try:
        report = deepcopy(doc.content.report); report["scenarios"][0]["proposalEnabled"] = False
        doc.set_report(report); doc.save(target)
    finally: doc.close()
    assert publish(server, admin, target).status_code == 200
    current = proposal(server, reader, rid)
    assert server.post(f"/api/reports/{rid}/scenario-proposals", headers=reader, json=current).status_code == 403
    route = f"/api/apps/{aid}/items/{iid}"
    receipt = server.post(f"{route}/query", headers=reader, json={"scenario": {"id": "sales.margin", "values": {"discount": 10}}, "filters": SCOPE}).json()["scenario"]
    body = {**current, "version": receipt["version"], "snapshot": receipt["snapshot"]}
    with server.app.state.db.begin() as c: c.execute(db.shares.delete())
    created = server.post(f"{route}/scenario-proposals", headers=reader, json=body)
    assert created.status_code == 200, created.text


def test_concurrent_retries_commit_one_proposal_and_event(web):
    from concurrent.futures import ThreadPoolExecutor
    from floem_bi.server import db
    server, _, reader, rid, _ = web
    body = proposal(server, reader, rid)
    with ThreadPoolExecutor(max_workers=3) as pool:
        responses = list(pool.map(lambda _: server.post(f"/api/reports/{rid}/scenario-proposals", headers=reader, json=body), range(3)))
    assert all(r.status_code == 200 for r in responses), [r.text for r in responses]
    assert len({r.json()["proposal"]["id"] for r in responses}) == 1
    assert sum(not r.json()["replayed"] for r in responses) == 1
    with server.app.state.db.connect() as c:
        assert len(c.execute(db.scenario_proposals.select()).all()) == len(c.execute(db.scenario_events.select()).all()) == 1


def test_viewer_history_is_own_and_current_scope_managers_retain_history(web):
    from test_server import publish
    server, admin, reader, rid, target = web
    path = f"/api/reports/{rid}/scenario-proposals"
    for headers in [reader, admin]:
        body = proposal(server, headers, rid)
        assert server.post(path, headers=headers, json=body).status_code == 200
    scope = {"scenarioId": "sales.margin", "filters": SCOPE}
    assert len(server.post(f"{path}/history", headers=reader, json=scope).json()["items"]) == 1
    assert len(server.post(f"{path}/history", headers=admin, json=scope).json()["items"]) == 2
    assert publish(server, admin, target).status_code == 200
    assert server.post(f"{path}/history", headers=reader, json=scope).json()["items"] == []
    assert len(server.post(f"{path}/history", headers=admin, json=scope).json()["items"]) == 2


def test_forged_result_and_mixed_query_cannot_be_submitted(web):
    server, admin, reader, rid, _ = web
    path = f"/api/reports/{rid}/scenario-proposals"
    body = proposal(server, reader, rid)
    assert server.post(path, headers=reader, json={**body, "outputs": [{"value": 1}]}).status_code == 422
    assert server.post(path, headers=reader, json={**body, "values": {"discount": "10"}}).status_code == 422
    assert server.post(f"/api/reports/{rid}/query", headers=admin, json={"scenario": {"id": "sales.margin"}, "analytics": {"metricId": "sales.net"}}).status_code == 400
    assert server.post(f"/api/reports/{rid}/query", headers=admin, json={"scenario": {"id": "sales.margin"}, "values": [{"measure": "Senaryo net satışı"}]}).status_code == 400
