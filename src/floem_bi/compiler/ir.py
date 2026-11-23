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


@dataclass(frozen=True)
class ColumnExtremum(Expr):
    """Hesaplanmış sütunda filtre bağlamından bağımsız MIN/MAX değeri."""
    function: str
    key: ColKey


@dataclass(frozen=True)
class FrozenScalar(Expr):
    """VAR'ın tanımlandığı filtre bağlamındaki değeri; satır filtresinde değişmez."""
    value: Expr


# --- filtre bağlamı ---------------------------------------------------------

@dataclass(frozen=True)
class Context:
    """DAX filtre bağlamı.

    group:   görselin gruplama sütunlarından hâlâ geçerli olanlar (satır başına filtre)
    filters: sütun → koşul ifadeleri (AND); her koşul yalnızca o sütunu kullanır.
             Tablo düzeyi satır filtreleri (FILTER(T, çok sütunlu koşul)) `table_key(T)`
             anahtarıyla tutulur; koşul T'nin birden fazla sütununu kullanabilir.
    time:    zaman zekâsı dönüşümü (ör. "MONTH:-12", "YTD"), yoksa None
    rels:    USERELATIONSHIP ile bu hesapta etkinleştirilen ilişkiler (çok, bir) sütun çiftleri
    """
    group: frozenset[ColKey] = frozenset()
    filters: tuple[tuple[ColKey, tuple[Expr, ...]], ...] = ()
    time: str | None = None
    rels: frozenset[tuple[ColKey, ColKey]] = frozenset()

    def filter_map(self) -> dict[ColKey, tuple[Expr, ...]]:
        return dict(self.filters)

    @staticmethod
    def make(group, filters: dict[ColKey, tuple[Expr, ...]], time: str | None, rels=frozenset()) -> "Context":
        return Context(frozenset(group), tuple(sorted(filters.items(), key=lambda kv: kv[0])), time, frozenset(rels))

    def remove_columns(self, cols) -> "Context":
        cols = set(cols)
        fm = {k: v for k, v in self.filter_map().items() if k not in cols}
        return Context.make((g for g in self.group if g not in cols), fm, self.time, self.rels)

    def remove_group(self, cols) -> "Context":
        """ALLSELECTED: görselin kendi gruplamasını kaldırır, dış filtreleri (dilimleyici vb.) korur."""
        cols = set(cols)
        return Context(frozenset(g for g in self.group if g not in cols), self.filters, self.time, self.rels)

    def replace_filter(self, col: ColKey, preds: tuple[Expr, ...]) -> "Context":
        fm = self.filter_map()
        fm[col] = preds
        return Context.make((g for g in self.group if g != col), fm, self.time, self.rels)

    def keep_filter(self, col: ColKey, preds: tuple[Expr, ...]) -> "Context":
        fm = self.filter_map()
        fm[col] = fm.get(col, ()) + preds
        return Context.make(self.group, fm, self.time, self.rels)

    def with_time(self, time: str | None) -> "Context":
        return Context(self.group, self.filters, time, self.rels)

    def with_rels(self, rels) -> "Context":
        return Context(self.group, self.filters, self.time, frozenset(self.rels | set(rels)))

    def columns(self) -> set[ColKey]:
        return set(self.group) | {k for k, _ in self.filters}


TABLE_ROW = "*satır*"


def table_key(table: str) -> ColKey:
    """Tablo düzeyi satır filtresinin bağlamdaki anahtarı (gerçek bir sütun değil)."""
    return ColKey(table, TABLE_ROW)


@dataclass(frozen=True)
class Slot(Expr):
    """Bir toplama: agg(arg) — `base` tablosu üzerinde, `ctx` bağlamında."""
    agg: str               # SUM AVG MIN MAX COUNT COUNTROWS DISTINCTCOUNT
    arg: Expr | None
    base: str              # tablo adı (modeldeki yazımıyla)
    ctx: Context = field(compare=True)


@dataclass(frozen=True)
class Nested(Expr):
    """Bağlam geçişi: `inner` her satır anahtarı (`keys`) için hesaplanır, sonra `agg` ile toplanır.

    SUMX(VALUES(Tarih[Ay]), [Satış]) → her ay için [Satış], sonra toplam.
    `ctx`, iteratörün dış bağlamıdır (görsel gruplamasından hangilerinin geçerli olduğu buradan çıkar).
    """
    agg: str
    inner: Expr
    keys: tuple[ColKey, ...]
    ctx: Context
