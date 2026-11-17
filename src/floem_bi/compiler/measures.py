"""Floem DAX → IR: binder ve filtre bağlamı semantiği.

Ölçüler skaler bağlamda derlenir; her toplama fonksiyonu, o anki filtre
bağlamıyla birlikte bir `Slot`a dönüşür. CALCULATE, bağlamı dönüştüren saf bir
fonksiyondur (bkz. research/notes/99-floem-bi-sentez.md §3.2).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..dax import ast, parse
from ..dax.lexer import DaxSyntaxError, Span
from ..model import ColKey, ModelError, SemanticModel
from . import ir


class CompileError(Exception):
    def __init__(self, message: str, span: Span | None = None, source: str | None = None):
        self.message = message
        self.span = span
        self.source = source
        if span is not None and source is not None:
            text = DaxSyntaxError(message, span, source).render()
        else:
            text = message
        super().__init__(text)


@dataclass
class UserInfo:
    upn: str = ""
    attributes: dict[str, list[str]] = field(default_factory=dict)


AGGREGATIONS = {
    "SUM": "SUM", "AVERAGE": "AVG", "MIN": "MIN", "MAX": "MAX",
    "COUNT": "COUNT", "COUNTA": "COUNT", "DISTINCTCOUNT": "DISTINCTCOUNT",
}
ITERATORS = {"SUMX": "SUM", "AVERAGEX": "AVG", "MINX": "MIN", "MAXX": "MAX", "COUNTX": "COUNT"}
TIME_FUNCS = {"SAMEPERIODLASTYEAR", "DATEADD", "DATESYTD", "DATESQTD", "DATESMTD"}
TOTAL_FUNCS = {"TOTALYTD": "DATESYTD", "TOTALQTD": "DATESQTD", "TOTALMTD": "DATESMTD"}
ROW_FUNCS = {"ABS": 1, "ROUND": 2, "YEAR": 1, "MONTH": 1, "DAY": 1, "UPPER": 1, "LOWER": 1}
UNSUPPORTED_V1 = {
    "FILTER", "USERELATIONSHIP", "CROSSFILTER", "ALLSELECTED", "VALUES", "SELECTEDVALUE",
    "HASONEVALUE", "RANKX", "TOPN", "SUMMARIZE", "ADDCOLUMNS", "EARLIER",
}


class MeasureCompiler:
    def __init__(self, model: SemanticModel, user: UserInfo | None = None):
        self.model = model
        self.user = user or UserInfo()
        self._source = ""            # hata mesajları için o an derlenen metin
        self._stack: list[str] = []  # döngü koruması

    # ------------------------------------------------------------------ giriş
    def measure(self, name: str, ctx: ir.Context) -> ir.Expr:
        found = self.model.measure(name)
        if found is None:
            raise CompileError(f"Ölçü bulunamadı: [{name}]")
        _, olcu = found
        key = olcu.ad.lower()
        if key in self._stack:
            raise CompileError("Döngüsel ölçü bağımlılığı: " + " → ".join(self._stack + [key]))
        self._stack.append(key)
        saved = self._source
        try:
            self._source = olcu.ifade
            try:
                node = parse(olcu.ifade)
            except DaxSyntaxError as e:
                raise CompileError(f"[{olcu.ad}] {e.message}", e.span, olcu.ifade) from e
            return self.scalar(node, ctx, {})
        finally:
            self._source = saved
            self._stack.pop()

    def expression(self, text: str, ctx: ir.Context) -> ir.Expr:
        """Modelde kayıtlı olmayan geçici bir ölçü ifadesini derler."""
        self._source = text
        return self.scalar(parse(text), ctx, {})

    def row_predicate(self, text: str, table: str) -> ir.Expr:
        """RLS kuralı gibi bir tablonun satır bağlamındaki boolean ifadesini derler."""
        saved = self._source
        self._source = text
        try:
            return self.row(parse(text), self.model.table(table).ad, {})
        finally:
            self._source = saved

    def calc_column(self, key: ColKey) -> ir.Expr:
        sutun = self.model.sutun(key)
        assert sutun.ifade is not None
        name = f"{key}"
        if name in self._stack:
            raise CompileError(f"Döngüsel hesaplanmış sütun: {name}")
        self._stack.append(name)
        saved = self._source
        try:
            self._source = sutun.ifade
            return self.row(parse(sutun.ifade), key.table, {})
        finally:
            self._source = saved
            self._stack.pop()

    # ------------------------------------------------------------- yardımcı
    def err(self, message: str, node: ast.Node | None = None) -> CompileError:
        return CompileError(message, node.span if node is not None else None, self._source or None)

    def resolve_column(self, node: ast.Node) -> ColKey:
        if not isinstance(node, ast.ColumnRef):
            raise self.err("Sütun referansı (Tablo[Sütun]) bekleniyordu", node)
        try:
            return self.model.column(node.table, node.column)[0]
        except ModelError as e:
            raise self.err(str(e), node) from e

    def resolve_table(self, node: ast.Node) -> str:
        if not isinstance(node, ast.Name):
            raise self.err("Tablo adı bekleniyordu", node)
        try:
            return self.model.table(node.name).ad
        except ModelError as e:
            raise self.err(str(e), node) from e

    def _arity(self, node: ast.Call, lo: int, hi: int | None = None) -> None:
        n = len(node.args)
        hi = lo if hi is None else hi
        if n < lo or n > hi:
            want = str(lo) if lo == hi else f"{lo}-{hi}"
            raise self.err(f"{node.name} {want} argüman alır, {n} verildi", node)

    # --------------------------------------------------------- skaler bağlam
    def scalar(self, node: ast.Node, ctx: ir.Context, env: dict[str, ir.Expr]) -> ir.Expr:
        if isinstance(node, ast.Number):
            return ir.Lit(node.value)
        if isinstance(node, ast.String):
            return ir.Lit(node.value)
        if isinstance(node, ast.Boolean):
            return ir.Lit(node.value)
        if isinstance(node, ast.BracketRef):
            if self.model.measure(node.name) is None:
                raise self.err(f"Ölçü bulunamadı: [{node.name}]", node)
            return self.measure(node.name, ctx)
        if isinstance(node, ast.Name):
            if not node.quoted and node.name.lower() in env:
                return env[node.name.lower()]
            raise self.err(f"'{node.name}' burada kullanılamaz (değişken değil; tablo skaler değer vermez)", node)
        if isinstance(node, ast.ColumnRef):
            raise self.err(
                f"{node.table}[{node.column}] satır bağlamı olmadan kullanılamaz; SUM, MIN gibi bir toplama kullanın",
                node,
            )
        if isinstance(node, ast.VarBlock):
            env2 = dict(env)
            for name, expr in node.variables:
                env2[name.lower()] = self.scalar(expr, ctx, env2)  # VAR tanımlandığı bağlamda değerlenir
            return self.scalar(node.body, ctx, env2)
        if isinstance(node, ast.Unary):
            inner = self.scalar(node.operand, ctx, env)
            return {"-": ir.Neg(inner), "+": inner, "NOT": ir.Not(inner)}[node.op]
        if isinstance(node, ast.Binary):
            return self._binary(node, lambda n: self.scalar(n, ctx, env))
        if isinstance(node, ast.TableConstructor):
            raise self.err("Tablo kurucusu yalnızca IN'in sağında kullanılabilir", node)
        if isinstance(node, ast.Call):
            return self._scalar_call(node, ctx, env)
        raise self.err("Desteklenmeyen ifade", node)

    def _binary(self, node: ast.Binary, sub) -> ir.Expr:
        if node.op == "IN":
            return ir.InList(sub(node.left), self._in_values(node.right))
        op = {"&&": "AND", "||": "OR"}.get(node.op, node.op)
        return ir.Bin(op, sub(node.left), sub(node.right))

    def _in_values(self, node: ast.Node) -> tuple[ir.Expr, ...]:
        if isinstance(node, ast.TableConstructor):
            vals = []
            for item in node.items:
                if not isinstance(item, (ast.Number, ast.String, ast.Boolean)):
                    raise self.err("IN listesi yalnızca sabit değer içerebilir (MVP)", item)
                vals.append(ir.Lit(item.value))
            return tuple(vals)
        if isinstance(node, ast.Call) and node.name == "USERATTRIBUTE":
            self._arity(node, 1)
            if not isinstance(node.args[0], ast.String):
                raise self.err("USERATTRIBUTE metin argümanı alır", node)
            values = self.user.attributes.get(node.args[0].value, [])
            # Öznitelik yoksa hiçbir satır eşleşmesin (güvenli varsayılan)
            return tuple(ir.Lit(v) for v in values) or (ir.Lit(None),)
        raise self.err("IN'in sağında {...} listesi veya USERATTRIBUTE(...) bekleniyordu", node)

    def _scalar_call(self, node: ast.Call, ctx: ir.Context, env: dict[str, ir.Expr]) -> ir.Expr:
        name = node.name
        sub = lambda n: self.scalar(n, ctx, env)  # noqa: E731
        if name in AGGREGATIONS:
            self._arity(node, 1)
            col = self.resolve_column(node.args[0])
            return ir.Slot(AGGREGATIONS[name], ir.Col(col), col.table, ctx)
        if name == "COUNTROWS":
            self._arity(node, 1)
            table = self.resolve_table(node.args[0])
            return ir.Slot("COUNTROWS", None, table, ctx)
        if name in ITERATORS:
            self._arity(node, 2)
            table = self.resolve_table(node.args[0])
            arg = self.row(node.args[1], table, env)
            return ir.Slot(ITERATORS[name], arg, table, ctx)
        if name == "CALCULATE":
            if not node.args:
                raise self.err("CALCULATE en az bir argüman alır", node)
            new_ctx = self._apply_modifiers(node.args[1:], ctx, env)
            return self.scalar(node.args[0], new_ctx, env)
        if name in TOTAL_FUNCS:
            self._arity(node, 2)
            fake = ast.Call(node.span, TOTAL_FUNCS[name], (node.args[1],))
            new_ctx = self._apply_modifiers((fake,), ctx, env)
            return self.scalar(node.args[0], new_ctx, env)
        common = self._common_call(node, sub)
        if common is not None:
            return common
        return self._unknown(node)

    def _common_call(self, node: ast.Call, sub) -> ir.Expr | None:
        """Hem skaler hem satır bağlamında aynı davranan fonksiyonlar."""
        name = node.name
        if name == "BLANK":
            self._arity(node, 0)
            return ir.Lit(None)
        if name == "DIVIDE":
            self._arity(node, 2, 3)
            alt = sub(node.args[2]) if len(node.args) == 3 else None
            return ir.Divide(sub(node.args[0]), sub(node.args[1]), alt)
        if name == "IF":
            self._arity(node, 2, 3)
            default = sub(node.args[2]) if len(node.args) == 3 else None
            return ir.Case(((sub(node.args[0]), sub(node.args[1])),), default)
        if name == "SWITCH":
            if len(node.args) < 3:
                raise self.err("SWITCH en az 3 argüman alır", node)
            first, rest = node.args[0], node.args[1:]
            default = sub(rest[-1]) if len(rest) % 2 == 1 else None
            pairs = rest[: len(rest) - (len(rest) % 2)]
            whens = []
            is_true = isinstance(first, ast.Boolean) and first.value
            subject = None if is_true else sub(first)
            for i in range(0, len(pairs), 2):
                cond = sub(pairs[i]) if is_true else ir.Bin("=", subject, sub(pairs[i]))
                whens.append((cond, sub(pairs[i + 1])))
            return ir.Case(tuple(whens), default)
        if name == "ISBLANK":
            self._arity(node, 1)
            return ir.IsBlank(sub(node.args[0]))
        if name == "COALESCE":
            if len(node.args) < 2:
                raise self.err("COALESCE en az 2 argüman alır", node)
            args = [sub(a) for a in node.args]
            whens = tuple((ir.Not(ir.IsBlank(a)), a) for a in args[:-1])
            return ir.Case(whens, args[-1])
        if name in ("AND", "OR"):
            self._arity(node, 2)
            return ir.Bin(name, sub(node.args[0]), sub(node.args[1]))
        if name == "NOT":
            self._arity(node, 1)
            return ir.Not(sub(node.args[0]))
        if name in ("USERPRINCIPALNAME", "USERNAME"):
            self._arity(node, 0)
            return ir.Lit(self.user.upn)
        if name in ROW_FUNCS:
            lo = 1
            self._arity(node, lo, ROW_FUNCS[name])
            return ir.Func(name, tuple(sub(a) for a in node.args))
        return None

    def _unknown(self, node: ast.Call) -> ir.Expr:
        if node.name in TIME_FUNCS or node.name in ("ALL", "REMOVEFILTERS", "ALLEXCEPT", "KEEPFILTERS"):
            raise self.err(f"{node.name} yalnızca CALCULATE filtre argümanı olarak kullanılabilir", node)
        if node.name in UNSUPPORTED_V1:
            raise self.err(f"{node.name} MVP'de desteklenmiyor (v1)", node)
        raise self.err(f"Bilinmeyen veya desteklenmeyen fonksiyon: {node.name}", node)

    # ------------------------------------------------------- CALCULATE
    def _apply_modifiers(self, args, ctx: ir.Context, env) -> ir.Context:
        removals: list[ast.Call] = []
        times: list[ast.Call] = []
        filters: list[tuple[ast.Node, bool]] = []   # (ifade, keep)
        for a in args:
            if isinstance(a, ast.Call) and a.name in ("ALL", "REMOVEFILTERS", "ALLEXCEPT"):
                removals.append(a)
            elif isinstance(a, ast.Call) and a.name in TIME_FUNCS:
                times.append(a)
            elif isinstance(a, ast.Call) and a.name == "KEEPFILTERS":
                self._arity(a, 1)
                filters.append((a.args[0], True))
            elif isinstance(a, ast.Call) and a.name in UNSUPPORTED_V1:
                raise self.err(f"{a.name} MVP'de desteklenmiyor (v1)", a)
            else:
                filters.append((a, False))

        # 1) ALL / REMOVEFILTERS / ALLEXCEPT
        for r in removals:
            ctx = self._removal(r, ctx)
        # 2) zaman zekâsı
        for t in times:
            key = self._time_key(t)
            if ctx.time is not None and ctx.time != key:
                raise self.err("İç içe farklı zaman zekâsı dönüşümleri MVP'de desteklenmiyor", t)
            ctx = ctx.with_time(key)
        # 3) boolean filtreler: aynı sütundaki filtreler kesişir, sonra bağlamdakinin yerine geçer
        replace: dict[ColKey, list[ir.Expr]] = {}
        keep: dict[ColKey, list[ir.Expr]] = {}
        for expr, is_keep in filters:
            cols = self._columns_in(expr)
            if len(cols) != 1:
                raise self.err(
                    "CALCULATE filtre ifadesi tam olarak bir sütuna başvurmalı (çok sütunlu FILTER v1'de)", expr
                )
            col = next(iter(cols))
            pred = self.row(expr, col.table, env, allow_vars_from_scalar=True)
            (keep if is_keep else replace).setdefault(col, []).append(pred)
        for col, preds in replace.items():
            ctx = ctx.replace_filter(col, tuple(preds))
        for col, preds in keep.items():
            ctx = ctx.keep_filter(col, tuple(preds))
        return ctx

    def _removal(self, node: ast.Call, ctx: ir.Context) -> ir.Context:
        if node.name == "ALLEXCEPT":
            if len(node.args) < 2:
                raise self.err("ALLEXCEPT bir tablo ve en az bir sütun alır", node)
            table = self.resolve_table(node.args[0])
            keep = {self.resolve_column(a) for a in node.args[1:]}
            drop = [c for c in ctx.columns() if c.table == table and c not in keep]
            return ctx.remove_columns(drop)
        if not node.args:  # ALL() / REMOVEFILTERS(): tüm filtreler
            return ir.Context(frozenset(), (), ctx.time)
        drop: list[ColKey] = []
        for a in node.args:
            if isinstance(a, ast.ColumnRef):
                drop.append(self.resolve_column(a))
            else:
                table = self.resolve_table(a)
                drop.extend(c for c in ctx.columns() if c.table == table)
                if self.model.table(table).tarih_tablosu is not None:
                    ctx = ir.Context(ctx.group, ctx.filters, None)
        return ctx.remove_columns(drop)

    def _time_key(self, node: ast.Call) -> str:
        if node.name == "DATEADD":
            self._arity(node, 3)
        else:
            self._arity(node, 1)
        col = self.resolve_column(node.args[0])
        date_table = self.model.date_table()
        if date_table is None or date_table.ad != col.table or date_table.tarih_tablosu.anahtar_sutun.lower() != col.column.lower():
            raise self.err("Zaman zekâsı fonksiyonları tarih tablosunun anahtar sütununu almalı", node.args[0])
        if node.name == "SAMEPERIODLASTYEAR":
            return "MONTH:-12"
        if node.name == "DATESYTD":
            return "YTD"
        if node.name == "DATESQTD":
            return "QTD"
        if node.name == "DATESMTD":
            return "MTD"
        n_node, unit_node = node.args[1], node.args[2]
        sign = 1
        if isinstance(n_node, ast.Unary) and n_node.op == "-":
            sign, n_node = -1, n_node.operand
        if not isinstance(n_node, ast.Number) or not isinstance(n_node.value, int):
            raise self.err("DATEADD aralığı tam sayı sabiti olmalı", node.args[1])
        if not isinstance(unit_node, ast.Name):
            raise self.err("DATEADD birimi YEAR, QUARTER veya MONTH olmalı", unit_node)
        months = {"YEAR": 12, "QUARTER": 3, "MONTH": 1}.get(unit_node.name.upper())
        if months is None:
            raise self.err("DATEADD birimi YEAR, QUARTER veya MONTH olmalı (DAY v1'de)", unit_node)
        return f"MONTH:{sign * n_node.value * months}"

    def _columns_in(self, node: ast.Node) -> set[ColKey]:
        out: set[ColKey] = set()
        if isinstance(node, ast.ColumnRef):
            out.add(self.resolve_column(node))
        elif isinstance(node, ast.BracketRef):
            raise self.err("Filtre ifadesinde ölçü kullanılamaz (FILTER v1'de)", node)
        for child in _children(node):
            out |= self._columns_in(child)
        return out

    # ------------------------------------------------------------ satır bağlamı
    def row(self, node: ast.Node, table: str, env: dict[str, ir.Expr], allow_vars_from_scalar: bool = False) -> ir.Expr:
        sub = lambda n: self.row(n, table, env, allow_vars_from_scalar)  # noqa: E731
        if isinstance(node, (ast.Number, ast.String, ast.Boolean)):
            return ir.Lit(node.value)
        if isinstance(node, ast.ColumnRef):
            key = self.resolve_column(node)
            if key.table != table:
                raise self.err(
                    f"{key} satır bağlamındaki '{table}' tablosunda değil; RELATED({key}) kullanın", node
                )
            return ir.Col(key)
        if isinstance(node, ast.Name):
            if not node.quoted and node.name.lower() in env:
                value = env[node.name.lower()]
                if not _is_constant(value):
                    raise self.err("Satır bağlamında yalnızca sabit değerli VAR kullanılabilir (MVP)", node)
                return value
            raise self.err(f"'{node.name}' burada kullanılamaz", node)
        if isinstance(node, ast.BracketRef):
            raise self.err(
                f"[{node.name}] satır bağlamında kullanılamaz (bağlam geçişi MVP'de desteklenmiyor)", node
            )
        if isinstance(node, ast.Unary):
            inner = sub(node.operand)
            return {"-": ir.Neg(inner), "+": inner, "NOT": ir.Not(inner)}[node.op]
        if isinstance(node, ast.Binary):
            return self._binary(node, sub)
        if isinstance(node, ast.VarBlock):
            raise self.err("Satır bağlamında VAR MVP'de desteklenmiyor", node)
        if isinstance(node, ast.Call):
            if node.name == "RELATED":
                self._arity(node, 1)
                key = self.resolve_column(node.args[0])
                if not self.model.reachable(table, key.table):
                    raise self.err(f"RELATED: '{table}' tablosundan {key.table} tablosuna çok→bir ilişki yok", node)
                return ir.Col(key)
            common = self._common_call(node, sub)
            if common is not None:
                return common
            if node.name in AGGREGATIONS or node.name in ITERATORS or node.name == "CALCULATE":
                raise self.err(f"{node.name} satır bağlamında MVP'de desteklenmiyor", node)
            return self._unknown(node)
        raise self.err("Desteklenmeyen ifade", node)


def _is_constant(e: ir.Expr) -> bool:
    if isinstance(e, ir.Lit):
        return True
    if isinstance(e, (ir.Slot, ir.Col)):
        return False
    for v in vars(e).values():
        if isinstance(v, ir.Expr) and not _is_constant(v):
            return False
        if isinstance(v, tuple):
            for x in v:
                if isinstance(x, ir.Expr) and not _is_constant(x):
                    return False
                if isinstance(x, tuple) and any(isinstance(y, ir.Expr) and not _is_constant(y) for y in x):
                    return False
    return True


def _children(node: ast.Node) -> list[ast.Node]:
    if isinstance(node, ast.Call):
        return list(node.args)
    if isinstance(node, ast.Binary):
        return [node.left, node.right]
    if isinstance(node, ast.Unary):
        return [node.operand]
    if isinstance(node, ast.TableConstructor):
        return list(node.items)
    if isinstance(node, ast.VarBlock):
        return [e for _, e in node.variables] + [node.body]
    return []
