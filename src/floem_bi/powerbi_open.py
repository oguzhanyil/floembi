"""Aç: Power BI kaynağını yeni, kaydedilmemiş ve taşınabilir Floem belgesine çevirir."""
from __future__ import annotations

from contextlib import ExitStack
from pathlib import Path
import tempfile
import zipfile

import pyarrow as pa

from .compiler import QueryRequest, SqlGenerator
from .dax.rename import bracket_token
from .document.document import Document
from .document.floemfile import FloemFileError
from .model.schema import Sutun
from .model.semantic import SemanticModel
from .pbip_import import prepare_report
from .powerbi_layout import MAX_FILE, contained, project_paths, stage_pbix, stage_project
from .powerbi_model import cached_model, deny_role, issue, project_model
from .report.schema import empty_report

SQL_TYPES = {"int32": "INTEGER", "int64": "BIGINT", "double": "DOUBLE", "decimal": "DECIMAL(38,10)", "bool": "BOOLEAN", "date": "DATE", "datetime": "TIMESTAMP", "string": "VARCHAR"}
quote = lambda name: '"' + name.replace('"', '""') + '"'


def _empty_table(doc, table):
    if not table.sutunlar: table.sutunlar.append(Sutun(ad="__floem_placeholder", tip="int64", gizli=True))
    columns = ",".join(quote(c.ad) + " " + SQL_TYPES[c.tip] for c in table.sutunlar)
    doc.con.execute(f'CREATE TABLE veri.{quote(table.kaynak.tablo)} ({columns})')


def _fill_table(doc, table, reader, issues):
    if reader is None: return 0
    if all(c.ad == "__floem_placeholder" for c in table.sutunlar): return 0
    physical = f'veri.{quote(table.kaynak.tablo)}'
    rows, size = 0, 0
    try:
        if table.ad not in reader.tables: raise ValueError("missing")
        for frame in reader.iter_table(table.ad, chunk_size=100000, strings_as_categorical=False):
            names = [c.ad for c in table.sutunlar]
            if not set(names).issubset(frame.columns): raise ValueError("schema")
            batch = pa.Table.from_pandas(frame[names], preserve_index=False)
            rows += len(batch); size += batch.nbytes
            if rows > 10000000 or size > 1024 ** 3: raise ValueError("limit")
            doc.con.register("_powerbi_batch", batch)
            try: doc.con.execute(f'INSERT INTO {physical} SELECT * FROM _powerbi_batch')
            finally: doc.con.unregister("_powerbi_batch")
        # Gömülü hesaplanmış sütun değerleri fiziksel anlık görüntü olarak kullanılır.
        for column in table.sutunlar: column.ifade = None
        return rows
    except Exception:
        doc.con.execute(f'DELETE FROM {physical}')
        issues.append(issue("TABLE_DATA_NOT_IMPORTED", "Tablonun gömülü verisi okunamadı, şema uyuşmadı veya sınırı aştı; kısmi satırlar kullanılmadı.", table.ad, "error"))
        return 0


def open_powerbi(root: Path, path: str | Path) -> Document:
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    source = Path(path).resolve()
    if not source.exists(): raise FloemFileError("Power BI dosyası bulunamadı")
    doc = None
    try:
        with tempfile.TemporaryDirectory(prefix="floem-powerbi-", dir=root) as folder, ExitStack() as stack:
            staged = Path(folder) / (source.stem + ".Report")
            issues = []
            reader, model = None, None
            is_pbix = source.suffix.lower() == ".pbix"
            if is_pbix:
                has_data = stage_pbix(source, staged)
                cache = source if has_data else None
            else:
                report_path, semantic_path, project_root = project_paths(source)
                stage_project(report_path, staged, project_root)
                model = project_model(semantic_path, issues) if semantic_path else None
                cache = contained(semantic_path / ".pbi/cache.abf", project_root) if semantic_path else None
                cache = cache if cache and cache.is_file() else None
            if cache:
                if cache.stat().st_size > MAX_FILE: raise ValueError("Gömülü model dosyası 2 GB sınırını aşıyor")
                try:
                    from pbixray import PBIXRay
                    reader = stack.enter_context(PBIXRay(str(cache), on_disk=True, temp_dir=folder))
                    model = model or cached_model(reader, source.stem, issues)
                except Exception:
                    reader = None
                    issues.append(issue("DATA_MODEL_NOT_READABLE", "Gömülü model sürümü okunamadı; düzenlenebilir yerleşim alındı. Bağlantı/yenileme işlemi yapılmadı.", severity="error"))
            report, placeholder, _ = prepare_report(staged)
            if not report["pages"]: report["pages"] = empty_report()["pages"]
            original_measures = {m.ad.lower() for t in model.tablolar for m in t.olculer} if model else set()
            for page in report["importAudit"]["pages"]:
                for visual in page["visuals"]:
                    refs = [f for f in visual["fields"] if f["kind"] == "measure"]
                    if refs and all(f["name"].lower() in original_measures for f in refs):
                        visual["issues"] = [i for i in visual["issues"] if i["code"] != "MEASURE_PLACEHOLDER"]
                        for field in refs: field["status"] = "mapped"
            if model is None:
                model = placeholder
                issues.append(issue("SOURCE_MODEL_UNAVAILABLE", "Semantik model veya yerel veri kopyası bulunamadı. Alanlar taslak olarak alındı.", severity="error"))
            else:
                # Raporda olup kaynak modelde olmayan alanlar görünür taslak olarak tutulur.
                by_name = {t.ad.lower(): t for t in model.tablolar}
                for table in placeholder.tablolar:
                    actual = by_name.get(table.ad.lower())
                    if actual is None:
                        model.tablolar.append(table); by_name[table.ad.lower()] = table
                        issues.append(issue("MODEL_FIELD_MISSING", "Rapor tablosu kaynak modelde bulunamadı; boş taslak eklendi.", table.ad, "error"))
                        continue
                    columns = {c.ad.lower() for c in actual.sutunlar}
                    for col in table.sutunlar:
                        if col.ad == "__floem_placeholder" or col.ad.lower() in columns: continue
                        actual.sutunlar.append(col)
                        issues.append(issue("MODEL_FIELD_MISSING", "Rapor alanı kaynak modelde bulunamadı.", f"{actual.ad}[{col.ad}]", "error"))
                    known = {m.ad.lower() for t in model.tablolar for m in t.olculer}
                    for m in table.olculer:
                        if m.ad.lower() not in known:
                            actual.olculer.append(m); known.add(m.ad.lower())
                            issues.append(issue("MODEL_FIELD_MISSING", "Özgün ölçü bulunamadı; taslak ölçü korundu.", m.ad, "error"))
            model.model.ad = source.stem
            # Fiziksel adlar yalnız aktarım alanına aittir; kaynak bağlantı bilgisi saklanmaz.
            for i, table in enumerate(model.tablolar):
                table.kaynak.katman, table.kaynak.tablo, table.sorgu = "veri", f"pbi_{i}", None
                for col in table.sutunlar: col.kaynak = None
            model.veri_kaynaklari = []
            # Yerleşimden sonradan eklenen taslak tablolar da kapalı rollerin kapsamındadır.
            model.roller = [deny_role(model, role.ad) for role in model.roller]
            semantic = SemanticModel(model)
            unsupported = 0
            for table in model.tablolar:
                for measure in table.olculer:
                    try: SqlGenerator(semantic, "duckdb").compile(QueryRequest(group_by=[], measures=[], expressions=[(measure.ad, bracket_token(measure.ad))]))
                    except Exception:
                        unsupported += 1
                        issues.append(issue("MEASURE_ADAPTATION_REQUIRED", "Ölçü ifadesi korundu; mevcut FDX motorunda uyarlama gerekli.", f"{table.ad}[{measure.ad}]", "error"))
            doc = Document.new(root, source.stem)
            doc.content.tanim = model
            counts = {}
            for table in model.tablolar:
                _empty_table(doc, table)
                counts[table.ad] = _fill_table(doc, table, reader, issues)
            if not reader:
                issues.append(issue("DATA_UNAVAILABLE", "Bu kaynakta okunabilir yerel veri yok. PBIP projelerinde .pbi/cache.abf her zaman bulunmaz; tablo ve model görünümü boş olabilir.", severity="error"))
            audit = report["importAudit"]
            audit["scope"] = "model_and_data" if reader else "model_only"
            audit["source"] = source.name
            audit["sourceFormat"] = "pbix" if is_pbix else "pbip"
            audit["data"] = {"rows": sum(counts.values()), "tables": counts, "status": "partial" if any(i["code"] == "TABLE_DATA_NOT_IMPORTED" for i in issues) else "loaded" if reader else "unavailable"}
            audit["model"] = {"tables": len(model.tablolar), "measures": sum(len(t.olculer) for t in model.tablolar), "relationships": len(model.iliskiler), "roles": len(model.roller), "unsupportedMeasures": unsupported}
            audit["issues"] = [i for i in audit["issues"] if i["code"] != "MODEL_NOT_IMPORTED"] + issues
            doc.set_report(report)
            doc._touch()
            return doc
    except BaseException as error:
        if doc: doc.close()
        if isinstance(error, (KeyboardInterrupt, SystemExit)): raise
        message = str(error) if isinstance(error, (ValueError, FileNotFoundError, zipfile.BadZipFile)) and not type(error).__module__.startswith("pydantic") else "Dosya biçimi veya semantik model doğrulanamadı"
        raise FloemFileError("Power BI dosyası açılamadı", message) from error
