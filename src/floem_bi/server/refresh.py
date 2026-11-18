"""Gateway'den gelen Arrow parçalarıyla yeni DuckDB anlık görüntüsü kurar.

Bu sınıf yalnızca geçici bir kopyaya yazar. Yayımdaki dosya ve metadata,
bütün tablolar ve Floem Query adımları bitmeden değiştirilmez.
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import pyarrow as pa

from ..importer.loader import qident
from ..model.schema import ModelTanimi, Tablo
from ..transform import ADIM_ADI, StepError, build, dependencies, parse_steps


class RefreshError(Exception):
    def __init__(self, message: str, *, stage: str, table: str | None = None, detail: str = ""):
        super().__init__(message)
        self.message, self.stage, self.table, self.detail = message, stage, table, detail


def _physical(t: Tablo, raw: bool = False) -> str:
    name = t.kaynak.tablo + ("__ham" if raw else "")
    return f"{qident(t.kaynak.katman)}.{qident(name)}"


class SnapshotBuilder:
    def __init__(self, source: Path, destination: Path, model: ModelTanimi):
        destination.parent.mkdir(parents=True, exist_ok=True)
        # Windows'ta açık DuckDB dosyası fiziksel olarak kopyalanamaz. Mantıksal kopya,
        # rapor sorguları eski veritabanını açık tutarken de çalışır.
        original = duckdb.connect(str(source))
        try:
            catalog = original.execute("SELECT current_database()").fetchone()[0]
            original.execute("ATTACH ? AS __refresh_stage", [str(destination)])
            original.execute(f"COPY FROM DATABASE {qident(catalog)} TO __refresh_stage")
            original.execute("DETACH __refresh_stage")
        finally:
            original.close()
        self.path = destination
        self.model = model
        self.con = duckdb.connect(str(destination))
        self.tables = {t.ad: t for t in model.tablolar if t.sorgu}
        self.current: Tablo | None = None
        self.received: set[str] = set()
        self.batches = 0

    def start_table(self, name: str) -> None:
        if self.current is not None or name not in self.tables or name in self.received:
            raise RefreshError("Beklenmeyen tablo başlangıcı", stage="Aktarım", table=name)
        self.current = self.tables[name]
        self.batches = 0

    def add_batch(self, data: bytes) -> None:
        t = self.current
        if t is None:
            raise RefreshError("Tablo seçilmeden veri gönderildi", stage="Aktarım")
        try:
            batch = pa.ipc.open_stream(data).read_all()
            if batch.num_columns == 0:
                raise ValueError("Sütun içermeyen Arrow parçası")
            self.con.register("__gateway_batch", batch)
            target = _physical(t, bool(t.sorgu.adimlar))
            try:
                if self.batches == 0:
                    self.con.execute(f"CREATE OR REPLACE TABLE {target} AS SELECT * FROM __gateway_batch")
                elif batch.num_rows:
                    self.con.execute(f"INSERT INTO {target} SELECT * FROM __gateway_batch")
            finally:
                self.con.unregister("__gateway_batch")
            self.batches += 1
        except (duckdb.Error, pa.ArrowException, ValueError) as e:
            raise RefreshError("Arrow verisi yüklenemedi", stage="Aktarım", table=t.ad, detail=str(e)) from e

    def end_table(self, name: str) -> None:
        if self.current is None or self.current.ad != name or not self.batches:
            raise RefreshError("Tablo aktarımı eksik", stage="Aktarım", table=name)
        self.received.add(name)
        self.current = None

    def finish(self) -> None:
        if self.current or self.received != set(self.tables):
            missing = ", ".join(sorted(set(self.tables) - self.received))
            raise RefreshError(f"Eksik tablolar: {missing or self.current.ad}", stage="Aktarım")
        # Birleştir/ekle adımları diğer model tablolarına dayanabilir.
        ordered: list[Tablo] = []
        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(t: Tablo) -> None:
            if t.ad in visited:
                return
            if t.ad in visiting:
                raise RefreshError("Floem Query adımlarında döngü var", stage="Dönüştürme", table=t.ad)
            visiting.add(t.ad)
            for name in dependencies(parse_steps(t.sorgu.adimlar)):
                other = next((x for x in self.tables.values() if x.ad.lower() == name), None)
                if other:
                    visit(other)
            visiting.remove(t.ad)
            visited.add(t.ad)
            ordered.append(t)

        for t in self.tables.values():
            visit(t)
        for t in ordered:
            if t.sorgu.adimlar:
                steps = parse_steps(t.sorgu.adimlar)
                others = {x.ad.lower(): _physical(x) for x in self.model.tablolar if x.ad != t.ad}
                try:
                    result = build(self.con, _physical(t, True), steps, others)
                    self.con.execute(f"CREATE OR REPLACE TABLE {_physical(t)} AS {result.sql}")
                except StepError as e:
                    label = ADIM_ADI.get(getattr(steps[e.index], "tur", ""), "")
                    stage = f"Floem Query adım {e.index + 1}" + (f" ({label})" if label else "")
                    raise RefreshError(e.message, stage=stage, table=t.ad, detail=e.detail) from e
                except duckdb.Error as e:
                    raise RefreshError("Floem Query adımı uygulanamadı", stage="Dönüştürme", table=t.ad,
                                       detail=str(e)) from e
            actual = {r[0].lower() for r in self.con.execute(f"DESCRIBE SELECT * FROM {_physical(t)}").fetchall()}
            missing = [(c.kaynak or c.ad) for c in t.sutunlar if c.ifade is None and (c.kaynak or c.ad).lower() not in actual]
            if missing:
                raise RefreshError(f"Modeldeki sütunlar kaynakta yok: {', '.join(missing)}",
                                   stage="Model doğrulama", table=t.ad,
                                   detail=f"Kaynak sütunlar: {', '.join(sorted(actual))}")
        self.con.execute("DROP TABLE IF EXISTS floem.tarih_map")
        self.con.execute("CHECKPOINT")
        self.close()

    def close(self) -> None:
        if self.con is not None:
            self.con.close()
            self.con = None
