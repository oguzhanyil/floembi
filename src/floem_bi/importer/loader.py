"""Bir kaynağı parça parça okuyup DuckDB'de bir tabloya yazar."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import duckdb
import pyarrow as pa

from ..connectors import ExtractColumn, Extraction
from .types import arrow_type, to_arrow

BATCH_ROWS = 50_000


class Cancelled(Exception):
    pass


@dataclass
class LoadResult:
    columns: list[ExtractColumn]          # adları tekilleştirilmiş
    types: list[pa.DataType]
    rows: int
    skipped: list[str]


def unique_names(names: list[str]) -> list[str]:
    """DuckDB sütun adları büyük/küçük harf duyarsızdır: 'Ad', 'ad' → 'Ad', 'ad (2)'."""
    seen: set[str] = set()
    out = []
    for n in names:
        cand, i = n.strip() or "Sütun", 2
        while cand.lower() in seen:
            cand = f"{n} ({i})"
            i += 1
        seen.add(cand.lower())
        out.append(cand)
    return out


def qident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def load(
    cur: duckdb.DuckDBPyConnection,
    extraction: Extraction,
    target: str,
    cancelled: Callable[[], bool],
    progress: Callable[[int], None],
    batch_rows: int = BATCH_ROWS,
) -> LoadResult:
    """`target` (tam nitelikli, tırnaklı) tabloyu oluşturur ve doldurur."""
    cols = extraction.columns
    names = unique_names([c.name for c in cols])
    for c, n in zip(cols, names):
        c.name = n
    types = [arrow_type(c) for c in cols]
    schema = pa.schema([pa.field(n, t) for n, t in zip(names, types)])
    total, created = 0, False
    while True:
        if cancelled():
            raise Cancelled()
        rows = extraction.fetch(batch_rows)
        batch = to_arrow(rows, schema)
        cur.register("__floem_batch", batch)
        try:
            if not created:
                cur.execute(f"CREATE TABLE {target} AS SELECT * FROM __floem_batch")
                created = True
            elif rows:
                cur.execute(f"INSERT INTO {target} SELECT * FROM __floem_batch")
        finally:
            cur.unregister("__floem_batch")
        total += len(rows)
        progress(total)
        if len(rows) < batch_rows:
            break
    return LoadResult(cols, types, total, list(extraction.skipped))
