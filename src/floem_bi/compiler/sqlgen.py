"""Görsel sorgusu → SQL.

Akış: istek → ölçülerin IR'a derlenmesi → slotların (taban tablo, etkin bağlam)
çiftlerine göre CTE'lere gruplanması → eksen (görünen satırlar) → CTE'lerin
eksene LEFT JOIN ile bağlanması → sqlglot AST → lehçe (duckdb | tsql).

Fan-out koruması: her toplama yalnızca kendi taban tablosu ve oradan çok→bir
yönünde ulaşılan tablolarla birleştirilir; farklı taban tabloları ayrı CTE'lerde
toplanır ve ortak gruplama sütunları üzerinden birleştirilir (MetricFlow/Cube deseni).
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

from sqlglot import exp
from sqlglot.errors import ErrorLevel

from ..model import ColKey, SemanticModel
from . import ir
from .measures import CompileError, MeasureCompiler, UserInfo

DIALECTS = {"duckdb": "duckdb", "tsql": "tsql"}


@dataclass
class QueryRequest:
    group_by: list[ColKey]
    measures: list[str]
    filters: list[tuple[ColKey, ir.Expr]] = field(default_factory=list)
    order_by: list[tuple[str, bool]] = field(default_factory=list)  # (çıktı adı, azalan mı)
    limit: int | None = None
    # Modelde kayıtlı olmayan ölçüler: (çıktı adı, DAX ifadesi). Rapordaki örtük ölçüler
    # ("Quantity toplamı" = SUM('OINM'[Quantity])) bu yolla derlenir.
    expressions: list[tuple[str, str]] = field(default_factory=list)


@dataclass
class CompiledQuery:
    sql: str
    dialect: str
    columns: list[str]
    time_keys: set[str]
    parameters: list = field(default_factory=list)


def _ident(name: str) -> exp.Identifier:
    return exp.to_identifier(name)


def _col(name: str, table: str | None = None) -> exp.Column:
    return exp.Column(this=_ident(name), table=_ident(table) if table else None)


def _lit(value) -> exp.Expression:
    if value is None:
        return exp.Null()
    if isinstance(value, bool):
        return exp.true() if value else exp.false()
    if isinstance(value, (int, float)):
        return exp.Literal.number(value)
    return exp.Literal.string(str(value))


def _and_all(conds: list[exp.Expression]) -> exp.Expression | None:
    out = None
    for c in conds:
        out = c if out is None else exp.and_(out, c)
    return out


def _null_safe_eq(a: exp.Expression, b: exp.Expression) -> exp.Expression:
    return exp.or_(
        exp.EQ(this=a, expression=b),
        exp.and_(exp.Is(this=a.copy(), expression=exp.Null()), exp.Is(this=b.copy(), expression=exp.Null())),
    )


@dataclass(frozen=True)
class _CteKey:
    base: str
    grain: tuple[ColKey, ...]
    filters: tuple[tuple[ColKey, tuple[ir.Expr, ...]], ...]
    time: str | None
    rels: frozenset = frozenset()
    row_grain: tuple[ColKey, ...] = ()


class SqlGenerator:
    def __init__(
        self,
        model: SemanticModel,
        dialect: str = "duckdb",
        schema_map: dict[str, str] | None = None,
        map_table: tuple[str, str] = ("floem", "tarih_map"),
        user: UserInfo | None = None,
        roles: list[str] | None = None,
    ):
        if dialect not in DIALECTS:
            raise CompileError(f"Desteklenmeyen lehçe: {dialect}")
        self.model = model
        self.dialect = dialect
        self.schema_map = schema_map or {}
        self.map_table = map_table
        self.user = user or UserInfo()
        self.compiler = MeasureCompiler(model, self.user)
        self.rls = self._rls_predicates(roles or [])
        self._calc_cache: dict[ColKey, ir.Expr] = {}
        self._extrema: set[ColKey] = set()

    # ------------------------------------------------------------------ RLS
    def _rls_predicates(self, roles: list[str]) -> list[tuple[str, ir.Expr]]:
        """Kullanıcının rollerindeki tablo filtreleri. Birden fazla rol varsa
        aynı tablodaki filtreler OR ile birleşir (Power BI davranışı)."""
        per_table: dict[str, list[ir.Expr]] = {}
        wanted = {r.lower() for r in roles}
        for rol in self.model.tanim.roller:
            if rol.ad.lower() not in wanted:
                continue
            for izin in rol.tablo_izinleri:
                table = self.model.table(izin.tablo).ad
                per_table.setdefault(table, []).append(self.compiler.row_predicate(izin.filtre, table))
        out = []
        for table, preds in per_table.items():
            combined = preds[0]
            for p in preds[1:]:
                combined = ir.Bin("OR", combined, p)
            out.append((table, combined))
        return out

    # ----------------------------------------------------------- tablo görünümü
    def row_expression(self, table: str, column: str, alias: str = "t") -> str:
        """Sütunun tek tablo üzerindeki satır SQL'i (tablo görünümü için).

        Hesaplanmış sütun yalnızca kendi tablosunun sütunlarına başvuruyorsa çevrilir;
        başka tabloya (RELATED vb.) ya da toplamaya başvuruyorsa CompileError."""
        key, sutun = self.model.column(table, column)
        if not sutun.ifade:
            return _col(self._physical(key), alias).sql(dialect=self.dialect)
        calc = self._calc(key)
        if any(k.table != key.table for k in self._cols_in(calc)):
            raise CompileError("başka bir tablonun sütununa başvuruyor")

        def bad(_):
            raise CompileError("toplama içeriyor")

        return self.render(calc, lambda k: _col(self._physical(k), alias), bad).sql(dialect=self.dialect)

    # ----------------------------------------------------------- yardımcılar
    def _source(self, table: str, alias: str) -> exp.Expression:
        t = self.model.table(table)
        schema = self.schema_map.get(t.kaynak.katman, t.kaynak.katman)
        return exp.Table(this=_ident(t.kaynak.tablo), db=_ident(schema), alias=exp.TableAlias(this=_ident(alias)))

    def _physical(self, key: ColKey) -> str:
        s = self.model.sutun(key)
        return s.kaynak or s.ad

    def _calc(self, key: ColKey) -> ir.Expr | None:
        s = self.model.sutun(key)
        if not s.ifade:
            return None
        if key not in self._calc_cache:
            self._calc_cache[key] = self.compiler.calc_column(key)
        return self._calc_cache[key]

    def _cols_in(self, e: ir.Expr | None, out: set[ColKey] | None = None) -> set[ColKey]:
        """İfadenin kullandığı fiziksel sütunlar (hesaplanmış sütunlar açılır)."""
        out = set() if out is None else out
        if e is None:
            return out
        if isinstance(e, ir.Col):
            calc = self._calc(e.key)
            if calc is None:
                out.add(e.key)
            else:
                self._cols_in(calc, out)
            return out
        if isinstance(e, (ir.Slot, ir.Nested, ir.FrozenScalar)):
            return out
        for v in vars(e).values():
            if isinstance(v, ir.Expr):
                self._cols_in(v, out)
            elif isinstance(v, tuple):
                for x in v:
                    if isinstance(x, ir.Expr):
                        self._cols_in(x, out)
                    elif isinstance(x, tuple):
                        for y in x:
                            if isinstance(y, ir.Expr):
                                self._cols_in(y, out)
        return out

    # -------------------------------------------------------- ifade üretimi
    def render(self, e: ir.Expr, col_fn, slot_fn=None) -> exp.Expression:
        r = lambda x: self.render(x, col_fn, slot_fn)  # noqa: E731
        if isinstance(e, ir.Lit):
            return _lit(e.value)
        if isinstance(e, ir.ColumnExtremum):
            if e.key in self._extrema:
                raise CompileError("Hesaplanmış sütun ve rol filtresi döngü oluşturuyor")
            self._extrema.add(e.key)
            try:
                axis = self._fallback_axis([e.key], ir.Context(), {e.key: 0})
                fn = exp.Min if e.function == "MIN" else exp.Max
                return exp.select(fn(this=_col("g0"))).from_(axis.subquery("fdx_domain")).subquery()
            finally:
                self._extrema.remove(e.key)
        if isinstance(e, ir.Col):
            calc = self._calc(e.key)
            return exp.Paren(this=r(calc)) if calc is not None else col_fn(e.key)
        if isinstance(e, (ir.Slot, ir.Nested, ir.FrozenScalar)):
            if slot_fn is None:
                raise CompileError("Satır ifadesinde toplama kullanılamaz")
            return slot_fn(e)
        if isinstance(e, ir.Neg):
            return exp.Neg(this=exp.Paren(this=r(e.operand)))
        if isinstance(e, ir.Not):
            return exp.Not(this=exp.Paren(this=r(e.operand)))
        if isinstance(e, ir.IsBlank):
            return exp.Is(this=r(e.operand), expression=exp.Null())
        if isinstance(e, ir.InList):
            return exp.In(this=r(e.operand), expressions=[r(v) for v in e.values])
        if isinstance(e, ir.Divide):
            num, den = r(e.num), r(e.den)
            cond = exp.or_(exp.Is(this=den.copy(), expression=exp.Null()), exp.EQ(this=den.copy(), expression=_lit(0)))
            quotient = exp.Div(this=exp.Cast(this=num, to=exp.DataType.build("double")), expression=den)
            return exp.Case(ifs=[exp.If(this=cond, true=r(e.alt) if e.alt is not None else exp.Null())], default=quotient)
        if isinstance(e, ir.Case):
            ifs = [exp.If(this=r(c), true=r(v)) for c, v in e.whens]
            return exp.Case(ifs=ifs, default=r(e.default) if e.default is not None else None)
        if isinstance(e, ir.Func):
            args = [r(a) for a in e.args]
            if e.name == "ABS":
                return exp.Abs(this=args[0])
            if e.name == "ROUND":
                return exp.Round(this=args[0], decimals=args[1] if len(args) > 1 else _lit(0))
            if e.name == "YEAR":
                return exp.Year(this=args[0])
            if e.name == "MONTH":
                return exp.Month(this=args[0])
            if e.name == "DAY":
                return exp.Day(this=args[0])
            if e.name == "UPPER":
                return exp.Upper(this=args[0])
            if e.name == "LOWER":
                return exp.Lower(this=args[0])
            if e.name == "DATE":
                return exp.DateFromParts(year=args[0], month=args[1], day=args[2])
            if e.name == "TODAY":
                return exp.CurrentDate()
            if e.name == "LEN":
                return exp.Length(this=args[0])
            if e.name == "LEFT":
                return exp.Left(this=args[0], expression=args[1])
            if e.name == "RIGHT":
                return exp.Right(this=args[0], expression=args[1])
            if e.name == "MID":
                return exp.Substring(this=args[0], start=args[1], length=args[2])
            if e.name == "TRIM":
                return exp.Trim(this=args[0])
            if e.name == "INT":
                return exp.Floor(this=args[0])
            if e.name == "MOD":
                return exp.Mod(this=args[0], expression=args[1])
            if e.name == "CONCATENATE":
                return exp.Concat(expressions=[args[0], args[1]])
            raise CompileError(f"SQL karşılığı olmayan fonksiyon: {e.name}")
        if isinstance(e, ir.Bin):
            a, b = r(e.left), r(e.right)
            if e.op in ("+", "-"):
                # DAX: BLANK + 5 = 5, BLANK + BLANK = BLANK
                cls = exp.Add if e.op == "+" else exp.Sub
                both_null = exp.and_(
                    exp.Is(this=a.copy(), expression=exp.Null()), exp.Is(this=b.copy(), expression=exp.Null())
                )
                calc = cls(this=exp.Coalesce(this=a, expressions=[_lit(0)]), expression=exp.Coalesce(this=b, expressions=[_lit(0)]))
                return exp.Case(ifs=[exp.If(this=both_null, true=exp.Null())], default=calc)
            if e.op == "*":
                return exp.Paren(this=exp.Mul(this=a, expression=b))
            if e.op == "/":
                # DAX'ta x/0 = ∞; SQL Server'da hata verdiği için BLANK döndürülür (bilinen sapma)
                return exp.Div(
                    this=exp.Cast(this=a, to=exp.DataType.build("double")),
                    expression=exp.Nullif(this=b, expression=_lit(0)),
                )
            if e.op == "^":
                return exp.Pow(this=a, expression=b)
            if e.op == "&":
                return exp.Concat(expressions=[a, b])
            if e.op in ("AND", "OR"):
                return exp.Paren(this=(exp.and_ if e.op == "AND" else exp.or_)(a, b))
            cmp = {"=": exp.EQ, "<>": exp.NEQ, "<": exp.LT, ">": exp.GT, "<=": exp.LTE, ">=": exp.GTE}
            if e.op in cmp:
                return cmp[e.op](this=a, expression=b)
        raise CompileError(f"SQL'e çevrilemeyen ifade: {e!r}")

    def _aggregate(self, slot: ir.Slot, col_fn) -> exp.Expression:
        if slot.agg == "COUNTROWS":
            return exp.Nullif(this=exp.Count(this=exp.Star()), expression=_lit(0))
        arg = self.render(slot.arg, col_fn)
        if slot.agg == "SUM":
            return exp.Sum(this=arg)
        if slot.agg == "AVG":
            return exp.Avg(this=arg)
        if slot.agg == "MIN":
            return exp.Min(this=arg)
        if slot.agg == "MAX":
            return exp.Max(this=arg)
        if slot.agg == "COUNT":
            return exp.Nullif(this=exp.Count(this=arg), expression=_lit(0))
        if slot.agg == "DISTINCTCOUNT":
            distinct = exp.Count(this=exp.Distinct(expressions=[arg.copy()]))
            # DAX, BLANK'ı ayrı bir üye olarak sayar. Boş tablo yine BLANK verir.
            has_blank = exp.Case(ifs=[exp.If(this=exp.GT(this=exp.Count(this=exp.Star()),
                expression=exp.Count(this=arg)), true=_lit(1))], default=_lit(0))
            return exp.Nullif(this=exp.Add(this=distinct, expression=has_blank), expression=_lit(0))
        raise CompileError(f"Bilinmeyen toplama: {slot.agg}")

    # ------------------------------------------------------------ planlama
    def _frozen_values(self, expr: ir.Expr) -> list[ir.FrozenScalar]:
        if isinstance(expr, ir.FrozenScalar):
            return [expr]
        result = []
        for value in vars(expr).values():
            if isinstance(value, ir.Expr):
                result.extend(self._frozen_values(value))
            elif isinstance(value, tuple):
                for item in value:
                    if isinstance(item, ir.Expr):
                        result.extend(self._frozen_values(item))
                    elif isinstance(item, tuple):
                        for child in item:
                            if isinstance(child, ir.Expr):
                                result.extend(self._frozen_values(child))
        return list(dict.fromkeys(result))

    def _frozen_context(self, value: ir.FrozenScalar) -> tuple[list[ColKey], ir.Context]:
        slots, nested = [], []
        self._collect(value.value, slots, nested)
        if nested or not slots or any(s.ctx.time for s in slots):
            raise CompileError("Filtredeki VAR için iç içe iteratör/zaman dönüşümü henüz desteklenmiyor")
        group = sorted({g for s in slots for g in s.ctx.group if self.model.reachable(s.base, g.table, s.ctx.rels)})
        return group, slots[0].ctx

    def _effective(self, slot: ir.Slot, group: list[ColKey]) -> _CteKey:
        rels = slot.ctx.rels
        reach = lambda t: self.model.reachable(slot.base, t, rels)  # noqa: E731
        native = tuple(g for g in group if g in slot.ctx.group and reach(g.table))
        filters = tuple((c, p) for c, p in slot.ctx.filters if reach(c.table))
        frozen_group = {g for _, preds in filters for p in preds for value in self._frozen_values(p)
                        for g in self._frozen_context(value)[0]}
        grain = tuple(g for g in group if g in native or g in frozen_group)
        date_table = self.model.date_table()
        time = slot.ctx.time if (slot.ctx.time and date_table and reach(date_table.ad)) else None
        return _CteKey(slot.base, grain, filters, time, rels, native)

    def compile(self, req: QueryRequest) -> CompiledQuery:
        from ..dax import ast, parse
        from ..dax.lexer import DaxSyntaxError, Span
        from .table_query import TablePlan, advanced

        if self.dialect == "duckdb":
            nodes = [ast.BracketRef(Span(0, 0), name) for name in req.measures]
            try:
                nodes.extend(parse(text) for _, text in req.expressions)
                use_tables = [advanced(node, self.model, set()) for node in nodes]
                if any(use_tables):
                    try:
                        return TablePlan(self).compile(req)
                    except CompileError as table_error:
                        # Geleneksel planın zaman zekâsı gibi önceden desteklediği
                        # birleşimler sanal tablo seçimi yüzünden kaybolmasın.
                        try:
                            return self._compile_slots(req)
                        except CompileError:
                            if not all(use_tables):
                                return self._mixed_query(req, use_tables)
                            raise table_error
            except DaxSyntaxError as error:
                raise CompileError(error.message,error.span,error.source) from error
        return self._compile_slots(req)

    def _mixed_query(self, req, use_tables):
        """Zaman zekâsı ve sanal tablo ölçülerini aynı görselde ortak eksende getir."""
        from .table_query import TablePlan, ident

        plans = []
        for use_table in (False, True):
            subset = replace(req, order_by=[], limit=None,
                             measures=[n for n, flag in zip(req.measures, use_tables) if flag == use_table],
                             expressions=[v for v, flag in zip(req.expressions, use_tables[len(req.measures):]) if flag == use_table])
            plans.append(TablePlan(self).compile(subset) if use_table else self._compile_slots(subset))
        groups = [str(g) for g in dict.fromkeys(req.group_by)]
        measures = [self.model.measure(n)[1].ad for n in req.measures] + [n for n, _ in req.expressions]
        # Her dal bir hücre/ölçü için en çok bir değer döndürür. NULL anahtarlar da
        # aynı gruba girer. İki daldan birinde bulunmayan hücre kaybolmaz.
        union = " UNION ALL BY NAME ".join(f"({p.sql})" for p in plans)
        fields = [ident(g) for g in groups] + [f"max({ident(n)}) AS {ident(n)}" for n in measures]
        sql = f"SELECT {', '.join(fields)} FROM ({union}) AS branches"
        if groups:
            sql += " GROUP BY " + ", ".join(map(ident, groups))
        sql += " HAVING count(*) > 0"
        order = req.order_by or [(g, False) for g in groups]
        if any(n not in groups + measures for n, _ in order):
            raise CompileError("Sıralama sütunu sonuçta yok")
        if order:
            sql += " ORDER BY " + ", ".join(ident(n) + (" DESC" if desc else " ASC") for n, desc in order)
        if req.limit is not None:
            sql += f" LIMIT {int(req.limit)}"
        return CompiledQuery(sql, self.dialect, groups + measures, plans[0].time_keys | plans[1].time_keys)

    def _compile_slots(self, req: QueryRequest) -> CompiledQuery:
        group = list(dict.fromkeys(req.group_by))
        gidx = {g: i for i, g in enumerate(group)}
        filter_map: dict[ColKey, tuple[ir.Expr, ...]] = {}
        for col, pred in req.filters:
            filter_map[col] = filter_map.get(col, ()) + (pred,)
        base_ctx = ir.Context.make(group, filter_map, None)

        measure_exprs: list[tuple[str, ir.Expr]] = []
        for name in req.measures:
            found = self.model.measure(name)
            if found is None:
                raise CompileError(f"Ölçü bulunamadı: [{name}]")
            measure_exprs.append((found[1].ad, self.compiler.measure(name, base_ctx)))
        for alias, text in req.expressions:
            measure_exprs.append((alias, self.compiler.expression(text, base_ctx)))

        time_keys: set[str] = set()
        with_parts = self._plan(group, measure_exprs, base_ctx, "", time_keys)

        out_names = [str(g) for g in group] + [name for name, _ in measure_exprs]
        final = exp.select(
            *[exp.alias_(_col(f"g{gidx[g]}"), str(g)) for g in group],
            *[exp.alias_(_col(f"m{i}"), name) for i, (name, _) in enumerate(measure_exprs)],
        ).from_("sonuc")
        if measure_exprs:
            all_blank = _and_all([exp.Is(this=_col(f"m{i}"), expression=exp.Null()) for i in range(len(measure_exprs))])
            final = final.where(exp.Not(this=exp.Paren(this=all_blank)))
        order_cols = []
        if req.order_by:
            for name, desc in req.order_by:
                if name not in out_names:
                    raise CompileError(f"Sıralama sütunu sonuçta yok: {name}")
                idx = out_names.index(name)
                ref = _col(f"g{idx}") if idx < len(group) else _col(f"m{idx - len(group)}")
                order_cols.append(exp.Ordered(this=ref, desc=desc))
        else:
            order_cols = [exp.Ordered(this=_col(f"g{gidx[g]}")) for g in group]
        if order_cols:
            final = final.order_by(*order_cols)
        if req.limit is not None:
            final = final.limit(req.limit)
        for name, body in with_parts:
            final = final.with_(name, as_=body)

        sql = final.sql(dialect=DIALECTS[self.dialect], pretty=True, unsupported_level=ErrorLevel.RAISE)
        return CompiledQuery(sql=sql, dialect=self.dialect, columns=out_names, time_keys=time_keys)

    def _plan(
        self, group: list[ColKey], measure_exprs: list[tuple[str, ir.Expr]], base_ctx: ir.Context,
        prefix: str, time_keys: set[str],
    ) -> list[tuple[str, exp.Expression]]:
        """Ölçüleri `group` ayrıntısında hesaplayan CTE'leri üretir; son CTE `{prefix}sonuc`
        (g0..gN gruplama, m0..mK ölçü sütunları).

        Bağlam geçişi (ir.Nested) için kendini iç ayrıntıda (`group` + satır anahtarı) yeniden
        çağırır; iç planın CTE'leri önekle en üst düzeye taşınır (T-SQL iç içe WITH desteklemez).
        """
        gidx = {g: i for i, g in enumerate(group)}
        slots: list[ir.Slot] = []
        nesteds: list[ir.Nested] = []
        for _, e in measure_exprs:
            self._collect(e, slots, nesteds)

        with_parts: list[tuple[str, exp.Expression]] = []
        slot_ref: dict[ir.Expr, tuple[str, str]] = {}
        joins: list[tuple[str, tuple[ColKey, ...]]] = []

        # 1) bağlam geçişi: iç düzeyde hesapla, dış ayrıntıda topla
        for i, n in enumerate(nesteds):
            outer = tuple(g for g in group if g in n.ctx.group)
            sub_group = list(outer) + [k for k in n.keys if k not in outer]
            sub_ctx = ir.Context.make(sub_group, n.ctx.filter_map(), n.ctx.time, n.ctx.rels)
            sub_prefix = f"{prefix}n{i}_"
            with_parts.extend(self._plan(sub_group, [("v", n.inner)], sub_ctx, sub_prefix, time_keys))
            sub_gidx = {g: j for j, g in enumerate(sub_group)}
            value = _col("m0", "x")
            agg = {
                "SUM": exp.Sum, "AVG": exp.Avg, "MIN": exp.Min, "MAX": exp.Max,
            }.get(n.agg)
            agg_expr = agg(this=value) if agg else exp.Nullif(this=exp.Count(this=value), expression=_lit(0))
            sel = exp.select(
                *[exp.alias_(_col(f"g{sub_gidx[g]}", "x"), f"g{gidx[g]}") for g in outer],
                exp.alias_(agg_expr, "v"),
            ).from_(exp.Table(this=_ident(f"{sub_prefix}sonuc"), alias=exp.TableAlias(this=_ident("x"))))
            if outer:
                sel = sel.group_by(*[_col(f"g{sub_gidx[g]}", "x") for g in outer])
            name = f"{prefix}n{i}"
            with_parts.append((name, sel))
            slot_ref[n] = (name, "v")
            joins.append((name, outer))

        # 2) toplamalar: aynı (taban, ayrıntı, filtreler) tek CTE'de
        ctes: dict[_CteKey, list[ir.Slot]] = {}
        for s in slots:
            ctes.setdefault(self._effective(s, group), []).append(s)
        k = 0
        for i, (key, members) in enumerate(ctes.items()):
            name = f"{prefix}q{i}"
            for s in members:
                slot_ref[s] = (name, f"s{k}")
                k += 1
            if key.time:
                time_keys.add(key.time)
            body = self._cte_select(key, members, gidx, slot_ref, name, with_parts, time_keys)
            with_parts.append((name, body))
            joins.append((name, key.grain))

        # 3) eksen: görünen satırlar
        if group:
            full = [name for name, grain in joins if grain == tuple(group)]
            if full:
                axis = None
                for name in full:
                    part = exp.select(*[_col(f"g{gidx[g]}") for g in group]).from_(name)
                    axis = part if axis is None else exp.union(axis, part, distinct=True)
            else:
                axis = self._fallback_axis(group, base_ctx, gidx)
        else:
            axis = exp.select(exp.alias_(_lit(1), "bir"))
        with_parts.append((f"{prefix}eksen", axis))

        # 4) sonuç: eksen + CTE'ler
        ref = lambda s: _col(slot_ref[s][1], slot_ref[s][0])  # noqa: E731
        sonuc = exp.select(
            *[exp.alias_(_col(f"g{gidx[g]}", "e"), f"g{gidx[g]}") for g in group],
            *[exp.alias_(self.render(e, lambda c: None, ref), f"m{i}") for i, (_, e) in enumerate(measure_exprs)],
        ).from_(exp.Table(this=_ident(f"{prefix}eksen"), alias=exp.TableAlias(this=_ident("e"))))
        for name, grain in joins:
            if grain:
                on = _and_all([_null_safe_eq(_col(f"g{gidx[g]}", "e"), _col(f"g{gidx[g]}", name)) for g in grain])
            else:
                on = exp.EQ(this=_lit(1), expression=_lit(1))
            sonuc = sonuc.join(exp.Table(this=_ident(name)), on=on, join_type="left")
        with_parts.append((f"{prefix}sonuc", sonuc))
        return with_parts

    def _collect(self, e: ir.Expr, slots: list[ir.Slot], nesteds: list[ir.Nested]) -> None:
        """Bu düzeyin toplamaları; iç içe toplamanın içi kendi planında toplanır."""
        if isinstance(e, ir.Slot):
            if e not in slots:
                slots.append(e)
            return
        if isinstance(e, ir.Nested):
            if e not in nesteds:
                nesteds.append(e)
            return
        for v in vars(e).values():
            if isinstance(v, ir.Expr):
                self._collect(v, slots, nesteds)
            elif isinstance(v, tuple):
                for x in v:
                    if isinstance(x, ir.Expr):
                        self._collect(x, slots, nesteds)
                    elif isinstance(x, tuple):
                        for y in x:
                            if isinstance(y, ir.Expr):
                                self._collect(y, slots, nesteds)

    # ------------------------------------------------------------ CTE gövdesi
    def _cte_select(self, key: _CteKey, members: list[ir.Slot], gidx, slot_ref,
                    cte_name: str, with_parts: list, time_keys: set[str]) -> exp.Select:
        model = self.model
        base = key.base
        date_table = model.date_table()
        dt_name = date_table.ad if (key.time and date_table) else None

        filter_map = dict(key.filters)
        frozen = list(dict.fromkeys(v for preds in filter_map.values() for p in preds for v in self._frozen_values(p)))
        if frozen and key.time:
            raise CompileError("Filtredeki VAR ve zaman dönüşümünün birlikte kullanımı henüz desteklenmiyor")
        rls = [(t, p) for t, p in self.rls if model.reachable(base, t, key.rels)]

        # gereken tablolar
        needed: set[str] = {g.table for g in key.row_grain} | {c.table for c in filter_map} | {t for t, _ in rls}
        # FILTER(T, RELATED(...)) gibi koşulların kullandığı diğer tablolar da birleştirilir
        for preds in filter_map.values():
            for pr in preds:
                needed |= {c.table for c in self._cols_in(pr)}
        for s in members:
            needed |= {c.table for c in self._cols_in(s.arg)}
        if dt_name:
            needed.add(dt_name)
        needed.discard(base)

        aliases: dict[str, str] = {base: "b"}
        sel = exp.Select().from_(self._source(base, "b"))
        ds_cols: dict[ColKey, str] = {}

        def col_fn(k: ColKey) -> exp.Expression:
            if dt_name and k.table == dt_name:
                if k not in ds_cols:
                    raise CompileError(f"{k} zaman zekâsı bağlamında bu konumda kullanılamaz (MVP)")
                return _col(ds_cols[k], "ds")
            return _col(self._physical(k), aliases[k.table])

        joined = {base}
        for t in sorted(needed, key=lambda x: len(model.path(base, x, key.rels) or [])):
            path = model.path(base, t, key.rels)
            if path is None:
                raise CompileError(f"'{base}' tablosundan '{t}' tablosuna ilişki yolu yok")
            for edge in path:
                to = edge.to_col.table
                if to in joined:
                    continue
                frm_alias = aliases[edge.from_col.table]
                if dt_name and to == dt_name:
                    if edge.from_col.table != base:
                        raise CompileError("Zaman zekâsı için tarih tablosu taban tabloya doğrudan bağlı olmalı (MVP)")
                    ds, ds_cols = self._date_subquery(key, filter_map, rls, gidx)
                    sel = sel.join(
                        exp.Subquery(this=ds, alias=exp.TableAlias(this=_ident("ds"))),
                        on=exp.EQ(this=_col(self._physical(edge.from_col), frm_alias), expression=_col("kaynak_tarih", "ds")),
                        join_type="inner",
                    )
                else:
                    alias = f"j{len(aliases)}"
                    aliases[to] = alias
                    sel = sel.join(
                        self._source(to, alias),
                        on=exp.EQ(
                            this=_col(self._physical(edge.from_col), frm_alias),
                            expression=_col(self._physical(edge.to_col), alias),
                        ),
                        join_type="inner" if edge.inner else "left",
                    )
                joined.add(to)

        # VAR önceki bağlamda hesaplanır. Tarih filtresi kalkınca MIN/MAX sınırı
        # kaybolmaz; ay satırları için ayrı sınır üretir. Olgular bu sınırla
        # karşılaştırılır, önceki dönemin hareketi yeni aya yanlışlıkla bağlanmaz.
        bound_cols: dict[ColKey, exp.Expression] = {}
        bound_values: dict[ir.FrozenScalar, exp.Expression] = {}
        for index, value in enumerate(frozen):
            groups, original_ctx = self._frozen_context(value)
            sub_prefix = f"{cte_name}_fv{index}_"
            with_parts.extend(self._plan(groups, [("value", value.value)], original_ctx, sub_prefix, time_keys))
            sub = exp.select("*").from_(f"{sub_prefix}sonuc")
            alias = f"fv{index}"
            group_index = {g: i for i, g in enumerate(groups)}
            conditions = []
            for g in groups:
                if g in bound_cols:
                    conditions.append(_null_safe_eq(bound_cols[g].copy(), _col(f"g{group_index[g]}", alias)))
                elif g in key.row_grain:
                    conditions.append(_null_safe_eq(col_fn(g), _col(f"g{group_index[g]}", alias)))
            sel = sel.join(exp.Subquery(this=sub, alias=exp.TableAlias(this=_ident(alias))),
                           on=_and_all(conditions) or exp.true(), join_type="inner")
            for g in groups:
                if g not in key.row_grain:
                    bound_cols[g] = _col(f"g{group_index[g]}", alias)
            bound_values[value] = _col("m0", alias)

        group_col = lambda g: bound_cols[g].copy() if g in bound_cols else col_fn(g)  # noqa: E731

        # SELECT
        projections = []
        for g in key.grain:
            projections.append(exp.alias_(group_col(g), f"g{gidx[g]}"))
        for s in members:
            projections.append(exp.alias_(self._aggregate(s, col_fn), slot_ref[s][1]))
        sel = sel.select(*projections)

        # WHERE (tarih tablosu koşulları ds alt sorgusunda)
        conds = []
        for c, preds in filter_map.items():
            if dt_name and c.table == dt_name:
                continue
            conds.extend(self.render(p, col_fn, lambda v: bound_values[v].copy()) for p in preds)
        for t, p in rls:
            if dt_name and t == dt_name:
                continue
            conds.append(self.render(p, col_fn))
        where = _and_all(conds)
        if where is not None:
            sel = sel.where(where)
        if key.grain:
            sel = sel.group_by(*[group_col(g) for g in key.grain])
        return sel

    def _date_subquery(self, key: _CteKey, filter_map, rls, gidx) -> tuple[exp.Select, dict[ColKey, str]]:
        dt = self.model.date_table()
        dkey = self.model.column(dt.ad, dt.tarih_tablosu.anahtar_sutun)[0]
        col_fn = lambda k: _col(self._physical(k), "d")  # noqa: E731
        ds_cols: dict[ColKey, str] = {}
        projections = []
        for g in key.grain:
            if g.table == dt.ad:
                name = f"g{gidx[g]}"
                ds_cols[g] = name
                projections.append(exp.alias_(self.render(ir.Col(g), col_fn), name))
        projections.append(exp.alias_(_col("KaynakTarih", "m"), "kaynak_tarih"))
        map_schema, map_name = self.map_table
        sel = (
            exp.select(*projections)
            .distinct()
            .from_(self._source(dt.ad, "d"))
            .join(
                exp.Table(this=_ident(map_name), db=_ident(map_schema), alias=exp.TableAlias(this=_ident("m"))),
                on=exp.and_(
                    exp.EQ(this=_col("Tarih", "m"), expression=_col(self._physical(dkey), "d")),
                    exp.EQ(this=_col("Donusum", "m"), expression=_lit(key.time)),
                ),
                join_type="inner",
            )
        )
        conds = []
        for c, preds in filter_map.items():
            if c.table == dt.ad:
                conds.extend(self.render(p, col_fn) for p in preds)
        for t, p in rls:
            if t == dt.ad:
                conds.append(self.render(p, col_fn))
        where = _and_all(conds)
        if where is not None:
            sel = sel.where(where)
        return sel, ds_cols

    def _fallback_axis(self, group: list[ColKey], ctx: ir.Context, gidx) -> exp.Select:
        """Hiçbir ölçü görselin tam ayrıntısında değilse: boyut değerlerinin çapraz çarpımı."""
        by_table: dict[str, list[ColKey]] = {}
        for g in group:
            by_table.setdefault(g.table, []).append(g)
        fm = ctx.filter_map()
        parts = []
        for i, (table, cols) in enumerate(by_table.items()):
            alias = f"t{i}"
            aliases = {table: alias}
            # Ölçüsüz alan/anahtar listeleri de ilişkili boyut filtresi ve RLS'yi
            # uygular. Örneğin Firma rolü Parti ve Bağlantı anahtarlarını sınırlar.
            predicates = [p for c, preds in fm.items() if self.model.reachable(table, c.table, ctx.rels) for p in preds]
            predicates += [p for t, p in self.rls if self.model.reachable(table, t, ctx.rels)]
            needed = {c.table for p in predicates for c in self._cols_in(p)} - {table}
            sel = exp.Select().from_(self._source(table, alias))
            for target in sorted(needed, key=lambda t: len(self.model.path(table, t, ctx.rels) or [])):
                path = self.model.path(table, target, ctx.rels)
                if path is None:
                    raise CompileError(f"'{table}' tablosundan '{target}' tablosuna ilişki yolu yok")
                for edge in path:
                    to = edge.to_col.table
                    if to in aliases:
                        continue
                    joined_alias = f"{alias}_j{len(aliases)}"
                    sel = sel.join(self._source(to, joined_alias),
                        on=exp.EQ(this=_col(self._physical(edge.from_col), aliases[edge.from_col.table]),
                                  expression=_col(self._physical(edge.to_col), joined_alias)),
                        join_type="inner" if edge.inner else "left")
                    aliases[to] = joined_alias
            col_fn = lambda k: _col(self._physical(k), aliases[k.table])  # noqa: E731
            sel = sel.select(*[exp.alias_(self.render(ir.Col(c), col_fn), f"g{gidx[c]}") for c in cols]).distinct()
            conds = [self.render(p, col_fn) for p in predicates]
            where = _and_all(conds)
            if where is not None:
                sel = sel.where(where)
            parts.append(exp.Subquery(this=sel, alias=exp.TableAlias(this=_ident(alias))))
        axis = exp.select(*[_col(f"g{gidx[g]}") for g in group]).from_(parts[0])
        for p in parts[1:]:
            axis = axis.join(p, join_type="cross")
        return axis
