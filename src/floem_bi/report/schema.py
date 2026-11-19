"""Rapor tanımı (report.json).

Power BI'daki rapor katmanının karşılığı: sayfalar, sayfadaki görseller, konum/boyut
ve alan atamaları. Görseller yalnızca modele başvurur (tablo/sütun/ölçü adı); veri
taşımaz. Aynı tanımı Desktop tasarlar, floembi.app görüntüler.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator

VisualType = Literal[
    "table",                                    # veri ızgarası (Data Grid)
    "card", "multicard", "kpi",                 # kartlar
    "column", "bar", "stackedcolumn", "stackedbar", "line", "area",
    "pie", "donut",
    "matrix",                                   # pivot / ağaç tablo (satır + sütun grupları, alt toplamlar)
    "treegrid",                                 # hiyerarşik ağaç tablo
    "scatter", "treemap", "heatmap", "waterfall", "gauge", "progress",
    "slicer",                                   # dilimleyici (liste / açılır / tarih aralığı)
    "text", "shape", "image", "button", "ticker", "container", # tasarım nesneleri
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


class LayoutItem(_B):
    grow: FiniteFloat = Field(default=0, ge=0, le=100)
    minWidth: FiniteFloat = Field(default=40, ge=1, le=20000)
    maxWidth: FiniteFloat = Field(default=20000, ge=1, le=20000)
    minHeight: FiniteFloat = Field(default=28, ge=1, le=20000)
    maxHeight: FiniteFloat = Field(default=20000, ge=1, le=20000)

    @model_validator(mode="after")
    def _bounds(self) -> "LayoutItem":
        if self.minWidth > self.maxWidth or self.minHeight > self.maxHeight:
            raise ValueError("En küçük boyut en büyük boyutu aşamaz")
        return self


class ContainerLayout(_B):
    kind: Literal["group", "frame"] = "frame"
    mode: Literal["free", "horizontal", "vertical", "grid"] = "free"
    gap: FiniteFloat = Field(default=12, ge=0, le=128)
    padding: FiniteFloat = Field(default=16, ge=0, le=128)
    columns: int = Field(default=2, ge=1, le=12)
    align: Literal["start", "center", "end", "stretch"] = "stretch"
    justify: Literal["start", "center", "end", "space-between"] = "start"
    wrap: bool = True
    autoHeight: bool = False
    overflow: Literal["visible", "clip"] = "visible"


class ComponentBinding(_B):
    table: str | None = None
    column: str | None = None
    measure: str | None = None
    agg: Agg | None = None
    pageId: str | None = None
    visualId: str | None = None


def check_binding(kind: str, binding: ComponentBinding) -> None:
    keys = binding.model_dump(exclude_none=True)
    if kind == "field":
        valid = set(keys) == {"table", "column"}
    elif kind == "value":
        valid = set(keys) == {"measure"} or {"table", "column"} <= set(keys) <= {"table", "column", "agg"}
    else:
        valid = set(keys) == {dict(measure="measure", page="pageId", visual="visualId")[kind]}
    if not valid or any(not value.strip() for value in keys.values() if isinstance(value, str)):
        raise ValueError("Bileşen yuvasının alan eşlemesi geçersiz")


class ComponentInstance(_B):
    definitionId: str = Field(min_length=1, max_length=80)
    version: int = Field(ge=1, le=100000)
    nodeMap: dict[str, str] = Field(min_length=1, max_length=200)
    bindings: dict[str, ComponentBinding] = Field(default_factory=dict, max_length=200)


class Visual(_B):
    id: str = Field(min_length=1, max_length=64)
    type: VisualType
    x: FiniteFloat = 0
    y: FiniteFloat = 0
    w: FiniteFloat = Field(default=420, gt=0)
    h: FiniteFloat = Field(default=280, gt=0)
    title: str | None = None
    parentId: str | None = None
    container: ContainerLayout | None = None
    layoutItem: LayoutItem | None = None
    component: ComponentInstance | None = None
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
    displayOption: Literal["FitToPage", "FitToWidth", "ActualSize"] | None = None
    backgroundTransparency: FiniteFloat | None = Field(default=None, ge=0, le=100)
    outspaceColor: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")
    outspaceTransparency: FiniteFloat | None = Field(default=None, ge=0, le=100)
    visuals: list[Visual] = Field(default_factory=list)
    drillthrough: list[FieldRef] = Field(default_factory=list)   # Detaya git (drill-through) alanları


def validate_tree(visuals: list[Visual]) -> None:
    by_id = {v.id: v for v in visuals}
    if len(by_id) != len(visuals):
        raise ValueError("Görsel kimlikleri benzersiz olmalı")
    for v in visuals:
        if v.container is not None and v.type != "container":
            raise ValueError("Kapsayıcı düzeni yalnız kapsayıcı nesnesine uygulanabilir")
        current, seen = v, {v.id}
        while current.parentId is not None:
            parent = by_id.get(current.parentId)
            if parent is None or parent.type != "container":
                raise ValueError("Üst nesne aynı sayfada bir kapsayıcı olmalı")
            if parent.id in seen:
                raise ValueError("Kapsayıcılar döngü oluşturamaz")
            seen.add(parent.id)
            if len(seen) > 16:
                raise ValueError("En fazla 16 iç içe nesne düzeyi kullanılabilir")
            current = parent


class ComponentSite(_B):
    visualId: str = Field(min_length=1, max_length=64)
    path: list[str] = Field(min_length=2, max_length=20)


class ComponentSlot(_B):
    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=120)
    kind: Literal["field", "value", "measure", "page", "visual"]
    sites: list[ComponentSite] = Field(min_length=1, max_length=400)
    defaultBinding: ComponentBinding | None = None


class ComponentDefinition(_B):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    version: int = Field(ge=1, le=100000)
    rootId: str = Field(min_length=1, max_length=64)
    visuals: list[Visual] = Field(min_length=1, max_length=200)
    slots: list[ComponentSlot] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def _definition(self) -> "ComponentDefinition":
        import re
        validate_tree(self.visuals)
        roots = [v.id for v in self.visuals if v.parentId is None]
        if roots != [self.rootId] or any(v.component is not None for v in self.visuals):
            raise ValueError("Bileşen tek köklü olmalı; iç bileşenler tasarım kopyası olarak kaydedilir")
        if len({s.id for s in self.slots}) != len(self.slots):
            raise ValueError("Bileşen yuva kimlikleri benzersiz olmalı")
        nodes = {v.id: v.model_dump(mode="json", exclude_none=True) for v in self.visuals}
        if any(key in {"__proto__", "constructor", "prototype"} for key in [*nodes, *(s.id for s in self.slots)]):
            raise ValueError("Bileşen kimliği ayrılmış bir ad olamaz")
        used = set()
        for slot in self.slots:
            if slot.defaultBinding:
                check_binding(slot.kind, slot.defaultBinding)
            for site in slot.sites:
                path = ".".join(site.path)
                ref_path = re.fullmatch(r"(group|legend|values|target|filters)\.[0-9]{1,3}", path)
                action_path = re.fullmatch(r"format\.(rowAction\.)?action(\.items\.[0-9]{1,3}\.action)*", path)
                if not (ref_path or action_path) or (site.visualId, path) in used:
                    raise ValueError("Bileşen yuvasının hedef yolu geçersiz veya yineleniyor")
                used.add((site.visualId, path))
                try:
                    node = nodes[site.visualId]
                    for key in site.path:
                        node = node[int(key)] if isinstance(node, list) else node[key]
                except (KeyError, IndexError, ValueError, TypeError) as e:
                    raise ValueError("Bileşen yuvasının hedefi bulunamadı") from e
                expected = "field" if ref_path and site.path[0] in ("group", "legend", "filters") else "value" if ref_path else None
                if action_path and isinstance(node, dict):
                    expected = "page" if node.get("type") == "page" else "visual" if node.get("type") == "toggle" else "measure" if node.get("type") == "function" and node.get("functionName") == "measure" else None
                if not isinstance(node, dict) or expected is None or slot.kind != expected:
                    raise ValueError("Bileşen yuvası hedef türüyle uyuşmuyor")
        return self


class ComponentLibrary(_B):
    version: Literal[1] = 1
    revision: int = Field(default=0, ge=0)
    components: list[ComponentDefinition] = Field(default_factory=list, max_length=500)

    @model_validator(mode="after")
    def _versions(self) -> "ComponentLibrary":
        if len({(c.id, c.version) for c in self.components}) != len(self.components):
            raise ValueError("Bileşen kimliği/sürümü benzersiz olmalı")
        return self


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
    importAudit: dict[str, Any] | None = None
    components: list[ComponentDefinition] = Field(default_factory=list, max_length=500)
    pages: list[Page] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique(self) -> "Report":
        if len({p.id for p in self.pages}) != len(self.pages):
            raise ValueError("Sayfa kimlikleri benzersiz olmalı")
        definitions = {(c.id, c.version): c for c in self.components}
        if len(definitions) != len(self.components):
            raise ValueError("Bileşen kimliği/sürümü benzersiz olmalı")
        for p in self.pages:
            validate_tree(p.visuals)
            by_id = {v.id: v for v in p.visuals}
            for v in p.visuals:
                if not v.component:
                    continue
                link = v.component
                definition = definitions.get((link.definitionId, link.version))
                if not definition or link.nodeMap.get(definition.rootId) != v.id or set(link.nodeMap) != {n.id for n in definition.visuals} or len(set(link.nodeMap.values())) != len(link.nodeMap):
                    raise ValueError("Bileşen kullanımı kayıtlı tanımla uyuşmuyor")
                slots = {s.id: s for s in definition.slots}
                if set(link.bindings) != set(slots):
                    raise ValueError("Bileşen alan yuvaları eksik")
                for key, binding in link.bindings.items():
                    check_binding(slots[key].kind, binding)
                for node_id in link.nodeMap.values():
                    node = by_id.get(node_id)
                    if node and node.id != v.id:
                        if node.component:
                            raise ValueError("Bileşen eşlemesi iç bileşen bağlantısı taşıyamaz")
                        while node.parentId and node.parentId != v.id:
                            node = by_id[node.parentId]
                        if node.parentId != v.id:
                            raise ValueError("Bileşen eşlemesi kendi alt ağacında kalmalı")
        return self


def empty_report() -> dict:
    return {"version": 1, "pages": [{"id": "p1", "name": "Sayfa 1", "width": 1280, "height": 720, "visuals": []}]}


# ------------------------------------------------- yeniden adlandırmada referanslar
def _refs(report: dict):
    for page in report.get("pages", []):
        yield from page.get("drillthrough", [])
        for v in page.get("visuals", []):
            # Tanımlar değişmez sürümlerdir; model adları kullanım eşlemesinde güncellenir.
            yield from (v.get("component") or {}).get("bindings", {}).values()
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

    for ref in _refs(report):
        if (ref.get("measure") or "").lower() == old.lower():
            ref["measure"] = new
    for page in report.get("pages", []):
        for v in page.get("visuals", []):
            fmt = v.get("format") or {}
            action_refs(fmt.get("action"))
            action_refs((fmt.get("rowAction") or {}).get("action"))
