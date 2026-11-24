import json
import sqlite3
from contextlib import closing
from zipfile import ZipFile

import pytest

from floem_bi.demo.belge_raporu import build
from floem_bi.demo.belge_sqlite import olustur
from floem_bi.document import Document
from floem_bi.document.print_forms import PrintLayout, PrintTemplate, read_form


def test_saved_form_uses_model_snapshot_and_independent_keys(tmp_path):
    source = tmp_path / "powerbi.sqlite"
    with closing(sqlite3.connect(source)) as db:
        db.executescript("""
            CREATE TABLE OINV(DocEntry INTEGER, CardCode TEXT);
            CREATE TABLE INV1(DocEntry INTEGER, LineNum INTEGER, ItemCode TEXT, WhsCode TEXT);
            WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<200)
            INSERT INTO OINV SELECT n,'C' FROM ids;
            INSERT INTO INV1 SELECT DocEntry,0,'A','W' FROM OINV;
            INSERT INTO INV1 VALUES (200,1,'A','W');
        """)
    snapshot = tmp_path / "demo.sqlite"
    olustur(source, snapshot)
    path = tmp_path / "Belge.floem"
    build(snapshot, path)
    snapshot.unlink()
    with ZipFile(path) as z:
        assert json.loads(z.read("manifest.json"))["format_version"] == 2
    with closing(Document.open(tmp_path, path)) as doc:
        assert [t.sampleKey for t in doc.content.print_templates] == ["200", "2"]
        assert read_form(doc, "invoice", None, "fat-0200")["items"] == [{"key": "200", "number": "FAT-0200"}]
        assert len(read_form(doc, "invoice", "200", "")["lines"]) == 2
        assert len(read_form(doc, "quote", "2", "")["lines"]) == 40
        assert read_form(doc, "invoice", None, "")["more"]
        with pytest.raises(ValueError, match="tek bir başlık"):
            read_form(doc, "invoice", "9999", "")
        doc.con.execute("INSERT INTO veri.INV1 SELECT * FROM veri.INV1 WHERE DocEntry=200 LIMIT 1")
        with pytest.raises(ValueError, match="benzersiz"):
            read_form(doc, "invoice", "200", "")
    old = tmp_path / "Normal.floem"
    with closing(Document.new(tmp_path)) as doc:
        doc.save(old)
    with ZipFile(old) as z:
        assert json.loads(z.read("manifest.json"))["format_version"] == 1
        assert "documentTemplates.json" not in z.namelist()


def test_custom_print_layout_round_trip(tmp_path):
    table = dict(id="items", type="table", band="beforeDetail", x=10, width=160,
                 header=True, repeatRow=1, rows=[{"cells": ["Ürün"]}, {"cells": ["{ItemCode}"], "color": "#dee8ee"}])
    line = dict(id="rule", type="line", band="header", x1=10, y1=1, x2=160, y2=3,
                color="#255964", thickness=.4, style="dashed")
    layout = PrintLayout(blocks=[line, table], guides=[10.5], stripe="#f4f6f6", hideMainDetail=True,
                         rule={"field": "LineTotal", "op": "gt", "value": 150, "color": "#ffeedc"})
    template = PrintTemplate(kind="invoice", title="Fatura", columns=["LineNum"], layout=layout)
    path = tmp_path / "custom.floem"
    with closing(Document.new(tmp_path)) as doc:
        doc.content.print_templates = [template]
        doc.save(path)
    with ZipFile(path) as archive:
        assert json.loads(archive.read("manifest.json"))["format_version"] == 3
    with closing(Document.open(tmp_path, path)) as doc:
        assert doc.content.print_templates == [template]
    for invalid in [dict(x=80), dict(rows=[{"cells": ["A", "B"]}, {"cells": ["A"]}]),
                    dict(repeatRow=2), dict(repeatRow=0), dict(columnFormat=[dict(align="left", weight=1)] * 2)]:
        with pytest.raises(ValueError):
            PrintLayout(blocks=[table | invalid])
    with pytest.raises(ValueError, match="benzersiz"):
        PrintLayout(blocks=[line, line])
