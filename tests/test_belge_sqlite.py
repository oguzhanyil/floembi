import sqlite3
from contextlib import closing

import pytest

from floem_bi.demo.belge_sqlite import olustur


def test_fatura_yapisi_korunur_kaynak_degerleri_tasinmaz(tmp_path):
    kaynak = tmp_path / "kaynak.sqlite"
    cikti = tmp_path / "belgeler.sqlite"
    with closing(sqlite3.connect(kaynak)) as db:
        db.executescript("""
            CREATE TABLE OINV(DocEntry INTEGER PRIMARY KEY, CardCode TEXT, CardName TEXT);
            CREATE TABLE INV1(DocEntry INTEGER, LineNum INTEGER, ItemCode TEXT, WhsCode TEXT, LineTotal NUMERIC);
            INSERT INTO OINV VALUES (98127, 'KAYNAK-CARI', 'KAYNAK-UNVAN');
            INSERT INTO INV1 VALUES (98127, 2, NULL, NULL, 9876543.21),
                                    (98127, 0, 'KAYNAK-URUN', 'KAYNAK-DEPO', 9876543.21),
                                    (98127, 1, 'KAYNAK-URUN', 'KAYNAK-DEPO', 9876543.21);
        """)
    once = kaynak.read_bytes()
    olustur(kaynak, cikti)
    with pytest.raises(FileExistsError):
        olustur(kaynak, kaynak)
    assert kaynak.read_bytes() == once
    with closing(sqlite3.connect(cikti)) as db:
        dump = "\n".join(db.iterdump())
        assert all(deger not in dump for deger in ("KAYNAK-", "98127", "9876543.21"))
        assert db.execute("SELECT DocNum FROM OINV").fetchall() == [("FAT-0001",)]
        satirlar = db.execute("SELECT ItemCode, WhsCode FROM INV1 ORDER BY LineNum").fetchall()
        assert len(satirlar) == 3 and satirlar[0] == satirlar[1]
        assert all(satirlar[0]) and satirlar[2] == (None, None)
        assert db.execute("""
            SELECT h.DocNum, COUNT(*), h.DocTotal, ROUND(SUM(l.LineTotal+l.VatSum), 2)
            FROM OQUT h JOIN QUT1 l USING (TeklifDocEntry) GROUP BY h.TeklifDocEntry ORDER BY h.DocNum
        """).fetchall() == [
            ("TEK-0001", 1, 17.10, 17.10),
            ("TEK-0002", 40, 2886, 2886),
            ("TEK-0003", 200, 14766, 14766),
        ]
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
