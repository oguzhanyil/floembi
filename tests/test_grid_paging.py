"""10.000 üstü gerçek DuckDB gruplarında arama, RLS, kararlı sayfa ve sürüm."""
import duckdb
import pytest
from pydantic import ValidationError

from floem_bi.engine.duckdb_engine import DuckDBEngine
from floem_bi.model import ModelTanimi, SemanticModel
from floem_bi.report.query import QueryError, VisualQuery, run_visual_query
from test_document import H
from test_server import server, floem_file  # noqa: F401


@pytest.fixture
def big():
    model = SemanticModel(ModelTanimi.model_validate({"model": {"ad": "Buyuk"}, "tablolar": [{
        "ad": "F", "kaynak": {"katman": "gold", "tablo": "facts"}, "sutunlar": [
            {"ad": "Id", "tip": "int64"}, {"ad": "Region", "tip": "string"}, {"ad": "Amount", "tip": "double"}],
        "olculer": [{"ad": "Ortalama", "ifade": "AVERAGE(F[Amount])"}]}],
        "roller": [{"ad": "East", "tablo_izinleri": [{"tablo": "F", "filtre": 'F[Region] = "East"'}]}]}))
    con = duckdb.connect(); con.execute("CREATE SCHEMA gold")
    con.execute("CREATE TABLE gold.facts AS SELECT i AS Id, CASE WHEN i%1000=0 THEN NULL WHEN i%2=0 THEN 'East' ELSE 'West' END AS Region, CAST(i%3+1 AS DOUBLE) AS Amount FROM range(12050) t(i)")
    con.execute("INSERT INTO gold.facts SELECT i, CASE WHEN i%1000=0 THEN NULL WHEN i%2=0 THEN 'East' ELSE 'West' END, 100.0 FROM range(100) t(i)")
    engine = DuckDBEngine(None, model, con=con)
    yield model, engine, con
    con.close()


def query(big, *, page=None, **patch):
    model, engine, _ = big
    q = VisualQuery.model_validate({"group": [{"table": "F", "column": "Id"}], "values": [{"measure": "Ortalama"}],
                                   "totals": True, "page": {"size": 100, **(page or {})}, **patch})
    return run_visual_query(model, engine, q, revision="dataset:1")


def test_beyond_10000_all_pages_stable_ties_and_weighted_total(big):
    first = query(big, order_by=[{"index": 1, "desc": True}])
    assert first["page"]["totalRows"] == 12050
    ids = []
    for offset in range(0, 12050, 1000):
        data = query(big, page={"size": 1000, "offset": offset, "revision": first["page"]["revision"], "snapshot": first["page"]["snapshot"]}, order_by=[{"index": 1, "desc": True}])
        ids.extend(r[0] for r in data["rows"])
    assert len(ids) == len(set(ids)) == 12050
    assert first["total"] == [pytest.approx(big[2].execute("SELECT avg(Amount) FROM gold.facts").fetchone()[0])]
    assert first["page"]["totalScope"] == "report_filters"


def test_search_runs_beyond_legacy_limit_and_totals_do_not_sum_page(big):
    data = query(big, page={"search": "12049"})
    assert data["page"]["totalRows"] == 1 and data["rows"][0][0] == 12049
    assert data["total"] == query(big)["total"]
    assert query(big, page={"search": "no match"})["rows"] == []


@pytest.mark.parametrize("search", ["' OR 1=1 --", "%", "_", "'; DROP TABLE gold.facts; --"])
def test_search_literal_and_parameter_bound(big, search):
    assert query(big, page={"search": search})["page"]["totalRows"] == 0
    assert big[2].execute("SELECT count(*) FROM gold.facts").fetchone()[0] == 12150


def test_numeric_column_filter_and_multi_order(big):
    data = query(big, page={"column_filters": [{"index": 0, "kind": "number", "op": "inRange", "value": 12000, "value2": 12049}]}, order_by=[{"index": 0, "desc": True}])
    assert data["page"]["totalRows"] == 50 and data["rows"][0][0] == 12049
    with pytest.raises(QueryError, match="Filtre sütunu"):
        query(big, page={"column_filters": [{"index": 99, "op": "contains", "value": "x"}]})


def test_tree_levels_parent_average_null_branch_and_rls(big):
    model, eng, _ = big
    def run(group, filters=[], roles=None, snapshot=None):
        return run_visual_query(model, eng, VisualQuery.model_validate({"group": [{"table": "F", "column": g} for g in group], "values": [{"measure": "Ortalama"}],
            "filters": filters, "page": {"size": 25, "snapshot": snapshot}, "totals": True}), revision="v1", roles=roles)
    root = run(["Region"])
    assert root["page"]["totalRows"] == 3
    branch = run(["Region", "Id"], [{"table": "F", "column": "Region", "op": "eq", "values": [None]}], snapshot=root["page"]["snapshot"])
    assert branch["page"]["totalRows"] == 13 and all(r[0] is None for r in branch["rows"])
    restricted = run(["Region"], roles=["East"])
    assert restricted["page"]["totalRows"] == 1 and restricted["rows"][0][0] == "East"
    with pytest.raises(QueryError, match="erişim kapsamı"):
        run(["Region", "Id"], roles=["East"], snapshot=root["page"]["snapshot"])


def test_stale_snapshot_and_changed_search_rejected(big):
    first = query(big)
    with pytest.raises(QueryError, match="kapsamı değişti"):
        query(big, page={"offset": 100, "search": "120", "revision": first["page"]["revision"]})
    model, eng, _ = big
    with pytest.raises(QueryError, match="kapsamı değişti"):
        run_visual_query(model, eng, VisualQuery(group=[{"table": "F", "column": "Id"}], page={"snapshot": first["page"]["snapshot"]}), revision="dataset:2")


@pytest.mark.parametrize("page", [{"size": 1001}, {"offset": -1}, {"search": "x"*501}, {"column_filters": [{"index": 0, "kind": "number", "op": "contains", "value": 3}]}, {"column_filters": [{"index": 0, "kind": "number", "op": "equals", "value": float("nan")}]}, {"sql": "SELECT 1"}])
def test_invalid_page_rejected(page):
    with pytest.raises(ValidationError): VisualQuery(page=page)


def test_desktop_web_publish_paging_and_snapshot_change(server, floem_file):
    from test_server import YON, login, publish
    body = {"group": [{"table": "OCRD", "column": "CardName"}], "values": [{"table": "INV1", "column": "LineTotal", "agg": "sum"}], "page": {"size": 1}, "totals": True}
    local = floem_file.post("/document/query", headers=H, json=body)
    assert local.status_code == 200, local.text
    assert local.json()["page"]["totalRows"] == 2
    headers = login(server, YON)
    rid = publish(server, headers, floem_file.path).json()["report_id"]
    path = f"/api/reports/{rid}/query"
    first = server.post(path, headers=headers, json=body).json()
    assert first["rows"] == local.json()["rows"]
    body["page"].update(offset=1, revision=first["page"]["revision"], snapshot=first["page"]["snapshot"])
    assert server.post(path, headers=headers, json=body).json()["rows"] != first["rows"]
    publish(server, headers, floem_file.path)
    stale = server.post(path, headers=headers, json=body)
    assert stale.status_code == 400 and "değişti" in stale.json()["error"]["detail"]
