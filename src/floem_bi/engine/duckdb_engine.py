"""Import modu sorgu motoru: DuckDB üzerinde derlenmiş SQL'i çalıştırır."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

import duckdb

from ..compiler import CompiledQuery
from ..compiler.timeintel import mapping_rows
from ..model import SemanticModel

MAP_SCHEMA, MAP_TABLE = "floem", "tarih_map"


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[tuple]


class DuckDBEngine:
    def __init__(
        self, db_path: str | Path | None, model: SemanticModel, con: duckdb.DuckDBPyConnection | None = None,
    ):
        """`con` verilirse (Desktop belgesi gibi) o bağlantı kullanılır ve kapatılmaz."""
        self.db_path = str(db_path) if db_path else None
        self.model = model
        self._owns = con is None
        self._con = con if con is not None else duckdb.connect(self.db_path)
        self._lock = threading.Lock()
        self._con.execute(f"CREATE SCHEMA IF NOT EXISTS {MAP_SCHEMA}")
        self._con.execute(
            f"CREATE TABLE IF NOT EXISTS {MAP_SCHEMA}.{MAP_TABLE} (Donusum VARCHAR, Tarih DATE, KaynakTarih DATE)"
        )

    def close(self) -> None:
        if self._owns:
            self._con.close()

    def clear_time_maps(self) -> None:
        """Veri yenilenince tarihler değişebilir; eşlemeler bir sonraki sorguda yeniden üretilir."""
        with self._lock:
            self._con.execute(f"DELETE FROM {MAP_SCHEMA}.{MAP_TABLE}")

    def _date_source(self) -> tuple[str, str]:
        dt = self.model.date_table()
        if dt is None:
            raise RuntimeError("Modelde tarih tablosu işaretlenmemiş")
        key = self.model.column(dt.ad, dt.tarih_tablosu.anahtar_sutun)[1]
        return f'"{dt.kaynak.katman}"."{dt.kaynak.tablo}"', f'"{key.kaynak or key.ad}"'

    def ensure_time_maps(self, keys: set[str]) -> None:
        """Sorgunun ihtiyaç duyduğu zaman zekâsı eşlemelerini (bir kez) üretir."""
        if not keys:
            return
        with self._lock:
            existing = {r[0] for r in self._con.execute(f"SELECT DISTINCT Donusum FROM {MAP_SCHEMA}.{MAP_TABLE}").fetchall()}
            missing = keys - existing
            if not missing:
                return
            src, key_col = self._date_source()
            for k in sorted(missing):
                if k.startswith("MONTH:"):
                    dates = [r[0] for r in self._con.execute(f"SELECT DISTINCT {key_col} FROM {src} ORDER BY 1").fetchall()]
                    rows = mapping_rows(k, dates)
                    self._con.executemany(f"INSERT INTO {MAP_SCHEMA}.{MAP_TABLE} VALUES (?, ?, ?)", rows)
                else:
                    trunc = {"YTD": "year", "QTD": "quarter", "MTD": "month"}[k]
                    # timeintel.period_to_date ile aynı kural, büyük tablo için SQL ile
                    self._con.execute(f"""
                        INSERT INTO {MAP_SCHEMA}.{MAP_TABLE}
                        SELECT '{k}', d.t, s.t
                        FROM (SELECT DISTINCT {key_col} AS t FROM {src}) d
                        JOIN (SELECT DISTINCT {key_col} AS t FROM {src}) s
                          ON s.t BETWEEN CAST(date_trunc('{trunc}', d.t) AS DATE) AND d.t
                    """)

    def execute(self, compiled: CompiledQuery) -> QueryResult:
        if compiled.dialect != "duckdb":
            raise ValueError("DuckDB motoru yalnızca duckdb lehçesindeki SQL'i çalıştırır")
        self.ensure_time_maps(compiled.time_keys)
        cur = self._con.cursor()
        try:
            rows = cur.execute(compiled.sql, compiled.parameters or None).fetchall()
        finally:
            cur.close()
        return QueryResult(compiled.columns, rows)
