"""Kaynak raporlarda kullanılan sayısal ve tarih FORMAT desenleri."""

import re

from .measures import CompileError


def format_sql(values, culture):
    value, mask = values[:2]
    locale = values[2].sql if len(values) > 2 else "'" + culture + "'"
    if locale.lower() not in {"'tr-tr'", "'en-us'"}:
        raise CompileError("FORMAT için desteklenen kültürler tr-TR ve en-US")
    dates = {
        "'dd.mm.yyyy'": "%d.%m.%Y",
        "'dd.mm.yyyy hh:mm'": "%d.%m.%Y %H:%M",
        "'yyyy-mm-dd'": "%Y-%m-%d",
    }
    if mask.sql.lower() in dates:
        return f"coalesce(strftime(cast({value.sql} as timestamp),'{dates[mask.sql.lower()]}'),'')"
    match = re.fullmatch(r"'(#,)?0(?:\.(0{1,12}))?(%)?'", mask.sql)
    if not match:
        raise CompileError("Desteklenmeyen FORMAT deseni")
    grouping, decimals, percent = match.groups()
    number = f"cast({value.sql} as double)" + ("*100" if percent else "")
    result = f"printf('%{',' if grouping else ''}.{len(decimals or '')}f',{number})"
    if locale.lower() == "'tr-tr'":
        result = f"translate({result},',.','.,')"
    if percent:
        result = f"{result} || '%'"
    return f"coalesce({result},'')"
