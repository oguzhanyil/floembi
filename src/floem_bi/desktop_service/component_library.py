"""Kullanıcının yerel, sürümlü tasarım kitaplığı. Veri bağlantısı veya sorgu sonucu tutmaz."""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from ..report.schema import ComponentDefinition, ComponentLibrary

MAX_BYTES = 10 * 1024 * 1024


class ComponentStore:
    def __init__(self, directory: Path):
        self.path = directory / "components.json"
        self.lock = threading.Lock()

    def load(self) -> ComponentLibrary:
        if not self.path.exists():
            return ComponentLibrary()
        if self.path.stat().st_size > MAX_BYTES:
            raise ValueError("Kitaplık 10 MB sınırını aşıyor")
        return ComponentLibrary.model_validate_json(self.path.read_bytes())

    def save(self, components: list[ComponentDefinition], expected: int) -> ComponentLibrary:
        with self.lock:
            before = self.load()
            if before.revision != expected:
                raise FileExistsError("Kitaplık değişti; listeyi yenileyip yeniden deneyin")
            old = {(c.id, c.version): c for c in before.components}
            result = ComponentLibrary(revision=before.revision + 1, components=components)
            for item in result.components:
                previous = old.get((item.id, item.version))
                if previous and previous != item:
                    raise ValueError("Yayımlanmış bileşen sürümü değiştirilemez; yeni sürüm oluşturun")
            payload = json.dumps(result.model_dump(mode="json", exclude_none=True), ensure_ascii=False).encode("utf-8")
            if len(payload) > MAX_BYTES:
                raise ValueError("Kitaplık 10 MB sınırını aşıyor; eski bileşenleri dışa aktarıp kaldırabilirsiniz")
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(".json.tmp")
            try:
                temporary.write_bytes(payload)
                os.replace(temporary, self.path)
            finally:
                temporary.unlink(missing_ok=True)
            return result
