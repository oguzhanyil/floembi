"""Veri tiplerini koruyan, bildirimsel rapor ifadeleri."""

from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from operator import eq, ge, gt, le, lt, ne


def number(value):
    if value is None or value == "":
        return Decimal(0)
    try:
        n = Decimal(str(value))
        if not n.is_finite():
            raise ValueError("Sonlu bir sayı gerekli")
        return n
    except InvalidOperation as exc:
        raise ValueError(f"Sayı bekleniyor: {value}") from exc


def day(value):
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise ValueError(f"Geçersiz tarih: {value}") from exc


def matches(row, field, op, value):
    a = row[field]
    if op == "contains":
        return str(value).casefold() in str(a or "").casefold()
    if a is None or value is None:
        return (a is value) if op == "eq" else (a is not value) if op == "ne" else False
    if isinstance(a, (Decimal, float, int)) and not isinstance(a, bool):
        a, value = number(a), number(value)
    elif isinstance(a, date) or isinstance(value, date):
        a, value = day(a), day(value)
    else:
        a, value = str(a), str(value)
    return {"eq": eq, "ne": ne, "ge": ge, "le": le, "gt": gt, "lt": lt}[op](a, value)


class Totals:
    def __init__(self, rows):
        self.rows = rows
        self._prefix = {}

    def sum(self, field, end=None):
        if field not in self._prefix:
            sums = [Decimal(0)]
            for row in self.rows:
                sums.append(sums[-1] + number(row[field]))
            self._prefix[field] = sums
        return self._prefix[field][-1 if end is None else end]


def evaluate(f, row, scope, index):
    if f.op == "count":
        return len(scope.rows)
    if f.op in ("sum", "running"):
        return scope.sum(f.field, index if f.op == "running" else None)
    if f.op == "if":
        if not f.condition:
            raise ValueError("Koşullu formül için karşılaştırma seçin")
        return f.yes if matches(row, f.condition.field, f.condition.op, f.condition.value) else f.no
    a = row.get(f.field)
    b = row.get(f.other) if f.other else f.value
    if f.op == "field" or a is None:
        return a
    if f.op in ("year", "month", "day"):
        return getattr(day(a), f.op)
    if f.op == "daysBetween":
        return (day(a) - day(b)).days
    a = number(a)
    if f.op == "abs":
        return abs(a)
    b = number(b)
    if f.op == "round":
        return a.quantize(Decimal(1).scaleb(-max(0, min(12, int(b)))), rounding=ROUND_HALF_UP)
    if f.op == "divide":
        return a / b if b else None
    return {"add": lambda: a + b, "subtract": lambda: a - b, "multiply": lambda: a * b}[f.op]()


def display(v, fmt):
    if v is None:
        return ""
    if fmt == "date":
        return day(v).strftime("%d.%m.%Y")
    if fmt in ("money", "integer", "decimal"):
        t = format(number(v), ",.0f" if fmt == "integer" else ",.2f").translate(str.maketrans(",.", ".,"))
        return t + " TL" if fmt == "money" else t
    return str(v)
