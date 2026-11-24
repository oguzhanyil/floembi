import json
import sqlite3
from contextlib import closing
from zipfile import ZipFile

import pytest

from floem_bi.demo.belge_raporu import build
from floem_bi.demo.belge_sqlite import olustur
from floem_bi.document import Document
from floem_bi.document.print_forms import read_form


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
