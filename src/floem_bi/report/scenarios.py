"""F15: sabit FDX varsayımlarını istek kapsamında değiştirir; asıl modeli korur."""
from __future__ import annotations

import math
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, field_validator

from ..dax import DaxSyntaxError, ast, parse
from ..model import SemanticModel
from .analytics import canonical_filters, digest
from .schema import FilterRef, ScenarioDefinition


class ScenarioQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=80)
    values: dict[str, FiniteFloat] = Field(default_factory=dict, max_length=12)
    snapshot: str | None = Field(default=None, max_length=64)

    @field_validator("values", mode="before")
    @classmethod
    def _numbers(cls, values):
        if not isinstance(values, dict) or any(isinstance(v, bool) or not isinstance(v, (float, int)) for v in values.values()):
            raise ValueError("Senaryo girdileri sonlu sayılar olmalı")
        return values


def scenario_by_id(definitions: list[ScenarioDefinition], id: str) -> ScenarioDefinition:
    from .query import QueryError
    found = next((s for s in definitions if s.id == id), None)
    if found is None:
        raise QueryError("Senaryo rapor tanımında bulunamadı")
    return found


def literal_value(expression: str) -> Decimal | None:
    try:
        node = parse(expression)
        sign = 1
        if isinstance(node, ast.Unary) and node.op in {"+", "-"}:
            sign = -1 if node.op == "-" else 1
            node = node.operand
        if isinstance(node, ast.Number) and math.isfinite(node.value):
            return Decimal(str(node.value)) * sign
    except (ValueError, SyntaxError, DaxSyntaxError):
        pass
    return None


def evaluate_scenario(model, engine, definitions, request, filters, *, revision, data_revision=None, user=None, roles=None):
    from .query import QueryError, VisualQuery, run_visual_query

    definition = scenario_by_id(definitions, request.id)
    allowed = {p.id for p in definition.parameters}
    if set(request.values) - allowed:
        raise QueryError("Senaryoda tanımlı olmayan parametre gönderildi")
    values = {p.id: request.values.get(p.id, p.defaultValue) for p in definition.parameters}
    clone = model.tanim.model_copy(deep=True)
    adjusted = SemanticModel(clone)
    for parameter in definition.parameters:
        value = Decimal(str(values[parameter.id]))
        lower, upper, step = (Decimal(str(v)) for v in [parameter.minimum, parameter.maximum, parameter.step])
        if not lower <= value <= upper or (value - lower) % step != 0:
            raise QueryError(f"{parameter.label}: değer sınır ve adım ayarına uymuyor")
        binding = adjusted.measure(parameter.measure)
        if binding is None or literal_value(binding[1].ifade) != Decimal(str(parameter.defaultValue)):
            raise QueryError(f"{parameter.label}: parametre ölçüsü başlangıç değeriyle aynı sayısal sabit olmalı")
        binding[1].ifade = format(value, "f")
    for output in definition.outputs:
        if model.measure(output.measure) is None:
            raise QueryError("Senaryonun çıktı FDX ölçüsü bulunamadı")
    scope = [*definition.filters, *filters]
    roots = run_visual_query(model, engine, VisualQuery(group=[definition.company], filters=scope,
        page={"offset": 0, "size": 2, "snapshot": request.snapshot}), revision=revision, user=user, roles=roles)
    if len(roots["rows"]) != 1 or roots["rows"][0][0] is None or roots["page"]["hasMore"]:
        raise QueryError("Senaryo için erişiminiz olan tek bir firma seçin")
    snapshot = roots["page"]["snapshot"]
    # RLS ile örtük seçilen firma da öneri tekrar incelenirken açık kapsam olur.
    scope = [*scope, FilterRef(table=definition.company.table, column=definition.company.column, values=[roots["rows"][0][0]])]
    q = VisualQuery(values=[{"measure": o.measure} for o in definition.outputs], filters=scope, page={"offset": 0, "size": 1, "snapshot": snapshot})
    baseline = run_visual_query(model, engine, q, revision=revision, user=user, roles=roles)
    simulated = run_visual_query(adjusted, engine, q, revision=revision, user=user, roles=roles)
    def number(result, index):
        value = result["rows"][0][index] if result["rows"] else None
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)):
            raise QueryError("Senaryo çıktısı sonlu sayısal veya boş değer üretmeli")
        return value
    results = []
    rows = []
    for i, output in enumerate(definition.outputs):
        a, b = number(baseline, i), number(simulated, i)
        delta = float(Decimal(str(b)) - Decimal(str(a))) if a is not None and b is not None else None
        percent = delta / abs(a) if delta is not None and a != 0 else None
        if any(v is not None and not math.isfinite(v) for v in [delta, percent]):
            raise QueryError("Senaryo farkı sayısal sınırı aşıyor")
        results.append({**output.model_dump(), "baseline": a, "value": b, "delta": delta, "percent": percent})
        rows.append([output.label, output.unit, a, b, delta, percent])
    semantic = model.tanim.model_dump(mode="json", exclude={"veri_kaynaklari"})
    context = {"company": roots["rows"][0][0], "companyField": definition.company.model_dump(), "filters": canonical_filters(scope)}
    receipt = {"id": definition.id, "label": definition.label, "version": digest([definition.model_dump(mode="json"), semantic]),
        "snapshot": snapshot, "dataVersion": digest(data_revision or revision), "context": context, "contextHash": digest(context), "values": values,
        "securityVersion": digest([getattr(user, "upn", None), roles, semantic, data_revision or revision]),
        "parameters": [p.model_dump() for p in definition.parameters], "outputs": results, "simulation": True}
    return {"columns": [{"name": name, "kind": "group" if i < 2 else "value", "type": "string" if i < 2 else "double", **({"format": "0.0%"} if i == 5 else {})} for i, name in enumerate(["Ölçü", "Birim", "Mevcut", "Senaryo", "Fark", "Değişim oranı"])],
            "rows": rows, "total": None, "truncated": False, "scenario": receipt}
