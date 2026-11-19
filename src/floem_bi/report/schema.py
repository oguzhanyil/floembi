"""Rapor tanımı (report.json).

Power BI'daki rapor katmanının karşılığı: sayfalar, sayfadaki görseller, konum/boyut
ve alan atamaları. Görseller yalnızca modele başvurur (tablo/sütun/ölçü adı); veri
taşımaz. Aynı tanımı Desktop tasarlar, floembi.app görüntüler.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

VisualType = Literal[
    "table",                                    # veri ızgarası (Data Grid)
    "card", "multicard", "kpi",                 # kartlar
    "column", "bar", "stackedcolumn", "stackedbar", "line", "area",
    "pie", "donut",
    "matrix",                                   # pivot / ağaç tablo (satır + sütun grupları, alt toplamlar)
    "treegrid",                                 # hiyerarşik ağaç tablo
    "scatter", "treemap", "heatmap", "waterfall", "gauge", "progress",
    "slicer",                                   # dilimleyici (liste / açılır / tarih aralığı)
    "text", "shape", "image", "button", "ticker", # tasarım nesneleri ve animasyonlu sayı kartı
]
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
    group: list[FieldRef] = Field(default_factory=list)     # Tablo: Sütunlar · Grafik: X ekseni · Dilimleyici: Alan
    legend: list[FieldRef] = Field(default_factory=list)    # Grafik: Gösterge (seriyi böler)
    values: list[ValueRef] = Field(default_factory=list)    # Tablo: Değerler · Grafik: Y ekseni · Kart: Alan
    target: list[ValueRef] = Field(default_factory=list)    # KPI: Hedef
    filters: list[FilterRef] = Field(default_factory=list)  # görsel düzeyi filtreler
    format: dict[str, Any] = Field(default_factory=dict)     # Biçim bölmesi: başlık, renkler, etiketler, eksenler
    state: dict[str, Any] = Field(default_factory=dict)      # dilimleyici seçimi, sıralama gibi etkileşim durumu


class Page(_B):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    width: int = 1280
    height: int = 720
    backgroundColor: str | None = None
    visuals: list[Visual] = Field(default_factory=list)
    drillthrough: list[FieldRef] = Field(default_factory=list)   # Detaya git (drill-through) alanları


class ThemeSnapshot(_B):
    id: str = Field(min_length=1, max_length=80)
    version: Literal[1] = 1
    mode: Literal["light", "dark"]
    colors: dict[str, str] = Field(max_length=40)
    series: list[str] = Field(min_length=1, max_length=16)
    density: Literal["compact", "comfortable"] = "compact"
    reducedMotion: bool = False

    @model_validator(mode="after")
    def _colors(self) -> "ThemeSnapshot":
        import re
        if any(not re.fullmatch(r"#[0-9a-fA-F]{6}", c) for c in [*self.colors.values(), *self.series]):
            raise ValueError("Tema renkleri #RRGGBB biçiminde olmalı")
        return self


class Report(_B):
    version: int = 1
    theme: ThemeSnapshot | None = None
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
        yield from page.get("drillthrough", [])
        for v in page.get("visuals", []):
            for key in ("group", "legend", "values", "target", "filters"):
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


def rename_measure_refs(report: dict, old: str, new: str) -> None:
    def action_refs(action: dict) -> None:
        if not isinstance(action, dict):
            return
        if action.get("type") == "function" and action.get("functionName") == "measure" and \
                (action.get("measure") or "").lower() == old.lower():
            action["measure"] = new
        for item in action.get("items") or []:
            if isinstance(item, dict):
                action_refs(item.get("action"))

    for page in report.get("pages", []):
        for v in page.get("visuals", []):
            for key in ("values", "target"):
                for ref in v.get(key, []):
                    if (ref.get("measure") or "").lower() == old.lower():
                        ref["measure"] = new
            fmt = v.get("format") or {}
            action_refs(fmt.get("action"))
            action_refs((fmt.get("rowAction") or {}).get("action"))
