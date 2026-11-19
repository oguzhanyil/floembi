"""Ortak boyut filtreleri, çoklu olguda çoğalmama ve seçili dönem bakiyesi."""
import pytest
import sqlglot

from floem_bi.compiler import QueryRequest, SqlGenerator
from floem_bi.demo_port import TABLES, _report
from floem_bi.document.document import Document
from floem_bi.model.schema import Iliski, Rol, Sutun, Tablo, TabloIzni, TabloKaynak
from floem_bi.model.semantic import SemanticModel, find_ambiguity
from floem_bi.report.query import VisualQuery
from floem_bi.report.schema import Report
from floem_bi.semantic_demo import MEASURES, apply_semantic_model, validate_keys
from floem_bi.semantic_validation import verify_demo


@pytest.fixture
def demo(tmp_path):
    doc = Document.new(tmp_path, 'Sentetik F06')
    types = {'string': 'VARCHAR', 'int64': 'BIGINT', 'double': 'DOUBLE', 'date': 'DATE'}
    for name, (columns, _) in TABLES.items():
        definition = ', '.join(f'"{col}" {types[typ]}' for col, typ in columns)
        doc.con.execute(f'CREATE TABLE veri."{name}" ({definition})')
        doc.tanim.tablolar.append(Tablo(ad=name, kaynak=TabloKaynak(katman='veri', tablo=name),
                                       sutunlar=[Sutun(ad=c, tip=t) for c, t in columns]))
    doc.con.execute("INSERT INTO veri.Muhatap (MuhatapKod,Muhatap,Tur) VALUES ('C1','C1 · Aynı ad','Müşteri'),('C2','C2 · Aynı ad','Müşteri')")
    doc.con.execute("""INSERT INTO veri.Satis (Tarih, MuhatapKod, Muhatap, BelgeTuru, BelgeKimlik,
        KayitAnahtari,UrunKod,SatisElemaniKod,SatisElemani,NetSatis,BrutKar,AcikSiparis) VALUES
        ('2026-01-10','C1','C1 · Aynı ad','Fatura','invoice1','line1','P1',1,'Ali',100,20,0),
        ('2026-01-11','C1','C1 · Aynı ad','Fatura','invoice1','line2','P2',1,'Ali',50,10,0),
        ('2026-01-12','C2','C2 · Aynı ad','Fatura','invoice2','line3','P1',2,'Ali',200,40,0),
        ('2026-02-10','C1','C1 · Aynı ad','İade','return1','line4','P1',1,'Ali',-10,-2,0),
        ('2026-02-11','C1','C1 · Aynı ad','Sipariş','order1','line5','P1',1,'Ali',0,0,40)
    """)
    doc.con.execute("""INSERT INTO veri.Cari (Tarih,MuhatapKod,Muhatap,HesapKod,Borc,Alacak) VALUES
        ('2025-12-01','C1','C1 · Aynı ad','120',100,0),
        ('2026-01-10','C1','C1 · Aynı ad','120',50,0),
        ('2026-01-10','C2','C2 · Aynı ad','120',900,0),
        ('2026-02-10','C1','C1 · Aynı ad','120',0,20),
        ('2026-03-01','C1','C1 · Aynı ad','120',1000,0)
    """)
    doc.con.execute("""INSERT INTO veri.Finans (Tarih,HesapKod,Hesap,Borc,Alacak) VALUES
        ('2025-12-01','120','120 · Alıcılar',100,0),
        ('2026-02-10','120','120 · Alıcılar',0,20)
    """)
    report = _report()
    apply_semantic_model(doc, report)
    doc.set_report(report)
    yield doc
    doc.close()


def query(doc, measures, *, group=(), filters=()):
    return doc.query(VisualQuery.model_validate({'group': list(group), 'values': [{'measure': m} for m in measures],
                                                'filters': list(filters)}))['rows']


def test_shared_customer_period_and_no_fact_join_fanout(demo):
    metrics = ['Yerel net satış · satır', 'Cari dönem hareketi', 'Yerel açık satış siparişi']
    rows = query(demo, metrics, group=[{'table': 'MuhatapBoyut', 'column': 'MuhatapKod'}])
    actual = {r[0]: r[1:] for r in rows}
    assert actual['C1'] == [140, 1130, 40]
    assert actual['C2'] == [200, 900, 0]
    filters = [{'table': 'Tarih', 'column': 'Donem', 'values': ['2026-02']},
               {'table': 'MuhatapBoyut', 'column': 'MuhatapKod', 'values': ['C1']}]
    assert query(demo, metrics, filters=filters) == [[-10, -20, 40]]
    assert query(demo, ['Satış faturası adedi']) == [[2]]  # iki satırlı fatura bir kez
    assert query(demo, ['Yerel satır brüt kâr oranı']) == [[pytest.approx(0.2)]]
    assert query(demo, ['Yerel net satış · satır'], filters=[{'table': 'Urun', 'column': 'UrunKod', 'values': ['P2']}]) == [[50]]
    assert len(demo.tanim.tablolar) == 13
    assert all(item['orphanRows'] == 0 for item in validate_keys(demo))


def test_open_close_uses_history_and_preserves_customer_filter(demo):
    filters = [{'table': 'Tarih', 'column': 'Donem', 'values': ['2026-02']},
               {'table': 'MuhatapBoyut', 'column': 'MuhatapKod', 'values': ['C1']}]
    assert query(demo, ['Cari açılış bakiyesi', 'Cari dönem hareketi', 'Cari kapanış bakiyesi'], filters=filters) == [[150, -20, 130]]
    # Boş hareket dönemi: devir ve kapanış korunur; gelecek hareket taşınmaz.
    filters[0]['values'] = ['2026-04']
    result = query(demo, ['Cari açılış bakiyesi', 'Cari kapanış bakiyesi'], filters=filters)
    assert result == [[1130, 1130]]
    # Bakiye sütunları tarih satırlarında değişir, genel toplam son günün bakiyesidir.
    filters[0]['values'] = ['2026-01', '2026-02']
    rows = query(demo, ['Cari açılış bakiyesi', 'Cari kapanış bakiyesi'],
                 group=[{'table': 'Tarih', 'column': 'Donem'}], filters=filters)
    assert {r[0]: r[1:] for r in rows} == {'2026-01': [100, 150], '2026-02': [150, 130]}
    assert query(demo, ['Cari kapanış bakiyesi'], filters=filters) == [[130]]


def test_all_measures_execute_and_file_roundtrip(demo, tmp_path):
    for entries in MEASURES.values():
        for name, _, _ in entries:
            query(demo, [name])
    Report.model_validate(demo.content.report)
    assert len(demo.content.report['pages']) == 9
    path = tmp_path / 'semantic.floem'
    demo.save(path)
    with_doc = Document.open(tmp_path / 'reopened', path)
    try:
        assert query(with_doc, ['Yerel net satış · satır']) == [[340]]
        assert len(with_doc.tanim.iliskiler) == 27
    finally:
        with_doc.close()


def test_independent_reference_checks_and_visual_queries(demo):
    result = verify_demo(demo)
    assert result['measureQueries'] == 29
    assert result['numericComparisons'] == 42
    assert result['localChecksPassed'] and not result['powerBIParityVerified']


def test_bad_keys_block_save(demo):
    demo.con.execute("UPDATE veri.Satis SET MuhatapKey = 'olmayan-anahtar' WHERE KayitAnahtari = 'line1'")
    with pytest.raises(ValueError, match='bütünlüğü'):
        validate_keys(demo)


def test_frozen_date_boundary_preserves_rls_and_generates_both_dialects(demo):
    demo.tanim.roller = [Rol(ad='C1', tablo_izinleri=[TabloIzni(tablo='MuhatapBoyut', filtre='[MuhatapKod] = "C1"')])]
    demo.revision += 1
    q = VisualQuery.model_validate({'values': [{'measure': 'Cari kapanış bakiyesi'}],
                                   'filters': [{'table': 'Tarih', 'column': 'Donem', 'values': ['2026-02']}]})
    assert demo.query(q, view_as=['C1'])['rows'] == [[130]]
    model = SemanticModel(demo.tanim)
    request = QueryRequest(group_by=[model.col_key('Tarih[Donem]')], measures=['Cari açılış bakiyesi', 'Cari kapanış bakiyesi'])
    for dialect in ['duckdb', 'tsql']:
        compiled = SqlGenerator(model, dialect, roles=['C1']).compile(request)
        tree = sqlglot.parse_one(compiled.sql, read=dialect)
        assert len(list(tree.find_all(sqlglot.exp.With))) == 1  # T-SQL iç içe WITH kabul etmez
        assert 'C1' in compiled.sql


def test_dimension_duplicates_are_rejected(demo):
    demo.con.execute('INSERT INTO veri.Urun SELECT * FROM veri.Urun LIMIT 1')
    with pytest.raises(ValueError, match='tekillik'):
        validate_keys(demo)


def test_shared_dimensions_allowed_but_directed_diamond_and_cycle_rejected():
    def rel(a, b):
        return Iliski(kimden=f'{a}[ID]', kime=f'{b}[ID]')
    assert find_ambiguity([rel('F1', 'D1'), rel('F1', 'D2'), rel('F2', 'D1'), rel('F2', 'D2')]) is None
    diamond = [rel('A', 'B'), rel('A', 'C'), rel('B', 'D'), rel('C', 'D')]
    assert find_ambiguity(diamond) == diamond[-1]
    cycle = [rel('A', 'B'), rel('B', 'A')]
    assert find_ambiguity(cycle) == cycle[-1]
    assert find_ambiguity([rel('A', 'B'), rel('A', 'B')]) is not None
