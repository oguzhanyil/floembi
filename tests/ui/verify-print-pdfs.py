"""Baskı denemesinde indirilen PDF'lerin dört belgedeki bütün kalemlerini SQLite ile doğrular."""
import argparse
import re
import sqlite3
from contextlib import closing
from decimal import Decimal
from pathlib import Path

from pypdf import PdfReader
from pypdf.generic import ContentStream


def cents(text):
    return int(Decimal(text.replace(".", "").replace(",", ".")) * 100)


def verify(db, path):
    head, detail, key = ("OINV", "INV1", "DocEntry") if path.stem.startswith("FAT") else ("OQUT", "QUT1", "TeklifDocEntry")
    entry, total, tax = db.execute(f"SELECT {key}, round(100*DocTotal), round(100*VatSum) FROM {head} WHERE DocNum=?",
                                   (path.stem,)).fetchone()
    expected = db.execute(f"SELECT LineNum+1, ItemCode, round(100*LineTotal), WhsCode FROM {detail} WHERE {key}=? ORDER BY WhsCode,LineNum",
                          (entry,)).fetchall()
    groups = db.execute(f"SELECT WhsCode, round(100*sum(LineTotal)) FROM {detail} WHERE {key}=? GROUP BY WhsCode ORDER BY WhsCode",
                        (entry,)).fetchall()
    pdf = PdfReader(path)
    group = None
    actual, subtotals, totals, taxes = [], [], [], []
    for index, page in enumerate(pdf.pages, 1):
        assert abs(float(page.mediabox.width) - 595.28) < .01 and abs(float(page.mediabox.height) - 841.89) < .01
        text = page.extract_text()
        assert f"Sayfa {index} / {len(pdf.pages)}" in text and "Net tutar" in text
        for line in text.splitlines():
            if line.startswith("Depo · "):
                group = line.removeprefix("Depo · ")
            match = re.match(r"^(\d+) (U-\d+|—) .*? ([\d.,]+)$", line)
            if match:
                actual.append((int(match[1]), None if match[2] == "—" else match[2], cents(match[3]), group))
            if line.startswith("Grup ara toplamı"):
                subtotals.append((group, cents(line.split()[-2])))
            if line.startswith("Vergi toplamı"):
                taxes.append((index, cents(line.split()[-2])))
            if line.startswith("Genel toplam"):
                totals.append((index, cents(line.split()[-2])))
    assert actual == expected and subtotals == groups, path.name
    assert totals == [(len(pdf.pages), total)] and taxes == [(len(pdf.pages), tax)], path.name
    print(f"{path.stem}: {len(actual)} kalem, {len(groups)} grup, {len(pdf.pages)} A4 sayfa.")


def verify_custom(db, path):
    pdf = PdfReader(path)
    actual, totals, fills, dash = [], [], set(), []
    expected = db.execute("""SELECT LineNum+1, coalesce(ItemCode, ''), round(100*LineTotal)
        FROM INV1 JOIN OINV USING (DocEntry) WHERE DocNum='FAT-0200' ORDER BY LineNum""").fetchall()
    for i, page in enumerate(pdf.pages, 1):
        text = page.extract_text()
        assert f"Sayfa {i} / {len(pdf.pages)}" in text
        assert re.search(r"Kalem / Ürün\s+Açıklama\s+Miktar\s+Net tutar", text)
        for line in text.splitlines():
            item = re.match(r"^Kalem (\d+) ·\s*(U-\d+)?\s.*? ([\d.,]+)$", line)
            if item:
                actual.append((int(item[1]), item[2] or "", cents(item[3])))
            if line.startswith("Genel toplam"):
                totals.append((i, cents(line.split()[-2])))
        for args, op in ContentStream(page.get_contents(), pdf).operations:
            if op == b"scn" and len(args) == 3:
                fills.add(tuple(round(float(v) * 255) for v in args))
            if op == b"d" and args[0]:
                dash.append((i, list(map(float, args[0]))))
    assert actual == expected and len(actual) == 182
    assert totals == [(len(pdf.pages), 3306180)]
    assert {(197, 229, 227), (237, 244, 247), (215, 237, 218)} <= fills
    assert len(dash) == 1 and dash[0][0] == 1
    assert abs(dash[0][1][0] - 4 * .7 * 72 / 25.4) < .001
    print(f"{path.stem}: {len(actual)} özel kalem satırı, {len(pdf.pages)} A4 sayfa, satır renkleri ve kesikli çizgi doğrulandı.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sqlite", type=Path)
    parser.add_argument("pdf_dir", type=Path)
    args = parser.parse_args()
    with closing(sqlite3.connect(args.sqlite.resolve().as_uri() + "?mode=ro", uri=True)) as con:
        for number in ["FAT-0200", "TEK-0001", "TEK-0002", "TEK-0003"]:
            verify(con, args.pdf_dir / f"{number}.pdf")
        custom = args.pdf_dir / "FAT-0200-Tasarim.pdf"
        if custom.exists():
            verify_custom(con, custom)
