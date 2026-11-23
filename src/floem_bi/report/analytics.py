"""F14: rapor ve tüketici için tek FDX hesabı, kapsam makbuzu ve eşik yorumu.

Bu modül ikinci bir ölçü formülü veya SQL üretmez. Dış kanıt beyanı karşılaştırılır;
veri kaynağının imzası/kimliği doğrulanmış gibi sunulmaz.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from decimal import Decimal
from operator import ge, gt, le, lt

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat

from .schema import AnalyticsConfig, FilterRef

PROTOCOL = "floem-metric/v1"


class MetricEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    protocol: str = Field(max_length=40)
    metricId: str = Field(max_length=100)
    metricVersion: str = Field(max_length=64)
    snapshot: str = Field(max_length=64)
    contextHash: str = Field(max_length=64)
    dataTime: str | None = Field(default=None, max_length=40)
    value: FiniteFloat | None = Field(strict=True)


class AnalyticsQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    metricId: str = Field(min_length=1, max_length=100)
    evidence: MetricEvidence | None = None
    snapshot: str | None = Field(default=None, max_length=64)


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str).encode()).hexdigest()


def canonical_filters(filters: list[FilterRef]) -> list[dict]:
    normalized = []
    for f in filters:
        values = f.values if f.op == "between" else sorted(f.values, key=lambda v: json.dumps(v, sort_keys=True))
        normalized.append({"table": f.table.lower(), "column": f.column.lower(), "op": f.op, "values": values})
    return [json.loads(s) for s in sorted({json.dumps(f, sort_keys=True, ensure_ascii=False) for f in normalized})]


def compare_evidence(receipt: dict, evidence: MetricEvidence | None, tolerance: float) -> dict:
    if evidence is None:
        return {"status": "not_provided", "reasons": []}
    reasons = []
    for key, label in [("protocol", "Sözleşme"), ("metricId", "Katalog kimliği"), ("metricVersion", "Ölçü/kural sürümü"), ("snapshot", "Veri/yetki sürümü"), ("contextHash", "Firma/filtre/birim/tane kapsamı"), ("dataTime", "Kaynak veri zamanı")]:
        if getattr(evidence, key) != receipt[key]:
            reasons.append(f"{label} uyuşmuyor")
    if reasons:
        return {"status": "context_mismatch", "reasons": reasons}
    if receipt["dataTime"] is None:
        return {"status": "unverified", "reasons": ["Kaynak veri zamanı bildirilmemiş"]}
    a, b = receipt["value"], evidence.value
    if a is None or b is None:
        return {"status": "unverified", "reasons": ["Boş değer sayı eşitliği olarak doğrulanamaz"]}
    equal = abs(Decimal(str(a)) - Decimal(str(b))) <= Decimal(str(tolerance))
    return {"status": "match" if equal else "value_mismatch", "reasons": [] if equal else ["Aynı kapsam beyanında değer farkı var"]}


def evaluate_metric(model, engine, config: AnalyticsConfig | None, request: AnalyticsQuery,
                    filters: list[FilterRef], *, revision: str, user=None, roles=None) -> dict:
    from .query import QueryError, VisualQuery, run_visual_query

    metric = next((m for m in config.metrics if m.id == request.metricId), None) if config else None
    if metric is None:
        raise QueryError("Analytics kataloğunda ölçü bulunamadı; rapor tanımını güncelleyin")
    if model.measure(metric.measure) is None:
        raise QueryError("Katalog ölçüsünün FDX bağı bulunamadı")
    scope = [*metric.filters, *filters]
    # Firma adı/kodu yalnız RLS uygulanmış sorgudan gelir. İstek firma yetkisi vermez.
    roots = run_visual_query(model, engine, VisualQuery(group=[metric.company], filters=scope,
        page={"offset": 0, "size": 2, "snapshot": request.snapshot}), user=user, roles=roles, revision=revision)
    if len(roots["rows"]) != 1 or roots["rows"][0][0] is None or roots["page"]["hasMore"]:
        raise QueryError("Ortak ölçü için erişiminiz olan tek bir firma seçin")
    snapshot = roots["page"]["snapshot"]
    result = run_visual_query(model, engine, VisualQuery(values=[{"measure": metric.measure}], filters=scope,
        page={"offset": 0, "size": 1, "snapshot": snapshot}), user=user, roles=roles, revision=revision)
    value = result["rows"][0][0] if result["rows"] else None
    if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)):
        raise QueryError("Ortak ölçü sayısal veya boş bir değer üretmeli")
    rules = [r for r in config.rules if r.metricId == metric.id]
    # Tüm model semantiği dahil: yardımcı ölçü, hesaplanmış sütun, ilişki veya RLS
    # değişince eski kanıt geçersizdir. Bağlantı/kimlik bilgisi makbuza konmaz.
    semantic = model.tanim.model_dump(mode="json", exclude={"veri_kaynaklari"})
    version = digest([PROTOCOL, semantic, metric.model_dump(mode="json"), [r.model_dump(mode="json") for r in rules]])
    context = {"company": roots["rows"][0][0], "companyField": metric.company.model_dump(), "filters": canonical_filters(scope), "unit": metric.unit, "grain": metric.grain}
    receipt = {"protocol": PROTOCOL, "metricId": metric.id, "metricVersion": version,
        "snapshot": snapshot, "datasetVersion": digest(revision), "context": context, "contextHash": digest(context),
        "dataTime": config.dataTime, "dataTimeStatus": "declared" if config.dataTime else "unknown",
        "evaluatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "value": value,
        "alerts": [{**r.model_dump(), "status": "unknown" if value is None else "triggered" if {"gt": gt, "ge": ge, "lt": lt, "le": le}[r.operator](Decimal(str(value)), Decimal(str(r.threshold))) else "clear"} for r in rules]}
    receipt["comparison"] = compare_evidence(receipt, request.evidence, metric.tolerance)
    # Standart görsel sonucu korunur; kart ve uyarı aynı sorgu değerini kullanır.
    return {**result, "analytics": receipt}
