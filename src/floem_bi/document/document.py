"""Açık rapor belgesi (Power BI Desktop'ta açık .pbix'in karşılığı).

Belge; semantik model (ModelTanimi), model görünümü düzeni, rapor tanımı ve bir
çalışma DuckDB dosyasından oluşur. Çalışma dosyası
%LOCALAPPDATA%\\FloemBI\\work\\<belge-id>\\data.duckdb altındadır; "Kaydet" bunu
.floem dosyasına paketler.

İçe aktarım ve yenileme önce geçici (__stg_) tablolara yükler, hepsi başarılı olursa
tek bir transaction içinde gerçek tabloların yerine geçirir. Yarıda kalan ya da
hatalı bir yükleme modeli ve mevcut veriyi değiştirmez.
"""

from __future__ import annotations

import copy
import shutil
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import duckdb

from ..connectors import Connector, ConnectorError, SourceRef, json_value
from ..importer.loader import Cancelled, LoadResult, load, qident, unique_names
from ..importer.relationships import detect
from ..importer.types import DUCKDB_TYPE, NUMERIC_TIPS, model_tip
from ..model.schema import (
    Iliski, ModelBilgisi, ModelTanimi, Sutun, Tablo, TabloKaynak, TabloSorgu, VeriKaynagi, parse_column_ref,
)
from ..engine.duckdb_engine import DuckDBEngine
from ..model.semantic import ModelError, SemanticModel, find_ambiguity
from ..report import Report, VisualQuery, empty_report, run_visual_query
from . import floemfile
from .floemfile import FloemContent, FloemFileError
from .jobs import Job
from .ops import DATA_SCHEMA, OpContext, TIP_ADI, phys_col, phys_table, sanitize_name

APP_VERSION = "0.1.0"
STAGE_PREFIX = "__stg_"
DEFAULT_NAME = "Adsız rapor"


class DocumentError(Exception):
    def __init__(self, message: str, detail: str = "", code: str = "document_error"):
        self.message = message
        self.detail = detail
        self.code = code
        super().__init__(message)


@dataclass
class ImportItem:
    source: SourceRef
    name: str | None = None


def _stage(job: Job, i: int) -> str:
    return f"{STAGE_PREFIX}{job.id}_{i}"


def _q(table: str) -> str:
    return f"{qident(DATA_SCHEMA)}.{qident(table)}"


class Document:
    def __init__(self, directory: Path, content: FloemContent, path: str | None):
        self.id = directory.name
        self.dir = directory
        self.db_path = directory / "data.duckdb"
        self.content = content
        self.path = path
        self.dirty = False
        self.revision = 0
        self.closed = False
        self.lock = threading.RLock()
        self._engine: tuple[int, SemanticModel, DuckDBEngine] | None = None
        if not (content.report or {}).get("pages"):
            content.report = empty_report()
        self._open_db()

    # ---------------------------------------------------------------- yaşam döngüsü
    @staticmethod
    def _new_dir(root: Path) -> Path:
        d = Path(root) / uuid.uuid4().hex[:16]
        d.mkdir(parents=True, exist_ok=False)
        return d

    @classmethod
    def new(cls, root: Path, name: str = DEFAULT_NAME) -> "Document":
        content = FloemContent(
            tanim=ModelTanimi(model=ModelBilgisi(ad=name)),
            diagram={"version": 1, "tables": {}},
            report=empty_report(),
        )
        return cls(cls._new_dir(root), content, None)

    @classmethod
    def open(cls, root: Path, path: str | Path) -> "Document":
        d = cls._new_dir(root)
        try:
            content = floemfile.read(path, d / "data.duckdb")
            try:
                SemanticModel(content.tanim)
            except ModelError as e:
                raise FloemFileError("Dosyadaki model geçersiz", str(e)) from e
            content.diagram.setdefault("tables", {})
            return cls(d, content, str(Path(path).resolve()))
        except BaseException:
            shutil.rmtree(d, ignore_errors=True)
            raise

    def _open_db(self) -> None:
        self.con = duckdb.connect(str(self.db_path))
        self.con.execute(f"CREATE SCHEMA IF NOT EXISTS {qident(DATA_SCHEMA)}")
        for (name,) in self.con.execute(
            "SELECT table_name FROM duckdb_tables() WHERE schema_name = ? AND starts_with(table_name, ?)",
            [DATA_SCHEMA, STAGE_PREFIX],
        ).fetchall():
            self.con.execute(f"DROP TABLE IF EXISTS {_q(name)}")

    def close(self) -> None:
        with self.lock:
            if self.closed:
                return
            self.closed = True
            try:
                self.con.close()
            finally:
                shutil.rmtree(self.dir, ignore_errors=True)

    @property
    def tanim(self) -> ModelTanimi:
        return self.content.tanim

    def _touch(self) -> None:
        self.dirty = True
        self.revision += 1

    # ---------------------------------------------------------------- kaydet
    def save(self, path: str | Path | None = None) -> None:
        with self.lock:
            target = path or self.path
            if not target:
                raise DocumentError("Kaydetmek için bir dosya adı seçin", code="path_required")
            target = Path(target)
            if target.suffix.lower() != ".floem":
                target = target.with_name(target.name + ".floem")
            target = target.resolve()
            if not target.parent.exists():
                raise DocumentError(f"Klasör bulunamadı: {target.parent}", code="path_invalid")
            # Rapor adı dosya adından gelir (Power BI'daki gibi)
            self.content.tanim.model.ad = target.stem
            self.con.execute("CHECKPOINT")
            self.con.close()
            self._engine = None
            try:
                floemfile.write(target, self.content, self.db_path, APP_VERSION)
            finally:
                self._open_db()
            self.path = str(target)
            self.dirty = False
            self.revision += 1

    # ---------------------------------------------------------------- durum
    def state(self) -> dict:
        with self.lock:
            counts = {
                name.lower(): rows
                for name, rows in self.con.execute(
                    "SELECT table_name, estimated_size FROM duckdb_tables() WHERE schema_name = ?", [DATA_SCHEMA]
                ).fetchall()
            }
            try:
                warnings = SemanticModel(self.tanim).warnings
            except ModelError as e:
                warnings = [str(e)]
            return {
                "id": self.id,
                "name": self.tanim.model.ad,
                "path": self.path,
                "dirty": self.dirty,
                "revision": self.revision,
                "model": self.tanim.model_dump(mode="json", exclude_none=True),
                "diagram": self.content.diagram,
                "report": self.content.report,
                "stats": {
                    t.ad: {"rows": counts.get(t.kaynak.tablo.lower()) if t.kaynak.katman == DATA_SCHEMA else None}
                    for t in self.tanim.tablolar
                },
                "warnings": warnings,
            }

    # ---------------------------------------------------------------- düzenleme
    @staticmethod
    def validate(tanim: ModelTanimi) -> None:
        SemanticModel(tanim)
        r = find_ambiguity(tanim.iliskiler)
        if r is not None:
            raise ModelError(
                f"{r.kimden} → {r.kime} ilişkisi etkin olursa iki tablo arasında birden fazla filtre yolu oluşur. "
                "Bu ilişkiyi pasif yapın ya da yoldaki başka bir ilişkiyi pasifleştirin."
            )

    def apply_ops(self, ops: list) -> None:
        with self.lock:
            ctx = OpContext(
                self.tanim.model_copy(deep=True), copy.deepcopy(self.content.diagram),
                report=copy.deepcopy(self.content.report),
            )
            for op in ops:
                op.apply(ctx)
            self.validate(ctx.tanim)
            if ctx.checks:
                cur = self.con.cursor()
                cur.execute("BEGIN TRANSACTION")
                try:
                    for check in ctx.checks:
                        check(cur)
                    cur.execute("COMMIT")
                except BaseException:
                    cur.execute("ROLLBACK")
                    raise
                finally:
                    cur.close()
            self.content.tanim = ctx.tanim
            self.content.diagram = ctx.diagram
            self.content.report = ctx.report
            self._touch()

    def set_diagram(self, tables: dict[str, dict], mark_dirty: bool = True) -> None:
        with self.lock:
            known = {t.ad for t in self.tanim.tablolar}
            clean = {}
            for name, pos in tables.items():
                if name not in known:
                    continue
                clean[name] = {
                    "x": round(float(pos.get("x", 0)), 1),
                    "y": round(float(pos.get("y", 0)), 1),
                    **({"collapsed": True} if pos.get("collapsed") else {}),
                }
            if clean != self.content.diagram.get("tables"):
                self.content.diagram["tables"] = clean
                if mark_dirty:
                    self._touch()
                else:
                    self.revision += 1

    # ---------------------------------------------------------------- rapor
    def set_report(self, report: dict) -> None:
        """Rapor tanımını doğrulayıp saklar (görsel ekleme, taşıma, alan atama...)."""
        clean = Report.model_validate(report).model_dump(mode="json", exclude_none=True)
        with self.lock:
            if clean != self.content.report:
                self.content.report = clean
                self._touch()

    def _semantic_engine(self) -> tuple[SemanticModel, DuckDBEngine]:
        if self._engine is None or self._engine[0] != self.revision:
            model = SemanticModel(self.tanim)
            self._engine = (self.revision, model, DuckDBEngine(None, model, con=self.con))
        return self._engine[1], self._engine[2]

    def query(self, q: VisualQuery) -> dict:
        with self.lock:
            model, engine = self._semantic_engine()
            return run_visual_query(model, engine, q)

    # ---------------------------------------------------------------- veri
    def preview(self, table: str, limit: int = 100) -> dict:
        with self.lock:
            t = OpContext(self.tanim, {}).table(table)
            cols = [c for c in t.sutunlar if c.ifade is None]
            if not cols:
                return {"columns": [], "rows": [], "truncated": False, "elapsed_ms": 0, "row_count": 0}
            select = ", ".join(f"{phys_col(c)} AS {qident(c.ad)}" for c in cols)
            cur = self.con.cursor()
            try:
                rows = cur.execute(f"SELECT {select} FROM {phys_table(t)} LIMIT {int(limit) + 1}").fetchall()
            finally:
                cur.close()
            return {
                "columns": [{"name": c.ad, "type": c.tip} for c in cols],
                "rows": [[json_value(v) for v in r] for r in rows[:limit]],
                "truncated": len(rows) > limit,
                "elapsed_ms": 0,
                "row_count": min(len(rows), limit),
            }

    def relationship_profile(self, kimden: str, kime: str) -> dict:
        """İlişki penceresi için: iki sütunun benzersizliği ve eşleşme oranı (Power BI'daki ön kontrol)."""
        with self.lock:
            ctx = OpContext(self.tanim, {})
            (ta, ca), (tb, cb) = ctx.resolve(kimden), ctx.resolve(kime)
            cur = self.con.cursor()
            try:
                def prof(t: Tablo, c: Sutun) -> dict:
                    n, d, nn = cur.execute(
                        f"SELECT count(*), count(DISTINCT {phys_col(c)}), count({phys_col(c)}) FROM {phys_table(t)}"
                    ).fetchone()
                    return {"rows": n, "distinct": d, "nulls": n - nn, "unique": d == nn and n - nn <= 1}

                pa, pb = prof(ta, ca), prof(tb, cb)
                matched = None
                if ca.tip == cb.tip or {ca.tip, cb.tip} <= NUMERIC_TIPS:
                    matched = cur.execute(
                        f"SELECT count(DISTINCT a.{phys_col(ca)}) FROM {phys_table(ta)} a "
                        f"WHERE a.{phys_col(ca)} IN (SELECT b.{phys_col(cb)} FROM {phys_table(tb)} b)"
                    ).fetchone()[0]
            finally:
                cur.close()
        if pb["unique"]:
            suggested = "1:1" if pa["unique"] else "*:1"
        elif pa["unique"]:
            suggested = "1:*"
        else:
            suggested = "*:*"
        return {"from": pa, "to": pb, "matched": matched, "suggested": suggested}

    # ---------------------------------------------------------------- içe aktarım
    def plan_names(self, items: list[ImportItem]) -> list[str]:
        taken = {t.ad.lower() for t in self.tanim.tablolar}
        names = []
        for i, it in enumerate(items):
            s = it.source
            base = sanitize_name(it.name or s.table or f"Sorgu{i + 1}", "Tablo")
            if not it.name and s.table and base.lower() in taken and (s.schema or "dbo").lower() != "dbo":
                base = sanitize_name(f"{s.schema} {s.table}", "Tablo")
            cand, n = base, 2
            while cand.lower() in taken:
                cand = f"{base} ({n})"
                n += 1
            taken.add(cand.lower())
            names.append(cand)
        return names

    def _physical_tables(self, cur) -> set[str]:
        return {
            r[0].lower()
            for r in cur.execute(
                "SELECT table_name FROM duckdb_tables() WHERE schema_name = ?", [DATA_SCHEMA]
            ).fetchall()
        }

    def _load_all(self, job: Job, plans: list[tuple[Connector, SourceRef]], cur) -> list[LoadResult]:
        results = []
        for i, (connector, source) in enumerate(plans):
            jt = job.tables[i]
            jt.status = "running"
            with connector.extract(source) as ex:
                job.on_cancel = ex.cancel
                res = load(cur, ex, _q(_stage(job, i)), job.cancelled, lambda n, jt=jt: setattr(jt, "rows", n))
            job.on_cancel = None
            jt.status = "done"
            results.append(res)
        if job.cancelled():
            raise Cancelled()
        return results

    def _drop_stages(self, job: Job, count: int) -> None:
        if self.closed:
            return
        with self.lock:
            for i in range(count):
                self.con.execute(f"DROP TABLE IF EXISTS {_q(_stage(job, i))}")

    def _check_alive(self, job: Job) -> None:
        if self.closed or job.doc_id != self.id:
            raise DocumentError("Belge kapatıldığı için işlem iptal edildi", code="document_closed")

    def run_import(
        self, job: Job, connector: Connector, kaynak: VeriKaynagi, items: list[ImportItem], names: list[str],
    ) -> None:
        warnings: list[str] = []
        fks = []
        for db in sorted({it.source.database or "" for it in items if it.source.table}):
            try:
                fks += [(db, fk) for fk in connector.foreign_keys(db or None)]
            except ConnectorError as e:
                warnings.append(f"Yabancı anahtarlar okunamadı ({db}): {e.message}")
        cur = self.con.cursor()
        try:
            results = self._load_all(job, [(connector, it.source) for it in items], cur)
            for name, res in zip(names, results):
                if res.skipped:
                    warnings.append(f"{name}: desteklenmeyen tipte oldukları için alınmayan sütunlar: {', '.join(res.skipped)}")
            with self.lock:
                self._check_alive(job)
                tanim = self.tanim.model_copy(deep=True)
                existing = next((k for k in tanim.veri_kaynaklari if k.id == kaynak.id), None)
                if existing:
                    tanim.veri_kaynaklari.remove(existing)
                tanim.veri_kaynaklari.append(kaynak)
                phys_taken = self._physical_tables(cur)
                cur.execute("BEGIN TRANSACTION")
                try:
                    for i, (it, name, res) in enumerate(zip(items, names, results)):
                        phys, n = sanitize_name(name, "Tablo"), 2
                        base = phys
                        while phys.lower() in phys_taken or phys.lower().startswith(STAGE_PREFIX):
                            phys = f"{base}_{n}"
                            n += 1
                        phys_taken.add(phys.lower())
                        cur.execute(f"ALTER TABLE {_q(_stage(job, i))} RENAME TO {qident(phys)}")
                        tanim.tablolar.append(_table_from(name, phys, it.source, kaynak.id, res))
                    suggestions = detect(cur, tanim, set(names), fks)
                    for s in suggestions:
                        tanim.iliskiler.append(s.iliski)
                        for ref in (s.iliski.kimden, s.iliski.kime):
                            tn, cn = parse_column_ref(ref)
                            ctx = OpContext(tanim, {})
                            c = ctx.column(ctx.table(tn), cn)
                            if c.tip in NUMERIC_TIPS:
                                c.ozet = "none"
                    self.validate(tanim)
                    cur.execute("DROP TABLE IF EXISTS floem.tarih_map")   # tarihler değişmiş olabilir
                    cur.execute("COMMIT")
                except BaseException:
                    cur.execute("ROLLBACK")
                    raise
                self.content.tanim = tanim
                self._touch()
            job.result = {
                "tables": names,
                "relationships": [
                    {"kimden": s.iliski.kimden, "kime": s.iliski.kime, "aktif": s.iliski.aktif, "neden": s.neden}
                    for s in suggestions
                ],
                "warnings": warnings,
            }
        finally:
            try:
                self._drop_stages(job, len(items))
            finally:
                cur.close()

    def refresh_targets(self, only: list[str] | None = None) -> list[Tablo]:
        wanted = {n.lower() for n in only} if only else None
        return [t for t in self.tanim.tablolar if t.sorgu and (wanted is None or t.ad.lower() in wanted)]

    def run_refresh(self, job: Job, connector_for: Callable[[str], Connector], targets: list[Tablo]) -> None:
        """Power BI Desktop'taki "Yenile": tabloları kaynaktan yeniden yükler, şema değişikliklerini uygular."""
        warnings: list[str] = []
        cur = self.con.cursor()
        connectors: dict[str, Connector] = {}
        plans = []
        phys_names = [t.kaynak.tablo for t in targets]
        try:
            for t in targets:
                s = t.sorgu
                if s.kaynak not in connectors:
                    connectors[s.kaynak] = connector_for(s.kaynak)
                plans.append((connectors[s.kaynak], SourceRef(s.veritabani, s.sema, s.tablo, s.sql)))
            results = self._load_all(job, plans, cur)
            with self.lock:
                self._check_alive(job)
                tanim = self.tanim.model_copy(deep=True)
                cur.execute("BEGIN TRANSACTION")
                try:
                    for i, (phys, res) in enumerate(zip(phys_names, results)):
                        t = next((x for x in tanim.tablolar if x.kaynak.tablo == phys), None)
                        if t is None:          # yenileme sürerken tablo silinmiş
                            continue
                        _sync_columns(tanim, t, res, _q(_stage(job, i)), cur, warnings)
                        cur.execute(f"DROP TABLE IF EXISTS {_q(phys)}")
                        cur.execute(f"ALTER TABLE {_q(_stage(job, i))} RENAME TO {qident(phys)}")
                    self.validate(tanim)
                    cur.execute("DROP TABLE IF EXISTS floem.tarih_map")   # tarihler değişmiş olabilir
                    cur.execute("COMMIT")
                except BaseException:
                    cur.execute("ROLLBACK")
                    raise
                self.content.tanim = tanim
                self._touch()
            job.result = {"tables": [t.ad for t in targets], "warnings": warnings}
        finally:
            try:
                self._drop_stages(job, len(targets))
            finally:
                cur.close()


def _new_column(ec_name: str, mname: str, dt, is_pk: bool) -> Sutun:
    tip = model_tip(dt)
    ozet = ("none" if is_pk else "sum") if tip in NUMERIC_TIPS else None
    return Sutun(ad=mname, kaynak=None if mname == ec_name else ec_name, tip=tip, anahtar=is_pk, ozet=ozet)


def _table_from(name: str, phys: str, source: SourceRef, kaynak_id: str, res: LoadResult) -> Tablo:
    mnames = unique_names([sanitize_name(c.name, "Sütun") for c in res.columns])
    cols = [_new_column(c.name, m, dt, c.is_primary_key) for c, dt, m in zip(res.columns, res.types, mnames)]
    sorgu = TabloSorgu(
        kaynak=kaynak_id, veritabani=source.database,
        sema=(source.schema or "dbo") if source.table else None, tablo=source.table, sql=source.sql,
    )
    return Tablo(ad=name, kaynak=TabloKaynak(katman=DATA_SCHEMA, tablo=phys), sorgu=sorgu, sutunlar=cols)


def _drop_column_refs(tanim: ModelTanimi, t: Tablo, c: Sutun) -> list[Iliski]:
    removed = []
    keep = []
    for r in tanim.iliskiler:
        hit = False
        for ref in (r.kimden, r.kime):
            tn, cn = parse_column_ref(ref)
            hit |= tn.lower() == t.ad.lower() and cn.lower() == c.ad.lower()
        (removed if hit else keep).append(r)
    tanim.iliskiler = keep
    for h in t.hiyerarsiler:
        h.seviyeler = [s for s in h.seviyeler if s.lower() != c.ad.lower()]
    t.hiyerarsiler = [h for h in t.hiyerarsiler if h.seviyeler]
    for o in t.sutunlar:
        if o.siralama_sutunu and o.siralama_sutunu.lower() == c.ad.lower():
            o.siralama_sutunu = None
    if t.tarih_tablosu and t.tarih_tablosu.anahtar_sutun.lower() == c.ad.lower():
        t.tarih_tablosu = None
    return removed


def _sync_columns(tanim: ModelTanimi, t: Tablo, res: LoadResult, stage: str, cur, warnings: list[str]) -> None:
    """Kaynakta eklenen/silinen sütunları modele yansıtır; kullanıcının değiştirdiği tipleri korur."""
    loaded = {c.name.lower(): (c, dt) for c, dt in zip(res.columns, res.types)}
    by_phys = {(c.kaynak or c.ad).lower(): c for c in t.sutunlar if c.ifade is None}
    for key, c in by_phys.items():
        if key not in loaded:
            t.sutunlar.remove(c)
            gone = _drop_column_refs(tanim, t, c)
            msg = f"{t.ad}[{c.ad}] kaynakta artık yok; modelden kaldırıldı"
            if gone:
                msg += f" ({len(gone)} ilişki de kaldırıldı)"
            warnings.append(msg)
    taken = {c.ad.lower() for c in t.sutunlar}
    for key, (ec, dt) in loaded.items():
        c = by_phys.get(key)
        if c is None:
            base, name, n = sanitize_name(ec.name, "Sütun"), sanitize_name(ec.name, "Sütun"), 2
            while name.lower() in taken:
                name = f"{base} ({n})"
                n += 1
            taken.add(name.lower())
            t.sutunlar.append(_new_column(ec.name, name, dt, ec.is_primary_key))
            warnings.append(f"{t.ad}[{name}] kaynakta yeni; modele eklendi")
            continue
        loaded_tip = model_tip(dt)
        if loaded_tip != c.tip:
            try:
                cur.execute(f"ALTER TABLE {stage} ALTER {qident(ec.name)} TYPE {DUCKDB_TYPE[c.tip]}")
            except duckdb.Error as e:
                raise ModelError(
                    f"{t.ad}[{c.ad}] {TIP_ADI[c.tip]} tipine çevrilemedi: kaynaktaki yeni değerler bu tipe uymuyor"
                ) from e
