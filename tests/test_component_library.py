"""Sürümlü tasarım kitaplığı: kalıcılık, doğrulama ve dosya uyumu."""
from copy import deepcopy

import pytest
from pydantic import ValidationError

from floem_bi.desktop_service.component_library import ComponentStore
from floem_bi.report.schema import ComponentDefinition, Report, rename_measure_refs, rename_table_refs, rename_column_refs
from test_document import H, client  # noqa: F401
from test_server import floem_file, server  # noqa: F401


def definition():
    return {"id": "summary", "name": "Özet kartı", "description": "Türkçe açıklama", "version": 1, "rootId": "root",
            "visuals": [{"id": "root", "type": "container"}, {"id": "amount", "type": "card", "parentId": "root", "values": [{"measure": "Satış"}]}],
            "slots": [{"id": "metric", "label": "Değer", "kind": "value", "defaultBinding": {"measure": "Satış"}, "sites": [{"visualId": "amount", "path": ["values", "0"]}]}]}


def linked_report():
    d = definition()
    nodes = deepcopy(d["visuals"])
    nodes[0]["component"] = {"definitionId": d["id"], "version": 1, "nodeMap": {"root": "root", "amount": "amount"}, "bindings": {"metric": {"measure": "Sipariş"}}}
    nodes[1]["values"] = [{"measure": "Sipariş"}]
    return {"version": 1, "components": [d], "pages": [{"id": "p1", "name": "Kitaplık", "visuals": nodes}]}


def test_library_persistence_cas_and_immutable_versions(tmp_path):
    store = ComponentStore(tmp_path)
    assert store.load().revision == 0
    d = ComponentDefinition.model_validate(definition())
    assert store.save([d], 0).revision == 1
    assert ComponentStore(tmp_path).load().components == [d]
    with pytest.raises(FileExistsError):
        store.save([], 0)
    with pytest.raises(ValueError, match="değiştirilemez"):
        store.save([d.model_copy(update={"name": "Başka"})], 1)
    assert store.load().revision == 1
    d2 = d.model_copy(update={"name": "Yeni", "version": 2})
    assert store.save([d, d2], 1).revision == 2
    assert not store.path.with_suffix(".json.tmp").exists()


def test_library_api_authorization_and_conflict(client):
    assert client.get("/library/components").status_code == 401
    assert client.put("/library/components", json={"components": [], "revision": 0}).status_code == 401
    assert client.get("/library/components", headers=H).json()["components"] == []
    response = client.put("/library/components", headers=H, json={"components": [definition()], "revision": 0})
    assert response.status_code == 200, response.text
    assert response.json()["revision"] == 1
    assert client.put("/library/components", headers=H, json={"components": [], "revision": 0}).status_code == 409
    altered = definition(); altered["name"] = "Aynı sürümde değişiklik"
    assert client.put("/library/components", headers=H, json={"components": [altered], "revision": 1}).status_code == 400
    assert client.get("/library/components", headers=H).json()["components"][0]["name"] == "Özet kartı"


def test_component_file_roundtrip(client, tmp_path):
    r = linked_report()
    response = client.put("/document/report", headers=H, json=r)
    assert response.status_code == 200, response.text
    saved = client.post("/document/save", headers=H, json={"path": str(tmp_path / "bilesen")}).json()["path"]
    client.post("/document/new", headers=H)
    response = client.post("/document/open", headers=H, json={"path": saved})
    assert response.status_code == 200, response.text
    actual = response.json()["report"]
    assert actual["components"][0]["description"] == "Türkçe açıklama"
    assert actual["pages"][0]["visuals"][0]["component"]["bindings"]["metric"]["measure"] == "Sipariş"


@pytest.mark.parametrize("change", [
    lambda r: r["components"][0]["slots"][0]["sites"][0].update(path=["__proto__", "polluted"]),
    lambda r: r["components"][0]["slots"][0].update(kind="field"),
    lambda r: r["components"][0]["slots"][0].update(defaultBinding={"measure": "Satış", "column": "X"}),
    lambda r: r["pages"][0]["visuals"][0]["component"]["nodeMap"].update(amount="outside"),
    lambda r: r["pages"][0]["visuals"][0]["component"].update(bindings={}),
    lambda r: r["components"][0]["visuals"][0].update(parentId="amount"),
])
def test_component_rejects_invalid_paths_bindings_and_tree(change):
    r = linked_report()
    r["pages"][0]["visuals"].append({"id": "outside", "type": "text"})
    change(r)
    with pytest.raises(ValidationError):
        Report.model_validate(r)


def test_local_deleted_node_and_renames_keep_pinned_definition():
    r = linked_report(); baseline = deepcopy(r["components"])
    rename_measure_refs(r, "Sipariş", "Yeni ölçü")
    assert r["pages"][0]["visuals"][0]["component"]["bindings"]["metric"] == {"measure": "Yeni ölçü"}
    assert r["components"] == baseline
    ref = {"table": "T", "column": "N"}
    r["pages"][0]["visuals"][0]["component"]["bindings"]["metric"] = ref
    rename_table_refs(r, "T", "Veri"); rename_column_refs(r, "Veri", "N", "Tutar")
    assert ref == {"table": "Veri", "column": "Tutar"}
    r["pages"][0]["visuals"].pop()
    Report.model_validate(r)


def test_library_size_guard_preserves_old_file(tmp_path, monkeypatch):
    store = ComponentStore(tmp_path); before = store.save([], 0)
    import floem_bi.desktop_service.component_library as module
    monkeypatch.setattr(module, "MAX_BYTES", store.path.stat().st_size + 10)
    with pytest.raises(ValueError, match="10 MB"):
        store.save([ComponentDefinition.model_validate(definition())], before.revision)
    assert store.load() == before


def test_demo_shared_definition_four_uses_two_pages():
    from floem_bi.component_demo import library_report
    from floem_bi.layout_demo import workshop_page
    original = {"version": 1, "pages": [workshop_page()]}
    actual = library_report(original)
    assert len(actual["components"]) == 2
    assert len([v for p in actual["pages"] for v in p["visuals"] if v.get("component")]) == 4
    assert len(original["pages"]) == 1 and "components" not in original
    with pytest.raises(ValueError):
        library_report(actual)


def test_embedded_component_publishes_and_queries_without_personal_library(server, floem_file):
    from test_server import login, publish, YON
    definition = linked_report()
    definition["components"][0]["visuals"][1]["values"] = [{"table": "INV1", "column": "LineTotal", "agg": "sum"}]
    definition["components"][0]["slots"][0]["defaultBinding"] = {"table": "INV1", "column": "LineTotal", "agg": "sum"}
    definition["pages"][0]["visuals"][1]["values"] = [{"table": "INV1", "column": "LineTotal", "agg": "sum"}]
    definition["pages"][0]["visuals"][0]["component"]["bindings"]["metric"] = {"table": "INV1", "column": "LineTotal", "agg": "sum"}
    assert floem_file.put("/document/report", headers=H, json=definition).status_code == 200
    floem_file.post("/document/save", headers=H, json={"path": floem_file.path})
    h = login(server, YON)
    response = publish(server, h, floem_file.path)
    assert response.status_code == 200, response.text
    rid = response.json()["report_id"]
    opened = server.get(f"/api/reports/{rid}", headers=h).json()
    assert opened["definition"]["components"][0]["name"] == "Özet kartı"
    q = {"group": [], "values": [{"table": "INV1", "column": "LineTotal", "agg": "sum"}], "filters": []}
    response = server.post(f"/api/reports/{rid}/query", headers=h, json=q)
    assert response.status_code == 200, response.text
    assert float(response.json()["rows"][0][0]) == 272.75
