""".floem dosya biçimi (Power BI'daki .pbix karşılığı).

Zip arşivi:
  manifest.json   biçim adı/sürümü, uygulama sürümü, tarih
  model.yaml      semantik model (ModelTanimi; şifre içermez)
  diagram.json    model görünümündeki kart konumları
  report.json     rapor tanımı (H4'te doluyor)
  documentTemplates.json   baskı şablonları (biçim 2), yerleşim araçlarıyla (biçim 3)
  data.duckdb     içe aktarılmış veri (Import modu anlık görüntüsü)

Yazma atomiktir: önce geçici dosyaya yazılır, sonra yerine taşınır. Okurken yalnızca
bu adlar okunur; arşiv toptan açılmaz (zip-slip yok).
"""

from __future__ import annotations

import json
import os
import shutil
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from ..model.schema import ModelTanimi
from .print_forms import PrintTemplate

FORMAT = "floem"
FORMAT_VERSION = 3
MAX_JSON_BYTES = 50 * 1024 * 1024


class FloemFileError(Exception):
    def __init__(self, message: str, detail: str = ""):
        self.message = message
        self.detail = detail
        super().__init__(message)


@dataclass
class FloemContent:
    tanim: ModelTanimi
    diagram: dict[str, Any] = field(default_factory=dict)
    report: dict[str, Any] = field(default_factory=dict)
    manifest: dict[str, Any] = field(default_factory=dict)
    print_templates: list[PrintTemplate] = field(default_factory=list)


def dump_model(tanim: ModelTanimi) -> str:
    data = tanim.model_dump(mode="json", exclude_none=True, exclude_defaults=True)
    data.setdefault("model", {"ad": tanim.model.ad})
    return yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=120)


def write(path: str | Path, content: FloemContent, db_file: str | Path, app_version: str) -> None:
    path = Path(path)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    manifest = {
        "format": FORMAT,
        "format_version": 3 if any(t.layout is not None for t in content.print_templates) else (2 if content.print_templates else 1),
        "app": f"Floem BI Desktop {app_version}",
        "created": content.manifest.get("created", now),
        "modified": now,
        "model": content.tanim.model.ad,
    }
    tmp = path.with_name(path.name + ".tmp")
    try:
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            z.writestr("model.yaml", dump_model(content.tanim))
            z.writestr("diagram.json", json.dumps(content.diagram, ensure_ascii=False, indent=2))
            z.writestr("report.json", json.dumps(content.report or {"version": 1, "pages": []}, ensure_ascii=False))
            if content.print_templates:
                z.writestr("documentTemplates.json", json.dumps([t.model_dump(exclude_none=True) for t in content.print_templates], ensure_ascii=False))
            # DuckDB dosyası zaten sıkıştırılmış; tekrar sıkıştırmak yalnızca yavaşlatır
            z.write(db_file, "data.duckdb", compress_type=zipfile.ZIP_STORED)
        os.replace(tmp, path)
    except OSError as e:
        tmp.unlink(missing_ok=True)
        raise FloemFileError(f"Dosya kaydedilemedi: {path}", str(e)) from e
    content.manifest = manifest


def _json(z: zipfile.ZipFile, name: str, default: Any) -> Any:
    try:
        info = z.getinfo(name)
    except KeyError:
        return default
    if info.file_size > MAX_JSON_BYTES:
        raise FloemFileError(f"{name} beklenenden büyük")
    return json.loads(z.read(info).decode("utf-8"))


def read(path: str | Path, db_dest: str | Path) -> FloemContent:
    path = Path(path)
    try:
        z = zipfile.ZipFile(path)
    except FileNotFoundError as e:
        raise FloemFileError(f"Dosya bulunamadı: {path}") from e
    except zipfile.BadZipFile as e:
        raise FloemFileError("Bu dosya bir Floem BI dosyası değil ya da bozuk", str(e)) from e
    with z:
        manifest = _json(z, "manifest.json", None)
        if not isinstance(manifest, dict) or manifest.get("format") != FORMAT:
            raise FloemFileError("Bu dosya bir Floem BI dosyası değil (manifest.json eksik)")
        if int(manifest.get("format_version", 0)) > FORMAT_VERSION:
            raise FloemFileError(
                "Bu dosya Floem BI'ın daha yeni bir sürümüyle kaydedilmiş; uygulamayı güncelleyin",
                f"dosya biçimi {manifest.get('format_version')}, desteklenen {FORMAT_VERSION}",
            )
        try:
            raw = z.read("model.yaml").decode("utf-8")
            tanim = ModelTanimi.model_validate(yaml.safe_load(raw))
        except KeyError as e:
            raise FloemFileError("model.yaml eksik") from e
        except (ValidationError, yaml.YAMLError) as e:
            raise FloemFileError("Model tanımı okunamadı", str(e)) from e
        diagram = _json(z, "diagram.json", {})
        report = _json(z, "report.json", {"version": 1, "pages": []})
        try:
            entries = _json(z, "documentTemplates.json", [] if manifest.get("format_version", 1) == 1 else None)
            if not isinstance(entries, list):
                raise ValueError("Belge şablonları listesi eksik veya geçersiz")
            templates = [PrintTemplate.model_validate(t) for t in entries]
            if len({t.kind for t in templates}) != len(templates):
                raise ValueError("Yinelenen belge şablonu")
        except (TypeError, ValueError) as e:
            raise FloemFileError("Belge şablonu okunamadı", str(e)) from e
        try:
            with z.open("data.duckdb") as src, open(db_dest, "wb") as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
        except KeyError:
            pass  # veri yoksa (yalnızca model) boş veritabanıyla açılır
    return FloemContent(tanim=tanim, diagram=diagram, report=report, manifest=manifest, print_templates=templates)
