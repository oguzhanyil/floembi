"""Aynı seçimle alınmış Power BI referanslarını açık Floem belgesinde sınar."""

from __future__ import annotations

import argparse
from datetime import datetime
from decimal import Decimal
import json
import math
from pathlib import Path
from tempfile import TemporaryDirectory

from .document.document import Document
from .report.query import VisualQuery


def matches(actual, expected, money=False, exact=False):
    if expected is None or isinstance(expected, bool):
        return actual is expected
    if isinstance(expected, (float, int, Decimal)):
        if not isinstance(actual, (float, int, Decimal)) or isinstance(actual, bool):
            return False
        # JSON, 1.0 oranını da 1 olarak yazabilir. Adetler referansta belirtilir.
        if exact or (isinstance(expected, int) and isinstance(actual, int) and not money):
            return actual == expected
        return math.isclose(
            actual,
            expected,
            rel_tol=0 if money else 1e-12,
            abs_tol=0.005 if money else 1e-8,
        )
    if isinstance(actual, str) and isinstance(expected, str) and "T" in expected:
        try:
            return (
                abs(
                    (
                        datetime.fromisoformat(actual)
                        - datetime.fromisoformat(expected)
                    ).total_seconds()
                )
                <= 0.000002
            )
        except ValueError:
            pass
    return actual == expected


def compare(doc, reference):
    filters = [
        dict(table=t, column=c, op="in", values=[value])
        for t, c, value in reference["filters"]
    ]
    measures = {m.ad: m for t in doc.tanim.tablolar for m in t.olculer}
    rows = []
    for name, expected in reference["values"].items():
        measure = measures.get(name)
        if measure is None:
            rows.append({"measure": name, "status": "ölçü eksik"})
            continue
        try:
            query = VisualQuery.model_validate(
                {"values": [{"measure": name}], "filters": filters}
            )
            result = doc.query(query)
            actual = result["rows"][0][0] if result["rows"] else None
            money = name in reference.get("moneyMeasures", [])
            identical = matches(actual, expected, money, name in reference.get("countMeasures", []))
            rows.append({"measure": name, "status": "eşleşti" if identical else "fark"})
        except Exception:
            rows.append({"measure": name, "status": "sorgu hatası"})
    for name in reference.get("errors", []):
        rows.append({"measure": name, "status": "kaynak sorgu hatası"})
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument(
        "reference",
        type=Path,
        nargs="+",
        help="filters, values ve isteğe bağlı moneyMeasures/countMeasures içeren yerel JSON",
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = {}
    with TemporaryDirectory() as root:
        doc = Document.open(Path(root), args.report)
        try:
            for file in args.reference:
                baseline = json.loads(file.read_text(encoding="utf-8-sig"))
                output[file.stem] = compare(doc, baseline)
        finally:
            doc.close()
    args.output.write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    failed = sum(r["status"] != "eşleşti" for rows in output.values() for r in rows)
    print(f"{sum(map(len, output.values()))} karşılaştırma, {failed} açık sonuç.")
    raise SystemExit(bool(failed))


if __name__ == "__main__":
    main()
