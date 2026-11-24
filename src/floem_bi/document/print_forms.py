"""Tek bir satış belgesinin baskı bantları için yerel modelden satır okur."""
from __future__ import annotations

import math
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..connectors import json_value
from ..importer.loader import qident
from .ops import phys_col, phys_table

FormKind = Literal["invoice", "quote"]
DetailColumn = Literal["LineNum", "ItemCode", "Dscription", "Quantity", "Price", "LineTotal", "WhsCode"]
Color = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
HorizontalMm = Annotated[float, Field(ge=0, le=181, allow_inf_nan=False)]
VerticalMm = Annotated[float, Field(ge=0, le=60, allow_inf_nan=False)]


class LayoutItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=80)
    band: Literal["header", "beforeDetail", "footer"]


class FormLine(LayoutItem):
    type: Literal["line"]
    x1: HorizontalMm
    x2: HorizontalMm
    y1: VerticalMm
    y2: VerticalMm
    color: Color
    thickness: float = Field(ge=.1, le=3, allow_inf_nan=False)
    style: Literal["solid", "dashed", "dotted"]


class FormTableRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cells: list[Annotated[str, Field(max_length=500)]] = Field(min_length=1, max_length=8)
    color: Color | None = None


class FormColumn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    align: Literal["left", "center", "right"]
    weight: float = Field(ge=1, le=8, allow_inf_nan=False)


class FormTable(LayoutItem):
    type: Literal["table"]
    x: HorizontalMm
    width: float = Field(ge=25, le=181, allow_inf_nan=False)
    header: bool
    repeatRow: int | None = Field(default=None, ge=0)
    columnFormat: list[FormColumn] | None = Field(default=None, min_length=1, max_length=8)
    rows: list[FormTableRow] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def check_grid(self):
        if self.repeatRow is not None and (self.repeatRow >= len(self.rows) or self.header and self.repeatRow == 0):
            raise ValueError("Tekrarlanan satır geçerli bir detay satırı olmalı.")
        if self.x + self.width > 181.00001 or len({len(row.cells) for row in self.rows}) != 1:
            raise ValueError("Tablo baskı alanına sığmalı ve her satır aynı sayıda hücre içermeli.")
        if self.width < 10 * len(self.rows[0].cells):
            raise ValueError("Her sütun için en az 10 mm ayırın.")
        if self.columnFormat is not None and len(self.columnFormat) != len(self.rows[0].cells):
            raise ValueError("Sütun biçimleri tablonun sütun sayısıyla eşleşmeli.")
        return self


class RowRule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: Literal["Quantity", "Price", "LineTotal"]
    op: Literal["gt", "lt", "eq"]
    value: float = Field(allow_inf_nan=False)
    color: Color


class PrintLayout(BaseModel):
    model_config = ConfigDict(extra="forbid")
    blocks: list[Annotated[FormLine | FormTable, Field(discriminator="type")]] = Field(default_factory=list, max_length=80)
    guides: list[HorizontalMm] = Field(default_factory=list, max_length=40)
    hideMainDetail: bool = False
    stripe: Color | None = None
    rule: RowRule | None = None

    @model_validator(mode="after")
    def unique_ids(self):
        if len({b.id for b in self.blocks}) != len(self.blocks):
            raise ValueError("Belge nesnesi kimlikleri benzersiz olmalı.")
        return self


class PrintTemplate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    kind: FormKind
    title: str = Field(min_length=1, max_length=100)
    issuer: str = Field(default="", max_length=160)
    note: str = Field(default="", max_length=2000)
    accent: str = Field(default="#205a67", pattern=r"^#[0-9a-fA-F]{6}$")
    groupBy: Literal["WhsCode", "ItemCode", "none"] = "WhsCode"
    subtotals: bool = True
    columns: list[DetailColumn] = Field(min_length=1, max_length=7)
    logo: str = Field(default="", max_length=1_500_000, pattern=r"^(data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+)?$")
    sampleKey: str = Field(default="", max_length=160)
    layout: PrintLayout | None = None

    @model_validator(mode="after")
    def unique_columns(self):
        if len(set(self.columns)) != len(self.columns):
            raise ValueError("Bir kalem sütunu yalnızca bir kez seçilebilir")
        return self


def _source(model, name):
    matches = [t for t in model.tablolar if name.casefold() in
               {t.ad.casefold(), (t.sorgu.tablo or "").casefold() if t.sorgu else ""}]
    if len(matches) != 1:
        raise ValueError(f"{name} için modelde tek bir kaynak tablo bulunmalı.")
    table = matches[0]
    fields = {n.casefold(): phys_col(c) for c in table.sutunlar if not c.ifade for n in (c.kaynak or c.ad, c.ad)}
    return phys_table(table), fields


def _field(fields, name):
    try:
        return fields[name.casefold()]
    except KeyError:
        raise ValueError(f"Belge için gerekli {name} alanı bulunamadı.") from None


def read_form(doc, kind: FormKind, record: str | None, search: str):
    """Seçici veya bir başlık ve tüm kalemler. Sorgular aynı belge kilidinde çalışır."""
    header_name, detail_name = ("OINV", "INV1") if kind == "invoice" else ("OQUT", "QUT1")
    with doc.lock:
        if doc.closed:
            raise ValueError("Açık rapor değişti. Belgeyi yeniden seçin.")
        head, hf = _source(doc.tanim, header_name)
        detail, df = _source(doc.tanim, detail_name)
        key = "TeklifDocEntry" if kind == "quote" and "teklifdocentry" in hf else "DocEntry"
        hk, dk = _field(hf, key), _field(df, key)
        number = _field(hf, "DocNum")
        if record is None:
            rows = doc.con.execute(f"""
                SELECT CAST({hk} AS VARCHAR), CAST({number} AS VARCHAR) FROM {head}
                WHERE {hk} IS NOT NULL AND contains(lower(CAST({number} AS VARCHAR)), lower(?))
                ORDER BY {number}, {hk} LIMIT 101
            """, [search]).fetchall()
            return {"items": [{"key": k, "number": n} for k, n in rows[:100]], "more": len(rows) > 100}

        def read(table, fields, names, condition, suffix):
            select = ", ".join(f"{_field(fields, n)} AS {qident(n)}" for n in names)
            rows = doc.con.execute(f"SELECT {select} FROM {table} WHERE CAST({condition} AS VARCHAR) = ? {suffix}",
                                   [record]).fetchall()
            return [{n: json_value(v) for n, v in zip(names, r)} for r in rows]

        header_fields = ["DocNum", "DocDate", "DocCur", "CardName", "DocTotal", "VatSum"]
        header_fields += [n for n in ("Address", "Comments", "DocDueDate") if n.casefold() in hf]
        heads = read(head, hf, header_fields, hk, "LIMIT 2")
        if len(heads) != 1:
            raise ValueError("Seçilen belge anahtarı tek bir başlıkla eşleşmeli.")
        fields = ["LineNum", "ItemCode", "Dscription", "Quantity", "Price", "LineTotal", "WhsCode"]
        lines = read(detail, df, fields, dk, f"ORDER BY {_field(df, 'LineNum')}")
        if any(r["LineNum"] is None for r in lines) or len({r["LineNum"] for r in lines}) != len(lines):
            raise ValueError("Kalem sıra numarası belge içinde dolu ve benzersiz olmalı.")
        for rows, amounts in ((heads, ("VatSum", "DocTotal")), (lines, ("LineNum", "Quantity", "Price", "LineTotal"))):
            for row in rows:
                for name in amounts:
                    if not isinstance(row[name], (int, float)) or not math.isfinite(row[name]):
                        raise ValueError(f"{name} alanı geçerli bir sayı olmalı.")
        return {"header": heads[0], "lines": lines}
