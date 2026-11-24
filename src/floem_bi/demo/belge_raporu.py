"""Yerel belge deneme SQLite dosyasını ve iki baskı şablonunu .floem olarak kaydeder."""
from __future__ import annotations

import argparse
from pathlib import Path
from tempfile import TemporaryDirectory

from ..connectors import ConnectionSpec, SourceRef
from ..connectors.sqlite import SQLiteConnector
from ..document import Document, ImportItem, Job, JobTable
from ..document.print_forms import PrintTemplate, read_form
from ..model.schema import VeriKaynagi


def build(source: Path, output: Path) -> None:
    if output.suffix.lower() != ".floem" or output.exists():
        raise ValueError("Yeni bir .floem çıktı dosyası seçin.")
    connector = SQLiteConnector(ConnectionSpec(kind="sqlite", server=str(source.resolve()), auth="none"))
    names = ["OINV", "INV1", "OQUT", "QUT1"]
    with TemporaryDirectory() as tmp:
        doc = Document.new(Path(tmp))
        try:
            items = [ImportItem(SourceRef(source.name, "main", name), name) for name in names]
            job = Job("import", doc.id, [JobTable(n, n) for n in names])
            doc.run_import(job, connector, VeriKaynagi(id="belge-demo", tur="sqlite", sunucu=str(source.resolve()),
                           kimlik="none"), items, names)
            for kind, title, number in [("invoice", "Satış faturası", "FAT-0200"), ("quote", "Satış teklifi", "TEK-0002")]:
                matches = read_form(doc, kind, None, number)["items"]
                if not matches:
                    raise ValueError(f"Örnek belge bulunamadı: {number}")
                doc.set_print_template(PrintTemplate(kind=kind, title=title, issuer="Floem Demo",
                    columns=["LineNum", "ItemCode", "Dscription", "Quantity", "Price", "LineTotal"],
                    sampleKey=matches[0]["key"]))
            doc.save(output)
        finally:
            doc.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kaynak", type=Path)
    parser.add_argument("cikti", type=Path)
    args = parser.parse_args()
    build(args.kaynak, args.cikti)
