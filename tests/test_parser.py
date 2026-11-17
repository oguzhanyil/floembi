import pytest

from floem_bi.dax import DaxSyntaxError, ast, parse, tokenize
from floem_bi.dax.lexer import T


def ev(node):
    """Sayısal AST'yi değerlendiren küçük yardımcı (öncelik testleri için)."""
    if isinstance(node, ast.Number):
        return node.value
    if isinstance(node, ast.Unary):
        return -ev(node.operand) if node.op == "-" else ev(node.operand)
    if isinstance(node, ast.Binary):
        a, b = ev(node.left), ev(node.right)
        return {"+": a + b, "-": a - b, "*": a * b, "/": a / b, "^": a ** b}[node.op]
    raise TypeError(node)


@pytest.mark.parametrize("src,expected", [
    ("1-2-3", -4),          # pbi_parsers'ta 2 çıkıyordu
    ("8/4/2", 1),           # pbi_parsers'ta 4 çıkıyordu
    ("2+3*4", 14),
    ("(2+3)*4", 20),
    ("-2^2", -4),           # DAX: ^ işaretten önce
    ("2^3^2", 64),          # soldan: (2^3)^2
    ("10-2*3+1", 5),
])
def test_operator_precedence_and_associativity(src, expected):
    assert ev(parse(src)) == expected


def test_keywords_require_word_boundary():
    # VAR.P bir fonksiyon, Returns bir tablo, Description bir sütun adı
    node = parse("VAR.P(Returns[Description]) + TRUEVALUE[x]")
    assert isinstance(node.left, ast.Call) and node.left.name == "VAR.P"
    assert node.left.args[0] == ast.ColumnRef(None, "Returns", "Description")
    assert node.right == ast.ColumnRef(None, "TRUEVALUE", "x")


def test_keywords_case_insensitive():
    node = parse("var x = 1 Return x + 1")
    assert isinstance(node, ast.VarBlock)
    assert node.variables[0][0] == "x"


def test_function_names_uppercased():
    assert parse("sum(Satis[Tutar])").name == "SUM"


def test_numbers_and_strings():
    toks = tokenize('1e-5 .5 2.5E+3 "a""b"')
    assert [t.value for t in toks[:4]] == ["1e-5", ".5", "2.5E+3", 'a"b']
    assert parse("1e-5").value == pytest.approx(1e-5)


def test_quoted_table_and_bracket_escape():
    node = parse("'Satış Tablosu'[Tutar]]x]")
    assert node == ast.ColumnRef(None, "Satış Tablosu", "Tutar]x")


def test_comments_are_skipped():
    node = parse("1 // satır\n + /* blok */ 2 -- son")
    assert ev(node) == 3


def test_not_and_in():
    node = parse('NOT Urun[Kategori] IN {"A", "B"} && TRUE')
    assert node.op == "&&"
    assert isinstance(node.left, ast.Unary) and node.left.op == "NOT"
    assert node.left.operand.op == "IN"


def test_error_has_span_and_caret():
    src = "SUM(Satis[Tutar]"
    with pytest.raises(DaxSyntaxError) as ei:
        parse(src)
    err = ei.value
    assert err.span.start == len(src)
    assert "^" in err.render()


def test_unterminated_string_reports_position():
    with pytest.raises(DaxSyntaxError) as ei:
        parse('"abc')
    assert ei.value.span.start == 0


def test_tokens_end_with_eof():
    assert tokenize("")[-1].type is T.EOF
