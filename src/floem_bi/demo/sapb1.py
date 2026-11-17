"""Sentetik SAP Business One verisi ve Gold katmanı (yalnızca demo/test için).

Gerçek warehouse modülünün yerini tutmaz; MVP'nin semantik çekirdeğini
uçtan uca test edebilmek için SAP B1 tablo yapısında, tekrarlanabilir
(sabit tohumlu) veri üretir.

Kullanım:  python -m floem_bi.demo.sapb1 data/demo.duckdb
"""

from __future__ import annotations

import csv
import random
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

import duckdb

AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos",
         "Eylül", "Ekim", "Kasım", "Aralık"]
SEHIRLER = ["İstanbul", "Ankara", "İzmir", "Bursa", "Antalya", "Konya", "Kocaeli", "Adana"]
GRUPLAR = [(100, "Bayi"), (101, "Perakende"), (102, "Kurumsal")]
KATEGORILER = ["Kağıt", "Kırtasiye", "Ambalaj", "Temizlik", "Ofis Mobilyası", "Elektronik", "Gıda", "Matbaa"]
MARKALAR = ["Atlas", "Defne", "Karya", "Lidya", "Mira", "Nova", "Pera", "Truva"]

VERI_BASLANGIC = date(2023, 1, 1)
VERI_BITIS = date(2025, 12, 31)
TAKVIM_BASLANGIC = date(2022, 1, 1)
TAKVIM_BITIS = date(2026, 12, 31)


def _write_csv(path: Path, header: list[str], rows: list[tuple]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def generate(db_path: str | Path, seed: int = 42, invoices_per_day: int = 12) -> Path:
    rnd = random.Random(seed)
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()

    ocrg = [(code, name) for code, name in GRUPLAR]
    ocrd = []
    for i in range(1, 201):
        grp = rnd.choices(GRUPLAR, weights=[3, 5, 2])[0][0]
        ocrd.append((f"C{i:04d}", f"Müşteri {i:03d}", "C", grp, rnd.choice(SEHIRLER)))
    oitb = [(100 + i, name) for i, name in enumerate(KATEGORILER)]
    oitm = []
    for i in range(1, 301):
        grp = rnd.choice(oitb)[0]
        oitm.append((f"U{i:05d}", f"Ürün {i:03d}", grp, rnd.choice(MARKALAR), round(rnd.uniform(5, 900), 2)))
    oslp = [(i, f"Temsilci {i:02d}", f"temsilci{i:02d}@floem.example") for i in range(1, 11)]
    oslp.append((-1, "-Satış Temsilcisi Yok-", None))

    oinv, inv1, orin, rin1 = [], [], [], []
    doc = 1
    cdoc = 1
    d = VERI_BASLANGIC
    while d <= VERI_BITIS:
        season = 1.0 + 0.25 * (d.month in (11, 12)) + 0.05 * (d.year - 2023)
        for _ in range(max(1, int(rnd.gauss(invoices_per_day * season, 3)))):
            card = rnd.choice(ocrd)
            slp = rnd.choice(oslp[:-1]) if rnd.random() > 0.05 else oslp[-1]
            canceled = "Y" if rnd.random() < 0.01 else "N"
            oinv.append((doc, d.isoformat(), card[0], slp[0], canceled))
            first_line = None
            for line in range(rnd.randint(1, 5)):
                item = rnd.choice(oitm)
                qty = rnd.randint(1, 40)
                price = round(item[4] * rnd.uniform(0.9, 1.1), 2)
                inv1.append((doc, line, item[0], qty, price, round(qty * price, 2)))
                first_line = first_line or inv1[-1]
            # %3 olasılıkla iade (alacak dekontu)
            if rnd.random() < 0.03:
                rdate = min(d + timedelta(days=rnd.randint(1, 20)), VERI_BITIS)
                orin.append((cdoc, rdate.isoformat(), card[0], slp[0], "N"))
                src = first_line
                rq = max(1, src[3] // 2)
                rin1.append((cdoc, 0, src[2], rq, src[4], round(rq * src[4], 2)))
                cdoc += 1
            doc += 1
        d += timedelta(days=1)

    con = duckdb.connect(str(db_path))
    con.execute("CREATE SCHEMA sapb1; CREATE SCHEMA gold;")
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        tables = {
            "OCRG": (["GroupCode", "GroupName"], ocrg),
            "OCRD": (["CardCode", "CardName", "CardType", "GroupCode", "City"], ocrd),
            "OITB": (["ItmsGrpCod", "ItmsGrpNam"], oitb),
            "OITM": (["ItemCode", "ItemName", "ItmsGrpCod", "FirmName", "AvgPrice"], oitm),
            "OSLP": (["SlpCode", "SlpName", "Email"], oslp),
            "OINV": (["DocEntry", "DocDate", "CardCode", "SlpCode", "CANCELED"], oinv),
            "INV1": (["DocEntry", "LineNum", "ItemCode", "Quantity", "Price", "LineTotal"], inv1),
            "ORIN": (["DocEntry", "DocDate", "CardCode", "SlpCode", "CANCELED"], orin),
            "RIN1": (["DocEntry", "LineNum", "ItemCode", "Quantity", "Price", "LineTotal"], rin1),
        }
        for name, (header, rows) in tables.items():
            p = t / f"{name}.csv"
            _write_csv(p, header, rows)
            con.execute(f"CREATE TABLE sapb1.{name} AS SELECT * FROM read_csv('{p.as_posix()}', header=true)")

    # --- Gold katmanı (yıldız şema) ---------------------------------------
    con.execute("""
        CREATE TABLE gold.fact_satis AS
        SELECT h.DocEntry, l.LineNum, 'Fatura' AS DocType, CAST(h.DocDate AS DATE) AS DocDate,
               h.CardCode, l.ItemCode, h.SlpCode,
               CAST(l.Quantity AS DECIMAL(19,6)) AS Quantity, CAST(l.LineTotal AS DECIMAL(19,6)) AS LineTotal
        FROM sapb1.OINV h JOIN sapb1.INV1 l ON l.DocEntry = h.DocEntry
        WHERE h.CANCELED = 'N'
        UNION ALL
        SELECT -h.DocEntry, l.LineNum, 'İade', CAST(h.DocDate AS DATE),
               h.CardCode, l.ItemCode, h.SlpCode,
               -CAST(l.Quantity AS DECIMAL(19,6)), -CAST(l.LineTotal AS DECIMAL(19,6))
        FROM sapb1.ORIN h JOIN sapb1.RIN1 l ON l.DocEntry = h.DocEntry
        WHERE h.CANCELED = 'N'
    """)
    con.execute("""
        CREATE TABLE gold.dim_musteri AS
        SELECT c.CardCode, c.CardName, g.GroupName, c.City
        FROM sapb1.OCRD c LEFT JOIN sapb1.OCRG g ON g.GroupCode = c.GroupCode
    """)
    con.execute("""
        CREATE TABLE gold.dim_urun AS
        SELECT i.ItemCode, i.ItemName, b.ItmsGrpNam, i.FirmName
        FROM sapb1.OITM i LEFT JOIN sapb1.OITB b ON b.ItmsGrpCod = i.ItmsGrpCod
    """)
    con.execute("CREATE TABLE gold.dim_temsilci AS SELECT SlpCode, SlpName, Email FROM sapb1.OSLP")
    ay_case = " ".join(f"WHEN {i + 1} THEN '{a}'" for i, a in enumerate(AYLAR))
    con.execute(f"""
        CREATE TABLE gold.dim_tarih AS
        SELECT CAST(d AS DATE) AS Tarih,
               year(d) AS Yil,
               'Ç' || quarter(d) AS Ceyrek,
               month(d) AS AyNo,
               CASE month(d) {ay_case} END AS Ay
        FROM range(DATE '{TAKVIM_BASLANGIC}', DATE '{TAKVIM_BITIS}' + INTERVAL 1 DAY, INTERVAL 1 DAY) r(d)
    """)
    con.close()
    return db_path


if __name__ == "__main__":
    out = generate(sys.argv[1] if len(sys.argv) > 1 else "data/demo.duckdb")
    print(f"Demo veritabanı oluşturuldu: {out}")
