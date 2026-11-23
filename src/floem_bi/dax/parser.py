"""Floem DAX Pratt parser'ı.

Operatör önceliği (yüksekten düşüğe, DAX belgelerine göre):
  ^  >  işaret (-x)  >  * /  >  + -  >  &  >  karşılaştırma ve IN  >  NOT  >  &&  >  ||
İkili operatörlerin tamamı soldan gruplanır: 1-2-3 = (1-2)-3.
"""

from __future__ import annotations

from . import ast
from .lexer import DaxSyntaxError, Span, T, Token, tokenize

# (sol bağlanma gücü, sağ bağlanma gücü)
BINARY_POWER: dict[str, tuple[int, int]] = {
    "||": (10, 11),
    "&&": (20, 21),
    "=": (40, 41), "==": (40, 41), "<>": (40, 41),
    "<": (40, 41), ">": (40, 41), "<=": (40, 41), ">=": (40, 41),
    "IN": (40, 41),
    "&": (50, 51),
    "+": (60, 61), "-": (60, 61),
    "*": (70, 71), "/": (70, 71),
    "^": (90, 91),
}
NOT_POWER = 30      # NOT x  →  x, karşılaştırmayı içine alır
SIGN_POWER = 80     # -x     →  ^ dışındaki her şeyden sıkı


class Parser:
    def __init__(self, source: str):
        self.source = source
        self.tokens = tokenize(source)
        self.pos = 0

    # --- yardımcılar -------------------------------------------------------
    @property
    def tok(self) -> Token:
        return self.tokens[self.pos]

    def advance(self) -> Token:
        t = self.tokens[self.pos]
        if t.type is not T.EOF:
            self.pos += 1
        return t

    def expect(self, ttype: T, value: str | None = None, what: str | None = None) -> Token:
        t = self.tok
        if t.type is not ttype or (value is not None and t.value != value):
            expected = what or value or ttype.name
            got = t.value or "girdi sonu"
            raise DaxSyntaxError(f"'{expected}' bekleniyordu, '{got}' bulundu", t.span, self.source)
        return self.advance()

    def error(self, message: str, span: Span | None = None) -> DaxSyntaxError:
        return DaxSyntaxError(message, span or self.tok.span, self.source)

    # --- giriş noktası -----------------------------------------------------
    def parse(self) -> ast.Node:
        node = self.expression(0)
        if self.tok.type is not T.EOF:
            raise self.error(f"Beklenmeyen ifade: '{self.tok.value}'")
        return node

    def expression(self, min_power: int) -> ast.Node:
        left = self.prefix()
        while True:
            t = self.tok
            if t.type is T.OP or (t.type is T.KEYWORD and t.value == "IN"):
                op = t.value
            else:
                break
            lp, rp = BINARY_POWER.get(op, (None, None))
            if lp is None or lp < min_power:
                break
            self.advance()
            right = self.expression(rp)
            left = ast.Binary(left.span.merge(right.span), "=" if op == "==" else op, left, right)
        return left

    def prefix(self) -> ast.Node:
        t = self.tok
        if t.type is T.NUMBER:
            self.advance()
            text = t.value
            value: float | int = float(text) if any(c in text for c in ".eE") else int(text)
            return ast.Number(t.span, value)
        if t.type is T.STRING:
            self.advance()
            return ast.String(t.span, t.value)
        if t.type is T.KEYWORD:
            if t.value in ("TRUE", "FALSE"):
                self.advance()
                # TRUE() / FALSE() fonksiyon biçimi
                if self.tok.type is T.LPAREN:
                    self.advance()
                    end = self.expect(T.RPAREN, what=")")
                    return ast.Boolean(t.span.merge(end.span), t.value == "TRUE")
                return ast.Boolean(t.span, t.value == "TRUE")
            if t.value == "NOT":
                self.advance()
                # NOT(x) ve NOT x aynı ağacı verir
                operand = self.expression(NOT_POWER)
                return ast.Unary(t.span.merge(operand.span), "NOT", operand)
            if t.value == "VAR":
                return self.var_block()
            raise self.error(f"Beklenmeyen anahtar kelime: {t.value}")
        if t.type is T.OP and t.value in ("-", "+"):
            self.advance()
            operand = self.expression(SIGN_POWER)
            return ast.Unary(t.span.merge(operand.span), t.value, operand)
        if t.type is T.LPAREN:
            self.advance()
            inner = self.expression(0)
            self.expect(T.RPAREN, what=")")
            return inner
        if t.type is T.LBRACE:
            return self.table_constructor()
        if t.type is T.BRACKET:
            self.advance()
            return ast.BracketRef(t.span, t.value)
        if t.type is T.QUOTED_TABLE:
            self.advance()
            if self.tok.type is T.BRACKET:
                col = self.advance()
                return ast.ColumnRef(t.span.merge(col.span), t.value, col.value)
            return ast.Name(t.span, t.value, quoted=True)
        if t.type is T.IDENT:
            self.advance()
            if self.tok.type is T.LPAREN:
                return self.call(t)
            if self.tok.type is T.BRACKET:
                col = self.advance()
                return ast.ColumnRef(t.span.merge(col.span), t.value, col.value)
            return ast.Name(t.span, t.value)
        if t.type is T.EOF:
            raise self.error("İfade beklenirken girdi bitti")
        raise self.error(f"Beklenmeyen simge: '{t.value}'")

    def call(self, name_tok: Token) -> ast.Node:
        self.expect(T.LPAREN)
        args: list[ast.Node] = []
        if self.tok.type is not T.RPAREN:
            while True:
                # RANKX'in üçüncü (aranan değer) argümanı DAX'ta boş bırakılabilir.
                if name_tok.value.upper() == "RANKX" and len(args) == 2 and self.tok.type is T.COMMA:
                    args.append(ast.Omitted(self.tok.span))
                else:
                    args.append(self.expression(0))
                if self.tok.type is T.COMMA:
                    self.advance()
                    continue
                break
        end = self.expect(T.RPAREN, what=")")
        return ast.Call(name_tok.span.merge(end.span), name_tok.value.upper(), tuple(args))

    def table_constructor(self) -> ast.Node:
        start = self.expect(T.LBRACE)
        items: list[ast.Node] = []
        if self.tok.type is not T.RBRACE:
            while True:
                items.append(self.expression(0))
                if self.tok.type is T.COMMA:
                    self.advance()
                    continue
                break
        end = self.expect(T.RBRACE, what="}")
        return ast.TableConstructor(start.span.merge(end.span), tuple(items))

    def var_block(self) -> ast.Node:
        start = self.tok.span
        variables: list[tuple[str, ast.Node]] = []
        while self.tok.type is T.KEYWORD and self.tok.value == "VAR":
            self.advance()
            name = self.expect(T.IDENT, what="değişken adı")
            self.expect(T.OP, "=", what="=")
            variables.append((name.value, self.expression(0)))
        self.expect(T.KEYWORD, "RETURN", what="RETURN")
        body = self.expression(0)
        return ast.VarBlock(start.merge(body.span), tuple(variables), body)


def parse(source: str) -> ast.Node:
    return Parser(source).parse()
