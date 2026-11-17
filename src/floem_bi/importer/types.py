"""Kaynak tipi → Arrow tipi → model tipi → DuckDB tipi eşlemesi."""

from __future__ import annotations

import datetime
import decimal

import pyarrow as pa

from ..connectors import ExtractColumn


def arrow_type(c: ExtractColumn) -> pa.DataType:
    t = c.py_type
    if t is bool:
        return pa.bool_()
    if t is int:
        return pa.int64()
    if t is float:
        return pa.float64()
    if t is decimal.Decimal:
        p = max(1, min(int(c.precision or 38), 38))
        s = max(0, min(int(c.scale or 0), p))
        return pa.decimal128(p, s)
    if t is datetime.datetime:
        return pa.timestamp("us")
    if t is datetime.date:
        return pa.date32()
    return pa.string()


def model_tip(dt: pa.DataType) -> str:
    if pa.types.is_boolean(dt):
        return "bool"
    if pa.types.is_integer(dt):
        return "int64"
    if pa.types.is_decimal(dt):
        return "decimal"
    if pa.types.is_floating(dt):
        return "double"
    if pa.types.is_timestamp(dt):
        return "datetime"
    if pa.types.is_date(dt):
        return "date"
    return "string"


def tip_from_duckdb(type_name: str) -> str:
    t = type_name.upper()
    if t.startswith("DECIMAL"):
        return "decimal"
    if t in ("TINYINT", "SMALLINT", "INTEGER"):
        return "int32"
    if t in ("BIGINT", "HUGEINT", "UTINYINT", "USMALLINT", "UINTEGER", "UBIGINT"):
        return "int64"
    if t in ("DOUBLE", "FLOAT", "REAL"):
        return "double"
    if t == "DATE":
        return "date"
    if t.startswith("TIMESTAMP"):
        return "datetime"
    if t == "BOOLEAN":
        return "bool"
    return "string"


# Power BI'daki "Sabit ondalık sayı" 4 basamaklıdır; tip değiştirirken bunu kullanırız.
DUCKDB_TYPE = {
    "int32": "INTEGER",
    "int64": "BIGINT",
    "decimal": "DECIMAL(19,4)",
    "double": "DOUBLE",
    "string": "VARCHAR",
    "date": "DATE",
    "datetime": "TIMESTAMP",
    "bool": "BOOLEAN",
}

NUMERIC_TIPS = {"int32", "int64", "decimal", "double"}


def tip_family(tip: str) -> str:
    if tip in NUMERIC_TIPS:
        return "num"
    if tip in ("date", "datetime"):
        return "date"
    return tip


def to_arrow(rows: list[tuple], schema: pa.Schema) -> pa.Table:
    n = len(schema)
    cols = list(zip(*rows)) if rows else [()] * n
    arrays = []
    for values, field in zip(cols, schema):
        try:
            arrays.append(pa.array(values, type=field.type))
        except (pa.ArrowInvalid, pa.ArrowTypeError):
            if not pa.types.is_string(field.type):
                raise
            arrays.append(pa.array([None if v is None else str(v) for v in values], type=pa.string()))
    return pa.Table.from_arrays(arrays, schema=schema)
