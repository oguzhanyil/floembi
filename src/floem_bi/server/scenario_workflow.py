"""F15: uygulama içi senaryo önerisi/onayı; kaynak sistemde işlem yürütmez."""
from __future__ import annotations

import json
import threading
from typing import Literal

from fastapi import Depends
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, field_validator
from sqlalchemy import and_, select

from ..report.analytics import canonical_filters, digest
from ..report.query import VisualQuery
from ..report.schema import FilterRef, Report
from ..report.scenarios import ScenarioQuery
from . import db


class ProposalScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scenarioId: str = Field(min_length=1, max_length=80)
    filters: list[FilterRef] = Field(default_factory=list, max_length=100)


class ProposalCreate(ProposalScope):
    values: dict[str, FiniteFloat] = Field(default_factory=dict, max_length=12)
    version: str = Field(min_length=64, max_length=64)
    snapshot: str = Field(min_length=64, max_length=64)
    requestKey: str = Field(min_length=16, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    note: str = Field(default="", max_length=1000)

    @field_validator("values", mode="before")
    @classmethod
    def _numbers(cls, values):
        return ScenarioQuery._numbers(values)


class ProposalDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["approved", "rejected"]
    note: str = Field(default="", max_length=1000)


def install_scenario_workflow(app, engine, current_user, load_target, query_target, error):
    # Öneri ve durum değişikliği birlikte kaydedilir. Aynı süreçte yarışlar sıralanır;
    # veritabanındaki tekillik ve koşullu UPDATE de tekrar işlemeyi önler.
    lock = threading.RLock()
    dump = lambda value: json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    def fail(status, message): raise error(status, "scenario_workflow", message)
    def target_for(user, rid=None, aid=None, iid=None):
        with engine.connect() as c: return load_target(c, user, rid, aid, iid)
    def definition(target, scenario_id):
        result = next((s for s in Report.model_validate_json(target["definition"]).scenarios if s.id == scenario_id), None)
        if result is None: fail(404, "Senaryo bulunamadı")
        return result
    def calculate(user, target, scope, values=None):
        q = VisualQuery(scenario=ScenarioQuery(id=scope.scenarioId, values=values or {}), filters=scope.filters)
        return query_target(user, target, q)["scenario"]
    def reviewable(target): return target["role"] in {"admin", "member"}
    def public(c, row):
        user = c.execute(select(db.users.c.name).where(db.users.c.id == row.user_id)).scalar_one()
        events = c.execute(select(db.scenario_events, db.users.c.name.label("actor")).join(db.users, db.users.c.id == db.scenario_events.c.user_id).where(db.scenario_events.c.proposal_id == row.id).order_by(db.scenario_events.c.id)).all()
        return {"id": row.id, "scenarioId": row.scenario_id, "status": row.status, "author": user,
                "note": row.note, "receipt": json.loads(row.receipt_json),
                "events": [{"status": e.status, "actor": e.actor, "note": e.note, "at": e.created_at.isoformat() + ("Z" if e.created_at.tzinfo is None else "")} for e in events]}
    def create(body, user, target):
        config = definition(target, body.scenarioId)
        if not config.proposalEnabled or target["role"] not in config.submitRoles:
            fail(403, "Bu senaryo için öneri oluşturma yetkiniz yok")
        receipt = calculate(user, target, body, body.values)
        request_hash = digest([body.model_dump(mode="json", exclude={"requestKey", "filters"}), canonical_filters(body.filters)])
        with lock, engine.begin() as c:
            previous = c.execute(select(db.scenario_proposals).where(and_(db.scenario_proposals.c.report_id == target["report_id"], db.scenario_proposals.c.user_id == user["id"], db.scenario_proposals.c.request_key == body.requestKey))).first()
            if previous:
                if previous.request_hash != request_hash: fail(409, "Aynı işlem anahtarı farklı bir istek için kullanılamaz")
                if not reviewable(target) and previous.security_version != receipt["securityVersion"]: fail(403, "Önerinin yetki kapsamı değişti")
                return {"proposal": public(c, previous), "replayed": True}
            if receipt["version"] != body.version or receipt["snapshot"] != body.snapshot:
                fail(409, "Veri, yetki veya senaryo tanımı değişti; yeniden hesaplayıp önerin")
            if any(o["value"] is None or o["baseline"] is None for o in receipt["outputs"]):
                fail(400, "Boş sonuçla öneri oluşturulamaz; veri ve filtreleri kontrol edin")
            created = c.execute(db.scenario_proposals.insert().values(report_id=target["report_id"], user_id=user["id"],
                request_key=body.requestKey, request_hash=request_hash, scenario_id=config.id, company_key=dump(receipt["context"]["company"]),
                security_version=receipt["securityVersion"], query_json=dump({"scenarioId": body.scenarioId, "values": receipt["values"], "filters": receipt["context"]["filters"]}),
                receipt_json=dump(receipt), note=body.note, status="pending")).inserted_primary_key[0]
            c.execute(db.scenario_events.insert().values(proposal_id=created, user_id=user["id"], status="pending", note=body.note))
            row = c.execute(select(db.scenario_proposals).where(db.scenario_proposals.c.id == created)).one()
            return {"proposal": public(c, row), "replayed": False}
    def history(body, user, target):
        config = definition(target, body.scenarioId)
        receipt = calculate(user, target, body)
        predicate = and_(db.scenario_proposals.c.report_id == target["report_id"], db.scenario_proposals.c.scenario_id == config.id,
                         db.scenario_proposals.c.company_key == dump(receipt["context"]["company"]))
        if not reviewable(target):
            predicate = and_(predicate, db.scenario_proposals.c.user_id == user["id"], db.scenario_proposals.c.security_version == receipt["securityVersion"])
        with engine.connect() as c:
            rows = c.execute(select(db.scenario_proposals).where(predicate).order_by(db.scenario_proposals.c.id.desc()).limit(101)).all()
            return {"items": [public(c, row) for row in rows[:100]], "hasMore": len(rows) > 100,
                    "canSubmit": config.proposalEnabled and target["role"] in config.submitRoles, "canReview": reviewable(target)}
    def decide(proposal_id, body, user, target):
        if not reviewable(target): fail(403, "Önerileri yalnız çalışma alanı yöneticisi veya üyesi değerlendirebilir")
        with lock:
            with engine.connect() as c:
                row = c.execute(select(db.scenario_proposals).where(and_(db.scenario_proposals.c.id == proposal_id, db.scenario_proposals.c.report_id == target["report_id"]))).first()
            if row is None: fail(404, "Öneri bulunamadı")
            if row.status != "pending":
                if row.status != body.status: fail(409, "Öneri daha önce başka bir kararla kapatıldı")
                with engine.connect() as c: return {"proposal": public(c, row), "replayed": True}
            saved = json.loads(row.query_json)
            config = definition(target, row.scenario_id)
            if body.status == "approved":
                if not config.proposalEnabled: fail(409, "Bu senaryonun öneri akışı kapatılmış")
                receipt = calculate(user, target, ProposalScope.model_validate({"scenarioId": saved["scenarioId"], "filters": saved["filters"]}), saved["values"])
                original = json.loads(row.receipt_json)
                # İnceleyen farklı kullanıcıdır: snapshot kullanıcıya bağlı olduğundan,
                # veri sürümü ayrıca sorgu sağlayıcısından alınır; firma/FDX sonuçları da eşleşir.
                if receipt["version"] != original["version"] or receipt["dataVersion"] != original["dataVersion"] or receipt["contextHash"] != original["contextHash"] or receipt["outputs"] != original["outputs"]:
                    fail(409, "Önerinin veri veya hesap sürümü değişti; yeni bir öneri oluşturun")
            with engine.begin() as c:
                changed = c.execute(db.scenario_proposals.update().where(and_(db.scenario_proposals.c.id == row.id, db.scenario_proposals.c.status == "pending")).values(status=body.status))
                if not changed.rowcount: fail(409, "Öneri başka bir oturumda değerlendirildi")
                c.execute(db.scenario_events.insert().values(proposal_id=row.id, user_id=user["id"], status=body.status, note=body.note))
                row = c.execute(select(db.scenario_proposals).where(db.scenario_proposals.c.id == row.id)).one()
                return {"proposal": public(c, row), "replayed": False}

    @app.post("/api/reports/{rid}/scenario-proposals")
    def report_create(rid: int, body: ProposalCreate, user: dict = Depends(current_user)):
        return create(body, user, target_for(user, rid=rid))
    @app.post("/api/reports/{rid}/scenario-proposals/history")
    def report_history(rid: int, body: ProposalScope, user: dict = Depends(current_user)):
        return history(body, user, target_for(user, rid=rid))
    @app.post("/api/reports/{rid}/scenario-proposals/{proposal_id}/decision")
    def report_decide(rid: int, proposal_id: int, body: ProposalDecision, user: dict = Depends(current_user)):
        return decide(proposal_id, body, user, target_for(user, rid=rid))
    @app.post("/api/apps/{aid}/items/{iid}/scenario-proposals")
    def app_create(aid: int, iid: int, body: ProposalCreate, user: dict = Depends(current_user)):
        return create(body, user, target_for(user, aid=aid, iid=iid))
    @app.post("/api/apps/{aid}/items/{iid}/scenario-proposals/history")
    def app_history(aid: int, iid: int, body: ProposalScope, user: dict = Depends(current_user)):
        return history(body, user, target_for(user, aid=aid, iid=iid))
    @app.post("/api/apps/{aid}/items/{iid}/scenario-proposals/{proposal_id}/decision")
    def app_decide(aid: int, iid: int, proposal_id: int, body: ProposalDecision, user: dict = Depends(current_user)):
        return decide(proposal_id, body, user, target_for(user, aid=aid, iid=iid))
