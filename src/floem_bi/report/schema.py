"""Rapor tanımı (report.json).

Power BI'daki rapor katmanının karşılığı: sayfalar, sayfadaki görseller, konum/boyut
ve alan atamaları. Görseller yalnızca modele başvurur (tablo/sütun/ölçü adı); veri
taşımaz. Aynı tanımı Desktop tasarlar, floembi.app görüntüler.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

VisualType = Literal["table", "column", "card"]
Agg = Literal["sum", "avg", "min", "max", "count", "distinctcount"]


class _B(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FieldRef(_B):
    """Gruplama alanı: Tablo[Sütun]."""
    table: str
    column: str


class ValueRef(_B):
    """Değer alanı: modeldeki bir ölçü ya da bir sütunun örtük toplaması."""
    measure: str | None = None
    table: str | None = None
    column: str | None = None
    agg: Agg | None = None

    @model_validator(mode="after")
    def _shape(self) -> "ValueRef":
        if self.measure:
            if self.table or self.column or self.agg:
                raise ValueError("Ölçü değerinde tablo/sütun/toplama verilmez")
        elif not (self.table and self.column):
            raise ValueError("Değer alanı ya bir ölçü ya da Tablo[Sütun] olmalı")
        elif self.agg is None:
            self.agg = "sum"
        return self


class FilterRef(_B):
    table: str
    column: str
    op: Literal["in", "not_in", "eq", "ne", "lt", "le", "gt", "ge", "between"] = "in"
    values: list[str | int | float | bool | None]


class Visual(_B):
    id: str = Field(min_length=1, max_length=64)
    type: VisualType
    x: float = 0
    y: float = 0
    w: float = Field(default=420, gt=0)
    h: float = Field(default=280, gt=0)
    title: str | None = None
    group: list[FieldRef] = Field(default_factory=list)     # Tablo: Sütunlar · Sütun grafiği: X ekseni
    values: list[ValueRef] = Field(default_factory=list)    # Tablo: Değerler · Grafik: Y ekseni · Kart: Alan
    filters: list[FilterRef] = Field(default_factory=list)  # görsel düzeyi filtreler
    format: dict[str, Any] = Field(default_factory=dict)     # başlık, etiket gösterimi vb. (serbest)


class Page(_B):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    width: int = 1280
    height: int = 720
    visuals: list[Visual] = Field(default_factory=list)


class Report(_B):
    version: int = 1
    pages: list[Page] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique(self) -> "Report":
        if len({p.id for p in self.pages}) != len(self.pages):
            raise ValueError("Sayfa kimlikleri benzersiz olmalı")
        for p in self.pages:
            if len({v.id for v in p.visuals}) != len(p.visuals):
                raise ValueError(f"'{p.name}' sayfasında görsel kimlikleri benzersiz olmalı")
        return self


def empty_report() -> dict:
    return {"version": 1, "pages": [{"id": "p1", "name": "Sayfa 1", "width": 1280, "height": 720, "visuals": []}]}


# ------------------------------------------------- yeniden adlandırmada referanslar
def _refs(report: dict):
    for page in report.get("pages", []):
        for v in page.get("visuals", []):
            for key in ("group", "values", "filters"):
                for ref in v.get(key, []):
                    yield ref


def rename_table_refs(report: dict, old: str, new: str) -> None:
    for ref in _refs(report):
        if (ref.get("table") or "").lower() == old.lower():
            ref["table"] = new


def rename_column_refs(report: dict, table: str, old: str, new: str) -> None:
    for ref in _refs(report):
        if (ref.get("table") or "").lower() == table.lower() and (ref.get("column") or "").lower() == old.lower():
            ref["column"] = new
