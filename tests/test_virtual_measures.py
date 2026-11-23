"""Tablo değişkenleri, hücre bağlamı, eşit sıra ve güvenlik aynı gerçek sorgu yolunda."""

import duckdb
import pytest

from floem_bi.compiler import QueryRequest, SqlGenerator, ir
from floem_bi.model import ModelTanimi, SemanticModel


@pytest.fixture
def data():
    def table(name, cols, measures=()):
        return dict(
            ad=name,
            kaynak=dict(katman="main", tablo=name),
            sutunlar=[dict(ad=c, tip=t) for c, t in cols],
            olculer=[dict(ad=n, ifade=x) for n, x in measures],
        )

    model = SemanticModel(
        ModelTanimi.model_validate(
            dict(
                model=dict(ad="Test"),
                tablolar=[
                    table(
                        "Sales",
                        [
                            ("Firm", "string"),
                            ("Customer", "string"),
                            ("Day", "int64"),
                            ("Amount", "double"),
                        ],
                        [("Revenue", "SUM(Sales[Amount])")],
                    ),
                    table(
                        "Rates",
                        [("Firm", "string"), ("Day", "int64"), ("Rate", "double")],
                    ),
                    table("Mask", [("Firm", "string"), ("Day", "int64")]),
                ],
                roller=[
                    dict(
                        ad="A",
                        tablo_izinleri=[
                            dict(tablo=t, filtre='[Firm] = "A"')
                            for t in ("Sales", "Rates", "Mask")
                        ],
                    )
                ],
            )
        )
    )
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE Sales(Firm VARCHAR, Customer VARCHAR, Day INT, Amount DOUBLE)"
    )
    con.execute(
        "INSERT INTO Sales VALUES ('A','x',1,20),('A','y',1,20),('A','z',2,5),('B','z',1,1),('B','w',2,-2),('B',NULL,2,NULL)"
    )
    con.execute("CREATE TABLE Rates(Firm VARCHAR,Day INT,Rate DOUBLE)")
    con.execute("INSERT INTO Rates VALUES ('A',1,2),('A',2,5),('B',1,1),('B',2,2)")
    con.execute("CREATE TABLE Mask(Firm VARCHAR,Day INT)")
    con.execute("INSERT INTO Mask VALUES ('A',2),('B',1)")

    def run(expr, groups=(), filters=(), roles=(), extra=()):
        req = QueryRequest(
            [model.col_key(g) for g in groups],
            [],
            filters=[
                (model.col_key(k), ir.Bin("=", ir.Col(model.col_key(k)), ir.Lit(v)))
                for k, v in filters
            ],
            expressions=[("val", expr), *extra],
        )
        return con.execute(SqlGenerator(model, roles=roles).compile(req).sql).fetchall()

    yield run, con
    con.close()


def test_currency_grain_lookup_and_duplicate(data):
    run, con = data
    expr = "SUMX(SUMMARIZE(Sales,Sales[Firm],Sales[Day]),DIVIDE(CALCULATE([Revenue]),LOOKUPVALUE(Rates[Rate],Rates[Firm],Sales[Firm],Rates[Day],Sales[Day])))"
    assert run(expr) == [(21,)]
    assert dict(run(expr, ["Sales[Firm]"])) == {"A": 21, "B": 0}
    con.execute("INSERT INTO Rates VALUES ('A',1,2)")
    assert run(expr) == [(21,)]
    con.execute("INSERT INTO Rates VALUES ('A',1,3)")
    with pytest.raises(duckdb.Error):
        run(expr)


def test_treatas_respects_pairs_and_rls(data):
    run, _ = data
    expr = "VAR P=CALCULATETABLE(SUMMARIZE(Mask,Mask[Firm],Mask[Day])) RETURN CALCULATE([Revenue],TREATAS(P,Sales[Firm],Sales[Day]))"
    assert run(expr) == [(6,)]
    assert run(expr, roles=["A"]) == [(5,)]
    assert run("COUNTROWS(ALL(Sales[Customer]))", roles=["A"]) == [(3,)]
    assert run("COUNTROWS(VALUES(Sales[Customer]))") == [(5,)]


def test_rank_topn_and_allselected(data):
    run, _ = data
    expr = "RANKX(ALLSELECTED(Sales[Customer]), [Revenue], , DESC, DENSE)"
    assert dict(run(expr, ["Sales[Customer]"], [("Sales[Firm]", "A")])) == {
        "x": 1,
        "y": 1,
        "z": 2,
    }
    top = 'VAR T=ADDCOLUMNS(VALUES(Sales[Customer]),"@v",[Revenue]) RETURN SUMX(TOPN(1,T,[@v],DESC),[@v])'
    assert run(top) == [(40,)]
    assert run("ISINSCOPE(Sales[Customer])") == [(False,)]
    assert all(
        v is True for _, v in run("ISINSCOPE(Sales[Customer])", ["Sales[Customer]"])
    )
    assert run("ISFILTERED(Sales[Firm])", filters=[("Sales[Firm]", "A")]) == [(True,)]
    assert run('FORMAT(-0.125,"0.00%","tr-TR")') == [("-12,50%",)]


def test_row_projection_and_rebinding_outer_table_variable(data):
    run, _ = data
    expr = 'VAR T=SELECTCOLUMNS(Sales,"@a",Sales[Amount]) RETURN SUMX(FILTER(T,[@a]>0),VAR x=[@a] RETURN COUNTROWS(FILTER(T,[@a]>x)))'
    assert run(expr) == [(5,)]


def test_mixed_plans_keep_group_order_and_nulls(data):
    run, _ = data
    rows = run(
        "SUMX(TOPN(1,Sales,Sales[Amount],DESC),Sales[Amount])",
        ["Sales[Firm]"],
        extra=[("dated", "YEAR(DATE(2025,1,1))"), ("sales", "[Revenue]")],
    )
    assert rows == [("A", 40, 2025, 45), ("B", 1, 2025, -1)]


def test_cumulative_score_table_keeps_external_filters_and_ties(data):
    run, _ = data
    expr = (
        'VAR cur=[Revenue] VAR T=FILTER(ADDCOLUMNS(ALLSELECTED(Sales[Customer]),"@v",[Revenue]),[@v]>0) '
        "RETURN DIVIDE(SUMX(FILTER(T,[@v]>=cur),[@v]),SUMX(T,[@v]))"
    )
    result = dict(run(expr, ["Sales[Customer]"], roles=["A"]))
    assert result == {"x": pytest.approx(40 / 45), "y": pytest.approx(40 / 45), "z": 1}
    assert dict(run(expr, ["Sales[Customer]"], [("Sales[Customer]", "z")])) == {"z": 1}
