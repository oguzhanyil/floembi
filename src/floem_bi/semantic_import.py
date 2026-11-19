"""TMDL semantik envanteri ve FDX derleme denetimi; kaynak sorgularını çalıştırmaz.

Bu okuyucu tablo/sütun/ölçü/ilişki alt kümesini destekler. Tam bir TOM
serileştiricisi değildir. M, SQL, bağlantılar ve özgün ifadeler denetim çıktısına
yazılmaz. Derleme başarısı veri ya da Power BI sonuç eşdeğerliği sayılmaz.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass, fields
import hashlib
import json
from pathlib import Path
import re
import textwrap

from .compiler import CompileError, QueryRequest, SqlGenerator
from .dax import ast, parse
from .dax.lexer import DaxSyntaxError, T, tokenize
from .model.schema import Iliski, ModelBilgisi, ModelTanimi, Olcu, Sutun, Tablo, TabloKaynak
from .model.semantic import ModelError, SemanticModel


_NAME = r"(?:'(?:[^']|'')*'|[^=]+?)"
_DECL = re.compile(rf"^(table|measure|column)\s+({_NAME})(?:\s*=\s*(.*))?$")


def _name(value: str) -> str:
    value = value.strip()
    return value[1:-1].replace("''", "'") if value.startswith("'") and value.endswith("'") else value


def _expression(lines: list[str], first: str | None, indent: int) -> str:
    if first is None:
        return ""
    if first.strip() == "```":
        body = []
        for line in lines:
            if line.strip() == "```":
                return textwrap.dedent("\n".join(body)).strip()
            body.append(line)
        raise ValueError("TMDL ifade bloğu kapanmamış")
    if first.strip():
        return first.strip()
    body = []
    for line in lines:
        if line.strip() and len(line) - len(line.lstrip()) <= indent + 4:
            break
        body.append(line)
    return textwrap.dedent("\n".join(body)).strip()


def _properties(lines: list[str], indent: int) -> dict[str, str]:
    result = {}
    for line in lines:
        if len(line) - len(line.lstrip()) != indent + 4:
            continue
        key, sep, value = line.strip().partition(":")
        if sep:
            result[key] = value.strip()
        elif key in ("isHidden", "isKey"):
            result[key] = "true"
    return result


@dataclass
class SourceModel:
    model: ModelTanimi
    tables: list[dict]
    relationships: list[dict]


def read_tmdl(path: Path) -> SourceModel:
    """Yalnız metadata okur. Kaynak bağlantısı açmaz; M/SQL yorumlamaz."""
    root = path / "definition" if (path / "definition").is_dir() else path
    files = sorted((root / "tables").glob("*.tmdl"))
    if not files:
        raise ValueError("TMDL tabloları bulunamadı; SemanticModel veya definition klasörünü seçin")
    tables, inventory = [], []
    types = {"int64": "int64", "double": "double", "decimal": "decimal", "dateTime": "datetime",
             "boolean": "bool", "string": "string", "binary": "string"}
    for file in files:
        lines = [line.expandtabs(4) for line in file.read_text(encoding="utf-8-sig").splitlines()]
        declarations, boundaries, fenced = [], [], False
        for i, line in enumerate(lines):
            if fenced:
                if line.strip() == "```":
                    fenced = False
                continue
            indent = len(line) - len(line.lstrip())
            if line.strip() and indent in (0, 4):
                declarations.append((i, _DECL.fullmatch(line.strip())))
                boundaries.append(i)
            if re.search(r"=\s*```$", line):
                fenced = True
        if fenced:
            raise ValueError("TMDL ifade bloğu kapanmamış")
        declarations = [(i, match) for i, match in declarations if match]
        homes = [match for i, match in declarations if match[1] == "table" and not lines[i].startswith(" ")]
        if len(homes) != 1:
            raise ValueError(f"TMDL dosyasında tek tablo bekleniyordu: {file.name}")
        table = Tablo(ad=_name(homes[0][2]), kaynak=TabloKaynak(katman="veri", tablo=file.stem))
        calculated, partitions = [], []
        for i, match in declarations:
            kind, raw_name, first = match.groups()
            if kind == "table":
                continue
            end = next((j for j in boundaries if j > i), len(lines))
            body = lines[i + 1:end]
            props = _properties(body, 4)
            name = _name(raw_name)
            expression = _expression(body, first, 4)
            if kind == "measure":
                if not expression:
                    raise ValueError(f"TMDL ölçü ifadesi boş: {table.ad}[{name}]")
                table.olculer.append(Olcu(ad=name, ifade=expression, bicim=props.get("formatString"),
                                         klasor=props.get("displayFolder")))
            else:
                # Hesaplanmış sütun ifadesi yalnız derleme adayı modelinde tutulur.
                table.sutunlar.append(Sutun(ad=name, tip=types.get(props.get("dataType"), "string"),
                                           ifade=expression or None, gizli=props.get("isHidden") == "true",
                                           anahtar=props.get("isKey") == "true"))
                if expression:
                    calculated.append(name)
        for line in lines:
            if line.startswith("    partition "):
                partitions.append("calculated" if line.rstrip().endswith("= calculated") else "source")
        tables.append(table)
        inventory.append({"table": table.ad, "columns": [c.ad for c in table.sutunlar],
                          "calculatedColumns": calculated, "partitions": partitions})
    relationships, supported = [], []
    rel_file = root / "relationships.tmdl"
    if rel_file.exists():
        text = rel_file.read_text(encoding="utf-8-sig")
        for block in re.split(r"(?m)^relationship ", text)[1:]:
            props = dict(re.findall(r"(?m)^\s+(\w+):\s*(.*?)\s*$", block))
            ends = []
            for key in ("fromColumn", "toColumn"):
                match = re.fullmatch(r"('(?:[^']|'')*'|[^.]+)\.(.+)", props.get(key, ""))
                if not match:
                    raise ValueError("TMDL ilişki uçları çözümlenemedi")
                ends.append((_name(match[1]), _name(match[2])))
            many_one = props.get("fromCardinality", "many") in ("many", "one") and props.get("toCardinality", "one") == "one"
            active = props.get("isActive", "true") != "false"
            both = props.get("crossFilteringBehavior") == "bothDirections"
            item = {"from": list(ends[0]), "to": list(ends[1]), "active": active,
                    "bidirectional": both, "supported": many_one and not both,
                    "datePartOnly": props.get("joinOnDateBehavior") == "datePartOnly"}
            relationships.append(item)
            if item["supported"]:
                supported.append(Iliski(kimden=f"'{ends[0][0]}'[{ends[0][1]}]",
                                       kime=f"'{ends[1][0]}'[{ends[1][1]}]", aktif=active,
                                       kardinalite="1:1" if props.get("fromCardinality") == "one" else "*:1"))
    return SourceModel(ModelTanimi(model=ModelBilgisi(ad=path.name), tablolar=tables, iliskiler=supported),
                       inventory, relationships)


def _walk(node: ast.Node):
    yield node
    for field in fields(node):
        value = getattr(node, field.name)
        if isinstance(value, ast.Node):
            yield from _walk(value)
        elif isinstance(value, tuple):
            for child in value:
                if isinstance(child, ast.Node):
                    yield from _walk(child)
                elif isinstance(child, tuple):
                    for sub in child:
                        if isinstance(sub, ast.Node):
                            yield from _walk(sub)


def analyze(source: SourceModel) -> dict:
    """Her ölçüyü kaynak şemasına karşı gerçek SQL üretimine kadar denetler."""
    model = SemanticModel(source.model)
    rows = []
    for table in source.model.tablolar:
        for measure in table.olculer:
            functions, dependencies, columns = [], [], []
            status, code = "uyarlama_gerekli", None
            try:
                tokens = tokenize(measure.ifade)
                functions = sorted({token.value.upper() for i, token in enumerate(tokens[:-1])
                                    if token.type is T.IDENT and tokens[i + 1].type is T.LPAREN})
                nodes = list(_walk(parse(measure.ifade)))
                dependencies = sorted({n.name for n in nodes if isinstance(n, ast.BracketRef)})
                columns = sorted({(n.table, n.column) for n in nodes if isinstance(n, ast.ColumnRef)})
                SqlGenerator(model).compile(QueryRequest(group_by=[], measures=[measure.ad]))
            except DaxSyntaxError:
                status, code = "motor_destegi_gerekli", "FDX_PARSE_ERROR"
            except (CompileError, ModelError):
                status, code = "motor_destegi_gerekli", "FDX_COMPILE_ERROR"
            rows.append({"table": table.ad, "name": measure.ad, "status": status, "code": code,
                         "compiled": code is None, "resultVerified": False,
                         "functions": functions, "dependencies": dependencies,
                         "columns": [list(c) for c in columns],
                         "expressionHash": hashlib.sha256(measure.ifade.encode()).hexdigest()})
    blocked = {r["name"].casefold() for r in rows if not r["compiled"]}
    for row in rows:
        row["blockedDependencies"] = [name for name in row["dependencies"] if name.casefold() in blocked]
    return {"version": 1, "scope": "metadata_and_compilation", "dataImported": False,
            "resultParityVerified": False, "tables": source.tables, "relationships": source.relationships,
            "measures": rows, "summary": {"tables": len(source.tables),
            "columns": sum(len(t.sutunlar) for t in source.model.tablolar),
            "relationships": len(source.relationships), "measures": len(rows),
            "statuses": dict(Counter(row["status"] for row in rows))}}


def write_audit(audit: dict, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.with_suffix(".json").write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    labels = {"uyarlama_gerekli": "Uyarlama gerekli", "motor_destegi_gerekli": "Motor desteği gerekli"}
    lines = ["# F06 semantik model denetimi", "", "Derleme, veri aktarımı veya sonuç eşdeğerliği değildir.", "",
             "| Tablo | Ölçü | Durum | SQL üretildi | Demo uyarlaması (eşdeğerlik değil) |", "|---|---|---|---|---|"]
    escape = lambda text: text.replace("|", "\\|").replace("\n", " ")
    for item in audit["measures"]:
        lines.append(f"| {escape(item['table'])} | {escape(item['name'])} | {labels[item['status']]} | {'Evet' if item['compiled'] else 'Hayır'} | {escape(item.get('demoMeasure', '—'))} |")
    if "fieldMappings" in audit:
        lines += ["", "## Alan eşlemeleri", "", "Alan eşlemesi semantik eşdeğerlik değildir.", "",
                  "| Kaynak | Hedef | Kapsam |", "|---|---|---|"]
        for item in audit["fieldMappings"]:
            lines.append(f"| {escape(item['source'])} | {escape(item.get('target') or 'Eksik; otomatik oluşturulmadı')} | {escape(item['scope'])} |")
    output.with_suffix(".md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="TMDL modelini bağlantı açmadan ve veri aktarmadan denetler")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path, help="JSON/Markdown çıktı kökü")
    parser.add_argument("--demo", type=Path, help="F06 .floem dosyasıyla alan/ölçü eşlemesini ve yerel anahtarları denetler")
    args = parser.parse_args()
    audit = analyze(read_tmdl(args.source))
    if args.demo:
        import tempfile

        from .document.document import Document
        from .semantic_demo import annotate_audit
        from .semantic_validation import verify_demo

        with tempfile.TemporaryDirectory(prefix="floem-semantic-audit-") as temporary:
            doc = Document.open(Path(temporary), args.demo)
            try:
                annotate_audit(audit, doc)
                audit["localVerification"] = verify_demo(doc)
            finally:
                doc.close()
    write_audit(audit, args.output)
    print(json.dumps(audit["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
