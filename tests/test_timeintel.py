from collections import Counter
from datetime import date, timedelta

from floem_bi.compiler.timeintel import mapping_rows, period_to_date, shift_months


def days(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def sources(key, ctx_dates):
    return [s for _, _, s in mapping_rows(key, ctx_dates)]


def test_full_year_maps_to_previous_full_year_exactly_once():
    for year in (2024, 2025):  # artık yıl ve normal yıl
        src = sources("MONTH:-12", days(date(year, 1, 1), date(year, 12, 31)))
        assert Counter(src) == Counter(days(date(year - 1, 1, 1), date(year - 1, 12, 31)))


def test_february_month_end_rule():
    # Şubat 2025 bağlamı → Şubat 2024'ün tamamı (29 dahil)
    assert sorted(sources("MONTH:-12", days(date(2025, 2, 1), date(2025, 2, 28)))) == days(date(2024, 2, 1), date(2024, 2, 29))
    # Şubat 2024 bağlamı → Şubat 2023'ün tamamı, 28'i iki kez değil
    assert sorted(sources("MONTH:-12", days(date(2024, 2, 1), date(2024, 2, 29)))) == days(date(2023, 2, 1), date(2023, 2, 28))


def test_month_shift_from_31_day_month():
    # Mart → Şubat (−1 ay): Şubat'ın her günü tam bir kez
    assert sorted(sources("MONTH:-1", days(date(2025, 3, 1), date(2025, 3, 31)))) == days(date(2025, 2, 1), date(2025, 2, 28))
    assert shift_months(date(2025, 3, 31), -1) == [date(2025, 2, 28)]
    assert shift_months(date(2025, 3, 30), -1) == []


def test_month_shift_forward_expands_month_end():
    assert shift_months(date(2025, 2, 28), 1) == days(date(2025, 3, 28), date(2025, 3, 31))


def test_quarter_shift():
    src = sources("MONTH:-3", days(date(2025, 4, 1), date(2025, 6, 30)))
    assert sorted(src) == days(date(2025, 1, 1), date(2025, 3, 31))


def test_period_to_date():
    assert period_to_date(date(2025, 3, 2), "YTD")[0] == date(2025, 1, 1)
    assert len(period_to_date(date(2025, 3, 2), "YTD")) == 31 + 28 + 2
    assert period_to_date(date(2025, 5, 10), "QTD")[0] == date(2025, 4, 1)
    assert period_to_date(date(2025, 5, 10), "MTD") == days(date(2025, 5, 1), date(2025, 5, 10))
