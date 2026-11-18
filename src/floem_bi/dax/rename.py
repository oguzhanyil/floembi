"""Yeniden adlandırmada DAX ifadelerini günceller (TabularEditor'daki FormulaFixup fikri).

Token düzeyinde çalışır: yalnızca tablo ve sütun referansları değişir; boşluk,
yorum ve biçim olduğu gibi kalır. Sözdizimi hatalı ifadeye dokunulmaz.
"""

from __future__ import annotations

import re

from .lexer import DaxSyntaxError, T, Token, tokenize

_SIMPLE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def table_token(name: str) -> str:
    return name if _SIMPLE.match(name) else "'" + name.replace("'", "''") + "'"


def bracket_token(name: str) -> str:
    return "[" + name.replace("]", "]]") + "]"


def _is_table_token(tokens: list[Token], i: int) -> bool:
    tok = tokens[i]
    if tok.type == T.QUOTED_TABLE:
        return True
    if tok.type != T.IDENT:
        return False
    nxt = tokens[i + 1] if i + 1 < len(tokens) else None
    return nxt is None or nxt.type != T.LPAREN      # fonksiyon çağrısı değil


def _apply(source: str, edits: list[tuple[int, int, str]]) -> str:
    out, pos = [], 0
    for start, end, text in sorted(edits):
        out.append(source[pos:start])
        out.append(text)
        pos = end
    out.append(source[pos:])
    return "".join(out)


def rename_table(source: str, old: str, new: str) -> str:
    try:
        tokens = tokenize(source)
    except DaxSyntaxError:
        return source
    edits = [
        (t.span.start, t.span.end, table_token(new))
        for i, t in enumerate(tokens)
        if _is_table_token(tokens, i) and t.value.lower() == old.lower()
    ]
    return _apply(source, edits) if edits else source


def rename_column(source: str, table: str, old: str, new: str, home_table: str | None = None) -> str:
    """`table[old]` → `table[new]`. `home_table == table` ise (hesaplanmış sütun) yalın `[old]` da değişir."""
    try:
        tokens = tokenize(source)
    except DaxSyntaxError:
        return source
    edits = []
    for i, t in enumerate(tokens):
        if t.type != T.BRACKET or t.value.lower() != old.lower():
            continue
        prev_is_table = i > 0 and _is_table_token(tokens, i - 1)
        if prev_is_table and tokens[i - 1].value.lower() == table.lower():
            edits.append((t.span.start, t.span.end, bracket_token(new)))
        elif not prev_is_table and home_table and home_table.lower() == table.lower():
            edits.append((t.span.start, t.span.end, bracket_token(new)))
    return _apply(source, edits) if edits else source


def rename_measure(source: str, old: str, new: str) -> str:
    """Tablo öneki olmayan `[old]` ölçü referanslarını `[new]` yapar (Tablo[Sütun] referanslarına dokunmaz)."""
    try:
        tokens = tokenize(source)
    except DaxSyntaxError:
        return source
    edits = [
        (t.span.start, t.span.end, bracket_token(new))
        for i, t in enumerate(tokens)
        if t.type == T.BRACKET and t.value.lower() == old.lower() and not (i > 0 and _is_table_token(tokens, i - 1))
    ]
    return _apply(source, edits) if edits else source
