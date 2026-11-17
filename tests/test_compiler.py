"""Derleyicinin ürettiği SQL'in sonuçları, derleyiciden bağımsız Python
hesaplarıyla (oracle) karşılaştırılır."""

from collections import defaultdict

import pytest
import sqlglot

from floem_bi.compiler import CompileError, MeasureCompiler, QueryRequest, SqlGenerator, UserInfo, ir
from floem_bi.model import ModelTanimi, SemanticModel

TOL = 1e-6


def run(model, engine, group, measures, filters=(), user=None, roles=None):
    k = model.col_key
    gen = SqlGenerator(model, "duckdb", user=user, roles=roles)
    req = QueryRequest(
        group_by=[k(g) for g in group],
        measures=list(measures),
        filters=[(k(c), ir.InList(ir.Col(k(c)), tuple(ir.Lit(v) for v in vals))) for c, vals in filters],
    )
    res = engine.execute(gen.compile(req))
    n = len(group)
    return {tuple(r[:n]): tuple(None if v is None else float(v) for v in r[n:]) for r in res.rows}


def approx_dict(actual, expected):
    assert set(actual) == set(expected), (sorted(set(actual) ^ set(expected), key=str))[:10]
    for key, vals in expected.items():
        for a, e in zip(actual[key], vals):
            if e is None:
                assert a is None, (key, actual[key], vals)
            else:
                assert a == pytest.approx(e, rel=TOL), (key, actual[key], vals)


def sum_by(rows, keyfn, valfn=lambda r: float(r["tutar"]), where=lambda r: True):
    out = defaultdict(float)
    for r in rows:
        if where(r):
            out[keyfn(r)] += valfn(r)
    return dict(out)


# --------------------------------------------------------------- ana senaryo
def test_three_reference_measures(model, engine, facts):
    """Sentez §3.3: Yil × Kategori, slicer Grup = Bayi."""
    actual = run(
        model, engine,
        ["Tarih[Yil]", "Urun[Kategori]"],
        ["Toplam Satış", "Geçen Yıl Satış", "Kategori Payı"],
        filters=[("Musteri[Grup]", ["Bayi"])],
    )
    bayi = lambda r: r["grup"] == "Bayi"  # noqa: E731
    total = sum_by(facts, lambda r: (r["yil"], r["kategori"]), where=bayi)
    per_year = sum_by(facts, lambda r: r["yil"], where=bayi)
    calendar_years = range(2022, 2027)
    prev = {(y, c): v for (py, c), v in total.items() for y in [py + 1] if y in calendar_years}
    expected = {}
    for key in set(total) | set(prev):
        y, _ = key
        t = total.get(key)
        share = t / per_year[y] if t is not None else None
        expected[key] = (t, prev.get(key), share)
    approx_dict(actual, expected)
    # 2026'da veri yok ama geçen yıl değeri olduğu için satırlar görünür (DAX davranışı)
    assert any(y == 2026 for y, _ in actual)


def test_ytd_by_month(model, engine, facts):
    actual = run(model, engine, ["Tarih[Yil]", "Tarih[AyNo]"], ["Yılbaşından Bugüne Satış"])
    monthly = sum_by(facts, lambda r: (r["yil"], r["ay"]))
    expected = {}
    for y in {y for y, _ in monthly}:
        acc = 0.0
        for m in range(1, 13):
            acc += monthly.get((y, m), 0.0)
            expected[(y, m)] = (acc,)
    approx_dict(actual, expected)


def test_growth_measure_with_vars(model, engine, facts):
    actual = run(model, engine, ["Tarih[Yil]"], ["Yıllık Büyüme"])
    yearly = sum_by(facts, lambda r: r["yil"])
    expected = {}
    for y in range(2022, 2027):
        cur, prev = yearly.get(y), yearly.get(y - 1)
        if prev:
            expected[(y,)] = (((cur or 0.0) - prev) / prev,)
    approx_dict(actual, expected)


def test_calculate_replaces_grouping_filter(model, engine, facts):
    """CALCULATE(..., Musteri[Grup] = "Bayi") her grup satırında Bayi toplamını verir."""
    actual = run(model, engine, ["Musteri[Grup]"], ["Toplam Satış", "Bayi Satışı"])
    per_group = sum_by(facts, lambda r: r["grup"])
    bayi = per_group["Bayi"]
    approx_dict(actual, {(g,): (v, bayi) for g, v in per_group.items()})


def test_filter_does_not_flow_against_relationship(model, engine):
    """Musteri tablosu Urun'dan filtrelenmez (tek yönlü ilişki): her kategori 200 müşteri."""
    actual = run(model, engine, ["Urun[Kategori]"], ["Müşteri Sayısı"])
    assert len(actual) == 8
    assert all(v == (200.0,) for v in actual.values())


def test_distinctcount_with_filter_and_iterator(model, engine, facts):
    actual = run(model, engine, ["Tarih[Yil]"], ["Fatura Sayısı", "Ortalama Birim Fiyat"])
    docs = defaultdict(set)
    prices = defaultdict(list)
    for r in facts:
        if r["tur"] == "Fatura":
            docs[r["yil"]].add(r["belge"])
        if r["miktar"] != 0:
            prices[r["yil"]].append(float(r["tutar"]) / float(r["miktar"]))
    expected = {(y,): (len(docs[y]), sum(prices[y]) / len(prices[y])) for y in prices}
    approx_dict(actual, expected)


# ------------------------------------------------------------------- RLS
def test_rls_sales_rep_sees_only_own_rows(model, engine, facts):
    user = UserInfo(upn="temsilci03@floem.example")
    actual = run(model, engine, [], ["Toplam Satış", "Müşteri Sayısı"], user=user, roles=["Satış Temsilcisi"])
    own = sum(float(r["tutar"]) for r in facts if r["eposta"] == "temsilci03@floem.example")
    # Temsilci filtresi Musteri tablosuna yayılmaz (tek yön): müşteri sayısı değişmez
    approx_dict(actual, {(): (own, 200.0)})


def test_rls_user_attribute_and_cannot_be_removed_by_all(model, engine, facts):
    user = UserInfo(attributes={"sehirler": ["İstanbul", "Ankara"]})
    actual = run(model, engine, ["Urun[Kategori]"], ["Toplam Satış", "Kategori Payı"], user=user, roles=["Bölge Müdürü"])
    allowed = lambda r: r["sehir"] in ("İstanbul", "Ankara")  # noqa: E731
    per_cat = sum_by(facts, lambda r: r["kategori"], where=allowed)
    grand = sum(per_cat.values())  # ALL(Urun[Kategori]) RLS'i kaldırmaz
    approx_dict(actual, {(c,): (v, v / grand) for c, v in per_cat.items()})


def test_rls_missing_attribute_returns_nothing(model, engine):
    actual = run(model, engine, [], ["Toplam Satış"], user=UserInfo(), roles=["Bölge Müdürü"])
    assert actual == {}


# ------------------------------------------------------------------ T-SQL
def test_tsql_output_is_valid_tsql(model):
    k = model.col_key
    gen = SqlGenerator(model, "tsql")
    req = QueryRequest(
        group_by=[k("Tarih[Yil]"), k("Urun[Kategori]")],
        measures=["Toplam Satış", "Geçen Yıl Satış", "Kategori Payı"],
        filters=[(k("Musteri[Grup]"), ir.InList(ir.Col(k("Musteri[Grup]")), (ir.Lit("Bayi"),)))],
        limit=100,
    )
    sql = gen.compile(req).sql
    sqlglot.parse_one(sql, read="tsql")  # sözdizimi hatası varsa istisna fırlatır
    assert "[Toplam Satış]" in sql
    assert "TOP 100" in sql
    assert "USING" not in sql and "DOUBLE" not in sql


# ---------------------------------------------------------------- hatalar
def test_unsupported_function_is_reported_with_position(model):
    mc = MeasureCompiler(model)
    with pytest.raises(CompileError) as ei:
        mc.expression("CALCULATE([Toplam Satış], FILTER(Urun, Urun[Kategori] = \"A\"))", ir.Context())
    assert "FILTER" in str(ei.value) and "v1" in str(ei.value)
    assert ei.value.span is not None


def test_bare_column_in_measure_is_rejected(model):
    with pytest.raises(CompileError, match="satır bağlamı"):
        MeasureCompiler(model).expression("Satis[Tutar] + 1", ir.Context())


def test_cycle_detection():
    tanim = ModelTanimi.model_validate({
        "model": {"ad": "döngü"},
        "tablolar": [{
            "ad": "T", "kaynak": {"tablo": "t"},
            "sutunlar": [{"ad": "x", "tip": "int32"}],
            "olculer": [{"ad": "A", "ifade": "[B] + 1"}, {"ad": "B", "ifade": "[A] * 2"}],
        }],
    })
    errors = SemanticModel(tanim).validate()
    assert any("Döngüsel" in e for e in errors)


def test_example_model_is_valid(model):
    assert model.validate() == []
