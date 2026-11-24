"""Sentetik satış verisi üzerinde Floem görsel sorgusunun süresini ve doğruluğunu ölçer."""

import statistics
import tempfile
from pathlib import Path
from time import perf_counter

import duckdb

from floem_bi.engine.duckdb_engine import DuckDBEngine
from floem_bi.model import SemanticModel
from floem_bi.model.schema import ModelTanimi
from floem_bi.report import VisualQuery, run_visual_query


def benchmark(size, directory):
    path = directory / f"satis-{size}.duckdb"
    model = SemanticModel(ModelTanimi.model_validate({"model": {"ad": "H9"},
        "tablolar": [{"ad": "Satis", "kaynak": {"katman": "veri", "tablo": "Satis"},
                     "sutunlar": [{"ad": "Bolge", "tip": "int32"}, {"ad": "Tutar", "tip": "int64"}],
                     "olculer": [{"ad": "Net", "ifade": "SUM(Satis[Tutar])"}]}]}))
    start = perf_counter()
    with duckdb.connect(str(path)) as c:
        c.execute("CREATE SCHEMA veri")
        c.execute("CREATE TABLE veri.Satis AS SELECT (i % 100)::INTEGER Bolge, i::BIGINT Tutar FROM range(?) t(i)", [size])
    load = perf_counter() - start
    engine = DuckDBEngine(path, model)
    query = VisualQuery.model_validate({"group": [{"table": "Satis", "column": "Bolge"}], "values": [{"measure": "Net"}]})
    durations = []
    try:
        for _ in range(6):
            start = perf_counter()
            rows = run_visual_query(model, engine, query)["rows"]
            durations.append(1000 * (perf_counter() - start))
            assert len(rows) == 100 and sum(row[1] for row in rows) == size * (size - 1) // 2
    finally:
        engine.close()
    print(f"{size:,} satır | üretim {load:.2f} sn | ilk sorgu {durations[0]:.1f} ms | "
          f"sonraki 5 medyan {statistics.median(durations[1:]):.1f} ms | {path.stat().st_size / 2**20:.1f} MiB")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as temp:
        for count in (1_000_000, 5_000_000):
            benchmark(count, Path(temp))
