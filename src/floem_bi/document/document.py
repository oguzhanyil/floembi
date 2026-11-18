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
from ..importer.types import DUCKDB_TYPE, NUMERIC_TIPS, model_tip, tip_from_duckdb
from ..transform import ADIM_ADI, StepError, build, dependencies, parse_steps
from ..model.schema import (
    Iliski, ModelBilgisi, ModelTanimi, Sutun, Tablo, TabloKaynak, TabloSorgu, VeriKaynagi, parse_column_ref,
)
from ..compiler import CompileError, SqlGenerator
from ..engine.duckdb_engine import DuckDBEngine
from ..model.semantic import ModelError, SemanticModel, find_ambiguity
from ..report import Report, VisualQuery, empty_report, run_visual_query
from . import floemfile
from .floemfile import FloemContent, FloemFileError
from .jobs import Job
from .ops import DATA_SCHEMA, OpContext, RenameColumn, TIP_ADI, phys_col, phys_table, sanitize_name

APP_VERSION = "0.1.0"
STAGE_PREFIX = "__stg_"
RAW_SUFFIX = "__ham"          # dönüştürme adımı olan tablonun kaynaktan gelen ham hâli
PREVIEW_LIMIT = 1000
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


def raw_name(t: Tablo) -> str:
    return f"{t.kaynak.tablo}{RAW_SUFFIX}"


def _step_error(t: Tablo, steps: list, e: StepError) -> DocumentError:
    label = ADIM_ADI.get(getattr(steps[e.index], "tur", ""), "") if e.index < len(steps) else ""
    where = f"Adım {e.index + 1}" + (f" ({label})" if label else "")
    err = DocumentError(f"{t.ad} → {where}: {e.message}", e.detail, code="transform_step")
    err.step = e.index
    return err


def _rename_trace(steps: list) -> dict[str, str]:
    """Yeniden adlandırma adımları boyunca: kaynak sütun adı (küçük harf) → son ad."""
    cur: dict[str, tuple[str, str]] = {}            # şimdiki ad (küçük) → (şimdiki ad, köken)
    for s in steps:
        if getattr(s, "tur", None) == "yeniden_adlandir":
            _, origin = cur.pop(s.sutun.lower(), (s.sutun, s.sutun))
            cur[s.yeni_ad.lower()] = (s.yeni_ad, origin)
    return {origin.lower(): name for name, origin in cur.values()}


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
            self._check_measures(ctx.tanim, ctx.measure_checks)
            self._check_roles(ctx.tanim, ctx.role_checks)
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

    @staticmethod
    def _check_measures(tanim: ModelTanimi, names: list[str]) -> None:
        """Eklenen/düzenlenen ölçüler derlenebilmeli (söz dizimi, ad çözümleme, desteklenen fonksiyonlar)."""
        if not names:
            return
        from ..compiler import CompileError, MeasureCompiler
        from ..compiler import ir as _ir

        model = SemanticModel(tanim)
        for name in names:
            try:
                MeasureCompiler(model).measure(name, _ir.Context())
            except CompileError as e:
                raise ModelError(f"[{name}] {e.message}") from e

    @staticmethod
    def _check_roles(tanim: ModelTanimi, names: list[str]) -> None:
        """RLS filtreleri tablonun satır bağlamında derlenebilmeli (ör. [Sehir] = "İstanbul")."""
        if not names:
            return
        from ..compiler import CompileError, MeasureCompiler, UserInfo

        model = SemanticModel(tanim)
        compiler = MeasureCompiler(model, UserInfo(upn="kontrol@floem"))
        wanted = {n.lower() for n in names}
        for rol in tanim.roller:
            if rol.ad.lower() not in wanted:
                continue
            for iz in rol.tablo_izinleri:
                try:
                    compiler.row_predicate(iz.filtre, model.table(iz.tablo).ad)
                except CompileError as e:
                    raise ModelError(f"'{rol.ad}' rolü, {iz.tablo} filtresi: {e.message}") from e

    def validate_dax(self, expression: str, table: str | None = None) -> dict:
        """Formül çubuğu için: hataları konumlarıyla döndürür (kaydetmeden)."""
        from ..compiler import CompileError, MeasureCompiler
        from ..compiler import ir as _ir
        from ..dax import DaxSyntaxError, parse

        try:
            parse(expression)
        except DaxSyntaxError as e:
            return {"ok": False, "errors": [{"message": e.message, "start": e.span.start, "end": e.span.end}]}
        with self.lock:
            model, _ = self._semantic_engine()
        try:
            MeasureCompiler(model).expression(expression, _ir.Context())
        except CompileError as e:
            span = e.span
            return {"ok": False, "errors": [{
                "message": e.message, "start": span.start if span else None, "end": span.end if span else None,
            }]}
        return {"ok": True, "errors": []}

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

    def query(self, q: VisualQuery, view_as: list[str] | None = None, upn: str | None = None) -> dict:
        """view_as: Power BI "Farklı görüntüle"; verilen rollerin RLS filtreleriyle sorgular."""
        with self.lock:
            model, engine = self._semantic_engine()
            if not view_as:
                return run_visual_query(model, engine, q)
            from ..compiler import UserInfo

            known = {r.ad.lower() for r in self.tanim.roller}
            missing = [r for r in view_as if r.lower() not in known]
            if missing:
                raise ModelError(f"Rol bulunamadı: {', '.join(missing)}")
            return run_visual_query(model, engine, q, user=UserInfo(upn=upn or ""), roles=view_as)

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

    def _data_columns(self, table: str):
        """Tablo görünümü sütunları: (Sutun, SQL ifadesi | None, uyarı)."""
        t = OpContext(self.tanim, {}).table(table)
        model, _ = self._semantic_engine()
        gen = SqlGenerator(model, "duckdb")
        out = []
        for c in t.sutunlar:
            try:
                out.append((c, gen.row_expression(t.ad, c.ad), None))
            except (CompileError, ModelError) as e:
                out.append((c, None, f"Hesaplanmış sütun tablo görünümünde gösterilemiyor: {getattr(e, 'message', str(e))}"))
        return t, out

    def table_rows(self, table: str, offset: int = 0, limit: int = 500, sort: dict | None = None,
                   filters: list[dict] | None = None) -> dict:
        """Power BI "Tablo görünümü": satırlar sayfa sayfa, sıralama ve sütun değer filtreleriyle."""
        with self.lock:
            t, cols = self._data_columns(table)
            exprs = {c.ad.lower(): e for c, e, _ in cols}
            where, params = [], []
            for f in filters or []:
                e = exprs.get(str(f.get("column", "")).lower())
                vals = f.get("values") or []
                if not e or not vals:
                    continue
                non_null = [v for v in vals if v is not None]
                parts = []
                if non_null:
                    parts.append(f"{e} IN ({', '.join('?' for _ in non_null)})")
                    params += non_null
                if len(non_null) != len(vals):
                    parts.append(f"{e} IS NULL")
                where.append("(" + " OR ".join(parts) + ")")
            cond = f" WHERE {' AND '.join(where)}" if where else ""
            order = ""
            if sort and exprs.get(str(sort.get("column", "")).lower()):
                order = f" ORDER BY {exprs[sort['column'].lower()]} {'DESC' if sort.get('desc') else 'ASC'} NULLS LAST"
            select = ", ".join(f"{e} AS {qident(c.ad)}" if e else f"NULL AS {qident(c.ad)}" for c, e, _ in cols)
            src = f"{phys_table(t)} AS t"
            cur = self.con.cursor()
            try:
                total = cur.execute(f"SELECT count(*) FROM {src}{cond}", params).fetchone()[0]
                rows = cur.execute(
                    f"SELECT {select} FROM {src}{cond}{order} LIMIT {int(limit)} OFFSET {int(offset)}", params,
                ).fetchall() if cols else []
            except duckdb.Error as e:
                raise DocumentError("Tablo verisi okunamadı", str(e).split("\n")[0], code="data_view") from e
            finally:
                cur.close()
            return {
                "columns": [
                    {"name": c.ad, "type": c.tip, "calculated": c.ifade is not None, "hidden": c.gizli, "warning": w}
                    for c, _, w in cols
                ],
                "rows": [[json_value(v) for v in r] for r in rows],
                "offset": offset,
                "total": total,
            }

    def column_values(self, table: str, column: str, limit: int = 1000) -> dict:
        """Sütun filtresi listesi için farklı değerler."""
        with self.lock:
            t, cols = self._data_columns(table)
            e = next((e for c, e, _ in cols if c.ad.lower() == column.lower()), None)
            if e is None:
                return {"values": [], "truncated": False}
            cur = self.con.cursor()
            try:
                rows = cur.execute(
                    f"SELECT DISTINCT {e} FROM {phys_table(t)} AS t ORDER BY 1 NULLS FIRST LIMIT {int(limit) + 1}"
                ).fetchall()
            finally:
                cur.close()
            return {"values": [json_value(r[0]) for r in rows[:limit]], "truncated": len(rows) > limit}

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
                        while (phys.lower() in phys_taken or phys.lower().startswith(STAGE_PREFIX)
                               or phys.lower().endswith(RAW_SUFFIX)):
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

    # ---------------------------------------------------------------- veri dönüştürme (Power Query)
    @staticmethod
    def _table_map(tanim: ModelTanimi, exclude: Tablo | None = None) -> dict[str, str]:
        return {
            t.ad.lower(): _q(t.kaynak.tablo) for t in tanim.tablolar
            if t is not exclude and t.kaynak.katman == DATA_SCHEMA
        }

    def _transform_table(self, name: str) -> Tablo:
        t = OpContext(self.tanim, {}).table(name)
        if t.sorgu is None:
            raise DocumentError(
                f"{t.ad} bir veri kaynağından gelmiyor; yalnızca içe aktarılan tablolar dönüştürülebilir",
                code="not_transformable",
            )
        return t

    def _source_of(self, cur, t: Tablo) -> str:
        raw = raw_name(t)
        return _q(raw) if raw.lower() in self._physical_tables(cur) else _q(t.kaynak.tablo)

    @staticmethod
    def _check_cycle(tanim: ModelTanimi, t: Tablo, steps: list) -> None:
        by_name = {x.ad.lower(): x for x in tanim.tablolar}
        todo, seen = list(dependencies(steps)), set()
        while todo:
            n = todo.pop()
            if n == t.ad.lower():
                raise DocumentError(
                    f"{t.ad} kendisine (doğrudan ya da başka bir tablo üzerinden) başvuramaz", code="transform_cycle",
                )
            if n in seen or n not in by_name:
                continue
            seen.add(n)
            o = by_name[n]
            if o.sorgu and o.sorgu.adimlar:
                todo += list(dependencies(parse_steps(o.sorgu.adimlar)))

    def transform_preview(self, table: str, raw_steps: list[dict], upto: int | None = None,
                          limit: int = PREVIEW_LIMIT) -> dict:
        """Power Query düzenleyicisindeki önizleme: adımlar `upto`'ya kadar uygulanmış ilk satırlar.

        Bir adım hatalıysa ondan önceki son geçerli sonuç ve hata birlikte döner (düzenleyici
        hatalı adımı işaretler)."""
        with self.lock:
            t = self._transform_table(table)
            steps = parse_steps(raw_steps)
            self._check_cycle(self.tanim, t, steps)
            cur = self.con.cursor()
            try:
                source = self._source_of(cur, t)
                tables = self._table_map(self.tanim, exclude=t)
                n = len(steps) if upto is None else max(0, min(upto, len(steps)))
                error = None
                try:
                    built = build(cur, source, steps, tables, n)
                except StepError as e:
                    de = _step_error(t, steps, e)
                    error = {"step": e.index, "message": de.message, "detail": de.detail}
                    built = build(cur, source, steps, tables, e.index)
                try:
                    rows = cur.execute(f"SELECT * FROM ({built.sql}) LIMIT {int(limit) + 1}").fetchall()
                except duckdb.Error as e:          # yalnızca veri okunurken ortaya çıkan hatalar
                    step = n - 1 if n else 0
                    msg = "Değerler istenen tipe dönüştürülemedi" if "onver" in str(e) else "Adım uygulanamadı"
                    return {
                        "columns": [{"name": c, "type": tip_from_duckdb(ty)} for c, ty in built.columns],
                        "rows": [], "truncated": False, "applied": n,
                        "error": {"step": step, "message": msg, "detail": str(e).split("\n")[0]},
                    }
            finally:
                cur.close()
            return {
                "columns": [{"name": c, "type": tip_from_duckdb(ty)} for c, ty in built.columns],
                "rows": [[json_value(v) for v in r] for r in rows[:limit]],
                "truncated": len(rows) > limit,
                "applied": n if error is None else error["step"],
                "error": error,
            }

    def _rebuild(self, cur, tanim: ModelTanimi, t: Tablo, stage: str, warnings: list[str],
                 old_steps: list | None = None) -> None:
        """Ham tablodan adımlarla son tabloyu yeniden kurar ve model sütunlarını eşitler.

        `old_steps` verilirse (düzenleyiciden "Uygula"), adımlarla tipi değişen sütunların model
        tipi yeni tipe geçer; yeniden adlandırılan sütunlar ilişki ve ölçüleriyle birlikte taşınır."""
        steps = parse_steps(t.sorgu.adimlar)
        tables = self._table_map(tanim, exclude=t)
        try:
            built = build(cur, _q(raw_name(t)), steps, tables)
        except StepError as e:
            raise _step_error(t, steps, e) from e
        cols = [(c, tip_from_duckdb(ty)) for c, ty in built.columns]
        adopt: set[str] = set()
        if old_steps is not None:
            try:
                old = {c.lower(): tip_from_duckdb(ty) for c, ty in build(cur, _q(raw_name(t)), old_steps, tables).columns}
            except StepError:
                old = {}
            self._carry_renames(tanim, t, old_steps, steps, [c for c, _ in cols])
            for name, tip in cols:
                if old.get(name.lower()) not in (None, tip):
                    adopt.add(name.lower())
        cur.execute(f"CREATE TABLE {_q(stage)} AS {built.sql}")
        _sync_columns(tanim, t, [(n, tip, False) for n, tip in cols], _q(stage), cur, warnings, adopt)
        cur.execute(f"DROP TABLE IF EXISTS {_q(t.kaynak.tablo)}")
        cur.execute(f"ALTER TABLE {_q(stage)} RENAME TO {qident(t.kaynak.tablo)}")

    def _carry_renames(self, tanim: ModelTanimi, t: Tablo, old_steps: list, steps: list, final: list[str]) -> None:
        """Adımlarla yeniden adlandırılan sütunları modelde de yeniden adlandırır (ilişki, ölçü ve
        rapor referanslarıyla); böylece sütun silinip yeniden eklenmiş gibi özelliklerini kaybetmez."""
        old_trace, new_trace = _rename_trace(old_steps), _rename_trace(steps)
        back = {v.lower(): k for k, v in old_trace.items()}
        names = {c.lower(): c for c in final}
        ctx = OpContext(tanim, {}, report=self._pending_report)
        for c in list(t.sutunlar):
            if c.ifade is not None:
                continue
            phys = c.kaynak or c.ad
            origin = back.get(phys.lower(), phys)
            new_phys = new_trace.get(origin.lower(), origin)
            if new_phys.lower() == phys.lower() or new_phys.lower() not in names:
                continue
            new_phys = names[new_phys.lower()]
            if c.kaynak is None and not any(o.ad.lower() == new_phys.lower() for o in t.sutunlar if o is not c):
                RenameColumn(op="rename_column", table=t.ad, column=c.ad, new_name=new_phys).apply(ctx)
            c.kaynak = None if c.ad == new_phys else new_phys

    def _dependents(self, tanim: ModelTanimi, changed: set[str]) -> list[Tablo]:
        """Adımlarında `changed` tablolarından birine başvuran tablolar (bağımlılık sırasıyla)."""
        out: list[Tablo] = []
        changed = set(changed)
        progress = True
        while progress:
            progress = False
            for o in tanim.tablolar:
                if o in out or o.ad.lower() in changed or not (o.sorgu and o.sorgu.adimlar):
                    continue
                if dependencies(parse_steps(o.sorgu.adimlar)) & changed:
                    out.append(o)
                    changed.add(o.ad.lower())
                    progress = True
        return out

    def apply_steps(self, table: str, raw_steps: list[dict]) -> dict:
        """Power Query'deki "Kapat ve uygula": adımları kaydeder, tabloyu yeniden kurar."""
        with self.lock:
            t0 = self._transform_table(table)
            steps = parse_steps(raw_steps)
            self._check_cycle(self.tanim, t0, steps)
            tanim = self.tanim.model_copy(deep=True)
            self._pending_report = copy.deepcopy(self.content.report)
            t = next(x for x in tanim.tablolar if x.ad == t0.ad)
            old_steps = parse_steps(t.sorgu.adimlar)
            t.sorgu.adimlar = [s.model_dump(exclude_defaults=False) for s in steps]
            warnings: list[str] = []
            cur = self.con.cursor()
            try:
                has_raw = raw_name(t).lower() in self._physical_tables(cur)
                cur.execute("BEGIN TRANSACTION")
                try:
                    if steps:
                        if not has_raw:
                            cur.execute(f"ALTER TABLE {_q(t.kaynak.tablo)} RENAME TO {qident(raw_name(t))}")
                        self._rebuild(cur, tanim, t, f"{STAGE_PREFIX}tr_{t.kaynak.tablo}", warnings, old_steps)
                    elif has_raw:
                        # adımlar kaldırıldı: ham tablo yeniden asıl tablo olur
                        try:
                            before = {c.lower(): tip_from_duckdb(ty) for c, ty in build(
                                cur, _q(raw_name(t)), old_steps, self._table_map(tanim, exclude=t)).columns}
                        except StepError:
                            before = {}
                        cur.execute(f"DROP TABLE IF EXISTS {_q(t.kaynak.tablo)}")
                        cur.execute(f"ALTER TABLE {_q(raw_name(t))} RENAME TO {qident(t.kaynak.tablo)}")
                        old = [(r[0], tip_from_duckdb(r[1])) for r in cur.execute(
                            f"DESCRIBE {_q(t.kaynak.tablo)}").fetchall()]
                        self._carry_renames(tanim, t, old_steps, [], [n for n, _ in old])
                        _sync_columns(tanim, t, [(n, tip, False) for n, tip in old], _q(t.kaynak.tablo), cur,
                                      warnings, {n.lower() for n, tip in old if before.get(n.lower()) not in (None, tip)})
                    for i, o in enumerate(self._dependents(tanim, {t.ad.lower()})):
                        self._rebuild(cur, tanim, o, f"{STAGE_PREFIX}tr{i}_{o.kaynak.tablo}", warnings)
                    self.validate(tanim)
                    cur.execute("DROP TABLE IF EXISTS floem.tarih_map")
                    cur.execute("COMMIT")
                except BaseException:
                    cur.execute("ROLLBACK")
                    raise
            finally:
                cur.close()
            self.content.tanim = tanim
            self.content.report = self._pending_report
            self._pending_report = None
            self._touch()
            return {"warnings": warnings}

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
                    transformed: list[Tablo] = []
                    for i, (phys, res) in enumerate(zip(phys_names, results)):
                        t = next((x for x in tanim.tablolar if x.kaynak.tablo == phys), None)
                        if t is None:          # yenileme sürerken tablo silinmiş
                            continue
                        if t.sorgu and t.sorgu.adimlar:
                            # yeni ham veri; son tablo adımlar uygulanarak aşağıda yeniden kurulur
                            if raw_name(t).lower() not in self._physical_tables(cur):
                                cur.execute(f"ALTER TABLE {_q(phys)} RENAME TO {qident(raw_name(t))}")
                            cur.execute(f"DROP TABLE IF EXISTS {_q(raw_name(t))}")
                            cur.execute(f"ALTER TABLE {_q(_stage(job, i))} RENAME TO {qident(raw_name(t))}")
                            transformed.append(t)
                            continue
                        _sync_columns(tanim, t, _loaded_columns(res), _q(_stage(job, i)), cur, warnings)
                        cur.execute(f"DROP TABLE IF EXISTS {_q(phys)}")
                        cur.execute(f"ALTER TABLE {_q(_stage(job, i))} RENAME TO {qident(phys)}")
                    # adımlı tablolar ve onlara (birleştirme/ekleme ile) bağlı tablolar, bağımlılık sırasıyla
                    refreshed = {t.ad.lower() for t in targets}
                    order = _topo(transformed + [d for d in self._dependents(tanim, refreshed) if d not in transformed])
                    for k, t in enumerate(order):
                        self._rebuild(cur, tanim, t, f"{STAGE_PREFIX}tr{k}_{t.kaynak.tablo}", warnings)
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


def _loaded_columns(res: LoadResult) -> list[tuple[str, str, bool]]:
    return [(c.name, model_tip(dt), c.is_primary_key) for c, dt in zip(res.columns, res.types)]


def _topo(tables: list[Tablo]) -> list[Tablo]:
    """Adımlı tabloları, başvurdukları tablolardan sonra gelecek şekilde sıralar."""
    names = {t.ad.lower(): t for t in tables}
    out: list[Tablo] = []
    state: dict[str, int] = {}

    def visit(t: Tablo) -> None:
        key = t.ad.lower()
        if state.get(key) == 2:
            return
        if state.get(key) == 1:
            raise DocumentError("Tabloların dönüştürme adımları birbirine döngüsel olarak bağlı", code="transform_cycle")
        state[key] = 1
        for d in sorted(dependencies(parse_steps(t.sorgu.adimlar))):
            if d in names:
                visit(names[d])
        state[key] = 2
        out.append(t)

    for t in tables:
        visit(t)
    return out


def _new_column(ec_name: str, mname: str, tip: str, is_pk: bool) -> Sutun:
    ozet = ("none" if is_pk else "sum") if tip in NUMERIC_TIPS else None
    return Sutun(ad=mname, kaynak=None if mname == ec_name else ec_name, tip=tip, anahtar=is_pk, ozet=ozet)


def _table_from(name: str, phys: str, source: SourceRef, kaynak_id: str, res: LoadResult) -> Tablo:
    mnames = unique_names([sanitize_name(c.name, "Sütun") for c in res.columns])
    cols = [_new_column(c.name, m, model_tip(dt), c.is_primary_key) for c, dt, m in zip(res.columns, res.types, mnames)]
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


def _sync_columns(tanim: ModelTanimi, t: Tablo, cols: list[tuple[str, str, bool]], stage: str, cur,
                  warnings: list[str], adopt: set[str] = frozenset()) -> None:
    """Kaynakta (ya da dönüştürme sonucunda) eklenen/silinen sütunları modele yansıtır.

    `cols`: (fiziksel ad, model tipi, birincil anahtar mı). Kullanıcının modelde değiştirdiği
    tipler korunur; `adopt`taki sütunlarda (adımla tipi değişenler) model tipi yeni tipe geçer."""
    loaded = {name.lower(): (name, tip, pk) for name, tip, pk in cols}
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
    for key, (pname, tip, pk) in loaded.items():
        c = by_phys.get(key)
        if c is None:
            base, name, n = sanitize_name(pname, "Sütun"), sanitize_name(pname, "Sütun"), 2
            while name.lower() in taken:
                name = f"{base} ({n})"
                n += 1
            taken.add(name.lower())
            t.sutunlar.append(_new_column(pname, name, tip, pk))
            warnings.append(f"{t.ad}[{name}] kaynakta yeni; modele eklendi")
            continue
        if c.kaynak and c.kaynak != pname:
            c.kaynak = None if c.ad == pname else pname        # yalnızca büyük/küçük harf farkı
        if tip != c.tip and key in adopt:
            c.tip = tip
            if tip in NUMERIC_TIPS and c.ozet is None and not c.anahtar:
                c.ozet = "sum"
            elif tip not in NUMERIC_TIPS:
                c.ozet = None
        elif tip != c.tip:
            try:
                cur.execute(f"ALTER TABLE {stage} ALTER {qident(pname)} TYPE {DUCKDB_TYPE[c.tip]}")
            except duckdb.Error as e:
                raise ModelError(
                    f"{t.ad}[{c.ad}] {TIP_ADI[c.tip]} tipine çevrilemedi: kaynaktaki yeni değerler bu tipe uymuyor"
                ) from e
