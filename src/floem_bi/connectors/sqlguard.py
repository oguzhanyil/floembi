"""SQL penceresi için salt okuma koruması.

Sorgu sqlglot ile ayrıştırılır; yalnızca tek bir SELECT (WITH/UNION dahil)
kabul edilir. INSERT/UPDATE/DELETE/MERGE/DDL, SELECT ... INTO, EXEC ve çoklu
deyimler reddedilir. Bu, kaynakta salt okuma yetkili kullanıcı kullanmanın
yerini tutmaz; ikinci bir emniyet katmanıdır.
"""

from __future__ import annotations

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

from .base import ConnectorError

_READ_ROOTS = (exp.Select, exp.Union, exp.Intersect, exp.Except)
_FORBIDDEN = tuple(
    getattr(exp, n)
    for n in ("Insert", "Update", "Delete", "Merge", "Create", "Drop", "Alter", "TruncateTable",
              "Command", "Into", "Grant", "Revoke", "Use", "Set", "Transaction", "Commit", "Rollback")
    if hasattr(exp, n)
)


def ensure_read_only(sql: str, dialect: str = "tsql") -> str:
    text = sql.strip().rstrip(";").strip()
    if not text:
        raise ConnectorError("Sorgu boş", code="empty_query")
    try:
        statements = [s for s in sqlglot.parse(text, read=dialect) if s is not None]
    except ParseError as e:
        raise ConnectorError("SQL sözdizimi çözümlenemedi", str(e).splitlines()[0], code="parse_error") from e
    if len(statements) != 1:
        raise ConnectorError("Tek seferde yalnızca bir SELECT sorgusu çalıştırılabilir", code="multi_statement")
    root = statements[0]
    if not isinstance(root, _READ_ROOTS):
        kind = root.key.upper()
        raise ConnectorError(
            f"Yalnızca SELECT sorguları çalıştırılabilir ({kind} engellendi)", code="not_read_only"
        )
    for node in root.walk():
        if isinstance(node, _FORBIDDEN):
            raise ConnectorError(
                f"Sorgu veri değiştiren bir ifade içeriyor ({node.key.upper()} engellendi)", code="not_read_only"
            )
    return text
