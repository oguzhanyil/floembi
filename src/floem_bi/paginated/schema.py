from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Name = Annotated[str, Field(min_length=1, max_length=160)]
Color = Annotated[str, Field(pattern=r"^#[a-fA-F0-9]{6}$")]
Scalar = str | int | float | bool | None
Section = Literal[
    "reportHeader", "pageHeader", "groupHeader", "detail", "groupFooter", "reportFooter", "pageFooter"
]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Rule(Model):
    field: Name
    op: Literal["eq", "ne", "gt", "lt", "ge", "le", "contains"] = "eq"
    value: Scalar = ""


class Formula(Model):
    op: Literal[
        "field",
        "add",
        "subtract",
        "multiply",
        "divide",
        "round",
        "abs",
        "year",
        "month",
        "day",
        "daysBetween",
        "if",
        "sum",
        "count",
        "running",
    ] = "field"
    field: str = ""
    other: str = ""
    value: Scalar = 0
    condition: Rule | None = None
    yes: Scalar = ""
    no: Scalar = ""
    scope: Literal["section", "report"] = "section"


class Object(Model):
    id: Name
    kind: Literal["text", "field", "formula", "line", "box", "page", "barcode", "subreport", "crossTab"]
    x: float = Field(ge=0, le=420)
    y: float = Field(ge=0, le=420)
    w: float = Field(gt=0, le=420)
    h: float = Field(gt=0, le=420)
    text: str = Field(default="", max_length=4000)
    field: str = ""
    formula: Formula | None = None
    font: float = Field(default=10, ge=5, le=72)
    bold: bool = False
    locked: bool = False
    wrap: bool = True
    align: Literal["left", "center", "right"] = "left"
    color: Color = "#162f46"
    background: Color | None = None
    border: float = Field(default=0.3, ge=0.1, le=6)
    format: Literal["auto", "integer", "decimal", "money", "date"] = "auto"
    rule: Rule | None = None
    ruleColor: Color | None = None
    ruleFormat: Literal["integer", "decimal", "money", "date"] | None = None
    hideWhen: bool = False
    symbology: Literal["code128", "code39", "ean13", "qr"] = "code128"
    target: str = ""
    childField: str = ""
    column: str = ""
    measure: str = ""


class Band(Model):
    kind: Section
    group: str = ""
    height: float = Field(default=10, ge=0, le=420)
    objects: list[Object] = Field(default_factory=list, max_length=150)


class Order(Model):
    field: Name
    desc: bool = False


class Group(Order):
    newPage: bool = False
    repeat: bool = True


class Parameter(Model):
    field: Name
    label: Name
    kind: Literal["choice", "date", "number", "text"] = "choice"
    op: Literal["eq", "ge", "le", "contains"] = "eq"
    default: Scalar = None


class Template(Model):
    id: Name
    version: int = Field(default=1, ge=1)
    name: Name
    category: str = Field(default="", max_length=160)
    table: str = Field(default="", max_length=160)
    paper: Literal["A4", "A3"] = "A4"
    landscape: bool = False
    margin: float = Field(default=12, ge=0, le=50)
    groups: list[Group] = Field(default_factory=list, max_length=8)
    sort: list[Order] = Field(default_factory=list, max_length=10)
    params: list[Parameter] = Field(default_factory=list, max_length=20)
    bands: list[Band] = Field(max_length=21)

    @property
    def size(self):
        w, h = (210, 297) if self.paper == "A4" else (297, 420)
        return (h, w) if self.landscape else (w, h)

    @model_validator(mode="after")
    def validate_layout(self):
        group_fields = [g.field for g in self.groups]
        keys = [(b.kind, b.group) for b in self.bands]
        ids = [obj.id for b in self.bands for obj in b.objects]
        if (
            len(set(group_fields)) != len(group_fields)
            or len(set(keys)) != len(keys)
            or len(set(ids)) != len(ids)
        ):
            raise ValueError("Grup, bölüm veya nesne yineleniyor")
        if ("detail", "") not in keys:
            raise ValueError("Detay bölümü gerekli")
        if len({p.label for p in self.params}) != len(self.params):
            raise ValueError("Parametre adları benzersiz olmalı")
        for b in self.bands:
            if b.group not in group_fields if b.kind in ("groupHeader", "groupFooter") else bool(b.group):
                raise ValueError("Bölümün grup bağlantısı geçersiz")
            flow = [o for o in b.objects if o.kind in ("crossTab", "subreport")]
            if flow and (
                len(flow) > 1
                or b.kind not in ("detail", "groupFooter", "reportFooter")
                or any(o.y + o.h > flow[0].y + 0.01 for o in b.objects if o is not flow[0])
            ):
                raise ValueError(
                    "Alt rapor veya çapraz tablo, detay ya da toplam bölümünün son satırında tek olmalı"
                )
            for o in b.objects:
                if o.x + o.w > self.size[0] - 2 * self.margin + 0.01 or o.y + o.h > b.height + 0.01:
                    raise ValueError(
                        f"{self.name} / {b.kind}: {o.text or o.field or o.kind} bölüm sınırını aşıyor"
                    )
        return self


class Library(Model):
    reports: list[Template] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def unique(self):
        if len({(t.id, t.version) for t in self.reports}) != len(self.reports):
            raise ValueError("Rapor ve sürümü yineleniyor")
        return self

    def latest(self):
        return {t.id: t for t in sorted(self.reports, key=lambda t: t.version)}


class Run(Model):
    report: Name
    values: dict[str, Scalar] = Field(default_factory=dict, max_length=20)
    output: Literal["preview", "word"] = "preview"
