"""Floem DAX lexer'ı.

Elle yazılmıştır. Anahtar kelimeler yalnızca tam kelime eşleşmesinde tanınır
(pbi_parsers'taki `VAR.P` / `Returns[...]` hatası burada yok) ve büyük/küçük
harf duyarsızdır. Her token kaynak konumunu (`Span`) taşır.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum, auto


@dataclass(frozen=True)
class Span:
    start: int
    end: int

    def merge(self, other: "Span") -> "Span":
        return Span(min(self.start, other.start), max(self.end, other.end))


class DaxSyntaxError(Exception):
    def __init__(self, message: str, span: Span, source: str | None = None):
        self.message = message
        self.span = span
        self.source = source
        super().__init__(self.render())

    def render(self) -> str:
        if self.source is None:
            return f"{self.message} (konum {self.span.start})"
        line_start = self.source.rfind("\n", 0, self.span.start) + 1
        line_end = self.source.find("\n", self.span.start)
        if line_end == -1:
            line_end = len(self.source)
        line_no = self.source.count("\n", 0, self.span.start) + 1
        col = self.span.start - line_start
        width = max(1, min(self.span.end, line_end) - self.span.start)
        line = self.source[line_start:line_end]
        return f"{self.message} (satır {line_no}, sütun {col + 1})\n  {line}\n  {' ' * col}{'^' * width}"


class T(Enum):
    NUMBER = auto()
    STRING = auto()
    IDENT = auto()          # fonksiyon adı, tablo adı veya değişken: Satis, VAR.P, DATEADD
    QUOTED_TABLE = auto()   # 'Tablo Adı'
    BRACKET = auto()        # [Sütun veya Ölçü]
    KEYWORD = auto()        # VAR RETURN TRUE FALSE NOT IN
    OP = auto()
    LPAREN = auto()
    RPAREN = auto()
    LBRACE = auto()
    RBRACE = auto()
    COMMA = auto()
    EOF = auto()


KEYWORDS = {"VAR", "RETURN", "TRUE", "FALSE", "NOT", "IN"}

# En uzun eşleşme önce
OPERATORS = ["&&", "||", "<>", "<=", ">=", "==", "+", "-", "*", "/", "^", "&", "=", "<", ">"]


@dataclass(frozen=True)
class Token:
    type: T
    value: str
    span: Span


def _is_ident_start(ch: str) -> bool:
    return ch.isalpha() or ch == "_"


def _is_ident_part(ch: str) -> bool:
    return ch.isalnum() or ch in "_."


def tokenize(source: str) -> list[Token]:
    tokens: list[Token] = []
    i = 0
    n = len(source)
    while i < n:
        ch = source[i]
        # boşluk
        if ch.isspace():
            i += 1
            continue
        # yorumlar
        if source.startswith("//", i) or source.startswith("--", i):
            j = source.find("\n", i)
            i = n if j == -1 else j + 1
            continue
        if source.startswith("/*", i):
            j = source.find("*/", i + 2)
            if j == -1:
                raise DaxSyntaxError("Kapanmamış blok yorumu", Span(i, n), source)
            i = j + 2
            continue
        start = i
        # sayı: 12, 12.5, .5, 1e-5, 2.5E+3
        if ch.isdigit() or (ch == "." and i + 1 < n and source[i + 1].isdigit()):
            while i < n and source[i].isdigit():
                i += 1
            if i < n and source[i] == ".":
                i += 1
                while i < n and source[i].isdigit():
                    i += 1
            if i < n and source[i] in "eE":
                j = i + 1
                if j < n and source[j] in "+-":
                    j += 1
                if j < n and source[j].isdigit():
                    i = j
                    while i < n and source[i].isdigit():
                        i += 1
            if i < n and _is_ident_start(source[i]):
                raise DaxSyntaxError("Geçersiz sayı", Span(start, i + 1), source)
            tokens.append(Token(T.NUMBER, source[start:i], Span(start, i)))
            continue
        # string: "..." ("" kaçış)
        if ch == '"':
            i += 1
            buf = []
            while True:
                if i >= n:
                    raise DaxSyntaxError("Kapanmamış metin", Span(start, n), source)
                if source[i] == '"':
                    if i + 1 < n and source[i + 1] == '"':
                        buf.append('"')
                        i += 2
                        continue
                    i += 1
                    break
                buf.append(source[i])
                i += 1
            tokens.append(Token(T.STRING, "".join(buf), Span(start, i)))
            continue
        # 'Tablo Adı' ('' kaçış)
        if ch == "'":
            i += 1
            buf = []
            while True:
                if i >= n:
                    raise DaxSyntaxError("Kapanmamış tablo adı", Span(start, n), source)
                if source[i] == "'":
                    if i + 1 < n and source[i + 1] == "'":
                        buf.append("'")
                        i += 2
                        continue
                    i += 1
                    break
                buf.append(source[i])
                i += 1
            tokens.append(Token(T.QUOTED_TABLE, "".join(buf), Span(start, i)))
            continue
        # [Sütun] (]] kaçış)
        if ch == "[":
            i += 1
            buf = []
            while True:
                if i >= n:
                    raise DaxSyntaxError("Kapanmamış köşeli parantez", Span(start, n), source)
                if source[i] == "]":
                    if i + 1 < n and source[i + 1] == "]":
                        buf.append("]")
                        i += 2
                        continue
                    i += 1
                    break
                buf.append(source[i])
                i += 1
            tokens.append(Token(T.BRACKET, "".join(buf), Span(start, i)))
            continue
        # tanımlayıcı / anahtar kelime (tam kelime)
        if _is_ident_start(ch):
            while i < n and _is_ident_part(source[i]):
                i += 1
            word = source[start:i]
            if word.upper() in KEYWORDS:
                tokens.append(Token(T.KEYWORD, word.upper(), Span(start, i)))
            else:
                tokens.append(Token(T.IDENT, word, Span(start, i)))
            continue
        simple = {"(": T.LPAREN, ")": T.RPAREN, "{": T.LBRACE, "}": T.RBRACE, ",": T.COMMA}
        if ch in simple:
            tokens.append(Token(simple[ch], ch, Span(i, i + 1)))
            i += 1
            continue
        for op in OPERATORS:
            if source.startswith(op, i):
                tokens.append(Token(T.OP, op, Span(i, i + len(op))))
                i += len(op)
                break
        else:
            raise DaxSyntaxError(f"Beklenmeyen karakter: {ch!r}", Span(i, i + 1), source)
    tokens.append(Token(T.EOF, "", Span(n, n)))
    return tokens
