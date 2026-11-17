"""Görsel sorgusu: alanlar + değerler + filtreler → Floem DAX derleyicisi → DuckDB.

Desktop yerel servisi ve floembi.app aynı fonksiyonu kullanır; görsel hangi tarafta
çalıştığını bilmez.
"""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from ..compiler import CompileError, QueryRequest, SqlGenerator
from ..compiler import ir
from ..connectors import json_value
from ..dax.rename import bracket_token, table_token
from ..engine.duckdb_engine import DuckDBEngine
from ..model import ModelError, SemanticModel
from .schema import FieldRef, FilterRef, ValueRef

# Power BI Türkçe arayüzündeki örtük ölçü adları
AGG = {
    "sum": ("SUM", "Toplam {c}"),
    "avg": ("AVERAGE", "Ortalama {c}"),
    "min": ("MIN", "En Düşük {c}"),
    "max": ("MAX", "En Yüksek {c}"),
    "count": ("COUNTA", "{c} Sayısı"),
    "distinctcount": ("DISTINCTCOUNT", "{c} Sayısı (Farklı)"),
}

MAX_ROWS = 30_000


class OrderRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    index: int = Field(ge=0)            # sonuç sütununun sırası (önce alanlar, sonra değerler)
    desc: bool = False


class VisualQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    group: list[FieldRef] = Field(default_factory=list)
    values: list[ValueRef] = Field(default_factory=list)
    filters: list[FilterRef] = Field(default_factory=list)
    order_by: list[OrderRef] = Field(default_factory=list)
    limit: int = Field(default=1000, ge=1, le=MAX_ROWS)
    totals: bool = False                # tablo görselinin "Toplam" satırı


class QueryError(Exception):
    pass


def value_label(v: ValueRef) -> str:
    if v.measure:
        return v.measure
    return AGG[v.agg][1].format(c=v.column)


def value_dax(v: ValueRef) -> str:
    fn = AGG[v.agg][0]
    return f"{fn}({table_token(v.table)}{bracket_token(v.column)})"


def _filter_expr(col, f: FilterRef) -> ir.Expr:
    c = ir.Col(col)
    vals = tuple(ir.Lit(v) for v in f.values)
    if f.op in ("in", "not_in"):
        if not vals:
            raise QueryError(f"{col}: '{f.op}' filtresi en az bir değer ister")
        e = ir.InList(c, vals)
        return ir.Not(e) if f.op == "not_in" else e
    if f.op == "between":
        if len(vals) != 2:
            raise QueryError(f"{col}: 'between' filtresi iki değer ister")
        return ir.Bin("AND", ir.Bin(">=", c, vals[0]), ir.Bin("<=", c, vals[1]))
    if len(vals) != 1:
        raise QueryError(f"{col}: '{f.op}' filtresi tek değer ister")
    op = {"eq": "=", "ne": "<>", "lt": "<", "le": "<=", "gt": ">", "ge": ">="}[f.op]
    return ir.Bin(op, c, vals[0])


def _value_meta(model: SemanticModel, v: ValueRef) -> dict:
    if v.measure:
        found = model.measure(v.measure)
        if found is None:
            raise QueryError(f"Ölçü bulunamadı: [{v.measure}]")
        return {"type": "double", "format": found[1].bicim}
    _, col = model.column(v.table, v.column)
    if v.agg in ("count", "distinctcount"):
        return {"type": "int64", "format": "#,0"}
    return {"type": "double" if v.agg == "avg" else col.tip, "format": col.bicim}


def run_visual_query(
    model: SemanticModel, engine: DuckDBEngine, q: VisualQuery, user=None, roles: list[str] | None = None,
) -> dict:
    """Görselin verisini döndürür: sütun bilgisi, satırlar, kesildi mi, toplam satırı."""
    try:
        group = [model.column(g.table, g.column)[0] for g in q.group]
        labels: list[str] = []
        exprs: list[tuple[str, str]] = []     # (takma ad, DAX); ölçüler de [Ölçü] olarak
        meta = []
        used: set[str] = {str(g).lower() for g in group}
        for v in q.values:
            base = value_label(v)
            name, n = base, 2
            while name.lower() in used:
                name = f"{base} ({n})"
                n += 1
            used.add(name.lower())
            labels.append(name)
            meta.append(_value_meta(model, v))
            exprs.append((name, bracket_token(v.measure) if v.measure else value_dax(v)))
        filters = [(model.column(f.table, f.column)[0], _filter_expr(model.column(f.table, f.column)[0], f)) for f in q.filters]
        gen = SqlGenerator(model, "duckdb", user=user, roles=roles or [])

        def compile_for(grp, limit, order):
            req = QueryRequest(group_by=grp, measures=[], filters=filters, order_by=order, limit=limit,
                               expressions=exprs)
            return gen.compile(req)

        order = []
        for o in q.order_by:
            if o.index >= len(group) + len(labels):
                raise QueryError("Sıralama sütunu sonuçta yok")
            order.append((([str(g) for g in group] + labels)[o.index], o.desc))
        if not group and not labels:
            return {"columns": [], "rows": [], "truncated": False, "total": None}
        compiled = compile_for(group, q.limit + 1, order)
        result = engine.execute(compiled)
        total = None
        if q.totals and group and labels:
            t = engine.execute(compile_for([], None, []))
            if t.rows:
                by_name = dict(zip(t.columns, t.rows[0]))
                total = [_num(by_name.get(n)) for n in labels]
    except (CompileError, ModelError) as e:
        raise QueryError(str(e)) from e

    rows = [[_num(v) for v in r] for r in result.rows]
    columns = [
        {"name": g.column, "ref": str(g), "kind": "group", "type": model.sutun(g).tip, "format": model.sutun(g).bicim}
        for g in group
    ] + [{"name": n, "kind": "value", **m} for n, m in zip(labels, meta)]
    return {
        "columns": columns,
        "rows": rows[: q.limit],
        "truncated": len(rows) > q.limit,
        "total": total,
    }


def _num(v):
    if isinstance(v, Decimal):
        return float(v)
    return json_value(v)


__all__ = ["QueryError", "VisualQuery", "run_visual_query", "value_label"]
