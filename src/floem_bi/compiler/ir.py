"""Derleyicinin ara temsili (IR).

İki tür ifade aynı düğümleri paylaşır:
- Satır ifadesi: tek bir tablonun satırı üzerinde (`Col`), toplama fonksiyonlarının
  argümanı, hesaplanmış sütun, filtre koşulu ve RLS kuralı.
- Skaler ifade: ölçünün sonucu; toplamalara `SlotRef` ile başvurur.

Tüm düğümler değiştirilemez ve hash'lenebilir; böylece aynı (toplama, bağlam)
çiftleri tek bir SQL ifadesine (slot) indirgenir.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..model import ColKey


class Expr:
    pass


@dataclass(frozen=True)
class Lit(Expr):
    value: object          # int, float, str, bool, None (BLANK)


@dataclass(frozen=True)
class Col(Expr):
    key: ColKey


@dataclass(frozen=True)
class Bin(Expr):
    op: str                # + - * / ^ & = <> < > <= >= AND OR
    left: Expr
    right: Expr


@dataclass(frozen=True)
class Neg(Expr):
    operand: Expr


@dataclass(frozen=True)
class Not(Expr):
    operand: Expr


@dataclass(frozen=True)
class InList(Expr):
    operand: Expr
    values: tuple[Expr, ...]


@dataclass(frozen=True)
class Divide(Expr):
    num: Expr
    den: Expr
    alt: Expr | None = None


@dataclass(frozen=True)
class Case(Expr):
    whens: tuple[tuple[Expr, Expr], ...]
    default: Expr | None


@dataclass(frozen=True)
class IsBlank(Expr):
    operand: Expr


@dataclass(frozen=True)
class Func(Expr):
    """Satır/skaler fonksiyonları: ABS, ROUND, YEAR, MONTH, UPPER..."""
    name: str
    args: tuple[Expr, ...]


# --- filtre bağlamı ---------------------------------------------------------

@dataclass(frozen=True)
class Context:
    """DAX filtre bağlamı.

    group:   görselin gruplama sütunlarından hâlâ geçerli olanlar (satır başına filtre)
    filters: sütun → koşul ifadeleri (AND); her koşul yalnızca o sütunu kullanır
    time:    zaman zekâsı dönüşümü (ör. "MONTH:-12", "YTD"), yoksa None
    """
    group: frozenset[ColKey] = frozenset()
    filters: tuple[tuple[ColKey, tuple[Expr, ...]], ...] = ()
    time: str | None = None

    def filter_map(self) -> dict[ColKey, tuple[Expr, ...]]:
        return dict(self.filters)

    @staticmethod
    def make(group, filters: dict[ColKey, tuple[Expr, ...]], time: str | None) -> "Context":
        return Context(frozenset(group), tuple(sorted(filters.items(), key=lambda kv: kv[0])), time)

    def remove_columns(self, cols) -> "Context":
        cols = set(cols)
        fm = {k: v for k, v in self.filter_map().items() if k not in cols}
        return Context.make((g for g in self.group if g not in cols), fm, self.time)

    def replace_filter(self, col: ColKey, preds: tuple[Expr, ...]) -> "Context":
        fm = self.filter_map()
        fm[col] = preds
        return Context.make((g for g in self.group if g != col), fm, self.time)

    def keep_filter(self, col: ColKey, preds: tuple[Expr, ...]) -> "Context":
        fm = self.filter_map()
        fm[col] = fm.get(col, ()) + preds
        return Context.make(self.group, fm, self.time)

    def with_time(self, time: str) -> "Context":
        return Context(self.group, self.filters, time)

    def columns(self) -> set[ColKey]:
        return set(self.group) | {k for k, _ in self.filters}


@dataclass(frozen=True)
class Slot(Expr):
    """Bir toplama: agg(arg) — `base` tablosu üzerinde, `ctx` bağlamında."""
    agg: str               # SUM AVG MIN MAX COUNT COUNTROWS DISTINCTCOUNT
    arg: Expr | None
    base: str              # tablo adı (modeldeki yazımıyla)
    ctx: Context = field(compare=True)
