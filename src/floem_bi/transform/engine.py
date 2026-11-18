"""Dönüştürme adımlarını DuckDB SQL'ine çevirir (CTE zinciri) ve her adımı doğrular.

Ham tablo → s0 → s1 → ... → sN. Her adımdan sonra şema DuckDB'ye sorulur (DESCRIBE);
böylece sonraki adımda olmayan bir sütun kullanılırsa hangi adımda olduğu söylenir.
"""

from __future__ import annotations

from dataclasses import dataclass

import duckdb
import sqlglot
from sqlglot import exp

from ..importer.loader import qident
from ..importer.types import DUCKDB_TYPE
from . import steps as S

TRY_TYPES = {**DUCKDB_TYPE, "decimal": "DECIMAL(38,6)"}


class StepError(Exception):
    def __init__(self, index: int, message: str, detail: str = ""):
        self.index = index
        self.message = message
        self.detail = detail
        super().__init__(f"Adım {index + 1}: {message}")


@dataclass
class Built:
    sql: str                                   # WITH ... SELECT * FROM sN
    columns: list[tuple[str, str]]             # (ad, DuckDB tipi)


def lit(v) -> str:
    return exp.convert(v).sql(dialect="duckdb")


def _with(ctes: list[tuple[str, str]], last: str) -> str:
    return "WITH " + ", ".join(f"{n} AS ({body})" for n, body in ctes) + f" SELECT * FROM {last}"


class _Cols:
    def __init__(self, cols: list[tuple[str, str]]):
        self.cols = cols
        self.by = {c.lower(): (c, t) for c, t in cols}

    def need(self, name: str, i: int) -> str:
        found = self.by.get(name.lower())
        if not found:
            raise StepError(i, f"'{name}' sütunu yok (mevcut: {', '.join(c for c, _ in self.cols[:12])}"
                               f"{'…' if len(self.cols) > 12 else ''})")
        return found[0]

    def type(self, name: str) -> str:
        return self.by[name.lower()][1]

    def free(self, name: str, i: int) -> None:
        if name.lower() in self.by:
            raise StepError(i, f"'{name}' adında bir sütun zaten var")


# ------------------------------------------------------------------ özel sütun güvenliği
DENIED_FUNCS = {
    "read_csv", "read_csv_auto", "read_parquet", "read_json", "read_json_auto", "read_text", "read_blob",
    "glob", "getenv", "query", "query_table", "sniff_csv", "parquet_scan", "csv_scan",
}
DENIED_NODES = (exp.Select, exp.Subquery, exp.Table, exp.Union, exp.Command, exp.Insert, exp.Update,
                exp.Delete, exp.Create, exp.Drop, exp.Pragma)


def check_expression(text: str, cols: _Cols, i: int) -> str:
    try:
        node = sqlglot.parse_one(text, read="duckdb")
    except (sqlglot.errors.ParseError, sqlglot.errors.TokenError) as e:
        raise StepError(i, "Özel sütun ifadesi okunamadı", str(e)) from e
    if isinstance(node, DENIED_NODES) or any(isinstance(n, DENIED_NODES) for n in node.walk()):
        raise StepError(i, "Özel sütun yalnızca bir ifade olabilir (sorgu, tablo ya da komut kullanılamaz)")
    for n in node.walk():
        if isinstance(n, exp.Anonymous) and str(n.this).lower() in DENIED_FUNCS:
            raise StepError(i, f"{n.this} fonksiyonu özel sütunda kullanılamaz")
        if isinstance(n, exp.Func) and n.sql_name().lower() in DENIED_FUNCS:
            raise StepError(i, f"{n.sql_name()} fonksiyonu özel sütunda kullanılamaz")
        if isinstance(n, exp.Column):
            if n.table:
                raise StepError(i, "Özel sütunda tablo öneki kullanılmaz; yalnızca sütun adı yazın")
            cols.need(n.name, i)
    return node.sql(dialect="duckdb")


# ------------------------------------------------------------------ adımlar → SQL
def _select(cols: _Cols, override: dict[str, str] | None = None, drop: set[str] | None = None,
            extra: list[str] | None = None) -> str:
    override = {k.lower(): v for k, v in (override or {}).items()}
    drop = {d.lower() for d in (drop or set())}
    parts = []
    for c, _ in cols.cols:
        if c.lower() in drop:
            continue
        parts.append(override.get(c.lower(), qident(c)))
    return ", ".join(parts + (extra or [])) or "1 AS bos"


def render(step, i: int, prev: str, cols: _Cols, tables: dict[str, str], describe) -> str:
    q = qident
    if isinstance(step, S.YenidenAdlandir):
        c = cols.need(step.sutun, i)
        if step.yeni_ad.lower() != c.lower():
            cols.free(step.yeni_ad, i)
        return f"SELECT {_select(cols, {c: f'{q(c)} AS {q(step.yeni_ad)}'})} FROM {prev}"
    if isinstance(step, S.SutunKaldir):
        drop = {cols.need(c, i) for c in step.sutunlar}
        return f"SELECT {_select(cols, drop=drop)} FROM {prev}"
    if isinstance(step, S.SutunSec):
        keep = [cols.need(c, i) for c in step.sutunlar]
        return f"SELECT {', '.join(q(c) for c in keep)} FROM {prev}"
    if isinstance(step, S.TipDegistir):
        c = cols.need(step.sutun, i)
        # Power Query'deki hata hücreleri yerine dönüştürülemeyen değerler boş olur
        return f"SELECT {_select(cols, {c: f'TRY_CAST({q(c)} AS {TRY_TYPES[step.tip]}) AS {q(c)}'})} FROM {prev}"
    if isinstance(step, S.SatirFiltrele):
        c = q(cols.need(step.sutun, i))
        v = step.degerler
        text = f"lower(CAST({c} AS VARCHAR))"

        def one() -> str:
            if not v:
                raise StepError(i, "Bu filtre için bir değer girin")
            return lit(v[0])

        cond = {
            "esit": lambda: f"{c} = {one()}",
            "esit_degil": lambda: f"({c} <> {one()} OR {c} IS NULL)",
            "buyuk": lambda: f"{c} > {one()}",
            "buyuk_esit": lambda: f"{c} >= {one()}",
            "kucuk": lambda: f"{c} < {one()}",
            "kucuk_esit": lambda: f"{c} <= {one()}",
            "icinde": lambda: f"{c} IN ({', '.join(lit(x) for x in v)})" if v else "FALSE",
            "icinde_degil": lambda: f"({c} NOT IN ({', '.join(lit(x) for x in v)}) OR {c} IS NULL)" if v else "TRUE",
            "icerir": lambda: f"contains({text}, lower({one()}))",
            "icermez": lambda: f"(NOT contains({text}, lower({one()})) OR {c} IS NULL)",
            "ile_baslar": lambda: f"starts_with({text}, lower({one()}))",
            "ile_biter": lambda: f"ends_with({text}, lower({one()}))",
            "bos": lambda: f"{c} IS NULL",
            "bos_degil": lambda: f"{c} IS NOT NULL",
            "arasinda": lambda: f"{c} BETWEEN {lit(v[0])} AND {lit(v[1])}" if len(v) == 2 else (_ for _ in ()).throw(
                StepError(i, "Arasında filtresi iki değer ister")),
        }[step.islem]()
        return f"SELECT * FROM {prev} WHERE {cond}"
    if isinstance(step, S.DegerDegistir):
        c = cols.need(step.sutun, i)
        is_text = cols.type(c).upper().startswith("VARCHAR")
        if is_text and isinstance(step.bul, str) and step.bul != "":
            expr = f"replace({q(c)}, {lit(step.bul)}, {lit('' if step.yerine is None else str(step.yerine))})"
        elif step.bul is None:
            expr = f"coalesce({q(c)}, {lit(step.yerine)})"
        else:
            expr = f"CASE WHEN {q(c)} = {lit(step.bul)} THEN {lit(step.yerine)} ELSE {q(c)} END"
        return f"SELECT {_select(cols, {c: f'{expr} AS {q(c)}'})} FROM {prev}"
    if isinstance(step, S.Metin):
        c = cols.need(step.sutun, i)
        fn = {"kirp": "trim", "buyuk": "upper", "kucuk": "lower"}[step.islem]
        return f"SELECT {_select(cols, {c: f'{fn}(CAST({q(c)} AS VARCHAR)) AS {q(c)}'})} FROM {prev}"
    if isinstance(step, S.SutunBol):
        c = cols.need(step.sutun, i)
        names = [f"{c}.{k}" for k in range(1, step.adet + 1)]
        for n in names:
            if n.lower() != c.lower():
                cols.free(n, i)
        parts = ", ".join(
            f"string_split(CAST({q(c)} AS VARCHAR), {lit(step.ayirici)})[{k}] AS {q(n)}" for k, n in enumerate(names, 1)
        )
        return f"SELECT {_select(cols, {c: parts})} FROM {prev}"
    if isinstance(step, S.SutunBirlestir):
        src = [cols.need(c, i) for c in step.sutunlar]
        if step.yeni_ad.lower() not in {s.lower() for s in src}:
            cols.free(step.yeni_ad, i)
        merged = f"concat_ws({lit(step.ayirici)}, {', '.join(f'CAST({q(c)} AS VARCHAR)' for c in src)}) AS {q(step.yeni_ad)}"
        return f"SELECT {_select(cols, {src[0]: merged}, drop=set(src[1:]))} FROM {prev}"
    if isinstance(step, S.OzelSutun):
        cols.free(step.ad, i)
        expr = check_expression(step.ifade, cols, i)
        return f"SELECT *, ({expr}) AS {q(step.ad)} FROM {prev}"
    if isinstance(step, S.YinelenenleriKaldir):
        if not step.sutunlar:
            return f"SELECT DISTINCT * FROM {prev}"
        keys = ", ".join(q(cols.need(c, i)) for c in step.sutunlar)
        return f"SELECT * FROM {prev} QUALIFY row_number() OVER (PARTITION BY {keys}) = 1"
    if isinstance(step, S.Grupla):
        groups = [cols.need(c, i) for c in step.gruplar]
        seen = {g.lower() for g in groups}
        aggs = []
        for a in step.toplamalar:
            if a.ad.lower() in seen:
                raise StepError(i, f"'{a.ad}' adı birden fazla kullanılmış")
            seen.add(a.ad.lower())
            if a.islem == "say" and not a.sutun:
                aggs.append(f"count(*) AS {q(a.ad)}")
                continue
            if not a.sutun:
                raise StepError(i, f"'{a.ad}' için bir sütun seçin")
            col = q(cols.need(a.sutun, i))
            fn = {"toplam": "sum({})", "ortalama": "avg({})", "en_kucuk": "min({})", "en_buyuk": "max({})",
                  "say": "count({})", "farkli_say": "count(DISTINCT {})"}[a.islem]
            aggs.append(f"{fn.format(col)} AS {q(a.ad)}")
        g = ", ".join(q(x) for x in groups)
        return f"SELECT {g}, {', '.join(aggs)} FROM {prev} GROUP BY {g}"
    if isinstance(step, S.TersOzet):
        src = [cols.need(c, i) for c in step.sutunlar]
        for n in (step.nitelik_adi, step.deger_adi):
            if n.lower() not in {s.lower() for s in src}:
                cols.free(n, i)
        return (
            f"SELECT * FROM {prev} UNPIVOT ({q(step.deger_adi)} FOR {q(step.nitelik_adi)} "
            f"IN ({', '.join(q(c) for c in src)}))"
        )
    if isinstance(step, S.SorguBirlestir):
        other = tables.get(step.tablo.lower())
        if other is None:
            raise StepError(i, f"'{step.tablo}' tablosu modelde yok")
        if len(step.sol) != len(step.sag):
            raise StepError(i, "Birleştirme için iki taraftan eşit sayıda sütun seçin")
        right = _Cols(describe(f"SELECT * FROM {other}"))
        on = " AND ".join(f"a.{q(cols.need(l, i))} = b.{q(right.need(r, i))}" for l, r in zip(step.sol, step.sag))
        brought = []
        for c in step.sutunlar:
            rc = right.need(c, i)
            name = f"{step.onek}{rc}"
            cols.free(name, i)
            brought.append(f"b.{q(rc)} AS {q(name)}")
        join = "LEFT JOIN" if step.birlesim == "sol" else "JOIN"
        return f"SELECT a.*, {', '.join(brought)} FROM {prev} a {join} {other} b ON {on}"
    if isinstance(step, S.SorguEkle):
        parts = [f"SELECT * FROM {prev}"]
        for name in step.tablolar:
            other = tables.get(name.lower())
            if other is None:
                raise StepError(i, f"'{name}' tablosu modelde yok")
            parts.append(f"SELECT * FROM {other}")
        return " UNION ALL BY NAME ".join(parts)
    raise StepError(i, f"Bilinmeyen adım: {getattr(step, 'tur', step)!r}")


def _friendly(e: duckdb.Error) -> str:
    text = str(e)
    if "Conversion Error" in text or "Could not convert" in text:
        return "Değerler istenen tipe dönüştürülemedi"
    if "UNPIVOT" in text.upper() and "type" in text.lower():
        return "Ters özetlenen sütunlar aynı tipte olmalı (önce tiplerini eşitleyin)"
    if "Binder Error" in text:
        return "Sütun ya da ifade çözümlenemedi"
    return "Adım uygulanamadı"


def build(cur, source: str, steps: list, tables: dict[str, str], upto: int | None = None) -> Built:
    """`source`: tam nitelikli ham tablo. `tables`: model tablosu adı (küçük harf) → fiziksel tablo."""

    def describe(sql: str) -> list[tuple[str, str]]:
        return [(r[0], r[1]) for r in cur.execute(f"DESCRIBE {sql}").fetchall()]

    ctes = [("s0", f"SELECT * FROM {source}")]
    cols = _Cols(describe(_with(ctes, "s0")))
    for i, step in enumerate(steps[:upto] if upto is not None else steps):
        body = render(step, i, f"s{i}", cols, tables, describe)
        ctes.append((f"s{i + 1}", body))
        try:
            cols = _Cols(describe(_with(ctes, f"s{i + 1}")))
        except duckdb.Error as e:
            raise StepError(i, _friendly(e), str(e).split("\n")[0]) from e
    return Built(_with(ctes, ctes[-1][0]), cols.cols)


def dependencies(steps: list) -> set[str]:
    """Adımların başvurduğu diğer model tabloları (küçük harf)."""
    out: set[str] = set()
    for s in steps:
        if isinstance(s, S.SorguBirlestir):
            out.add(s.tablo.lower())
        elif isinstance(s, S.SorguEkle):
            out |= {t.lower() for t in s.tablolar}
    return out
