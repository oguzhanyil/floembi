"""Power BI demosunun fatura yapısından Belge Tasarımcısı için yerel SQLite üretir."""

from __future__ import annotations

import argparse
import sqlite3
from collections.abc import Iterable
from contextlib import closing
from datetime import date, timedelta
from itertools import groupby
from operator import itemgetter
from pathlib import Path


# Kaynaktan yalnız sıra numaraları çıkar. Serbest metin, kod, tarih ve tutar taşınmaz.
FATURA_YAPISI = """
    SELECT dense_rank() OVER (ORDER BY h.DocEntry) AS belge,
           dense_rank() OVER (ORDER BY h.CardCode) AS musteri,
           CASE WHEN l.ItemCode IS NOT NULL THEN dense_rank() OVER (ORDER BY l.ItemCode) END,
           CASE WHEN l.WhsCode IS NOT NULL THEN dense_rank() OVER (ORDER BY l.WhsCode) END
    FROM OINV h JOIN INV1 l ON h.DocEntry = l.DocEntry
    ORDER BY h.DocEntry, l.LineNum
"""


def tablolari_olustur(db: sqlite3.Connection, baslik: str, detay: str, anahtar: str) -> None:
    db.execute(f"""CREATE TABLE {baslik} (
        {anahtar} INTEGER PRIMARY KEY, DocNum TEXT NOT NULL UNIQUE,
        DocDate TEXT NOT NULL, DocDueDate TEXT NOT NULL, CardCode TEXT NOT NULL,
        CardName TEXT NOT NULL, Address TEXT NOT NULL, DocCur TEXT NOT NULL,
        VatSum NUMERIC NOT NULL, DocTotal NUMERIC NOT NULL, Comments TEXT
    )""")
    db.execute(f"""CREATE TABLE {detay} (
        {anahtar} INTEGER NOT NULL REFERENCES {baslik}({anahtar}), LineNum INTEGER NOT NULL,
        ItemCode TEXT, Dscription TEXT NOT NULL, WhsCode TEXT, Quantity INTEGER NOT NULL,
        Price NUMERIC NOT NULL, LineTotal NUMERIC NOT NULL, VatSum NUMERIC NOT NULL,
        PRIMARY KEY ({anahtar}, LineNum)
    )""")


def belge_ekle(db: sqlite3.Connection, baslik: str, detay: str, numara: int, musteri: int,
               kalemler: Iterable[tuple[int | None, int | None]]) -> None:
    teklif = baslik == "OQUT"
    on_ek = "TEK" if teklif else "FAT"
    tarih = date(2026, 1, 1) + timedelta(days=(numara - 1) % 300)
    net_toplam = vergi_toplami = 0
    satirlar = []
    for sira, (urun, depo) in enumerate(kalemler):
        miktar = 1 + sira % 4
        fiyat_kurus = 1250 + 175 * ((urun or 0) % 90)
        net = miktar * fiyat_kurus
        vergi = (net * 20 + 50) // 100
        net_toplam += net
        vergi_toplami += vergi
        satirlar.append((
            numara, sira, f"U-{urun:04}" if urun else None,
            f"Örnek ürün {urun:04}" if urun else "Örnek hizmet",
            f"Depo {depo}" if depo else None, miktar, fiyat_kurus / 100, net / 100, vergi / 100,
        ))

    db.execute(f"INSERT INTO {baslik} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (
        numara, f"{on_ek}-{numara:04}", tarih.isoformat(), (tarih + timedelta(days=30)).isoformat(),
        f"M-{musteri:04}", f"Örnek müşteri {musteri:04}", "Örnek Mahallesi, Tasarım Caddesi No. 1",
        "TRY", vergi_toplami / 100, (net_toplam + vergi_toplami) / 100,
        "Sentetik teklif. Teklif 30 gün geçerlidir." if teklif else None,
    ))
    db.executemany(f"INSERT INTO {detay} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", satirlar)


def olustur(kaynak: Path, cikti: Path) -> None:
    with (
        closing(sqlite3.connect(kaynak.resolve().as_uri() + "?mode=ro", uri=True)) as oku,
        closing(sqlite3.connect(":memory:")) as demo,
    ):
        demo.execute("PRAGMA foreign_keys = ON")
        tablolari_olustur(demo, "OINV", "INV1", "DocEntry")
        # İki belge türünün bağımsız anahtarlarını Desktop da ayrı algılamalı.
        tablolari_olustur(demo, "OQUT", "QUT1", "TeklifDocEntry")
        for (numara, musteri), satirlar in groupby(oku.execute(FATURA_YAPISI), itemgetter(0, 1)):
            belge_ekle(demo, "OINV", "INV1", numara, musteri, (r[2:] for r in satirlar))
        if not demo.execute("SELECT 1 FROM OINV LIMIT 1").fetchone():
            raise ValueError("Kaynakta kalemi olan bir satış faturası bulunamadı.")

        # Kaynakta teklif yok. Üç sentetik belge sayfalama ve ara toplam denemeleri içindir.
        for numara, adet in enumerate((1, 40, 200), start=1):
            kalemler = ((1 + i % 12, 1 + (i // 13) % 3) for i in range(adet))
            belge_ekle(demo, "OQUT", "QUT1", numara, numara, kalemler)
        demo.commit()
        icerik = demo.serialize()

    cikti.parent.mkdir(parents=True, exist_ok=True)
    with cikti.open("xb") as dosya:
        try:
            dosya.write(icerik)
            dosya.flush()
        except OSError:
            dosya.close()
            cikti.unlink(missing_ok=True)
            raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kaynak", type=Path, help="Power BI demosunun OINV ve INV1 içeren SQLite dosyası")
    parser.add_argument("cikti", type=Path, help="Oluşturulacak yeni yerel SQLite dosyası")
    args = parser.parse_args()
    try:
        olustur(args.kaynak, args.cikti)
    except FileExistsError:
        parser.exit(1, "Çıktı dosyası zaten var. Yeni bir dosya adı seçin.\n")
    except (OSError, sqlite3.Error, ValueError) as hata:
        parser.exit(1, f"Belge deneme verisi oluşturulamadı. {hata}\n")
    print(f"Belge deneme verisi hazır. {args.cikti}")
