"""Zaman zekâsı eşleme tabloları.

Her dönüşüm için (Donusum, Tarih, KaynakTarih) satırları üretilir:
"bağlamdaki Tarih, şu kaynak tarihlerin değerini gösterir".
Sorgu derlenirken bağlamın tarih kümesi bu tabloyla kaynak tarihlere
eşlenir; aynı (grup, kaynak tarih) çifti DISTINCT ile tekilleştirilir.

Ay kaydırma kuralı (DATEADD / SAMEPERIODLASTYEAR, ay sonu davranışı):
  - Ayın son günü d → hedef ayda karşılık gelen günden ay sonuna kadar tüm günler
  - Diğer günler d → aynı gün; ancak d.gün ≥ hedef ayın gün sayısı ise boş
    (o günler hedef ayın son gününe zaten ayın son günü üzerinden eşlenir)
Böylece tam ay/çeyrek/yıl bağlamları DAX ile aynı sonucu verir ve hiçbir
kaynak gün iki kez sayılmaz. Bilinen sapma: yalnızca tek bir günü içeren
bağlamda (ör. 28.02.2024) DAX bir gün döndürürken burada sonuç boş olabilir.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta


def _days_in_month(y: int, m: int) -> int:
    return calendar.monthrange(y, m)[1]


def _add_months(y: int, m: int, n: int) -> tuple[int, int]:
    idx = y * 12 + (m - 1) + n
    return idx // 12, idx % 12 + 1


def shift_months(d: date, n: int) -> list[date]:
    ty, tm = _add_months(d.year, d.month, n)
    tdays = _days_in_month(ty, tm)
    last_of_month = d.day == _days_in_month(d.year, d.month)
    if last_of_month:
        start = min(d.day, tdays)
        return [date(ty, tm, day) for day in range(start, tdays + 1)]
    if d.day >= tdays:
        return []
    return [date(ty, tm, d.day)]


def period_to_date(d: date, kind: str) -> list[date]:
    if kind == "YTD":
        start = date(d.year, 1, 1)
    elif kind == "QTD":
        start = date(d.year, 3 * ((d.month - 1) // 3) + 1, 1)
    elif kind == "MTD":
        start = date(d.year, d.month, 1)
    else:
        raise ValueError(kind)
    return [start + timedelta(days=i) for i in range((d - start).days + 1)]


def mapping_rows(key: str, dates: list[date]) -> list[tuple[str, date, date]]:
    rows: list[tuple[str, date, date]] = []
    for d in dates:
        if key.startswith("MONTH:"):
            sources = shift_months(d, int(key.split(":", 1)[1]))
        else:
            sources = period_to_date(d, key)
        rows.extend((key, d, s) for s in sources)
    return rows
