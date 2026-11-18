"""Ölçü dili genişletmeleri: SELECTEDVALUE, HASONEVALUE, ALLSELECTED, FILTER,
çok sütunlu filtreler, USERELATIONSHIP, tarih/metin fonksiyonları.

Sonuçlar derleyiciden bağımsız Python hesaplarıyla (oracle) karşılaştırılır.
"""

from __future__ import annotations

import datetime
from collections import defaultdict

import pytest

from floem_bi.compiler import CompileError, QueryRequest, SqlGenerator, ir
from floem_bi.model import SemanticModel

TOL = 1e-6


def q(model, engine, group, exprs, filters=(), dialect="duckdb"):
    """Ad hoc ölçüleri (DAX ifadesi) çalıştırır: {grup değerleri: (değerler...)}"""
    k = model.col_key
    gen = SqlGenerator(model, dialect)
    req = QueryRequest(
        group_by=[k(g) for g in group],
        measures=[],
        expressions=[(f"m{i}", e) for i, e in enumerate(exprs)],
        filters=[(k(c), ir.InList(ir.Col(k(c)), tuple(ir.Lit(v) for v in vals))) for c, vals in filters],
    )
    compiled = gen.compile(req)
    if dialect != "duckdb":
        return compiled.sql
    res = engine.execute(compiled)
    n = len(group)
    return {tuple(r[:n]): tuple(r[n:]) for r in res.rows}


def num(v):
    return None if v is None else float(v)


def sums(rows, key, where=lambda r: True, val=lambda r: float(r["tutar"])):
    out = defaultdict(float)
    for r in rows:
        if where(r):
            out[key(r)] += val(r)
    return dict(out)


def categories(facts):
    return sorted({r["kategori"] for r in facts if r["kategori"] is not None})


# ------------------------------------------------------------------ tek değer fonksiyonları
def test_selectedvalue_and_hasonevalue(model, engine, facts):
    res = q(model, engine, ["Urun[Kategori]"], [
        'SELECTEDVALUE(Urun[Kategori], "Çoklu")', "HASONEVALUE(Urun[Kategori])",
    ])
    for (cat,), (sel, one) in res.items():
        assert sel == cat and one is True
    # Gruplama yokken birden çok kategori görünür → alternatif değer / FALSE
    (total,) = q(model, engine, [], ['SELECTEDVALUE(Urun[Kategori], "Çoklu")', "HASONEVALUE(Urun[Kategori])"]).values()
    assert total == ("Çoklu", False)
    # Dilimleyiciyle tek kategori seçiliyse o kategori
    cat = categories(facts)[0]
    (one,) = q(model, engine, [], ["SELECTEDVALUE(Urun[Kategori])"], filters=[("Urun[Kategori]", [cat])]).values()
    assert one == (cat,)


# ------------------------------------------------------------------ ALLSELECTED
def test_allselected_keeps_outer_filters(model, engine, facts):
    c1, c2 = categories(facts)[:2]
    res = q(
        model, engine, ["Urun[Kategori]"],
        [
            "DIVIDE([Toplam Satış], CALCULATE([Toplam Satış], ALLSELECTED(Urun)))",
            "DIVIDE([Toplam Satış], CALCULATE([Toplam Satış], ALL(Urun)))",
        ],
        filters=[("Urun[Kategori]", [c1, c2])],
    )
    per_cat = sums(facts, lambda r: r["kategori"])
    selected_total = per_cat[c1] + per_cat[c2]
    all_total = sum(per_cat.values()) + sums(facts, lambda r: 1, where=lambda r: r["kategori"] is None).get(1, 0.0)
    assert set(res) == {(c1,), (c2,)}
    for (cat,), (share_sel, share_all) in res.items():
        assert num(share_sel) == pytest.approx(per_cat[cat] / selected_total, rel=TOL)   # seçili kategoriler içinde pay
        assert num(share_all) == pytest.approx(per_cat[cat] / all_total, rel=TOL)        # tüm kategoriler içinde pay
    assert sum(num(v[0]) for v in res.values()) == pytest.approx(1.0)


# ------------------------------------------------------------------ FILTER
def test_filter_multi_column_condition(model, engine, facts):
    res = q(model, engine, ["Urun[Kategori]"], [
        'CALCULATE([Toplam Satış], FILTER(Satis, Satis[Miktar] > 5 && Satis[BelgeTuru] = "Fatura"))',
    ])
    expected = sums(facts, lambda r: r["kategori"], where=lambda r: float(r["miktar"]) > 5 and r["tur"] == "Fatura")
    assert {k[0]: num(v[0]) for k, v in res.items() if v[0] is not None} == pytest.approx(expected, rel=TOL)


def test_boolean_filter_on_two_columns(model, engine, facts):
    res = q(model, engine, ["Tarih[Yil]"], ["CALCULATE([Toplam Satış], Satis[Miktar] > 5 && Satis[Tutar] < 1000)"])
    expected = sums(facts, lambda r: r["yil"], where=lambda r: float(r["miktar"]) > 5 and float(r["tutar"]) < 1000)
    assert {k[0]: num(v[0]) for k, v in res.items() if v[0] is not None} == pytest.approx(expected, rel=TOL)


def test_countrows_and_sumx_over_filter(model, engine, facts):
    res = q(model, engine, ["Urun[Kategori]"], [
        "COUNTROWS(FILTER(Satis, Satis[Tutar] > 1000))",
        "SUMX(FILTER(Satis, Satis[Miktar] > 10), Satis[Tutar])",
    ])
    counts = sums(facts, lambda r: r["kategori"], where=lambda r: float(r["tutar"]) > 1000, val=lambda r: 1.0)
    totals = sums(facts, lambda r: r["kategori"], where=lambda r: float(r["miktar"]) > 10)
    for (cat,), (n, s) in res.items():
        assert num(n) == pytest.approx(counts.get(cat)) if cat in counts else n is None
        assert num(s) == pytest.approx(totals.get(cat), rel=TOL) if cat in totals else s is None


def test_filter_all_column_replaces_group(model, engine, facts):
    c1 = categories(facts)[0]
    res = q(model, engine, ["Urun[Kategori]"], [
        f'CALCULATE([Toplam Satış], FILTER(ALL(Urun[Kategori]), Urun[Kategori] = "{c1}"))',
    ])
    target = sums(facts, lambda r: r["kategori"])[c1]
    assert res and all(num(v[0]) == pytest.approx(target, rel=TOL) for v in res.values())


def test_filter_with_related(model, engine, facts):
    res = q(model, engine, ["Tarih[Yil]"], [
        'CALCULATE([Toplam Satış], FILTER(Satis, RELATED(Musteri[Grup]) = "Bayi"))',
        "[Bayi Satışı]",
    ])
    for _, (a, b) in res.items():
        assert num(a) == pytest.approx(num(b), rel=TOL)


def test_filter_with_measure_is_explained(model, engine):
    with pytest.raises(CompileError, match="bağlam geçişi"):
        q(model, engine, [], ["CALCULATE([Toplam Satış], FILTER(Musteri, [Toplam Satış] > 1000))"])


# ------------------------------------------------------------------ USERELATIONSHIP
def test_userelationship_activates_inactive_relationship(model, engine, facts):
    tanim = model.tanim.model_copy(deep=True)
    for r in tanim.iliskiler:
        if r.kime == "Temsilci[TemsilciKodu]":
            r.aktif = False
    m2 = SemanticModel(tanim)
    res = q(m2, engine, ["Temsilci[TemsilciKodu]"], [
        "[Toplam Satış]",
        "CALCULATE([Toplam Satış], USERELATIONSHIP(Satis[TemsilciKodu], Temsilci[TemsilciKodu]))",
    ])
    grand = sum(float(r["tutar"]) for r in facts)
    per_rep = sums(facts, lambda r: r["slp"])
    for (slp,), (plain, used) in res.items():
        assert num(plain) == pytest.approx(grand, rel=TOL)          # pasif ilişki: temsilci filtresi ulaşmaz
        assert num(used) == pytest.approx(per_rep[slp], rel=TOL) if slp in per_rep else used is None
    with pytest.raises(CompileError, match="ilişki yok"):
        q(m2, engine, [], ["CALCULATE([Toplam Satış], USERELATIONSHIP(Satis[Tutar], Temsilci[TemsilciKodu]))"])


# ------------------------------------------------------------------ tarih ve metin fonksiyonları
def test_date_and_text_functions(model, engine, facts):
    (vals,) = q(model, engine, [], [
        "CALCULATE([Toplam Satış], Tarih[Tarih] >= DATE(2025, 1, 1))",
        "CALCULATE([Toplam Satış], LEN(Musteri[Sehir]) > 5)",
        'CALCULATE([Toplam Satış], LEFT(Urun[Kategori], 1) = "' + categories(facts)[0][0] + '")',
    ]).values()
    since = sum(float(r["tutar"]) for r in facts if r["tarih"] >= datetime.date(2025, 1, 1))
    long_city = sum(float(r["tutar"]) for r in facts if r["sehir"] and len(r["sehir"]) > 5)
    first = categories(facts)[0][0]
    by_letter = sum(float(r["tutar"]) for r in facts if r["kategori"] and r["kategori"].startswith(first))
    assert [num(v) for v in vals] == pytest.approx([since, long_city, by_letter], rel=TOL)


def test_new_functions_compile_to_tsql(model, engine):
    sql = q(model, engine, ["Urun[Kategori]"], [
        "CALCULATE([Toplam Satış], Tarih[Tarih] >= DATE(2025, 1, 1), LEN(Musteri[Sehir]) > 5)",
        'SELECTEDVALUE(Urun[Kategori], "Çoklu")',
    ], dialect="tsql")
    assert "DATEFROMPARTS" in sql.upper() and "LEN(" in sql.upper()


# ------------------------------------------------------------------ bağlam geçişi (satır bağlamında ölçü)
def monthly(facts):
    return sums(facts, lambda r: (r["yil"], r["ay"]))


def test_averagex_over_months(model, engine, facts):
    """Aylık ortalama satış: satış olmayan aylar (BLANK) ortalamaya girmez (DAX AVERAGEX)."""
    res = q(model, engine, ["Tarih[Yil]"], ["AVERAGEX(VALUES(Tarih[AyNo]), [Toplam Satış])"])
    per_month = monthly(facts)
    expected = {}
    for (y, _m), v in per_month.items():
        expected.setdefault(y, []).append(v)
    for (y,), (avg,) in res.items():
        assert num(avg) == pytest.approx(sum(expected[y]) / len(expected[y]), rel=TOL)
    assert {k[0] for k in res} == set(expected)


def test_maxx_countx_sumx_over_salespeople(model, engine, facts):
    res = q(model, engine, ["Urun[Kategori]"], [
        "MAXX(VALUES(Temsilci[TemsilciKodu]), [Toplam Satış])",
        "COUNTX(VALUES(Temsilci[TemsilciKodu]), [Toplam Satış])",
        "SUMX(Temsilci, [Toplam Satış] * 2)",            # tablo üzerinde: anahtar sütunla yinelenir
    ])
    per = sums(facts, lambda r: (r["kategori"], r["slp"]))
    for (cat,), (mx, cnt, dbl) in res.items():
        vals = [v for (c, _s), v in per.items() if c == cat]
        assert num(mx) == pytest.approx(max(vals), rel=TOL)
        assert num(cnt) == len(vals)
        assert num(dbl) == pytest.approx(2 * sum(vals), rel=TOL)


def test_row_column_inside_context_transition(model, engine, facts):
    res = q(model, engine, ["Tarih[Yil]"], ["SUMX(VALUES(Tarih[AyNo]), [Toplam Satış] * Tarih[AyNo])"])
    expected = defaultdict(float)
    for (y, m), v in monthly(facts).items():
        expected[y] += v * m
    assert {k[0]: num(v[0]) for k, v in res.items()} == pytest.approx(dict(expected), rel=TOL)


def test_context_transition_respects_calculate_and_slicer(model, engine, facts):
    """Dış CALCULATE filtresi ve dilimleyici iç hesaba da uygulanır."""
    res = q(model, engine, [], [
        'CALCULATE(AVERAGEX(VALUES(Tarih[AyNo]), [Toplam Satış]), Musteri[Grup] = "Bayi")',
    ], filters=[("Tarih[Yil]", [2024])])
    vals = list(sums(facts, lambda r: r["ay"], where=lambda r: r["grup"] == "Bayi" and r["yil"] == 2024).values())
    ((avg,),) = res.values()
    assert num(avg) == pytest.approx(sum(vals) / len(vals), rel=TOL)


def test_context_transition_errors_and_tsql(model, engine):
    with pytest.raises(CompileError, match="anahtar sütun"):
        q(model, engine, [], ["SUMX(Satis, [Toplam Satış])"])
    sql = q(model, engine, ["Tarih[Yil]"], ["AVERAGEX(VALUES(Tarih[AyNo]), [Toplam Satış])"], dialect="tsql")
    assert sql.upper().count("WITH") == 1                 # iç plan üst düzeye taşındı (T-SQL iç içe WITH almaz)
