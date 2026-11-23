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
    "text", "shape", "image", "button", "ticker", "container", "icon", "repeater", # tasarım nesneleri
    "lineage", "tolerance", "signal", "scenario", # süreç, ölçü/uyarı ve senaryo
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


DataScalar = str | FiniteFloat | bool | None
BindingTarget = Literal["text", "value", "backgroundColor", "color", "icon", "visible"]
DesignState = Literal["normal", "hover", "selected", "loading", "empty", "error"]
DATA_ICONS = {"none", "arrow", "back", "refresh", "eye", "link", "play", "file", "menu", "check", "warning", "trendUp", "trendDown", "clock", "user", "box"}


class BindingSource(_B):
    kind: Literal["value", "field", "row"]
    value: ValueRef | None = None
    field: FieldRef | None = None

    @model_validator(mode="after")
    def _source(self):
        if bool(self.value) == bool(self.field) or self.kind == "value" and not self.value or self.kind == "field" and not self.field:
            raise ValueError("Veri bağı tek bir geçerli alan veya ölçü ister")
        return self


class BindingRule(_B):
    op: Literal["eq", "ne", "gt", "ge", "lt", "le", "blank", "notBlank"]
    value: DataScalar = None
    output: DataScalar


class DataBinding(_B):
    source: BindingSource
    template: str | None = Field(default=None, max_length=4000)
    fallback: DataScalar = None
    rules: list[BindingRule] = Field(default_factory=list, max_length=32)


def _data_color(value):
    import re
    return value is None or isinstance(value, str) and (value == "transparent" or re.fullmatch(r"#[0-9a-fA-F]{6}", value))


class StateAppearance(_B):
    text: str | None = Field(default=None, max_length=4000)
    color: str | None = None
    backgroundColor: str | None = None
    borderColor: str | None = None
    opacity: FiniteFloat | None = Field(default=None, ge=0, le=1)
    icon: str | None = None

    @model_validator(mode="after")
    def _appearance(self):
        if any(not _data_color(c) for c in [self.color, self.backgroundColor, self.borderColor]) or self.icon is not None and self.icon not in DATA_ICONS:
            raise ValueError("Durum rengi veya simgesi geçersiz")
        return self


class RepeaterDefinition(_B):
    definitionId: str = Field(min_length=1, max_length=80)
    version: int = Field(ge=1)
    bindings: dict[str, ComponentBinding] = Field(default_factory=dict, max_length=200)
    itemHeight: FiniteFloat = Field(default=180, ge=64, le=1200)
    actionSourceIndex: int = Field(default=0, ge=0, le=1000)


class Visual(_B):
    bindings: dict[BindingTarget, DataBinding] = Field(default_factory=dict)
    states: dict[DesignState, StateAppearance] = Field(default_factory=dict)
    repeater: RepeaterDefinition | None = None
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

    @model_validator(mode="after")
    def _runtime(self):
        if self.repeater and self.type != "repeater":
            raise ValueError("Tekrarlayıcı ayarı yalnız tekrarlayıcıya uygulanabilir")
        if "value" in self.bindings and self.type not in ("card", "ticker", "text"):
            raise ValueError("Değer bağı kart, sayaç veya metin nesnesi ister")
        for target, binding in self.bindings.items():
            outputs = [r.output for r in binding.rules] + [binding.fallback]
            if target in ("backgroundColor", "color") and any(not _data_color(v) for v in outputs):
                raise ValueError("Bağ rengi #RRGGBB veya transparent olmalı")
            if target == "visible" and any(v is not None and not isinstance(v, bool) for v in outputs):
                raise ValueError("Görünürlük kuralı doğru/yanlış döndürmeli")
            if target == "icon" and any(v is not None and v not in DATA_ICONS for v in outputs):
                raise ValueError("Bağ simgesi geçersiz")
        return self


class LayoutFormat(_B):
    fontSize: FiniteFloat | None = Field(default=None, ge=8, le=144)
    titleSize: FiniteFloat | None = Field(default=None, ge=8, le=144)
    padding: FiniteFloat | None = Field(default=None, ge=0, le=128)
    textOverflow: Literal["wrap", "ellipsis", "scroll", "grow"] | None = None
    gridFitColumns: bool | None = None
    legend: Literal["top", "bottom", "right", "none"] | None = None


class LayoutVisualOverride(_B):
    x: FiniteFloat | None = None
    y: FiniteFloat | None = None
    w: FiniteFloat | None = Field(default=None, gt=0, le=20000)
    h: FiniteFloat | None = Field(default=None, gt=0, le=20000)
    container: ContainerLayout | None = None
    layoutItem: LayoutItem | None = None
    format: LayoutFormat | None = None


class PageLayoutVariant(_B):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    maxWidth: int = Field(ge=240, le=7680)
    width: int = Field(ge=240, le=7680)
    height: int = Field(ge=200, le=20000)
    displayOption: Literal["FitToPage", "FitToWidth", "ActualSize"] = "FitToWidth"
    rootLayout: ContainerLayout | None = None
    order: list[str] = Field(default_factory=list, max_length=10000)
    overrides: dict[str, LayoutVisualOverride] = Field(default_factory=dict, max_length=10000)


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
    layouts: list[PageLayoutVariant] = Field(default_factory=list, max_length=12)
    rootLayout: ContainerLayout | None = None
    visuals: list[Visual] = Field(default_factory=list)
    drillthrough: list[FieldRef] = Field(default_factory=list)   # Detaya git (drill-through) alanları

    @model_validator(mode="after")
    def _layouts(self) -> "Page":
        if len({v.id for v in self.layouts}) != len(self.layouts) or len({v.maxWidth for v in self.layouts}) != len(self.layouts):
            raise ValueError("Düzen kimlikleri ve geçiş genişlikleri benzersiz olmalı")
        if any(v.id in {"base", "auto"} for v in self.layouts):
            raise ValueError("base ve auto düzen seçimi için ayrılmış kimliklerdir")
        ids = {v.id for v in self.visuals}
        for layout in self.layouts:
            if set(layout.overrides) - ids or set(layout.order) - ids or len(set(layout.order)) != len(layout.order):
                raise ValueError("Düzen yalnız sayfanın mevcut nesnelerine başvurabilir; sıralama yinelenemez")
            if any(key in {"__proto__", "constructor", "prototype"} for key in layout.overrides):
                raise ValueError("Düzen nesne kimliği ayrılmış bir ad olamaz")
            by_id = {v.id: v for v in self.visuals}
            if any(o.container is not None and by_id[key].type != "container" for key, o in layout.overrides.items()):
                raise ValueError("Düzen kapsayıcı ayarı yalnız kapsayıcıya uygulanabilir")
        return self


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
                binding_path = re.fullmatch(r"bindings\.(text|value|backgroundColor|color|icon|visible)\.source\.(field|value)", path)
                action_path = re.fullmatch(r"format\.(rowAction\.)?action(\.items\.[0-9]{1,3}\.action)*", path)
                if not (ref_path or action_path or binding_path) or (site.visualId, path) in used:
                    raise ValueError("Bileşen yuvasının hedef yolu geçersiz veya yineleniyor")
                used.add((site.visualId, path))
                try:
                    node = nodes[site.visualId]
                    for key in site.path:
                        node = node[int(key)] if isinstance(node, list) else node[key]
                except (KeyError, IndexError, ValueError, TypeError) as e:
                    raise ValueError("Bileşen yuvasının hedefi bulunamadı") from e
                expected = "field" if ref_path and site.path[0] in ("group", "legend", "filters") else "value" if ref_path else None
                if binding_path:
                    expected = site.path[-1]
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


class AnalyticsMetric(_B):
    id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_.:-]+$")
    label: str = Field(min_length=1, max_length=160)
    measure: str = Field(min_length=1, max_length=160)
    unit: str = Field(min_length=1, max_length=60)
    grain: str = Field(min_length=1, max_length=200)
    company: FieldRef
    filters: list[FilterRef] = Field(default_factory=list, max_length=100)
    tolerance: FiniteFloat = Field(default=0.000001, ge=0, le=1000)


class AnalyticsRule(_B):
    id: str = Field(min_length=1, max_length=100)
    metricId: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=200)
    operator: Literal["gt", "ge", "lt", "le"] = "gt"
    threshold: FiniteFloat
    severity: Literal["info", "warning", "critical"] = "warning"


class AnalyticsConfig(_B):
    protocol: Literal["floem-metric/v1"] = "floem-metric/v1"
    # Kaynağın beyanıdır; değerlendirme/yayımlama zamanı veri zamanı sayılmaz.
    dataTime: str | None = Field(default=None, max_length=40)
    metrics: list[AnalyticsMetric] = Field(default_factory=list, max_length=100)
    rules: list[AnalyticsRule] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def _catalog(self):
        from datetime import datetime
        if self.dataTime == "":
            self.dataTime = None
        if self.dataTime:
            try:
                parsed = datetime.fromisoformat(self.dataTime.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    raise ValueError()
                self.dataTime = parsed.isoformat()
            except ValueError as e:
                raise ValueError("Kaynak veri zamanı saat dilimi içeren ISO tarih olmalı") from e
        ids = {m.id for m in self.metrics}
        if len(ids) != len(self.metrics) or len({r.id for r in self.rules}) != len(self.rules):
            raise ValueError("Ölçü ve kural kimlikleri kendi kataloglarında benzersiz olmalı")
        if any(r.metricId not in ids for r in self.rules):
            raise ValueError("Uyarı kuralının katalog ölçüsü bulunamadı")
        return self


class ScenarioParameter(_B):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_.:-]+$")
    label: str = Field(min_length=1, max_length=160)
    measure: str = Field(min_length=1, max_length=160)
    unit: str = Field(default="", max_length=40)
    minimum: FiniteFloat = Field(ge=-1e12, le=1e12)
    maximum: FiniteFloat = Field(ge=-1e12, le=1e12)
    step: FiniteFloat = Field(default=1, ge=0.000001, le=1e12)
    defaultValue: FiniteFloat = Field(ge=-1e12, le=1e12)

    @model_validator(mode="after")
    def _range(self):
        from decimal import Decimal
        if self.minimum > self.maximum or not self.minimum <= self.defaultValue <= self.maximum:
            raise ValueError("Parametre sınırları ve başlangıç değeri uyumlu olmalı")
        if (Decimal(str(self.defaultValue)) - Decimal(str(self.minimum))) % Decimal(str(self.step)) != 0:
            raise ValueError("Başlangıç değeri minimumdan başlayan adımlara uymalı")
        return self


class ScenarioOutput(_B):
    measure: str = Field(min_length=1, max_length=160)
    label: str = Field(min_length=1, max_length=160)
    unit: str = Field(default="", max_length=40)


class ScenarioDefinition(_B):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_.:-]+$")
    label: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=1000)
    company: FieldRef
    filters: list[FilterRef] = Field(default_factory=list, max_length=100)
    parameters: list[ScenarioParameter] = Field(min_length=1, max_length=12)
    outputs: list[ScenarioOutput] = Field(min_length=1, max_length=12)
    proposalEnabled: bool = False
    submitRoles: list[Literal["admin", "member", "contributor", "viewer"]] = Field(default_factory=lambda: ["admin", "member", "contributor"], max_length=4)

    @model_validator(mode="after")
    def _unique_scenario(self):
        if len({p.id for p in self.parameters}) != len(self.parameters) or len({p.measure.lower() for p in self.parameters}) != len(self.parameters):
            raise ValueError("Senaryoda parametre kimliği ve ölçü bağı benzersiz olmalı")
        if len({o.measure.lower() for o in self.outputs}) != len(self.outputs):
            raise ValueError("Senaryo çıktı ölçüleri benzersiz olmalı")
        return self


class Report(_B):
    version: int = 1
    theme: ThemeSnapshot | None = None
    analytics: AnalyticsConfig | None = None
    scenarios: list[ScenarioDefinition] = Field(default_factory=list, max_length=30)
    importAudit: dict[str, Any] | None = None
    components: list[ComponentDefinition] = Field(default_factory=list, max_length=500)
    pages: list[Page] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique(self) -> "Report":
        if len({s.id for s in self.scenarios}) != len(self.scenarios):
            raise ValueError("Senaryo kimlikleri benzersiz olmalı")
        if len({p.id for p in self.pages}) != len(self.pages):
            raise ValueError("Sayfa kimlikleri benzersiz olmalı")
        definitions = {(c.id, c.version): c for c in self.components}
        if len(definitions) != len(self.components):
            raise ValueError("Bileşen kimliği/sürümü benzersiz olmalı")
        for p in self.pages:
            validate_tree(p.visuals)
            by_id = {v.id: v for v in p.visuals}
            for v in p.visuals:
                if v.repeater:
                    definition = definitions.get((v.repeater.definitionId, v.repeater.version))
                    if not definition:
                        raise ValueError("Tekrarlayıcı bileşeni raporda bulunamadı")
                    slots = {s.id: s for s in definition.slots}
                    if set(v.repeater.bindings) != set(slots):
                        raise ValueError("Tekrarlayıcı bileşen alan eşlemeleri eksik")
                    for key, binding in v.repeater.bindings.items():
                        check_binding(slots[key].kind, binding)
                    if any(n.type not in ("container", "text", "card", "ticker", "shape", "image", "button", "icon") for n in definition.visuals):
                        raise ValueError("Satır şablonu yalnız tasarım nesneleri, kart ve sayaç içerebilir")
                    if any(b.source.kind != "row" for n in definition.visuals for b in n.bindings.values()):
                        raise ValueError("Satır şablonundaki veri bağları satır kaynağını kullanmalı")
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
    for scenario in report.get("scenarios", []):
        yield scenario.get("company") or {}
        yield from scenario.get("parameters", [])
        yield from scenario.get("outputs", [])
        yield from scenario.get("filters", [])
    for metric in (report.get("analytics") or {}).get("metrics", []):
        yield metric
        yield metric.get("company") or {}
        yield from metric.get("filters", [])
    for page in report.get("pages", []):
        yield from page.get("drillthrough", [])
        for v in page.get("visuals", []):
            # Tanımlar değişmez sürümlerdir; model adları kullanım eşlemesinde güncellenir.
            yield from (v.get("component") or {}).get("bindings", {}).values()
            yield from (v.get("repeater") or {}).get("bindings", {}).values()
            for binding in (v.get("bindings") or {}).values():
                source = binding.get("source") or {}
                for key in ("value", "field"):
                    if source.get(key):
                        yield source[key]
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
