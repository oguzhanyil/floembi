"""F06 yerel anlık görüntüsünü bağımsız SQL toplamlarıyla kontrol eder.

Kaynağa bağlanmaz. Kayıt veya tutarları çıktıya yazmaz; bu kontrol Power BI
motoruyla finansal mutabakat yerine geçmez.
"""
from __future__ import annotations

from datetime import date
import math

from .document.document import Document
from .report.query import VisualQuery


def verify_demo(doc: Document) -> dict:
    measures = [m.ad for t in doc.tanim.tablolar for m in t.olculer]
    for name in measures:
        doc.query(VisualQuery.model_validate({"values": [{"measure": name}]}))
    visual_queries, empty_visuals = 0, 0
    for page in doc.content.report["pages"]:
        for visual in page["visuals"]:
            if not visual.get("group") and not visual.get("values"):
                continue
            query = VisualQuery.model_validate({key: visual.get(key, []) for key in ("group", "values", "filters")})
            result = doc.query(query)
            visual_queries += 1
            empty_visuals += not bool(result["rows"])

    periods = [r[0] for r in doc.con.execute("SELECT DISTINCT strftime(Tarih, '%Y-%m') FROM veri.Satis WHERE Tarih IS NOT NULL ORDER BY 1").fetchall()]
    customer = doc.con.execute("SELECT MuhatapKod FROM veri.Satis WHERE MuhatapKod IS NOT NULL ORDER BY MuhatapKod LIMIT 1").fetchone()
    choices = list(dict.fromkeys([None, *([periods[0], periods[len(periods) // 2], periods[-1]] if periods else [])]))
    cases, comparisons = 0, 0
    metrics = ["Yerel net satış · satır", "Yerel satır brüt kârı", "Yerel açık satış siparişi",
               "Satış faturası adedi", "Cari açılış bakiyesi", "Cari dönem hareketi", "Cari kapanış bakiyesi"]
    for period in choices:
        for code in ([None, customer[0]] if customer else [None]):
            filters, where, params = [], [], []
            if period:
                year, month = map(int, period.split("-"))
                start = date(year, month, 1)
                end = date(year + (month == 12), month % 12 + 1, 1)
                filters.append({"table": "Tarih", "column": "Donem", "values": [period]})
                where.append("Tarih >= ? AND Tarih < ?")
                params += [start, end]
            else:
                start, last = doc.con.execute("SELECT MIN(Tarih), MAX(Tarih) FROM veri.Tarih").fetchone()
                end = date.fromordinal(last.toordinal() + 1) if last else None
            if code is not None:
                filters.append({"table": "MuhatapBoyut", "column": "MuhatapKod", "values": [code]})
                where.append("MuhatapKod = ?")
                params.append(code)
            condition = " AND ".join(where) or "TRUE"
            sales = doc.con.execute(f"""SELECT SUM(NetSatis), SUM(BrutKar), SUM(AcikSiparis),
                NULLIF(COUNT(DISTINCT CASE WHEN BelgeTuru = 'Fatura' THEN BelgeKimlik END), 0)
                FROM veri.Satis WHERE {condition}""", params).fetchone()
            movement = doc.con.execute(f"SELECT SUM(Borc) - SUM(Alacak) FROM veri.Cari WHERE {condition}", params).fetchone()[0]
            customer_sql = "AND MuhatapKod = ?" if code is not None else ""
            customer_params = [code] if code is not None else []
            opening = doc.con.execute(f"SELECT SUM(Borc) - SUM(Alacak) FROM veri.Cari WHERE Tarih < ? {customer_sql}",
                                      [start, *customer_params]).fetchone()[0]
            closing = doc.con.execute(f"SELECT SUM(Borc) - SUM(Alacak) FROM veri.Cari WHERE Tarih < ? {customer_sql}",
                                      [end, *customer_params]).fetchone()[0]
            expected = [*sales, opening, movement, closing]
            result = doc.query(VisualQuery.model_validate({"values": [{"measure": name} for name in metrics], "filters": filters}))
            actual = result["rows"][0] if result["rows"] else [None] * len(metrics)
            for name, value, reference in zip(metrics, actual, expected):
                equal = value is None and reference is None
                if value is not None and reference is not None:
                    equal = math.isclose(float(value), float(reference), rel_tol=1e-9, abs_tol=1e-6)
                if not equal:
                    # Değerleri ve filtredeki müşteri kodunu hata metnine koyma.
                    raise ValueError(f"F06 yerel kontrolünde hesap farkı: {name}; senaryo {cases + 1}")
                comparisons += 1
            cases += 1
    return {"measureQueries": len(measures), "visualQueries": visual_queries, "emptyVisuals": empty_visuals,
            "filterScenarios": cases, "numericComparisons": comparisons, "localChecksPassed": True,
            "powerBIParityVerified": False}
