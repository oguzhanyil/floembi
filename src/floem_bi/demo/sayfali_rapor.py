"""SQLite fatura örneğinden bağımsız bir sayfalı rapor kütüphanesi oluşturur."""

import argparse
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory

from ..document import Document
from ..paginated.schema import Band, Formula, Group, Library, Object, Order, Parameter, Template


def library():
    seq = 0

    def item(kind, x, y, w, h=6, **props):
        nonlocal seq
        seq += 1
        return Object(id=f"n{seq}", kind=kind, x=x, y=y, w=w, h=h, **props)

    def band(kind, height, *objects, group=""):
        return Band(kind=kind, height=height, objects=list(objects), group=group)

    def title(text):
        return item("text", 0, 0, 155, 12, text=text, font=22, bold=True)

    def total(field, x=126):
        return item(
            "formula",
            x,
            1,
            60,
            7,
            formula=Formula(op="sum", field=field),
            format="money",
            align="right",
            bold=True,
        )

    columns = [
        ("ItemCode", "Ürün", 0, 27),
        ("Dscription", "Açıklama", 28, 72),
        ("WhsCode", "Depo", 102, 18),
        ("Quantity", "Miktar", 121, 21),
        ("LineTotal", "Tutar", 143, 43),
    ]

    def headings():
        return [
            item(
                "text",
                x,
                0,
                w,
                7,
                text=name,
                bold=True,
                color="#ffffff",
                background="#24475c",
                align="right" if f in ("Quantity", "LineTotal") else "left",
            )
            for f, name, x, w in columns
        ]

    child = Template(
        id="lines",
        name="Fatura kalemleri",
        category="Satış",
        table="INV1",
        sort=[Order(field="LineNum")],
        bands=[
            band("pageHeader", 8, *headings()),
            band(
                "detail",
                7,
                *(
                    item(
                        "field",
                        x,
                        0,
                        w,
                        field=f,
                        align="right" if f in ("Quantity", "LineTotal") else "left",
                        format="money" if f == "LineTotal" else "auto",
                    )
                    for f, _, x, w in columns
                ),
                item("line", 0, 6.5, 186, 0.3, color="#d6e0e6", border=0.2),
            ),
        ],
    )
    master = Template(
        id="invoice",
        name="Fatura dökümü",
        category="Satış",
        table="OINV",
        params=[Parameter(field="DocNum", label="Fatura numarası", default="FAT-0200")],
        bands=[
            band(
                "reportHeader",
                17,
                title("Satış faturası"),
                item("text", 0, 12, 100, 4, text="FLOEM  /  SATIŞ OPERASYONLARI", font=8, color="#337680"),
            ),
            band(
                "pageHeader",
                9,
                item("text", 0, 0, 45, text="Belge numarası", bold=True),
                item("field", 46, 0, 53, field="DocNum"),
                item("field", 125, 0, 61, field="DocDate", format="date", align="right"),
            ),
            band(
                "detail",
                35,
                item("field", 0, 1, 122, 8, field="CardName", font=16, bold=True),
                item("field", 0, 11, 123, 7, field="Address"),
                item("barcode", 133, 0, 53, 13, field="DocNum"),
                item("subreport", 0, 24, 186, 11, field="DocEntry", target="lines", childField="DocEntry"),
            ),
            band(
                "reportFooter",
                15,
                item("text", 82, 4, 50, 8, text="Genel toplam", bold=True),
                item(
                    "field",
                    129,
                    4,
                    57,
                    8,
                    field="DocTotal",
                    align="right",
                    format="money",
                    font=14,
                    bold=True,
                ),
            ),
            band(
                "pageFooter",
                9,
                item("line", 0, 0, 186, 0.4, color="#337680"),
                item("page", 105, 2, 81, align="right", font=8),
            ),
        ],
    )
    by_store = Template(
        id="warehouse",
        name="Depo ve stok özeti",
        category="Stok",
        table="INV1",
        groups=[Group(field="WhsCode", newPage=True), Group(field="ItemCode")],
        params=[Parameter(field="WhsCode", label="Depo"), Parameter(field="ItemCode", label="Stok")],
        bands=[
            band("reportHeader", 15, title("Depo ve stok özeti")),
            band("pageHeader", 8, *headings()),
            band(
                "groupHeader",
                9,
                item("field", 0, 0, 186, 8, field="WhsCode", background="#d3e8e8", bold=True),
                group="WhsCode",
            ),
            band("groupHeader", 8, item("field", 0, 0, 95, 7, field="ItemCode", bold=True), group="ItemCode"),
            child.bands[1].model_copy(deep=True),
            band(
                "groupFooter",
                9,
                item("text", 0, 1, 90, text="Ürün ara toplamı"),
                total("LineTotal"),
                group="ItemCode",
            ),
            band(
                "groupFooter",
                9,
                item("text", 0, 1, 90, text="Depo ara toplamı"),
                total("LineTotal"),
                group="WhsCode",
            ),
            band(
                "reportFooter",
                16,
                item("text", 0, 0, 100, text="Genel toplam", bold=True),
                total("LineTotal"),
            ),
            band("pageFooter", 8, item("page", 0, 0, 186, align="right")),
        ],
    )
    pivot = Template(
        id="pivot",
        name="Depolara göre stok tutarı",
        category="Stok",
        table="INV1",
        paper="A3",
        landscape=True,
        bands=[
            band("reportHeader", 18, title("Depolara göre stok tutarı")),
            band("detail", 0),
            band(
                "reportFooter",
                9,
                item(
                    "crossTab",
                    0,
                    0,
                    380,
                    9,
                    field="ItemCode",
                    column="WhsCode",
                    measure="LineTotal",
                    format="money",
                ),
            ),
            band("pageFooter", 8, item("page", 0, 0, 380, align="right")),
        ],
    )
    receipt = Template(
        id="receipt",
        name="Teslim tutanağı",
        category="Operasyon",
        table="OINV",
        params=[Parameter(field="DocNum", label="Belge numarası", default="FAT-0200")],
        bands=[
            band(
                "detail",
                273,
                item("line", 0, 9, 186, 0.7, color="#28777b", border=0.7),
                item("text", 0, 17, 118, 16, text="Teslim tutanağı", font=30, bold=True),
                item("field", 125, 18, 61, 9, field="DocNum", font=15, bold=True, align="right"),
                item("field", 125, 29, 61, 7, field="DocDate", format="date", align="right"),
                item("text", 0, 46, 46, 6, text="TESLİM YERİ", font=9, color="#28777b", bold=True),
                item("field", 0, 55, 175, 10, field="CardName", font=17, bold=True),
                item("field", 0, 69, 178, 8, field="Address", font=11),
                item("line", 0, 87, 186, 0.3, color="#b8cbd0"),
                item("text", 0, 96, 140, 10, text="Teslim notu", font=16, bold=True),
                item(
                    "text",
                    0,
                    109,
                    157,
                    15,
                    text="Teslim edilen malzemeler ve teslim sırasında tespit edilen hususlar:",
                    font=11,
                ),
                *(item("line", 0, y, 186, 0.25, color="#b8cbd0", border=0.25) for y in (139, 156, 173)),
                item("text", 0, 195, 84, 9, text="Teslim eden", font=13, bold=True),
                item("text", 103, 195, 83, 9, text="Teslim alan", font=13, bold=True),
                item("line", 0, 229, 82, 0.3, color="#536d79"),
                item("line", 103, 229, 83, 0.3, color="#536d79"),
                item("text", 0, 232, 82, 7, text="Adı, soyadı ve imzası", font=9, color="#536d79"),
                item("text", 103, 232, 83, 7, text="Adı, soyadı ve imzası", font=9, color="#536d79"),
                item("barcode", 0, 255, 51, 11, field="DocNum"),
                item("page", 130, 258, 56, 7, align="right", font=9),
            )
        ],
    )
    return Library(reports=[master, child, by_store, pivot, receipt])


def build(source: Path, output: Path, free_design=False):
    if output.exists() or output.suffix.lower() != ".floem":
        raise ValueError("Yeni bir .floem çıktı dosyası seçin")
    with TemporaryDirectory() as tmp, closing(Document.open(Path(tmp), source)) as doc:
        doc.content.paginated = library()
        if free_design:
            doc.content.paginated.reports.sort(key=lambda t: t.id != "receipt")
        doc.save(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kaynak", type=Path)
    parser.add_argument("cikti", type=Path)
    parser.add_argument("--serbest", action="store_true", help="İlk tasarım olarak teslim tutanağını aç")
    args = parser.parse_args()
    build(args.kaynak, args.cikti, args.serbest)
