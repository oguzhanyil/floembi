"""TMDL alt kümesi, güvenli envanter ve kaynak/değer doğrulaması ayrımı."""
import json

import pytest

from floem_bi.semantic_import import analyze, read_tmdl, write_audit


def test_inventory_multiline_quotes_calculated_columns_and_no_query_leak(tmp_path):
    tables = tmp_path / "definition" / "tables"
    tables.mkdir(parents=True)
    (tables / "model.tmdl").write_text("""table 'Satış''lar'

    measure Tutar = SUM('Satış''lar'[Değer])
        formatString: #,0.00
    measure Oran =
            VAR Bir = [Tutar]
            RETURN DIVIDE(Bir, 2)
        displayFolder: Genel
    measure Engel = UNKNOWNFUNCTION([Tutar])
    measure Bağımlı = [Engel] + 1
    measure Metin = ```
            "gizli-ifade-metni"
            ```
    column Değer
        dataType: double
    column İki = [Değer] * 2
        dataType: double
    partition Veriler = m
        mode: import
        source =
                let secret = "kaynak-bağlantı-bilgisi"
                in secret
""", encoding="utf-8")
    source = read_tmdl(tmp_path)
    table = source.model.tablolar[0]
    assert table.ad == "Satış'lar"
    assert len(table.olculer) == 5 and len(table.sutunlar) == 2
    assert table.olculer[1].klasor == "Genel"
    assert table.olculer[1].ifade.endswith("RETURN DIVIDE(Bir, 2)")
    assert table.sutunlar[1].ifade == "[Değer] * 2"
    audit = analyze(source)
    states = {m['name']: m for m in audit['measures']}
    assert states['Tutar']['compiled'] and states['Oran']['compiled']
    assert not states['Engel']['compiled'] and not states['Bağımlı']['compiled']
    assert all(m['resultVerified'] is False for m in states.values())
    write_audit(audit, tmp_path / "audit")
    outputs = (tmp_path / 'audit.json').read_text(encoding='utf-8') + (tmp_path / 'audit.md').read_text(encoding='utf-8')
    assert 'gizli-ifade-metni' not in outputs and 'kaynak-bağlantı-bilgisi' not in outputs
    assert 'SUM(' not in outputs
    assert json.loads((tmp_path / 'audit.json').read_text(encoding='utf-8'))['dataImported'] is False


def test_relationship_support_is_explicit(tmp_path):
    tables = tmp_path / 'tables'
    tables.mkdir()
    for name in ['F', 'D']:
        (tables / f'{name}.tmdl').write_text(f"table {name}\n\tcolumn ID\n\t\tdataType: int64\n", encoding='utf-8')
    (tmp_path / 'relationships.tmdl').write_text("""relationship r1
    fromColumn: F.ID
    toColumn: D.ID
    crossFilteringBehavior: bothDirections
    isActive: false
    joinOnDateBehavior: datePartOnly
""", encoding='utf-8')
    source = read_tmdl(tmp_path)
    assert source.model.iliskiler == []
    assert source.relationships[0] == {'from': ['F', 'ID'], 'to': ['D', 'ID'],
                                      'active': False, 'bidirectional': True, 'supported': False, 'datePartOnly': True}


def test_unclosed_expression_stops_import(tmp_path):
    tables = tmp_path / 'tables'
    tables.mkdir()
    (tables / 'F.tmdl').write_text('table F\n\tmeasure M = ```\n\t\t\t1\n', encoding='utf-8')
    with pytest.raises(ValueError, match='kapanmamış'):
        read_tmdl(tmp_path)
