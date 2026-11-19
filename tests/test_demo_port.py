"""Demo ölçüleri: kapalı/kısmi sipariş, iade, aynı adlı muhatap ve kimlikler."""
import duckdb
import pytest
import sqlglot

from floem_bi.demo_port import TABLES, _report


@pytest.fixture
def source():
    con = duckdb.connect()
    con.execute("CREATE SCHEMA dbo")
    con.execute("CREATE TABLE dbo.OCRD(CardCode VARCHAR, CardName VARCHAR, CardType VARCHAR, Balance DOUBLE)")
    con.execute("INSERT INTO dbo.OCRD VALUES ('C1','Aynı ad','C',120),('C2','Aynı ad','C',-20),('S1','Tedarikçi','S',-80)")
    con.execute("CREATE TABLE dbo.OSLP(SlpCode INT, SlpName VARCHAR)")
    for head, line in [('OINV', 'INV1'), ('ORIN', 'RIN1'), ('ORDR', 'RDR1'), ('OPCH', 'PCH1'), ('OPOR', 'POR1')]:
        con.execute(f"CREATE TABLE dbo.{head}(DocEntry INT, DocNum INT, DocDate DATE, CardCode VARCHAR, SlpCode INT, CANCELED VARCHAR, DocStatus VARCHAR)")
        con.execute(f"CREATE TABLE dbo.{line}(DocEntry INT, LineNum INT, UomCode VARCHAR, LineTotal DOUBLE, GrssProfit DOUBLE, Quantity DOUBLE, OpenQty DOUBLE, LineStatus VARCHAR)")
    yield con
    con.close()


def add(con, head, line, entry, *, status='O', line_status='O', qty=10, remaining=4, canceled='N', card='C1', unit='KG'):
    con.execute(f"INSERT INTO dbo.{head} VALUES (?, 7, '2026-01-10', ?, 0, ?, ?)", [entry, card, canceled, status])
    con.execute(f"INSERT INTO dbo.{line} VALUES (?, 0, ?, 100, 20, ?, ?, ?)", [entry, unit, qty, remaining, line_status])


def rows(con, table):
    query = sqlglot.transpile(TABLES[table][1], read='tsql', write='duckdb')[0]
    result = con.execute(query)
    return [dict(zip([c[0] for c in result.description], row)) for row in result.fetchall()]


def test_sales_open_orders_returns_and_unique_identity(source):
    add(source, 'OINV', 'INV1', 1)
    add(source, 'OINV', 'INV1', 2, card='C2', unit='ADET')  # aynı ad ve belge no, farklı kayıt
    add(source, 'ORIN', 'RIN1', 1)
    add(source, 'ORDR', 'RDR1', 1)  # kısmi açık: 4/10 * 100
    add(source, 'ORDR', 'RDR1', 2, status='C')
    add(source, 'ORDR', 'RDR1', 3, line_status='C')
    add(source, 'ORDR', 'RDR1', 4, canceled='Y')
    data = rows(source, 'Satis')
    assert len(data) == 6
    assert len({r['KayitAnahtari'] for r in data}) == 6
    assert len({r['Muhatap'] for r in data}) == 2
    assert sum(r['AcikSiparis'] for r in data) == pytest.approx(40)
    assert sum(r['NetSatis'] for r in data) == pytest.approx(100)
    assert sum(r['NetFaturaMiktar'] for r in data) == pytest.approx(10)
    assert sum(r['SiparisMiktar'] for r in data) == pytest.approx(30)
    assert {r['Birim'] for r in data} == {'KG', 'ADET'}
    assert all('Miktar' not in r for r in data)  # fatura + sipariş karışık toplamı yok


def test_purchase_scope_and_unknown_open_value(source):
    add(source, 'OPCH', 'PCH1', 1)
    add(source, 'OPOR', 'POR1', 1)
    add(source, 'OPOR', 'POR1', 2, status='C')
    add(source, 'OPOR', 'POR1', 3, qty=0)
    data = rows(source, 'Satinalma')
    assert sum(r['FaturaTutar'] for r in data) == 100
    assert sum(r['AcikSiparisTutar'] or 0 for r in data) == 40
    assert next(r for r in data if r['BelgeKimlik'].endswith(':3'))['AcikSiparisTutar'] is None


def test_receivables_and_payables_are_not_netted(source):
    data = rows(source, 'Muhatap')
    assert sum(r['MusteriAlacak'] for r in data) == 120
    assert sum(r['TedarikciBorc'] for r in data) == 80


def test_report_never_totals_running_balances_or_mixed_units():
    report = _report()
    visuals = {v['id']: v for p in report['pages'] for v in p['visuals']}
    for page in ['cari', 'satis', 'satinalma', 'muhatap']:
        assert visuals[f'{page}-details']['format']['showTotals'] is False
    balance = visuals['cari-details']['values'][-1]
    assert balance['column'] == 'YuruyenBakiye' and balance['agg'] == 'max'
    for v in visuals.values():
        for ref in v['group'] + v['values']:
            if 'column' in ref:
                assert ref['column'] in dict(TABLES[ref['table']][0])
        if v['type'] == 'card':
            assert all(not ref.get('column', '').endswith('Miktar') for ref in v['values'])
