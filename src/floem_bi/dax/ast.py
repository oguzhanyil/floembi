"""Floem DAX AST düğümleri. Her düğüm kaynak konumunu (`span`) taşır."""

from __future__ import annotations

from dataclasses import dataclass, field

from .lexer import Span


@dataclass(frozen=True)
class Node:
    span: Span = field(compare=False, repr=False)


@dataclass(frozen=True)
class Number(Node):
    value: float | int


@dataclass(frozen=True)
class String(Node):
    value: str


@dataclass(frozen=True)
class Boolean(Node):
    value: bool


@dataclass(frozen=True)
class ColumnRef(Node):
    """Tablo[Sütun]"""
    table: str
    column: str


@dataclass(frozen=True)
class BracketRef(Node):
    """[Ad]: ölçü (ya da tablosuz sütun) referansı; binder çözer."""
    name: str


@dataclass(frozen=True)
class Name(Node):
    """Çıplak tanımlayıcı veya 'Tablo': tablo ya da VAR değişkeni."""
    name: str
    quoted: bool = False


@dataclass(frozen=True)
class Omitted(Node):
    """Çağrıda varsayılan değeri seçen boş argüman."""


@dataclass(frozen=True)
class Call(Node):
    name: str          # büyük harfe çevrilmiş
    args: tuple[Node, ...]


@dataclass(frozen=True)
class Binary(Node):
    op: str            # + - * / ^ & = <> < > <= >= && || IN
    left: Node
    right: Node


@dataclass(frozen=True)
class Unary(Node):
    op: str            # - + NOT
    operand: Node


@dataclass(frozen=True)
class TableConstructor(Node):
    """{1, 2, 3} — MVP'de yalnızca tek sütunlu."""
    items: tuple[Node, ...]


@dataclass(frozen=True)
class VarBlock(Node):
    variables: tuple[tuple[str, Node], ...]
    body: Node
