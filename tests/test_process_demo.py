"""F12: bağımsız hesap, kayıt tanesi, firma yetkisi ve taşınabilir pilot verisi."""
import pytest

from floem_bi.document.document import Document
from floem_bi.model import ModelTanimi
from floem_bi.model.semantic import find_ambiguity
from floem_bi.process_demo import MEASURES, create_demo, process_model, process_report, seed_process_data
from floem_bi.report.query import QueryError, VisualQuery
from floem_bi.report.schema import Report


@pytest.fixture
def pilot(tmp_path):
    doc = Document.new(tmp_path, "Sentetik F12")
    doc.content.tanim = ModelTanimi.model_validate(process_model())
    seed_process_data(doc)
    doc.set_report(process_report())
    yield doc
    doc.close()


def field(table, column):
    return {"table": table, "column": column}


def filt(table, column, *values):
    return {**field(table, column), "values": list(values)}


def query(doc, measures=(), *, group=(), filters=(), role=None, **kwargs):
    q = VisualQuery.model_validate({"group": list(group), "values": [{"measure": m} for m in measures], "filters": list(filters), **kwargs})
    return doc.query(q, view_as=role)


def test_period_flows_and_asof_balances_match_independent_sql(pilot):
    scope = [filt("Firma", "Kod", "F1"), filt("Musteri", "Key", "F1:C001"), filt("Tarih", "Donem", "2026-02")]
    names = ["Dönem net satışı", "Dönem belge adedi", "Açılış bakiyesi", "Cari net hareket", "Dönem sonu bakiyesi", "Vadesi geçmiş net kalem", "Dönem tahsilatı", "Açık iş · dönem sonu", "Açık fırsat · dönem sonu"]
    assert query(pilot, names, filters=scope)["rows"] == [[180, 2, 250, 100, 350, 170, 80, 1, 500]]
    # Bağımsız SQL: aynı FDX derleyicisini referans olarak tekrar kullanmaz.
    expected = pilot.con.execute("""SELECT
        SUM(CASE WHEN b.Tarih < DATE '2026-02-01' THEN h.Borc-h.Alacak ELSE 0 END),
        SUM(CASE WHEN b.Tarih BETWEEN DATE '2026-02-01' AND DATE '2026-02-28' THEN h.Borc-h.Alacak ELSE 0 END),
        SUM(h.Borc-h.Alacak)
        FROM veri.Hareket h JOIN veri.Belge b ON b.Key=h.BelgeKey
        WHERE b.MusteriKey='F1:C001' AND b.Tarih <= DATE '2026-02-28'""").fetchone()
    assert query(pilot, names[2:5], filters=scope)["rows"][0] == list(expected)
    # Ocak açılan iş Şubat'ta da açıktır; kapanan iş stok göstergesinde sıfırdır.
    scope[1] = filt("Musteri", "Key", "F1:C002")
    assert query(pilot, ["Dönem net satışı", "Açık iş · dönem sonu", "Açık fırsat · dönem sonu"], filters=scope)["rows"] == [[360, 0, 0]]
    scope[1] = filt("Musteri", "Key", "F1:C006")
    assert query(pilot, ["Dönem net satışı", "Dönem sonu bakiyesi"], filters=scope)["rows"] == []


def test_same_codes_names_and_rls_do_not_merge_firms(pilot):
    scope = [filt("Musteri", "Kod", "C001"), filt("Tarih", "Donem", "2026-02")]
    rows = query(pilot, ["Dönem net satışı", "Dönem sonu bakiyesi"], group=[field("Musteri", "Key")], filters=scope)["rows"]
    assert {r[0]: r[1:] for r in rows} == {"F1:C001": [180, 350], "F2:C001": [1800, 3500]}
    assert query(pilot, ["Dönem sonu bakiyesi"], filters=scope, role=["Örnek Firma F1"])["rows"] == [[350]]
    assert find_ambiguity(pilot.tanim.iliskiler) is None
    # Aynı faturadaki iki satır iki belge sayılmaz.
    assert query(pilot, ["Dönem belge adedi"], filters=[filt("Musteri", "Key", "F1:C001"), filt("Tarih", "Donem", "2026-01")])["rows"] == [[1]]


def test_batch_grain_quality_and_mixed_units(pilot):
    scope = [filt("Firma", "Kod", "F1"), filt("Parti", "Key", "F1:U1"), filt("Tarih", "Donem", "2026-02")]
    assert query(pilot, ["Tekil parti miktarı", "Kalite kayıt adedi", "Sınır dışı kayıt", "Kararsız kayıt"], filters=scope)["rows"] == [[700, 4, 1, 1]]
    # Üç kenardaki 500 + 200 + 50 miktarını ana miktara eklemeyiz.
    assert pilot.con.execute("SELECT SUM(Miktar) FROM veri.Baglanti WHERE Kaynak='F1:U1' OR Hedef='F1:U1'").fetchone()[0] == 750
    assert query(pilot, ["Tekil parti miktarı"], filters=[filt("Firma", "Kod", "F1")])["rows"] == []
    assert query(pilot, ["Tekil parti miktarı"], filters=[filt("Firma", "Kod", "F1"), filt("Parti", "Birim", "kg")])["rows"] == [[4300]]
    assert pilot.con.execute("SELECT SinirDisi,Kararsiz FROM veri.Kalite WHERE Key='F1:U1:Q3'").fetchone() == (0, 0)


def test_neighborhood_query_snapshot_and_company_rls(pilot):
    groups = [field("Baglanti", c) for c in ["Kaynak", "Hedef", "KaynakAd", "HedefAd", "Birim", "Iliski"]]
    base = dict(group=groups, values=[{"table": "Baglanti", "column": "Miktar", "agg": "sum"}])
    scope = [filt("Tarih", "Donem", "2026-02")]
    root = query(pilot, group=[field("Parti", "Key")], filters=[filt("Parti", "Key", "F1:U1")], role=["Örnek Firma F1"], page={"offset": 0, "size": 2})
    snapshot = root["page"]["snapshot"]
    for column in ["Kaynak", "Hedef"]:
        q = VisualQuery.model_validate({**base, "filters": [*scope, filt("Baglanti", column, "F1:U1", "F2:U1")], "page": {"offset": 0, "size": 81, "snapshot": snapshot}})
        result = pilot.query(q, view_as=["Örnek Firma F1"])
        assert result["rows"] and all(str(r[0]).startswith("F1:") and str(r[1]).startswith("F1:") for r in result["rows"])
        assert result["page"]["snapshot"] == snapshot
    pilot.revision += 1
    with pytest.raises(QueryError, match="değişti"):
        pilot.query(q, view_as=["Örnek Firma F1"])


def test_key_only_lists_apply_related_filters_and_rls(pilot):
    # Ölçüsüz sorgu aynı veri kapsamını korur: kök seçimi ve düğüm anahtarları.
    scope = [filt("Firma", "Kod", "F1")]
    for table, column in [("Parti", "Key"), ("Musteri", "Key"), ("Baglanti", "Kaynak")]:
        for paging in [{}, {"page": {"offset": 0, "size": 100}}]:
            explicit = query(pilot, group=[field(table, column)], filters=scope, **paging)["rows"]
            secured = query(pilot, group=[field(table, column)], role=["Örnek Firma F1"], **paging)["rows"]
            assert explicit == secured and explicit
            assert all(str(row[0]).startswith("F1:") for row in secured)
    assert query(pilot, group=[field("Parti", "Key")], filters=[filt("Parti", "Key", "F2:U1")], role=["Örnek Firma F1"])["rows"] == []
    assert query(pilot, group=[field("Belge", "Key")], filters=[*scope, filt("Tarih", "Donem", "2026-02")])["rows"]
    keys = query(pilot, group=[field("Belge", "Key")], filters=[*scope, filt("Tarih", "Donem", "2026-02")])["rows"]
    assert all(not any(code in key[0] for code in ["DEVIR", "FAT-01", "GELECEK"]) for key in keys)


def test_every_measure_and_configured_query_executes(pilot):
    for entries in MEASURES.values():
        for name, _, _ in entries:
            query(pilot, [name])
    for page in process_report()["pages"]:
        for v in page["visuals"]:
            if v["type"] not in {"table", "card", "slicer", "tolerance"}:
                continue
            q = {"group": v["group"], "values": v["values"], "filters": v["filters"]}
            if v["type"] == "table":
                q["page"] = {"offset": 0, "size": 25}
            pilot.query(VisualQuery.model_validate(q))


def test_file_roundtrip_layouts_and_no_overwrite(tmp_path):
    report = Report.model_validate(process_report())
    assert len(report.pages) == 6
    assert all(p.layouts[0].width == 390 for p in report.pages)
    target = tmp_path / "Pilot.floem"
    create_demo(target)
    original = target.read_bytes()
    with pytest.raises(ValueError, match="yeni"):
        create_demo(target)
    assert target.read_bytes() == original
    doc = Document.open(tmp_path / "opened", target)
    try:
        assert len(doc.content.report["pages"]) == 6 and len(doc.tanim.tablolar) == 12
        assert not doc.tanim.veri_kaynaklari
        assert doc.con.execute("SELECT COUNT(*) FROM veri.Musteri").fetchone()[0] == 12
        assert doc.con.execute("SELECT COUNT(*) FROM veri.Kalite").fetchone()[0] == 64
        assert query(doc, ["Parti adedi"])["rows"] == [[16]]
    finally:
        doc.close()


def test_publish_roundtrip_and_web_role_applies_to_every_graph_query(tmp_path):
    from fastapi.testclient import TestClient
    from floem_bi.server import ServerSettings, create_server, db
    from test_server import IZL, YON, login, publish

    target = tmp_path / "WebPilot.floem"
    create_demo(target)
    with TestClient(create_server(ServerSettings(data_dir=tmp_path / "server", secret="s" * 48))) as server:
        admin = login(server, YON)
        published = publish(server, admin, target)
        assert published.status_code == 200, published.text
        rid, dsid = published.json()["report_id"], published.json()["dataset_id"]
        definition = server.get(f"/api/reports/{rid}", headers=admin).json()["definition"]
        assert len(definition["pages"]) == 6
        assert definition["pages"][4]["visuals"][-3]["type"] == "lineage"
        with server.app.state.db.begin() as c:
            c.execute(db.shares.insert().values(report_id=rid, user_id=2, shared_by=1))
        reader = login(server, IZL)
        assert server.post(f"/api/reports/{rid}/query", headers=reader, json={"values": []}).status_code == 403
        assigned = server.post(f"/api/datasets/{dsid}/security/members", headers=admin, json={"role": "Örnek Firma F1", "email": IZL[0]})
        assert assigned.status_code == 200
        response = server.post(f"/api/reports/{rid}/query", headers=reader, json={"values": [{"measure": "Dönem sonu bakiyesi"}], "filters": [filt("Musteri", "Kod", "C001"), filt("Tarih", "Donem", "2026-02")]})
        assert response.status_code == 200 and response.json()["rows"] == [[350]]
        for column in ["Kaynak", "Hedef"]:
            response = server.post(f"/api/reports/{rid}/query", headers=reader, json={"group": [field("Baglanti", "Kaynak"), field("Baglanti", "Hedef")], "values": [], "filters": [filt("Baglanti", column, "F1:U1", "F2:U1")], "page": {"offset": 0, "size": 81}})
            assert response.status_code == 200, response.text
            assert response.json()["rows"] and all(r[0].startswith("F1:") and r[1].startswith("F1:") for r in response.json()["rows"])
