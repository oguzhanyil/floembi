"""Tek bir satış belgesinin baskı bantları için yerel modelden satır okur."""
from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..connectors import json_value
from ..importer.loader import qident
from .ops import phys_col, phys_table

FormKind = Literal["invoice", "quote"]
DetailColumn = Literal["LineNum", "ItemCode", "Dscription", "Quantity", "Price", "LineTotal", "WhsCode"]


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
