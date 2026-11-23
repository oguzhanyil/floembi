"""Mali mutabakatın birimi, boş değerleri ve tarih çözünürlüğü."""

from floem_bi.reconciliation import matches


def test_financial_tolerance_is_absolute():
    assert matches(40_000_000.004, 40_000_000, money=True)
    assert not matches(40_000_000_000.01, 40_000_000_000, money=True)
    assert not matches(12.00001, 12)
    assert matches(1.000000000000008, 1)
    assert not matches(12.0000000001, 12, exact=True)
    assert not matches(False, 0)
    assert not matches(0, None)
    assert matches(None, None)


def test_timestamp_round_trip():
    assert matches("2025-01-01T00:00:00", "2025-01-01T00:00:00.0000010")
    assert not matches("2025-01-01T00:00:00", "2025-01-01T00:00:01")
