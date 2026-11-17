"""Floem BI query-service (MVP).

Uç noktalar:
  GET  /model           modelin tabloları, sütunları, ölçüleri
  POST /query           görsel sorgusu → DuckDB sonucu (+ üretilen SQL)
  POST /compile         görsel sorgusu → SQL (duckdb | tsql), çalıştırmadan
  POST /dax/validate    DAX ifadesinin söz dizimi/bağlama kontrolü (editör için)

UYARI: MVP'de kullanıcı kimliği ve roller istek gövdesinden gelir; bu yalnızca
geliştirme içindir. Üretimde Keycloak token'ından okunacaktır.

Çalıştırma:
  set FLOEM_MODEL=examples/sapb1_satis.yaml
  set FLOEM_DB=data/demo.duckdb
  uvicorn floem_bi.api.app:app
"""

from __future__ import annotations

import os
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from ..compiler import CompileError, QueryRequest, SqlGenerator, UserInfo
from ..compiler import ir
from ..dax import DaxSyntaxError, parse
from ..engine.duckdb_engine import DuckDBEngine
from ..model import ModelError, SemanticModel


class FilterIn(BaseModel):
    column: str                                   # "Musteri[Grup]"
    op: Literal["in", "not_in", "eq", "ne", "lt", "le", "gt", "ge", "between"] = "in"
    values: list[str | int | float | bool | None]


class UserIn(BaseModel):
    upn: str = ""
    roles: list[str] = Field(default_factory=list)
    attributes: dict[str, list[str]] = Field(default_factory=dict)


class OrderIn(BaseModel):
    name: str
    desc: bool = False


class QueryIn(BaseModel):
    group_by: list[str] = Field(default_factory=list)
    measures: list[str]
    filters: list[FilterIn] = Field(default_factory=list)
    order_by: list[OrderIn] = Field(default_factory=list)
    limit: int | None = Field(default=None, ge=1, le=100_000)
    user: UserIn | None = None


class CompileIn(QueryIn):
    dialect: Literal["duckdb", "tsql"] = "duckdb"


class ValidateIn(BaseModel):
    expression: str


def _json_value(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


def _filter_expr(col, f: FilterIn) -> ir.Expr:
    c = ir.Col(col)
    vals = tuple(ir.Lit(v) for v in f.values)
    if f.op in ("in", "not_in"):
        if not vals:
            raise CompileError(f"{col}: '{f.op}' en az bir değer ister")
        e = ir.InList(c, vals)
        return ir.Not(e) if f.op == "not_in" else e
    if f.op == "between":
        if len(vals) != 2:
            raise CompileError(f"{col}: 'between' iki değer ister")
        return ir.Bin("AND", ir.Bin(">=", c, vals[0]), ir.Bin("<=", c, vals[1]))
    if len(vals) != 1:
        raise CompileError(f"{col}: '{f.op}' tek değer ister")
    op = {"eq": "=", "ne": "<>", "lt": "<", "le": "<=", "gt": ">", "ge": ">="}[f.op]
    return ir.Bin(op, c, vals[0])


def create_app(model_path: str, db_path: str) -> FastAPI:
    model = SemanticModel.from_yaml(model_path)
    errors = model.validate()
    if errors:
        raise ModelError("Model geçersiz:\n" + "\n".join(errors))
    engine = DuckDBEngine(db_path, model)
    app = FastAPI(title="Floem BI query-service", version="0.1.0")

    def build(q: QueryIn, dialect: str):
        user = q.user or UserIn()
        try:
            gen = SqlGenerator(model, dialect, user=UserInfo(user.upn, user.attributes), roles=user.roles)
            req = QueryRequest(
                group_by=[model.col_key(g) for g in q.group_by],
                measures=q.measures,
                filters=[(model.col_key(f.column), _filter_expr(model.col_key(f.column), f)) for f in q.filters],
                order_by=[(o.name, o.desc) for o in q.order_by],
                limit=q.limit,
            )
            return gen.compile(req)
        except (CompileError, ModelError, ValueError) as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/model")
    def get_model():
        out = []
        for t in model.tanim.tablolar:
            out.append({
                "ad": t.ad,
                "tarih_tablosu": t.tarih_tablosu is not None,
                "sutunlar": [{"ad": c.ad, "tip": c.tip, "gizli": c.gizli, "hesaplanmis": c.ifade is not None} for c in t.sutunlar],
                "olculer": [{"ad": m.ad, "ifade": m.ifade, "bicim": m.bicim, "klasor": m.klasor} for m in t.olculer],
                "hiyerarsiler": [h.model_dump() for h in t.hiyerarsiler],
            })
        return {"model": model.tanim.model.model_dump(), "tablolar": out, "uyarilar": model.warnings}

    @app.post("/query")
    def run_query(q: QueryIn):
        compiled = build(q, "duckdb")
        result = engine.execute(compiled)
        return {
            "columns": result.columns,
            "rows": [[_json_value(v) for v in row] for row in result.rows],
            "sql": compiled.sql,
        }

    @app.post("/compile")
    def compile_only(q: CompileIn):
        compiled = build(q, q.dialect)
        return {"dialect": compiled.dialect, "columns": compiled.columns, "sql": compiled.sql}

    @app.post("/dax/validate")
    def validate(v: ValidateIn):
        try:
            parse(v.expression)
        except DaxSyntaxError as e:
            return {"ok": False, "errors": [{"message": e.message, "start": e.span.start, "end": e.span.end}]}
        try:
            from ..compiler import MeasureCompiler
            MeasureCompiler(model).expression(v.expression, ir.Context())
        except CompileError as e:
            span = e.span
            return {"ok": False, "errors": [{
                "message": e.message,
                "start": span.start if span else None,
                "end": span.end if span else None,
            }]}
        return {"ok": True, "errors": []}

    app.state.engine = engine
    app.state.model = model
    return app


def _default_app() -> FastAPI | None:
    model_path = os.environ.get("FLOEM_MODEL")
    db_path = os.environ.get("FLOEM_DB")
    if model_path and db_path:
        return create_app(model_path, db_path)
    return None


app = _default_app()
