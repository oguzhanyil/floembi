"""Yerel, maskelenmiş SAP B1 Demo verisinden çalışır Floem BI raporu üretir.

Kaynak yalnızca (localdb)\\MSSQLLocalDB / DEMO_FIRMA1'dir. Hiçbir kaynak tabloya yazmaz.
PBIP'in 135 ölçüsünü taklit etmez; yerel satır toplamlarıyla sekiz sayfa oluşturur.
--semantic ortak boyutlar, 29 FDX ölçüsü ve dokuzuncu karşılaştırma sayfasını ekler.
Çıktı yerel .floem dosyasıdır; özgün ölçü sonuç eşdeğerliği iddia edilmez.
"""

from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

import pyarrow as pa
import pyodbc

from .document.document import Document
from .model.schema import ModelBilgisi, ModelTanimi, Sutun, Tablo, TabloKaynak
from .model.semantic import SemanticModel
from .report.schema import Report

SERVER = r"(localdb)\MSSQLLocalDB"
DATABASE = "DEMO_FIRMA1"
PAGE_W, PAGE_H = 1280, 860
NAV = [
    ("Genel", "genel"), ("Mizan", "mizan"), ("Cari", "cari"),
    ("Satış", "satis"), ("Satınalma", "satinalma"), ("Fırsat", "firsat"),
    ("Muhatap", "muhatap"), ("Aktivite", "aktivite"),
]


TABLES: dict[str, tuple[list[tuple[str, str]], str]] = {
    "Finans": ([
        ("Tarih", "date"), ("HesapKod", "string"),
        ("Donem", "string"), ("Yil", "int64"), ("HesapSinifi", "string"),
        ("AnaHesap", "string"), ("Hesap", "string"), ("Borc", "double"),
        ("Alacak", "double"), ("Bakiye", "double"), ("Kayit", "int64"),
    ], """
        SELECT CONVERT(date, J.RefDate) AS Tarih, L.Account AS HesapKod,
               CONVERT(char(7), J.RefDate, 120) AS Donem,
               YEAR(J.RefDate) AS Yil,
               LEFT(L.Account, 1) AS HesapSinifi,
               LEFT(L.Account, 3) AS AnaHesap,
               L.Account + N' · ' + COALESCE(A.AcctName, N'Hesap') AS Hesap,
               SUM(CONVERT(float, L.Debit)) AS Borc,
               SUM(CONVERT(float, L.Credit)) AS Alacak,
               SUM(CONVERT(float, L.Debit - L.Credit)) AS Bakiye,
               COUNT_BIG(*) AS Kayit
        FROM dbo.JDT1 L
        JOIN dbo.OJDT J ON J.TransId = L.TransId
        LEFT JOIN dbo.OACT A ON A.AcctCode = L.Account
        WHERE J.RefDate IS NOT NULL AND L.Account IS NOT NULL
        GROUP BY CONVERT(date, J.RefDate), CONVERT(char(7), J.RefDate, 120), YEAR(J.RefDate),
                 LEFT(L.Account, 1), LEFT(L.Account, 3), L.Account, A.AcctName
    """),
    "Cari": ([
        ("Tarih", "date"), ("Donem", "string"), ("FisNo", "int64"),
        ("SatirNo", "int64"), ("HesapKod", "string"), ("MuhatapKod", "string"), ("Muhatap", "string"), ("Borc", "double"),
        ("Alacak", "double"), ("Bakiye", "double"), ("YuruyenBakiye", "double"),
    ], """
        SELECT CONVERT(date, J.RefDate) AS Tarih,
               CONVERT(char(7), J.RefDate, 120) AS Donem,
               L.TransId AS FisNo, L.Line_ID AS SatirNo, L.Account AS HesapKod,
               C.CardCode AS MuhatapKod, CONCAT(C.CardCode, N' · ', C.CardName) AS Muhatap,
               CONVERT(float, COALESCE(L.Debit, 0)) AS Borc,
               CONVERT(float, COALESCE(L.Credit, 0)) AS Alacak,
               CONVERT(float, COALESCE(L.Debit, 0) - COALESCE(L.Credit, 0)) AS Bakiye,
               CONVERT(float, SUM(COALESCE(L.Debit, 0) - COALESCE(L.Credit, 0))
                 OVER (PARTITION BY L.ShortName ORDER BY J.RefDate, L.TransId, L.Line_ID
                       ROWS UNBOUNDED PRECEDING)) AS YuruyenBakiye
        FROM dbo.JDT1 L
        JOIN dbo.OJDT J ON J.TransId = L.TransId
        JOIN dbo.OCRD C ON C.CardCode = L.ShortName
        WHERE L.ShortName <> L.Account AND J.RefDate IS NOT NULL
    """),
    "Satis": ([
        ("Tarih", "date"), ("Donem", "string"), ("BelgeNo", "int64"),
        ("BelgeKimlik", "string"), ("SatirNo", "int64"), ("KayitAnahtari", "string"),
        ("BelgeTuru", "string"), ("MuhatapKod", "string"), ("Muhatap", "string"), ("SatisElemani", "string"),
        ("UrunKod", "string"), ("SatisElemaniKod", "int64"),
        ("NetSatis", "double"), ("Siparis", "double"), ("AcikSiparis", "double"), ("BrutKar", "double"),
        ("Birim", "string"), ("NetFaturaMiktar", "double"), ("SiparisMiktar", "double"),
        ("AcikSiparisMiktar", "double"), ("SatirAdedi", "int64"),
    ], """
        WITH Satir AS (
          SELECT 'Fatura' AS Tur, 1 AS Isaret, H.DocNum, H.DocDate, H.CardCode, H.SlpCode,
                 H.DocEntry, L.LineNum, L.UomCode, L.LineTotal, L.GrssProfit, L.Quantity, L.ItemCode,
                 CAST(0 AS decimal(19,6)) AS OpenQty
          FROM dbo.OINV H JOIN dbo.INV1 L ON L.DocEntry = H.DocEntry WHERE H.CANCELED = 'N'
          UNION ALL
          SELECT N'İade', -1, H.DocNum, H.DocDate, H.CardCode, H.SlpCode,
                 H.DocEntry, L.LineNum, L.UomCode, L.LineTotal, L.GrssProfit, L.Quantity, L.ItemCode, 0
          FROM dbo.ORIN H JOIN dbo.RIN1 L ON L.DocEntry = H.DocEntry WHERE H.CANCELED = 'N'
          UNION ALL
          SELECT N'Sipariş', 1, H.DocNum, H.DocDate, H.CardCode, H.SlpCode,
                 H.DocEntry, L.LineNum, L.UomCode, L.LineTotal, L.GrssProfit, L.Quantity, L.ItemCode,
                 CASE WHEN H.DocStatus = 'O' AND L.LineStatus = 'O' THEN L.OpenQty ELSE 0 END
          FROM dbo.ORDR H JOIN dbo.RDR1 L ON L.DocEntry = H.DocEntry WHERE H.CANCELED = 'N'
        )
        SELECT CONVERT(date, X.DocDate) AS Tarih,
               CONVERT(char(7), X.DocDate, 120) AS Donem,
               X.DocNum AS BelgeNo,
               CONCAT(N'DEMO_FIRMA1:', X.Tur, ':', X.DocEntry) AS BelgeKimlik,
               X.LineNum AS SatirNo,
               CONCAT(N'DEMO_FIRMA1:', X.Tur, ':', X.DocEntry, ':', X.LineNum) AS KayitAnahtari,
               X.Tur AS BelgeTuru, X.CardCode AS MuhatapKod,
               CONCAT(X.CardCode, N' · ', COALESCE(C.CardName, N'Demo muhatap')) AS Muhatap,
               COALESCE(S.SlpName, N'Atanmamış') AS SatisElemani,
               X.ItemCode AS UrunKod, CONVERT(bigint, X.SlpCode) AS SatisElemaniKod,
               CONVERT(float, CASE WHEN X.Tur = N'Sipariş' THEN 0 ELSE X.Isaret * X.LineTotal END) AS NetSatis,
               CONVERT(float, CASE WHEN X.Tur = N'Sipariş' THEN X.LineTotal ELSE 0 END) AS Siparis,
               CONVERT(float, CASE WHEN X.OpenQty > 0 THEN X.LineTotal * X.OpenQty / NULLIF(X.Quantity, 0) ELSE 0 END) AS AcikSiparis,
               CONVERT(float, CASE WHEN X.Tur = N'Sipariş' THEN 0 ELSE X.Isaret * X.GrssProfit END) AS BrutKar,
               COALESCE(NULLIF(X.UomCode, ''), N'Belirsiz') AS Birim,
               CONVERT(float, CASE WHEN X.Tur = N'Sipariş' THEN 0 ELSE X.Isaret * X.Quantity END) AS NetFaturaMiktar,
               CONVERT(float, CASE WHEN X.Tur = N'Sipariş' THEN X.Quantity ELSE 0 END) AS SiparisMiktar,
               CONVERT(float, X.OpenQty) AS AcikSiparisMiktar,
               CONVERT(bigint, 1) AS SatirAdedi
        FROM Satir X
        LEFT JOIN dbo.OCRD C ON C.CardCode = X.CardCode
        LEFT JOIN dbo.OSLP S ON S.SlpCode = X.SlpCode
    """),
    "Satinalma": ([
        ("Tarih", "date"), ("Donem", "string"), ("BelgeNo", "int64"),
        ("BelgeKimlik", "string"), ("SatirNo", "int64"), ("KayitAnahtari", "string"),
        ("BelgeTuru", "string"), ("MuhatapKod", "string"), ("Muhatap", "string"), ("SatisElemani", "string"),
        ("UrunKod", "string"), ("SatisElemaniKod", "int64"),
        ("FaturaTutar", "double"), ("SiparisTutar", "double"), ("AcikSiparisTutar", "double"),
        ("Birim", "string"), ("FaturaMiktar", "double"), ("SiparisMiktar", "double"),
        ("AcikSiparisMiktar", "double"), ("SatirAdedi", "int64"),
    ], """
        WITH Satir AS (
          SELECT N'Fatura' AS Tur, H.DocNum, H.DocDate, H.CardCode, H.SlpCode,
                 H.DocEntry, L.LineNum, L.UomCode, L.LineTotal, L.Quantity, L.ItemCode,
                 CAST(0 AS decimal(19,6)) AS OpenQty
          FROM dbo.OPCH H JOIN dbo.PCH1 L ON L.DocEntry = H.DocEntry WHERE H.CANCELED = 'N'
          UNION ALL
          SELECT N'Sipariş', H.DocNum, H.DocDate, H.CardCode, H.SlpCode,
                 H.DocEntry, L.LineNum, L.UomCode, L.LineTotal, L.Quantity, L.ItemCode,
                 CASE WHEN H.DocStatus = 'O' AND L.LineStatus = 'O' THEN L.OpenQty ELSE 0 END
          FROM dbo.OPOR H JOIN dbo.POR1 L ON L.DocEntry = H.DocEntry WHERE H.CANCELED = 'N'
        )
        SELECT CONVERT(date, X.DocDate) AS Tarih,
               CONVERT(char(7), X.DocDate, 120) AS Donem,
               X.DocNum AS BelgeNo,
               CONCAT(N'DEMO_FIRMA1:', X.Tur, ':', X.DocEntry) AS BelgeKimlik,
               X.LineNum AS SatirNo,
               CONCAT(N'DEMO_FIRMA1:', X.Tur, ':', X.DocEntry, ':', X.LineNum) AS KayitAnahtari,
               X.Tur AS BelgeTuru, X.CardCode AS MuhatapKod,
               CONCAT(X.CardCode, N' · ', COALESCE(C.CardName, N'Demo muhatap')) AS Muhatap,
               COALESCE(S.SlpName, N'Atanmamış') AS SatisElemani,
               X.ItemCode AS UrunKod, CONVERT(bigint, X.SlpCode) AS SatisElemaniKod,
               CONVERT(float, CASE WHEN X.Tur = N'Fatura' THEN X.LineTotal ELSE 0 END) AS FaturaTutar,
               CONVERT(float, CASE WHEN X.Tur = N'Sipariş' THEN X.LineTotal ELSE 0 END) AS SiparisTutar,
               CONVERT(float, CASE WHEN X.OpenQty > 0 THEN X.LineTotal * X.OpenQty / NULLIF(X.Quantity, 0) ELSE 0 END) AS AcikSiparisTutar,
               COALESCE(NULLIF(X.UomCode, ''), N'Belirsiz') AS Birim,
               CONVERT(float, CASE WHEN X.Tur = N'Fatura' THEN X.Quantity ELSE 0 END) AS FaturaMiktar,
               CONVERT(float, CASE WHEN X.Tur = N'Sipariş' THEN X.Quantity ELSE 0 END) AS SiparisMiktar,
               CONVERT(float, X.OpenQty) AS AcikSiparisMiktar,
               CONVERT(bigint, 1) AS SatirAdedi
        FROM Satir X
        LEFT JOIN dbo.OCRD C ON C.CardCode = X.CardCode
        LEFT JOIN dbo.OSLP S ON S.SlpCode = X.SlpCode
    """),
    "Firsat": ([
        ("Tarih", "date"), ("Donem", "string"), ("FirsatNo", "int64"),
        ("MuhatapKod", "string"), ("Muhatap", "string"), ("SatisElemani", "string"), ("SatisElemaniKod", "int64"), ("Asama", "string"),
        ("Durum", "string"), ("Tutar", "double"), ("AgirlikliTutar", "double"),
        ("AcikTutar", "double"), ("Adet", "int64"), ("AcikAdet", "int64"),
    ], """
        SELECT CONVERT(date, COALESCE(O.PredDate, O.OpenDate)) AS Tarih,
               CONVERT(char(7), COALESCE(O.PredDate, O.OpenDate), 120) AS Donem,
               O.OpprId AS FirsatNo,
               O.CardCode AS MuhatapKod,
               CONCAT(O.CardCode, N' · ', COALESCE(C.CardName, N'Demo muhatap')) AS Muhatap,
               COALESCE(P.SlpName, N'Atanmamış') AS SatisElemani, CONVERT(bigint, O.SlpCode) AS SatisElemaniKod,
               COALESCE(S.Descript, N'Belirsiz') AS Asama,
               CASE O.Status WHEN 'O' THEN N'Açık' WHEN 'W' THEN N'Kazanıldı'
                    WHEN 'L' THEN N'Kaybedildi' ELSE N'Diğer' END AS Durum,
               CONVERT(float, COALESCE(O.MaxSumLoc, 0)) AS Tutar,
               CONVERT(float, COALESCE(O.WtSumLoc, 0)) AS AgirlikliTutar,
               CONVERT(float, CASE WHEN O.Status = 'O' THEN COALESCE(O.MaxSumLoc, 0) ELSE 0 END) AS AcikTutar,
               CONVERT(bigint, 1) AS Adet,
               CONVERT(bigint, CASE WHEN O.Status = 'O' THEN 1 ELSE 0 END) AS AcikAdet
        FROM dbo.OOPR O
        LEFT JOIN dbo.OCRD C ON C.CardCode = O.CardCode
        LEFT JOIN dbo.OSLP P ON P.SlpCode = O.SlpCode
        LEFT JOIN dbo.OOST S ON S.Num = O.StepLast
    """),
    "Muhatap": ([
        ("MuhatapKod", "string"), ("Muhatap", "string"), ("Tur", "string"), ("Bakiye", "double"),
        ("MusteriAlacak", "double"), ("TedarikciBorc", "double"),
        ("Adet", "int64"), ("MusteriAdet", "int64"), ("TedarikciAdet", "int64"),
    ], """
        SELECT C.CardCode AS MuhatapKod, CONCAT(C.CardCode, N' · ', C.CardName) AS Muhatap,
               CASE C.CardType WHEN 'C' THEN N'Müşteri' WHEN 'S' THEN N'Tedarikçi'
                    WHEN 'L' THEN N'Aday' ELSE N'Diğer' END AS Tur,
               CONVERT(float, COALESCE(C.Balance, 0)) AS Bakiye,
               CONVERT(float, CASE WHEN C.CardType = 'C' AND C.Balance > 0 THEN C.Balance ELSE 0 END) AS MusteriAlacak,
               CONVERT(float, CASE WHEN C.CardType = 'S' AND C.Balance < 0 THEN -C.Balance ELSE 0 END) AS TedarikciBorc,
               CONVERT(bigint, 1) AS Adet,
               CONVERT(bigint, CASE WHEN C.CardType = 'C' THEN 1 ELSE 0 END) AS MusteriAdet,
               CONVERT(bigint, CASE WHEN C.CardType = 'S' THEN 1 ELSE 0 END) AS TedarikciAdet
        FROM dbo.OCRD C
        WHERE C.CardName IS NOT NULL
    """),
    "Aktivite": ([
        ("Tarih", "date"), ("Donem", "string"), ("AktiviteNo", "int64"), ("MuhatapKod", "string"), ("Muhatap", "string"),
        ("SatisElemani", "string"), ("SatisElemaniKod", "int64"), ("Tur", "string"), ("Durum", "string"),
        ("Oncelik", "string"), ("Adet", "int64"), ("AcikAdet", "int64"),
        ("YuksekAdet", "int64"),
    ], """
        SELECT CONVERT(date, A.CntctDate) AS Tarih,
               CONVERT(char(7), A.CntctDate, 120) AS Donem,
               A.ClgCode AS AktiviteNo, A.CardCode AS MuhatapKod,
               CONCAT(A.CardCode, N' · ', COALESCE(C.CardName, N'Muhatap yok')) AS Muhatap,
               COALESCE(P.SlpName, N'Atanmamış') AS SatisElemani, CONVERT(bigint, A.SlpCode) AS SatisElemaniKod,
               CASE A.Action WHEN 'C' THEN N'Telefon' WHEN 'M' THEN N'Toplantı'
                    WHEN 'T' THEN N'Görev' WHEN 'E' THEN N'Not' ELSE N'Diğer' END AS Tur,
               CASE WHEN A.Closed = 'Y' THEN N'Tamamlandı' ELSE N'Açık' END AS Durum,
               CASE A.Priority WHEN '2' THEN N'Yüksek' WHEN '0' THEN N'Düşük'
                    ELSE N'Normal' END AS Oncelik,
               CONVERT(bigint, 1) AS Adet,
               CONVERT(bigint, CASE WHEN A.Closed = 'Y' THEN 0 ELSE 1 END) AS AcikAdet,
               CONVERT(bigint, CASE WHEN A.Priority = '2' THEN 1 ELSE 0 END) AS YuksekAdet
        FROM dbo.OCLG A
        LEFT JOIN dbo.OCRD C ON C.CardCode = A.CardCode
        LEFT JOIN dbo.OSLP P ON P.SlpCode = A.SlpCode
        WHERE COALESCE(A.inactive, 'N') = 'N' AND A.CntctDate IS NOT NULL
    """),
}


def _field(table: str, column: str) -> dict:
    return {"table": table, "column": column}


def _value(table: str, column: str, agg: str = "sum") -> dict:
    return {"table": table, "column": column, "agg": agg}


def _visual(kind: str, key: str, title: str, x: int, y: int, w: int, h: int,
            table: str | None = None, groups: tuple[str, ...] = (),
            values: tuple[str, ...] = (), extra: dict | None = None) -> dict:
    fmt = {"backgroundColor": "#ffffff", "borderColor": "#d9e4f2", "borderWidth": 1,
           "radius": 12, "shadow": True, "padding": 8, "titleSize": 14,
           "colors": ["#0ea5e9", "#2563eb", "#14b8a6", "#f59e0b", "#8b5cf6"]}
    if kind == "card":
        fmt["categoryLabel"] = False
    if extra:
        fmt.update(extra)
    return {"id": key, "type": kind, "x": x, "y": y, "w": w, "h": h,
            "title": title, "group": [_field(table, c) for c in groups] if table else [],
            "values": [_value(table, c) for c in values] if table else [],
            "filters": [], "format": fmt}


def _base(page_id: str, title: str, subtitle: str) -> dict:
    visuals = [
        _visual("shape", f"{page_id}-header", "", 0, 0, PAGE_W, 100,
                extra={"showTitle": False, "padding": 0, "backgroundColor": "#0b1f3b", "radius": 0, "shadow": False}),
        _visual("text", f"{page_id}-title", "", 30, 16, 900, 46,
                extra={"showTitle": False, "padding": 0, "backgroundColor": "transparent",
                       "text": title, "fontSize": 30, "bold": True, "color": "#ffffff", "shadow": False}),
        _visual("text", f"{page_id}-subtitle", "", 32, 62, 1110, 28,
                extra={"showTitle": False, "padding": 0, "backgroundColor": "transparent",
                       "text": subtitle, "fontSize": 14, "color": "#b9d8f2", "shadow": False}),
    ]
    for i, (label, target) in enumerate(NAV):
        v = _visual("button", f"{page_id}-nav-{target}", "", 30 + i * 153, 109, 139, 42,
                    extra={"showTitle": False, "padding": 0, "shadow": False, "text": label,
                           "buttonStyle": "solid", "buttonColor": "#0ea5e9" if target == page_id else "#264a72",
                           "buttonTextColor": "#ffffff", "action": {"type": "page", "pageId": target}})
        visuals.append(v)
    return {"id": page_id, "name": title, "width": PAGE_W, "height": PAGE_H,
            "backgroundColor": "#f1f5fb", "visuals": visuals}


def _add(page: dict, *visuals: dict) -> None:
    page["visuals"].extend(visuals)


def _cards(page: dict, cards: list[tuple[str, str, str]]) -> None:
    for i, (title, table, column) in enumerate(cards):
        _add(page, _visual("card", f"{page['id']}-card-{i}", title, 30 + i * 306, 174, 282, 108,
                           table, values=(column,)))


def _chart(page: dict, kind: str, key: str, title: str, side: int,
           table: str, group: str, *values: str) -> None:
    _add(page, _visual(kind, f"{page['id']}-{key}", title, 30 + side * 612, 305, 588, 254,
                       table, groups=(group,), values=tuple(values)))


def _table(page: dict, table: str, groups: tuple[str, ...], values: tuple[str, ...],
           slicer: str | None = None, tree: bool = False) -> None:
    if slicer:
        _add(page, _visual("slicer", f"{page['id']}-slicer", slicer, 30, 580, 220, 244,
                           table, groups=(slicer,), extra={"slicerStyle": "dropdown"}))
    detail = _visual("treegrid" if tree else "table", f"{page['id']}-details", "Detay", 266 if slicer else 30,
                     580, 964 if slicer else 1200, 244, table, groups=groups, values=values,
                     extra={"gridFilters": True, "gridPagination": True, "gridPageSize": 50})
    if not tree and groups and groups[0] == "Tarih":
        detail["state"] = {"sort": {"index": 0, "desc": True}}
    _add(page, detail)


def _report() -> dict:
    pages = []
    p = _base("genel", "SAP B1 Demo · Genel Bakış", "Maskelenmiş yerel demo verisi · Floem BI uyarlaması")
    _cards(p, [("Fatura − iade tutarı", "Satis", "NetSatis"), ("Satınalma faturası", "Satinalma", "FaturaTutar"),
               ("Fırsat sayısı", "Firsat", "Adet"), ("Aktivite sayısı", "Aktivite", "Adet")])
    _chart(p, "line", "trend", "Aylık net satış", 0, "Satis", "Donem", "NetSatis")
    _chart(p, "bar", "firsatlar", "Fırsat durumu", 1, "Firsat", "Durum", "Adet")
    _table(p, "Satis", ("Tarih", "BelgeNo", "BelgeKimlik", "SatirNo", "Muhatap"), ("NetSatis", "BrutKar"))
    pages.append(p)

    p = _base("mizan", "Finans · Mizan", "Hesap sınıfı, ana hesap ve alt hesap kırılımı · yerel tutarlar")
    _cards(p, [("Toplam borç", "Finans", "Borc"), ("Toplam alacak", "Finans", "Alacak"),
               ("Net bakiye", "Finans", "Bakiye"), ("Yevmiye satırı", "Finans", "Kayit")])
    _chart(p, "bar", "sinif", "Hesap sınıfı bakiyesi", 0, "Finans", "HesapSinifi", "Bakiye")
    _chart(p, "line", "trend", "Aylık borç ve alacak", 1, "Finans", "Donem", "Borc", "Alacak")
    _table(p, "Finans", ("HesapSinifi", "AnaHesap", "Hesap"), ("Borc", "Alacak", "Bakiye"), tree=True)
    pages.append(p)

    p = _base("cari", "Finans · Cari Ekstre", "Yürüyen bakiye tüm kaynak geçmişinden gelir; tarih filtresiyle yeniden başlamaz · Genel toplam kapalı")
    _cards(p, [("Cari borç", "Cari", "Borc"), ("Cari alacak", "Cari", "Alacak"),
               ("Cari bakiye", "Cari", "Bakiye"), ("Muhatap sayısı", "Cari", "Muhatap")])
    p["visuals"][-1]["values"] = [_value("Cari", "Muhatap", "distinctcount")]
    _chart(p, "bar", "muhatap", "Muhatap bakiyesi", 0, "Cari", "Muhatap", "Bakiye")
    _chart(p, "line", "trend", "Aylık cari hareket", 1, "Cari", "Donem", "Borc", "Alacak")
    _table(p, "Cari", ("Tarih", "FisNo", "SatirNo", "Muhatap"),
           ("Borc", "Alacak", "YuruyenBakiye"), slicer="Muhatap")
    p["visuals"][-1]["format"]["showTotals"] = False
    p["visuals"][-1]["values"][-1] = _value("Cari", "YuruyenBakiye", "max")
    pages.append(p)

    p = _base("satis", "Satış Analizi", "Yerel para birimi · Fatura − iade satır tutarı · Açık sipariş: kalan miktarın satır tutarı; belge indirimi/vergi hariç")
    _cards(p, [("Fatura − iade tutarı", "Satis", "NetSatis"), ("Açık sipariş tutarı", "Satis", "AcikSiparis"),
               ("Satır brüt kârı", "Satis", "BrutKar"), ("Belge satırı", "Satis", "SatirAdedi")])
    _chart(p, "line", "trend", "Aylık net satış", 0, "Satis", "Donem", "NetSatis")
    _chart(p, "bar", "muhatap", "Müşteri bazında net satış", 1, "Satis", "Muhatap", "NetSatis")
    _table(p, "Satis", ("Tarih", "BelgeNo", "BelgeKimlik", "SatirNo", "Muhatap", "BelgeTuru", "Birim"),
           ("NetSatis", "AcikSiparis", "BrutKar", "NetFaturaMiktar", "AcikSiparisMiktar"), slicer="BelgeTuru")
    p["visuals"][-1]["format"]["showTotals"] = False
    pages.append(p)

    p = _base("satinalma", "Satınalma Analizi", "Yerel satır tutarları · Kaynakta satınalma iadeleri yok; net satınalma değildir · Belge indirimi/vergi hariç")
    _cards(p, [("Fatura satır tutarı", "Satinalma", "FaturaTutar"), ("Açık sipariş tutarı", "Satinalma", "AcikSiparisTutar"),
               ("Tüm sipariş tutarı", "Satinalma", "SiparisTutar"), ("Satır sayısı", "Satinalma", "SatirAdedi")])
    _chart(p, "line", "trend", "Aylık satınalma faturası", 0, "Satinalma", "Donem", "FaturaTutar")
    _chart(p, "bar", "tedarikci", "Tedarikçi bazında tutar", 1, "Satinalma", "Muhatap", "FaturaTutar")
    _table(p, "Satinalma", ("Tarih", "BelgeNo", "BelgeKimlik", "SatirNo", "Muhatap", "BelgeTuru", "Birim"),
           ("FaturaTutar", "AcikSiparisTutar", "FaturaMiktar", "AcikSiparisMiktar"), slicer="BelgeTuru")
    p["visuals"][-1]["format"]["showTotals"] = False
    pages.append(p)

    p = _base("firsat", "Satış Fırsatları", "Aşama, durum ve ağırlıklı beklenen gelir")
    _cards(p, [("Potansiyel tutar", "Firsat", "Tutar"), ("Açık tutar", "Firsat", "AcikTutar"),
               ("Ağırlıklı gelir", "Firsat", "AgirlikliTutar"), ("Fırsat sayısı", "Firsat", "Adet")])
    _chart(p, "bar", "asama", "Aşama bazında tutar", 0, "Firsat", "Asama", "AgirlikliTutar")
    _chart(p, "donut", "durum", "Fırsat durumu", 1, "Firsat", "Durum", "Adet")
    _table(p, "Firsat", ("FirsatNo", "Muhatap", "Asama", "Durum"),
           ("Tutar", "AgirlikliTutar"), slicer="Durum")
    pages.append(p)

    p = _base("muhatap", "Muhatap Analizi", "Güncel kaynak bakiyesi · Müşteri alacağı ve tedarikçi borcu ayrı; avanslar kartlara netlenmez")
    _cards(p, [("Müşteri sayısı", "Muhatap", "MusteriAdet"), ("Tedarikçi sayısı", "Muhatap", "TedarikciAdet"),
               ("Müşteri alacağı", "Muhatap", "MusteriAlacak"), ("Tedarikçi borcu", "Muhatap", "TedarikciBorc")])
    _chart(p, "donut", "tur", "Muhatap türü", 0, "Muhatap", "Tur", "Adet")
    _chart(p, "bar", "bakiye", "Muhatap bakiyesi", 1, "Muhatap", "Muhatap", "Bakiye")
    _table(p, "Muhatap", ("Muhatap", "Tur"), ("Bakiye", "MusteriAlacak", "TedarikciBorc"), slicer="Tur")
    p["visuals"][-1]["format"]["showTotals"] = False
    pages.append(p)

    p = _base("aktivite", "Aktiviteler", "Telefon, toplantı ve görev kayıtları")
    _cards(p, [("Aktivite sayısı", "Aktivite", "Adet"), ("Açık aktivite", "Aktivite", "AcikAdet"),
               ("Yüksek öncelik", "Aktivite", "YuksekAdet"), ("Muhatap sayısı", "Aktivite", "Muhatap")])
    p["visuals"][-1]["values"] = [_value("Aktivite", "Muhatap", "distinctcount")]
    _chart(p, "bar", "tur", "Aktivite türü", 0, "Aktivite", "Tur", "Adet")
    _chart(p, "donut", "durum", "Tamamlanma durumu", 1, "Aktivite", "Durum", "Adet")
    _table(p, "Aktivite", ("Tarih", "AktiviteNo", "Muhatap", "Tur", "Oncelik", "Durum"),
           ("Adet",), slicer="Durum")
    pages.append(p)
    return Report.model_validate({"version": 1, "pages": pages}).model_dump(mode="json", exclude_none=True)


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _copy_table(source: pyodbc.Connection, doc: Document, name: str,
                columns: list[tuple[str, str]], query: str) -> int:
    sql_types = {"string": "VARCHAR", "int64": "BIGINT", "double": "DOUBLE", "date": "DATE"}
    definition = ", ".join(f"{_quote(col)} {sql_types[typ]}" for col, typ in columns)
    doc.con.execute(f"CREATE TABLE {_quote('veri')}.{_quote(name)} ({definition})")
    cursor = source.cursor()
    cursor.execute(query)
    expected = [col for col, _ in columns]
    actual = [item[0] for item in cursor.description]
    if [x.lower() for x in actual] != [x.lower() for x in expected]:
        raise ValueError(f"{name}: SQL sütunları modelle uyuşmuyor: {actual}")
    count = 0
    while batch := cursor.fetchmany(2500):
        data = pa.table({col: [row[i] for row in batch] for i, col in enumerate(expected)})
        doc.con.register("_demo_batch", data)
        try:
            doc.con.execute(f"INSERT INTO {_quote('veri')}.{_quote(name)} SELECT * FROM _demo_batch")
        finally:
            doc.con.unregister("_demo_batch")
        count += len(batch)
    cursor.close()
    if name in ("Satis", "Satinalma"):
        amount = "AcikSiparis" if name == "Satis" else "AcikSiparisTutar"
        invalid = doc.con.execute(
            f'SELECT COUNT(*) FROM veri.{_quote(name)} WHERE AcikSiparisMiktar > 0 AND {_quote(amount)} IS NULL'
        ).fetchone()[0]
        if invalid:
            raise ValueError(f"{name}: {invalid} açık satırın tutarı hesaplanamıyor; kaynak miktarı sıfır. Dosya kaydedilmedi.")
        duplicate = doc.con.execute(
            f'SELECT COUNT(*) - COUNT(DISTINCT KayitAnahtari) FROM veri.{_quote(name)}'
        ).fetchone()[0]
        if duplicate:
            raise ValueError(f"{name}: yinelenen belge/satır anahtarı bulundu. Dosya kaydedilmedi.")
    return count


def build(output: Path, *, semantic: bool = False) -> dict[str, int]:
    """Kaynak DB'ye sadece SELECT yapar; çıktı dosyası hedefte mevcutsa üzerine yazar."""
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    connection = pyodbc.connect(
        "DRIVER={ODBC Driver 17 for SQL Server};"
        f"SERVER={SERVER};DATABASE={DATABASE};Trusted_Connection=yes;ApplicationIntent=ReadOnly;",
        autocommit=True, timeout=10,
    )
    try:
        company = connection.cursor().execute("SELECT TOP (1) CompnyName FROM dbo.OADM").fetchval()
        if company != "Demo Sanayi ve Ticaret A.Ş.":
            raise ValueError("Kaynak veritabanı maskelenmiş DEMO_FIRMA1 değil; aktarım durduruldu")
        with tempfile.TemporaryDirectory(prefix="floem-demo-") as temporary:
            doc = Document.new(Path(temporary), "SAP B1 Demo · Floem")
            try:
                doc.content.tanim = ModelTanimi(
                    model=ModelBilgisi(ad="SAP B1 Demo · Floem"),
                    tablolar=[Tablo(ad=name, kaynak=TabloKaynak(katman="veri", tablo=name),
                                   sutunlar=[Sutun(ad=col, tip=typ,
                                                  anahtar=col == "KayitAnahtari",
                                                  gizli=col == "KayitAnahtari",
                                                  ozet="none" if col.endswith("Miktar") or col == "YuruyenBakiye" else None)
                                             for col, typ in columns])
                             for name, (columns, _query) in TABLES.items()],
                )
                SemanticModel(doc.tanim)
                counts = {name: _copy_table(connection, doc, name, columns, query)
                          for name, (columns, query) in TABLES.items()}
                report = _report()
                if semantic:
                    from .semantic_demo import apply_semantic_model

                    apply_semantic_model(doc, report)
                doc.set_report(report)
                if semantic:
                    from .semantic_validation import verify_demo

                    verify_demo(doc)
                doc.con.execute("CHECKPOINT")
                doc.save(output)
            finally:
                doc.close()
    finally:
        connection.close()
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Maskelenmiş SAP B1 Demo DB'yi Floem BI raporuna aktarır")
    parser.add_argument("output", type=Path, help="Oluşturulacak yerel .floem dosyası")
    parser.add_argument("--semantic", action="store_true", help="F06 ortak boyutlarını ve FDX ölçülerini ekler")
    args = parser.parse_args()
    counts = build(args.output, semantic=args.semantic)
    print("Oluşturuldu:", args.output.resolve())
    print(" · ".join(f"{name}: {count:,} satır" for name, count in counts.items()))


if __name__ == "__main__":
    main()
