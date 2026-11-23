"""Sanal FDX tabloları için DuckDB planı. Her satır kendi dış filtre bağlamının kimliğini taşır.

VALUES/SUMMARIZE sütun kökenini korur. CALCULATE bu kökenleri filtreye çevirir.
RLS her fiziksel okumada uygulanır ve ALL/REMOVEFILTERS ile kaldırılamaz.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from functools import lru_cache

from sqlglot import exp

from ..dax import ast, parse
from ..model import ColKey
from . import ir
from .measures import CompileError, _children

TABLE_CALLS = {
    "FILTER",
    "SUMMARIZE",
    "SELECTCOLUMNS",
    "ADDCOLUMNS",
    "CALCULATETABLE",
    "VALUES",
    "DISTINCT",
    "ALL",
    "ALLSELECTED",
    "TOPN",
}
ADVANCED = TABLE_CALLS - {"FILTER", "VALUES", "ALL", "ALLSELECTED"} | {
    "LOOKUPVALUE",
    "TREATAS",
    "ISEMPTY",
    "ISINSCOPE",
    "ISFILTERED",
    "RANKX",
    "CONCATENATEX",
    "FORMAT",
    "CONTAINSSTRING",
    "SEARCH",
    "VALUE",
    "DATEDIFF",
    "CONTAINS",
    "DISTINCTCOUNTNOBLANK",
}


def advanced(node, model, seen):
    if isinstance(node, ast.ColumnRef):
        found = model.measure(node.column)
        if found and found[0].ad.lower() == node.table.lower():
            return True
    if isinstance(node, ast.Call) and (
        node.name in ADVANCED
        or node.name == "COUNTROWS"
        and node.args
        and isinstance(node.args[0], ast.Call)
    ):
        return True
    if isinstance(node, ast.BracketRef) and node.name not in seen:
        seen.add(node.name)
        found = model.measure(node.name)
        if found and advanced(parse(found[1].ifade), model, seen):
            return True
    return any(advanced(n, model, seen) for n in _children(node))


def ident(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    return exp.convert(value).sql(dialect="duckdb")


@dataclass(frozen=True)
class Value:
    sql: str
    kind: str = "number"


@dataclass(frozen=True)
class Column:
    alias: str
    name: str
    kind: str
    key: ColKey | None = None


@dataclass(frozen=True)
class Rows:
    name: str
    parent: str
    columns: tuple[Column, ...]


@dataclass(frozen=True)
class Selection:
    keys: tuple[ColKey, ...]
    # Tek sütun karşılaştırması veya bağlam kimliğine göre eşleşen bir değer tablosu.
    op: str = "="
    value: str = ""
    rows: Rows | None = None
    external: bool = False
    axis: bool = False


@dataclass(frozen=True)
class Scope:
    name: str
    key: str
    filters: tuple[Selection, ...]
    row: tuple[Column, ...] = ()


def require(condition, message):
    if not condition:
        raise CompileError(message)


class TablePlan:
    def __init__(self, gen):
        self.gen = gen
        self.model = gen.model
        self.ctes = {}
        self.sequence = 0
        self.measures = {}
        self.stack = []
        self.group = []
        self.paths = lru_cache(maxsize=None)(self.model.path)
        self._scanned = lru_cache(maxsize=None)(self._scan)
        self._frame = lru_cache(maxsize=None)(self._make_frame)

    def alias(self, prefix):
        self.sequence += 1
        return f"{prefix}{self.sequence}"

    def cte(self, sql):
        if sql not in self.ctes:
            require(len(self.ctes) < 4096, "Ölçü sanal tablo planı sınırını aşıyor")
            self.ctes[sql] = self.alias("q")
        return self.ctes[sql]

    def key(self, node):
        require(isinstance(node, ast.ColumnRef), "Tablo[Sütun] başvurusu gerekli")
        return self.model.column(node.table, node.column)[0]

    def kind(self, key):
        tip = self.model.sutun(key).tip
        return tip if tip in ("date", "datetime", "string", "bool") else "number"

    def ref(self, rows, key, kind):
        return Value(
            f"(SELECT v FROM {rows} AS result WHERE result.{key}=e.{key})", kind
        )

    def freeze(self, val, scope):
        if isinstance(val, Rows) or "e." not in val.sql:
            return val
        name = self.cte(f"SELECT e.{scope.key}, {val.sql} AS v FROM {scope.name} e")
        return self.ref(name, scope.key, val.kind)

    def frame(self, rows, scope):
        return self._frame(rows, scope)

    def _make_frame(self, rows, scope):
        key = self.alias("s")
        name = self.cte(f"SELECT *, row_number() OVER () AS {key} FROM {rows.name}")
        return Scope(name, key, scope.filters, scope.row + rows.columns)

    def transition(self, scope):
        filters = list(scope.filters)
        for col in scope.row:
            if col.key:
                filters = [f for f in filters if col.key not in f.keys]
                filters.append(
                    Selection((col.key,), "IS NOT DISTINCT FROM", "e." + col.alias)
                )
        return replace(scope, row=(), filters=tuple(filters))

    def scan(self, table, keys, scope, distinct=False):
        return self._scanned(table, tuple(keys), scope, distinct)

    def _scan(self, table, keys, scope, distinct):
        # Her yol çoktan bire gider. Yalnız gereken boyutlarla birleşilir.
        aliases = {table: "b"}
        joins = []

        def physical(key):
            for edge in self.paths(table, key.table) or ():
                target = edge.to_col.table
                if target not in aliases:
                    alias = f"j{len(aliases)}"
                    joins.append(
                        f"{'INNER' if edge.inner else 'LEFT'} JOIN {self.gen._source(target, alias).sql(dialect='duckdb')} ON "
                        f"{aliases[edge.from_col.table]}.{ident(self.gen._physical(edge.from_col))}="
                        f"{alias}.{ident(self.gen._physical(edge.to_col))}"
                    )
                    aliases[target] = alias
            require(
                key.table in aliases,
                f"{table} ile {key.table} arasında ilişki yolu yok",
            )
            return exp.column(
                self.gen._physical(key), table=aliases[key.table], quoted=True
            )

        def render(pred):
            return self.gen.render(pred, physical).sql(dialect="duckdb")

        def col(key):
            return render(ir.Col(key))

        conditions = [
            render(p) for t, p in self.gen.rls if self.paths(table, t) is not None
        ]
        for f in scope.filters:
            if not all(self.paths(table, k.table) is not None for k in f.keys):
                continue
            if f.external:
                conditions.append(render(f.value))
            elif f.rows:
                equal = [
                    f"match.{c.alias} IS NOT DISTINCT FROM {col(k)}"
                    for k, c in zip(f.keys, f.rows.columns)
                ]
                conditions.append(
                    f"EXISTS (SELECT 1 FROM {f.rows.name} match WHERE match.{f.rows.parent}=e.{f.rows.parent} AND {' AND '.join(equal)})"
                )
            else:
                conditions.append(f"({col(f.keys[0])} {f.op} {f.value})")
        columns = tuple(
            Column(self.alias("c"), k.column, self.kind(k), k) for k in keys
        )
        projection = "".join(f", {col(k)} AS {c.alias}" for k, c in zip(keys, columns))
        query = f"SELECT {'DISTINCT ' if distinct else ''}e.*{projection} FROM {scope.name} e CROSS JOIN {self.gen._source(table, 'b').sql(dialect='duckdb')} {' '.join(joins)}"
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        return Rows(self.cte(query), scope.key, columns)

    def lifted(self, rows, scope):
        if rows.parent == scope.key:
            return rows
        # Aynı tablo değişkeni iç içe yinelenebilir. Dış satırın sütunu ve
        # yeni iç satırın sütunu farklı SQL adlarına sahip olmalı.
        rebound = tuple(replace(c, alias=self.alias("c")) for c in rows.columns)
        cols = "".join(
            f", t.{old.alias} AS {new.alias}" for old, new in zip(rows.columns, rebound)
        )
        name = self.cte(
            f"SELECT e.*{cols} FROM {scope.name} e JOIN {rows.name} t ON t.{rows.parent}=e.{rows.parent}"
        )
        return Rows(name, scope.key, rebound)

    def without(self, scope, keys, axis_only=False):
        return replace(
            scope,
            filters=tuple(
                f
                for f in scope.filters
                if not (set(keys).intersection(f.keys) and (not axis_only or f.axis))
            ),
        )

    def removed(self, args, scope, axis_only):
        keys = set()
        for arg in args:
            if isinstance(arg, ast.ColumnRef):
                keys.add(self.key(arg))
            else:
                table = self.gen.compiler.resolve_table(arg)
                keys.update(
                    k for f in scope.filters for k in f.keys if k.table == table
                )
        if not args:
            keys = {k for f in scope.filters for k in f.keys}
        return self.without(scope, keys, axis_only)

    def bindings(self, node, scope, env):
        env = dict(env)
        for name, expr in node.variables:
            env[name.lower()] = (
                self.table(expr, scope, env)
                if self.is_table(expr, env)
                else self.freeze(self.scalar(expr, scope, env), scope)
            )
        return env

    def is_table(self, node, env):
        if isinstance(node, ast.Name):
            return isinstance(env.get(node.name.lower()), Rows) or self.model.has_table(
                node.name
            )
        return (
            isinstance(node, ast.TableConstructor)
            or isinstance(node, ast.Call)
            and node.name in TABLE_CALLS
        )

    def table(self, node, scope, env):
        if isinstance(node, ast.Name):
            bound = env.get(node.name.lower()) if not node.quoted else None
            if isinstance(bound, Rows):
                return self.lifted(bound, scope)
            table = self.model.table(node.name)
            return self.scan(
                table.ad, [ColKey(table.ad, c.ad) for c in table.sutunlar], scope
            )
        if isinstance(node, ast.TableConstructor):
            require(node.items, "Boş tablo kurucusu desteklenmiyor")
            vals = [self.scalar(a, scope, env) for a in node.items]
            col = Column(self.alias("c"), "Value", vals[0].kind)
            sql = " UNION ALL ".join(
                f"SELECT e.*, {v.sql} AS {col.alias} FROM {scope.name} e" for v in vals
            )
            return Rows(self.cte(sql), scope.key, (col,))
        require(isinstance(node, ast.Call), "Tablo ifadesi gerekli")
        n, args = node.name, node.args
        if n == "CALCULATETABLE" and args:
            return self.table(args[0], self.modified(args[1:], scope, env), env)
        if n in {"ALL", "ALLSELECTED", "VALUES", "DISTINCT", "SUMMARIZE"} and args:
            base = args[0]
            if n in {"ALL", "ALLSELECTED"}:
                scope = self.removed(args, scope, n == "ALLSELECTED")
            if n == "SUMMARIZE":
                table = self.gen.compiler.resolve_table(base)
                keys = [self.key(x) for x in args[1:]]
            elif isinstance(base, ast.Name):
                require(len(args) == 1, f"{n} tek tablo alır")
                return self.table(base, scope, env)
            else:
                keys = [self.key(x) for x in args]
                table = keys[0].table
                require(
                    all(k.table == table for k in keys),
                    f"{n} aynı tablo sütunlarını alır",
                )
            return self.scan(table, keys, scope, True)
        if n in {"FILTER", "ADDCOLUMNS", "SELECTCOLUMNS", "TOPN"}:
            offset = 1 if n == "TOPN" else 0
            require(len(args) >= 2 + offset, f"{n} argümanları eksik")
            rows = self.table(args[offset], scope, env)
            frame = self.frame(rows, scope)
            if n == "FILTER":
                require(len(args) == 2, "FILTER iki argüman alır")
                pred = self.scalar(args[1], frame, env)
                sql = f"SELECT e.* EXCLUDE ({frame.key}) FROM {frame.name} e WHERE {pred.sql}"
                return replace(rows, name=self.cte(sql))
            if n == "TOPN":
                require(len(args) in (3, 4), "TOPN tek sıralama ifadesi alır")
                direction = self.order(args[3] if len(args) > 3 else None)
                score = self.scalar(args[2], frame, env)
                limit = self.scalar(args[0], scope, env)
                sql = f"SELECT e.* EXCLUDE ({frame.key}) FROM {frame.name} e QUALIFY rank() OVER (PARTITION BY e.{scope.key} ORDER BY {score.sql} {direction}) <= {limit.sql}"
                return replace(rows, name=self.cte(sql))
            require(len(args) % 2 == 1, f"{n} ad ve ifade çiftleri alır")
            cols, parts = [], []
            for label, expr in zip(args[1::2], args[2::2]):
                require(isinstance(label, ast.String), f"{n} sütun adı metin olmalı")
                val = self.scalar(expr, frame, env)
                key = self.key(expr) if isinstance(expr, ast.ColumnRef) else None
                col = Column(self.alias("c"), label.value, val.kind, key)
                cols.append(col)
                parts.append(f"{val.sql} AS {col.alias}")
            excluded = [frame.key] + (
                [c.alias for c in rows.columns] if n == "SELECTCOLUMNS" else []
            )
            sql = f"SELECT e.* EXCLUDE ({', '.join(excluded)}), {', '.join(parts)} FROM {frame.name} e"
            return Rows(
                self.cte(sql),
                scope.key,
                tuple(cols) if n == "SELECTCOLUMNS" else rows.columns + tuple(cols),
            )
        raise CompileError(f"Desteklenmeyen FDX tablo ifadesi: {n}")

    @staticmethod
    def order(node):
        if node is None:
            return "DESC"
        key = (
            node.name.upper()
            if isinstance(node, ast.Name)
            else str(getattr(node, "value", "")).upper()
        )
        require(
            key in {"ASC", "DESC", "0", "1", "TRUE", "FALSE"},
            "Sıralama yönü ASC/DESC olmalı",
        )
        return "ASC" if key in {"ASC", "1", "TRUE"} else "DESC"

    def modified(self, args, original, env):
        out = self.transition(original)
        additions = []
        for arg in args:
            n = arg.name if isinstance(arg, ast.Call) else ""
            if n in ("REMOVEFILTERS", "ALL", "ALLSELECTED"):
                out = self.removed(arg.args, out, n == "ALLSELECTED")
                continue
            keep = n == "KEEPFILTERS"
            if keep:
                require(len(arg.args) == 1, "KEEPFILTERS tek filtre alır")
                arg = arg.args[0]
            if isinstance(arg, ast.Call) and arg.name == "TREATAS":
                rows = self.table(arg.args[0], original, env)
                keys = tuple(self.key(k) for k in arg.args[1:])
                require(
                    bool(keys) and len(keys) == len(rows.columns),
                    "TREATAS sütun sayıları eşleşmeli",
                )
                filt = Selection(keys, rows=rows)
            elif self.is_table(arg, env):
                rows = self.table(arg, original, env)
                keys = tuple(c.key for c in rows.columns)
                require(all(keys), "Tablo filtresi kaynak sütun kökeni gerektirir")
                filt = Selection(keys, rows=rows)
            elif (
                isinstance(arg, ast.Binary)
                and isinstance(arg.left, ast.ColumnRef)
                and arg.op in ("=", "<>", ">", "<", ">=", "<=")
                and not isinstance(arg.right, ast.ColumnRef)
            ):
                val = self.scalar(arg.right, original, env)
                filt = Selection((self.key(arg.left),), arg.op, val.sql)
            else:
                keys = []

                def walk(a):
                    if isinstance(a, ast.ColumnRef) and self.key(a) not in keys:
                        keys.append(self.key(a))
                    for child in _children(a):
                        walk(child)

                walk(arg)
                require(
                    keys and len({k.table for k in keys}) == 1,
                    "Filtre tek tabloya başvurmalı",
                )
                rows = self.scan(
                    keys[0].table, keys, self.without(original, keys), True
                )
                frame = self.frame(rows, original)
                pred = self.scalar(arg, frame, env)
                selected = self.cte(f"SELECT e.* FROM {frame.name} e WHERE {pred.sql}")
                filt = Selection(tuple(keys), rows=replace(rows, name=selected))
            if not keep:
                out = self.without(out, filt.keys)
            additions.append(filt)
        return replace(out, filters=out.filters + tuple(additions))

    def aggregated(self, rows, scope, expression, kind="number"):
        sql = f"SELECT e.{scope.key}, {expression} AS v FROM {rows} e GROUP BY e.{scope.key}"
        return self.ref(self.cte(sql), scope.key, kind)

    def measure(self, name, scope):
        found = self.model.measure(name)
        require(found is not None, f"Ölçü bulunamadı: [{name}]")
        name = found[1].ad
        ctx = self.transition(scope)
        key = (name, ctx)
        if key not in self.measures:
            require(name not in self.stack, f"Döngüsel ölçü bağımlılığı: [{name}]")
            self.stack.append(name)
            try:
                self.measures[key] = self.freeze(
                    self.scalar(parse(found[1].ifade), ctx, {}), ctx
                )
            finally:
                self.stack.pop()
        return self.measures[key]

    def scalar(self, node, scope, env):
        if isinstance(node, (ast.Number, ast.Boolean, ast.String)):
            return Value(
                literal(node.value),
                "string"
                if isinstance(node, ast.String)
                else "bool"
                if isinstance(node, ast.Boolean)
                else "number",
            )
        if isinstance(node, ast.Name):
            val = env.get(node.name.lower())
            require(val is not None, f"Değişken bulunamadı: {node.name}")
            if isinstance(val, Rows):
                require(len(val.columns) == 1, "Skaler bağlamda tek sütun gerekli")
                col = val.columns[0]
                return Value(
                    f"(SELECT {col.alias} FROM {val.name} t WHERE t.{val.parent}=e.{val.parent})",
                    col.kind,
                )
            return val
        if isinstance(node, ast.VarBlock):
            return self.scalar(node.body, scope, self.bindings(node, scope, env))
        if isinstance(node, (ast.ColumnRef, ast.BracketRef)):
            if isinstance(node, ast.ColumnRef):
                found = self.model.measure(node.column)
                if found and found[0].ad.lower() == node.table.lower():
                    return self.measure(node.column, scope)
            key = self.key(node) if isinstance(node, ast.ColumnRef) else None
            for c in reversed(scope.row):
                matches = c.key == key if key else c.name.lower() == node.name.lower()
                if matches:
                    return Value("e." + c.alias, c.kind)
            if not key:
                return self.measure(node.name, scope)
            raise CompileError(f"{key} için satır bağlamı gerekli")
        if isinstance(node, ast.Unary):
            v = self.scalar(node.operand, scope, env)
            return Value(
                f"({node.op} ({v.sql}))", "bool" if node.op == "NOT" else v.kind
            )
        if isinstance(node, ast.Binary):
            a = self.scalar(node.left, scope, env)
            if node.op == "IN":
                rows = self.table(node.right, scope, env)
                require(len(rows.columns) == 1, "IN tek sütunlu tablo alır")
                return Value(
                    f"EXISTS (SELECT 1 FROM {rows.name} t WHERE t.{scope.key}=e.{scope.key} AND t.{rows.columns[0].alias} IS NOT DISTINCT FROM {a.sql})",
                    "bool",
                )
            b = self.scalar(node.right, scope, env)
            return binary(node.op, a, b)
        require(isinstance(node, ast.Call), "Skaler FDX ifadesi gerekli")
        n, args = node.name, node.args
        sub = lambda a: self.scalar(a, scope, env)
        if n == "DATEDIFF" and len(args) == 3:
            unit = args[2].name.lower() if isinstance(args[2], ast.Name) else ""
            require(
                unit in {"day", "month", "year", "hour", "minute", "second", "quarter"},
                "DATEDIFF zaman birimi desteklenmiyor",
            )
            return Value(f"date_diff('{unit}', {sub(args[0]).sql}, {sub(args[1]).sql})")
        if n == "CONTAINS" and len(args) >= 3 and len(args) % 2 == 1:
            rows = self.table(args[0], scope, env)
            terms = [f"t.{scope.key}=e.{scope.key}"]
            for node_key, expr in zip(args[1::2], args[2::2]):
                key = self.key(node_key)
                col = next((c for c in rows.columns if c.key == key), None)
                require(col is not None, f"CONTAINS tablosunda {key} bulunamadı")
                terms.append(f"t.{col.alias} IS NOT DISTINCT FROM {sub(expr).sql}")
            return Value(
                f"EXISTS (SELECT 1 FROM {rows.name} t WHERE {' AND '.join(terms)})",
                "bool",
            )
        if n == "CALCULATE" and args:
            return self.scalar(args[0], self.modified(args[1:], scope, env), env)
        if n in {"ISFILTERED", "ISINSCOPE"} and len(args) == 1:
            if isinstance(args[0], ast.ColumnRef):
                key = self.key(args[0])
                match = lambda k: k == key
            else:
                require(n == "ISFILTERED", "ISINSCOPE sütun alır")
                table = self.gen.compiler.resolve_table(args[0])
                match = lambda k: k.table == table
            return Value(
                literal(
                    any(
                        match(k)
                        for f in scope.filters
                        for k in f.keys
                        if n != "ISINSCOPE" or f.axis
                    )
                ),
                "bool",
            )
        if n in {
            "SUM",
            "MIN",
            "MAX",
            "AVERAGE",
            "COUNT",
            "COUNTA",
            "DISTINCTCOUNT",
            "DISTINCTCOUNTNOBLANK",
            "SELECTEDVALUE",
            "HASONEVALUE",
            "VALUES",
        }:
            require(
                len(args) == 1 or n == "SELECTEDVALUE" and len(args) == 2,
                f"{n} argüman sayısı geçersiz",
            )
            key = self.key(args[0])
            unique = n in {
                "DISTINCTCOUNT",
                "DISTINCTCOUNTNOBLANK",
                "SELECTEDVALUE",
                "HASONEVALUE",
                "VALUES",
            }
            rows = self.scan(key.table, [key], scope, unique)
            c = "e." + rows.columns[0].alias
            if unique:
                if n == "DISTINCTCOUNTNOBLANK":
                    return self.aggregated(rows.name, scope, f"count({c})")
                count = self.aggregated(rows.name, scope, "count(*)")
                if n == "DISTINCTCOUNT":
                    return count
                if n == "HASONEVALUE":
                    return Value(f"coalesce({count.sql}=1,false)", "bool")
                val = self.aggregated(rows.name, scope, f"min({c})", self.kind(key))
                other = sub(args[1]) if len(args) > 1 else Value("NULL", "blank")
                return branch([(Value(count.sql + "=1", "bool"), val)], other)
            fn = {"AVERAGE": "AVG", "COUNTA": "COUNT"}.get(n, n)
            agg = f"{fn}({c})"
            if fn == "COUNT":
                agg = f"nullif({agg},0)"
            return self.aggregated(
                rows.name,
                scope,
                agg,
                self.kind(key) if n in ("MIN", "MAX") else "number",
            )
        if n in {
            "SUMX",
            "AVERAGEX",
            "MINX",
            "MAXX",
            "COUNTX",
            "CONCATENATEX",
            "RANKX",
            "COUNTROWS",
            "ISEMPTY",
        }:
            require(args, f"{n} tablo alır")
            if (
                n in {"COUNTROWS", "ISEMPTY"}
                and isinstance(args[0], ast.Name)
                and args[0].name.lower() not in env
            ):
                rows = self.scan(self.gen.compiler.resolve_table(args[0]), [], scope)
            else:
                rows = self.table(args[0], scope, env)
            if n in {"COUNTROWS", "ISEMPTY"}:
                require(len(args) == 1, f"{n} tek tablo alır")
                count = self.aggregated(rows.name, scope, "count(*)")
                return (
                    Value(count.sql + " IS NULL", "bool") if n == "ISEMPTY" else count
                )
            require(len(args) >= 2, f"{n} ifade alır")
            frame = self.frame(rows, scope)
            v = self.scalar(args[1], frame, env)
            if n == "RANKX":
                require(len(args) <= 5, "RANKX en çok beş argüman alır")
                target = (
                    sub(args[2])
                    if len(args) > 2 and not isinstance(args[2], ast.Omitted)
                    else sub(args[1])
                )
                direction = self.order(args[3] if len(args) > 3 else None)
                tie = (
                    args[4].name.upper()
                    if len(args) > 4 and isinstance(args[4], ast.Name)
                    else "SKIP"
                )
                require(
                    tie in ("SKIP", "DENSE"), "RANKX eşitlik kuralı SKIP/DENSE olmalı"
                )
                zero = "''" if v.kind == "string" else "0"
                score = f"coalesce({v.sql},{zero})"
                cmp = ">" if direction == "DESC" else "<"
                agg = f"count({'distinct ' + score if tie == 'DENSE' else '*'}) FILTER (WHERE {score} {cmp} coalesce({target.sql},{zero}))"
                rank = self.aggregated(frame.name, scope, agg)
                return Value(f"1+coalesce({rank.sql},0)")
            if n == "CONCATENATEX":
                require(
                    len(args) in (2, 3), "CONCATENATEX için sıralama desteği gerekli"
                )
                sep = sub(args[2]).sql if len(args) > 2 else "''"
                require(
                    len(args) < 3 or isinstance(args[2], ast.String),
                    "Ayraç metin sabiti olmalı",
                )
                return self.aggregated(
                    frame.name,
                    scope,
                    f"string_agg(coalesce(cast({v.sql} as varchar),''),{sep})",
                    "string",
                )
            require(len(args) == 2, f"{n} iki argüman alır")
            fn = {
                "SUMX": "sum",
                "AVERAGEX": "avg",
                "MINX": "min",
                "MAXX": "max",
                "COUNTX": "count",
            }[n]
            agg = f"{fn}({v.sql})"
            return self.aggregated(
                frame.name, scope, f"nullif({agg},0)" if n == "COUNTX" else agg, v.kind
            )
        if n == "LOOKUPVALUE":
            require(len(args) >= 3, "LOOKUPVALUE sonuç ve arama çifti alır")
            key = self.key(args[0])
            ctx = self.removed((ast.Name(node.span, key.table, True),), scope, False)
            for search, expr in zip(args[1::2], args[2::2]):
                k = self.key(search)
                require(
                    k.table == key.table, "LOOKUPVALUE arama sütunu aynı tabloda olmalı"
                )
                ctx = replace(
                    ctx,
                    filters=ctx.filters
                    + (Selection((k,), "IS NOT DISTINCT FROM", sub(expr).sql),),
                )
            rows = self.scan(key.table, [key], ctx, True)
            c = rows.columns[0].alias
            if len(args) % 2 == 0:
                count = self.aggregated(rows.name, scope, "count(*)")
                val = self.aggregated(rows.name, scope, f"min(e.{c})", self.kind(key))
                return branch([(Value(count.sql + "=1", "bool"), val)], sub(args[-1]))
            return Value(
                f"(SELECT {c} FROM {rows.name} t WHERE t.{scope.key}=e.{scope.key})",
                self.kind(key),
            )
        if n == "IF" and len(args) in (2, 3):
            return branch(
                [(sub(args[0]), sub(args[1]))],
                sub(args[2]) if len(args) > 2 else Value("NULL", "blank"),
            )
        if n == "SWITCH" and len(args) >= 3:
            first = sub(args[0])
            pairs = []
            for k, v in zip(args[1::2], args[2::2]):
                condition = binary("=", first, sub(k))
                if isinstance(v, ast.Call) and v.name in {"SUMX", "AVERAGEX"}:
                    # Kur seçilmediyse her firma/gün için kur tablosuna gitme.
                    active = self.cte(
                        f"SELECT e.* FROM {scope.name} e WHERE {condition.sql}"
                    )
                    value = self.scalar(v, replace(scope, name=active), env)
                else:
                    value = sub(v)
                pairs.append((condition, value))
            return branch(
                pairs, sub(args[-1]) if len(args) % 2 == 0 else Value("NULL", "blank")
            )
        return simple(n, [sub(a) for a in args], self.model.tanim.model.kultur)

    def compile(self, req):
        from .sqlgen import CompiledQuery

        self.group = list(dict.fromkeys(req.group_by))
        group = self.group
        idx = {g: i for i, g in enumerate(group)}
        filters = {}
        for k, p in req.filters:
            filters.setdefault(k, []).append(p)
        ctx = ir.Context.make(group, {k: tuple(v) for k, v in filters.items()}, None)
        axis = (
            self.gen._fallback_axis(group, ctx, idx).sql(dialect="duckdb")
            if group
            else "SELECT 1 AS unit"
        )
        start = self.cte(f"SELECT *, row_number() OVER () AS s0 FROM ({axis}) ax")
        selections = tuple(
            Selection((k,), value=p, external=True) for k, p in req.filters
        )
        selections += tuple(
            Selection((g,), "IS NOT DISTINCT FROM", f"e.g{i}", axis=True)
            for i, g in enumerate(group)
        )
        scope = Scope(start, "s0", selections)
        values = [(n, self.measure(n, scope)) for n in req.measures] + [
            (n, self.scalar(parse(s), scope, {})) for n, s in req.expressions
        ]
        out = [str(g) for g in group] + [n for n, _ in values]
        cols = [f"e.g{i}" for i in range(len(group))] + [v.sql for _, v in values]
        result = self.cte(
            f"SELECT {', '.join(c + ' AS ' + ident(n) for c, n in zip(cols, out))} FROM {start} e"
        )
        sql = (
            "WITH "
            + ",\n".join(
                f"{name} AS MATERIALIZED ({body})" for body, name in self.ctes.items()
            )
            + f" SELECT * FROM {result}"
        )
        if values:
            sql += " WHERE " + " OR ".join(ident(n) + " IS NOT NULL" for n, _ in values)
        order = req.order_by or [(str(g), False) for g in group]
        require(all(n in out for n, d in order), "Sıralama sütunu sonuçta yok")
        if order:
            sql += " ORDER BY " + ", ".join(
                ident(n) + (" DESC" if desc else " ASC") for n, desc in order
            )
        if req.limit is not None:
            sql += f" LIMIT {int(req.limit)}"
        return CompiledQuery(sql, "duckdb", out, set())


def branch(pairs, other):
    kinds = {v.kind for _, v in pairs} | {other.kind}
    kinds.discard("blank")
    mixed = len(kinds) > 1 and not kinds.issubset({"date", "datetime"})

    def cast(v):
        return f"CAST({v.sql} AS VARIANT)" if mixed else v.sql

    sql = (
        "CASE "
        + " ".join(f"WHEN {cond.sql} THEN {cast(v)}" for cond, v in pairs)
        + f" ELSE {cast(other)} END"
    )
    return Value("(" + sql + ")", "variant" if mixed else next(iter(kinds), "blank"))


def binary(op, a, b):
    x, y = a.sql, b.sql
    if op == "&":
        return Value(f"concat({x},{y})", "string")
    if op in ("&&", "||", "AND", "OR"):
        return Value(f"(({x}) {'AND' if op in ('&&', 'AND') else 'OR'} ({y}))", "bool")
    if op in ("=", "<>", "<", ">", "<=", ">="):
        kind = b.kind if a.kind == "blank" else a.kind
        blank = {"string": "''", "bool": "false", "number": "0"}.get(kind)
        if blank and (a.kind == b.kind or "blank" in (a.kind, b.kind)):
            x, y = f"coalesce({x},{blank})", f"coalesce({y},{blank})"
        return Value(f"(({x}) {op} ({y}))", "bool")
    if op == "-" and a.kind in ("date", "datetime") and b.kind in ("date", "datetime"):
        return Value(f"(epoch(cast({x} as timestamp)-cast({y} as timestamp))/86400)")
    if op in ("+", "-"):
        return Value(
            f"(CASE WHEN {x} IS NULL AND {y} IS NULL THEN NULL ELSE coalesce({x},0) {op} coalesce({y},0) END)"
        )
    require(op in ("*", "/", "^"), f"Desteklenmeyen işlem: {op}")
    return Value(f"(({x}) {op} ({y}))")


def simple(name, vals, culture):
    args = [v.sql for v in vals]
    if name == "COALESCE" and len(args) >= 2:
        return Value(
            f"coalesce({', '.join(args)})",
            next((v.kind for v in vals if v.kind != "blank"), "blank"),
        )
    if name == "BLANK" and not args:
        return Value("NULL", "blank")
    if name == "ISBLANK" and len(args) == 1:
        return Value(f"({args[0]} IS NULL)", "bool")
    if name == "DIVIDE" and len(args) in (2, 3):
        a, b = args[:2]
        return Value(
            f"(CASE WHEN coalesce({b},0)=0 THEN {args[2] if len(args) > 2 else 'NULL'} ELSE {a}/{b} END)"
        )
    if name in {"AND", "OR"} and len(args) == 2:
        return binary(name, *vals)
    if name == "NOT" and len(args) == 1:
        return Value(f"NOT ({args[0]})", "bool")
    if name == "CONTAINSSTRING" and len(args) == 2:
        return Value(f"contains(lower({args[0]}),lower({args[1]}))", "bool")
    if name == "SEARCH" and len(args) == 2:
        return Value(
            f"coalesce(nullif(strpos(lower({args[1]}),lower({args[0]})),0),error('SEARCH: metin bulunamadı'))"
        )
    if name == "VALUE" and len(args) == 1:
        return Value(f"cast({args[0]} as double)")
    if name == "FORMAT" and len(args) in (2, 3):
        from .value_format import format_sql

        return Value(format_sql(vals, culture), "string")
    mapping = {
        "ABS": ("abs", 1, "number"),
        "INT": ("floor", 1, "number"),
        "LEFT": ("left", 2, "string"),
        "RIGHT": ("right", 2, "string"),
        "TRIM": ("trim", 1, "string"),
        "LEN": ("length", 1, "number"),
        "YEAR": ("year", 1, "number"),
        "MONTH": ("month", 1, "number"),
        "DAY": ("day", 1, "number"),
        "ROUND": ("round", 2, "number"),
        "UPPER": ("upper", 1, "string"),
        "LOWER": ("lower", 1, "string"),
    }
    if name in mapping:
        fn, arity, kind = mapping[name]
        require(len(args) == arity, f"{name} {arity} argüman alır")
        return Value(f"{fn}({', '.join(args)})", kind)
    raise CompileError(f"Desteklenmeyen sanal tablo/skaler fonksiyon: {name}")
