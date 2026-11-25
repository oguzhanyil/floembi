from base64 import b64decode
from contextlib import closing, contextmanager
from io import BytesIO
from itertools import chain
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import pytest

from floem_bi.demo.sayfali_rapor import library
from floem_bi.paginated.formula import Totals, evaluate
from floem_bi.paginated.pagination import Layout
from floem_bi.paginated.render import modules
from floem_bi.paginated.schema import Band, Formula, Group, Library, Object, Rule, Run, Template
from floem_bi.paginated.service import run


def obj(kind="field", **opts):
    return Object.model_validate(dict({"id": "x", "kind": kind, "x": 0, "y": 0, "w": 100, "h": 6}, **opts))


def test_subreport_link_reprints_headers_and_exports_word():
    parent, child, *rest = library().reports

    class Source:
        def rows(self, t, link=""):
            if t.id == parent.id:
                return [
                    dict(
                        DocNum="FAT-TEST",
                        DocTotal=400,
                        DocEntry=3,
                        DocDate="2026-11-24",
                        CardName="Çağrı <&>",
                        Address="Ankara",
                    )
                ]
            return [
                dict(
                    ItemCode="A",
                    DocEntry=3,
                    LineNum=i,
                    Dscription=f"Kalem {i:03}",
                    WhsCode="D",
                    Quantity=1,
                    LineTotal=4,
                )
                for i in range(100)
            ] + [
                dict(
                    ItemCode="X",
                    DocEntry=8,
                    LineNum=1,
                    Dscription="DİĞER BELGE",
                    WhsCode="D",
                    Quantity=1,
                    LineTotal=9,
                )
            ]

    lib = Library(reports=[parent, child])
    result = run(lib, Run(report=parent.id, values={"Fatura numarası": "FAT-TEST"}), Source())
    assert len(result["pages"]) >= 3 and all("Açıklama" in svg for svg in result["pages"])
    text = " ".join(" ".join(ET.fromstring(s).itertext()) for s in result["pages"])
    assert text.count("Genel toplam") == 1 and "400,00 TL" in text
    assert text.count("Kalem ") == 100 and "DİĞER BELGE" not in text and "Çağrı <&>" in text
    cells = list(chain.from_iterable(result["sheet"]))
    assert "Kalem 099" in cells and 400 in cells
    with ZipFile(
        BytesIO(
            b64decode(
                run(
                    lib,
                    Run(report=parent.id, values={"Fatura numarası": "FAT-TEST"}, output="word"),
                    Source(),
                )["word"]
            )
        )
    ) as z:
        xml = ET.fromstring(z.read("word/document.xml"))
        assert (
            "Kalem 099" in list(xml.itertext())
            and len(xml.findall(".//{*}pageBreakBefore")) == len(result["pages"]) - 1
        )


def test_nested_group_scopes_running_sort_and_conditions():
    def band(kind, height, obj, group=""):
        return Band(kind=kind, group=group, height=height, objects=[obj])

    t = Template(
        id="g",
        name="test",
        table="T",
        groups=[Group(field="depo", newPage=True), Group(field="stok")],
        bands=[
            band("groupHeader", 8, obj(id="gh", field="depo"), "depo"),
            band(
                "detail",
                25,
                obj(
                    "formula",
                    formula=Formula(op="running", field="v"),
                    rule=Rule(field="v", op="gt", value=1),
                    ruleColor="#ff0000",
                ),
            ),
            band("groupFooter", 8, obj("formula", id="fg", formula=Formula(op="sum", field="v")), "depo"),
            band("reportFooter", 8, obj("formula", id="fr", formula=Formula(op="count"))),
        ],
    )
    rows = [dict(depo="A", stok="a", v=1)] * 12 + [dict(depo="B", stok="b", v=2)] * 3
    p = Layout(Library(reports=[t]), None).pages(t, rows)
    assert len(p) == 3 and [i["text"] for i in p[1]][0] == "A"
    assert [i["text"] for i in p[-1]] == ["B", "2", "4", "6", "6", "15"]
    assert [o["color"] for o in p[-1] if o["text"] == "4"] == ["#ff0000"]


def test_four_barcode_types_and_checksum():
    for sym, val in [
        ("code39", "ABC-128"),
        ("code128", "Floem-123"),
        ("ean13", "4006381333931"),
        ("qr", "Türkçe"),
    ]:
        matrix = modules(sym, val)
        assert len(matrix[0]) > 20 and any(any(row) for row in matrix)
    with pytest.raises(ValueError, match="kontrol"):
        modules("ean13", "4006381333932")


def test_formula_types_and_dynamic_pivot():
    row = {"a": 3, "b": 4, "date": "2026-11-24"}
    for op, field, other, value, expected in [
        ("multiply", "a", "b", 0, 12),
        ("year", "date", "", 0, 2026),
        ("daysBetween", "date", "", "2026-11-20", 4),
    ]:
        assert (
            evaluate(Formula(op=op, field=field, other=other, value=value), row, Totals([row]), 1) == expected
        )
    cond = Formula(op="if", condition=Rule(field="a", op="le", value=3), yes="Evet", no="Hayır")
    assert evaluate(cond, row, Totals([row]), 1) == "Evet"

    class Source:
        def rows(self, *_args):
            return [
                dict(ItemCode="X", WhsCode="A", LineTotal=20),
                dict(ItemCode="X", WhsCode="A", LineTotal=10),
                dict(ItemCode="Y", WhsCode="B", LineTotal=7),
            ]

    p = run(library(), Run(report="pivot"), Source())
    assert (p["width"], p["height"]) == (420, 297)
    assert "30,00 TL" in p["pages"][0] and "7,00 TL" in p["pages"][0]


def test_archive_versions_and_duplicate_rows(tmp_path):
    from floem_bi.document import Document
    import test_document as td
    from floem_bi.paginated.source import SnapshotSource
    from floem_bi.connectors import SourceRef
    from floem_bi.document import ImportItem, Job, JobTable
    from floem_bi.model.schema import VeriKaynagi
    from floem_bi.connectors import ConnectionSpec

    path = tmp_path / "sample.floem"
    with closing(Document.new(tmp_path)) as d:
        source = td.FakeConnector(ConnectionSpec(kind="sqlserver", server="fixture"))
        d.run_import(
            Job("import", d.id, [JobTable("OCRD", "OCRD")]),
            source,
            VeriKaynagi(id="demo", sunucu="fixture"),
            [ImportItem(SourceRef("SBO", "dbo", "OCRD"), "OCRD")],
            ["OCRD"],
        )
        t = Template(
            id="a", name="A", table="OCRD", bands=[Band(kind="detail", objects=[obj(field="CardName")])]
        )
        d.content.paginated = Library(reports=[t, t.model_copy(update={"version": 2, "name": "A2"})])
        d.con.execute("INSERT INTO veri.OCRD SELECT * FROM veri.OCRD LIMIT 1")
        count = d.con.execute("SELECT count(*) FROM veri.OCRD").fetchone()[0]
        d.save(path)
    with closing(Document.open(tmp_path, path)) as d:
        assert d.content.manifest["format_version"] == 5 and len(d.content.paginated.reports) == 2
        res = run(d.content.paginated, Run(report="a"), SnapshotSource(*d._semantic_engine()))
        assert len(res["sheet"]) == count and res["name"] == "A2"


def test_sql_procedure_binds_arguments():
    from floem_bi.connectors.base import ConnectionSpec, SourceRef
    from floem_bi.connectors.sqlserver import SqlServerConnector

    class Cursor:
        description = [("Value", int, None, 12, 12, 0, False)]

        def execute(self, *args):
            self.call = args

        def fetchmany(self, n):
            return [(3,)]

    cur = Cursor()

    class Connection:
        def add_output_converter(self, *args):
            pass

        def cursor(self):
            return cur

    @contextmanager
    def connect(*args, **kwargs):
        yield Connection()

    c = object.__new__(SqlServerConnector)
    c.spec = ConnectionSpec(kind="sqlserver", server="fixture")
    c._connect = connect
    ref = SourceRef("db", "rapor", "", None, "Liste", ("a'b", 42))
    with c.extract(ref) as result:
        assert result.fetch(1) == [(3,)] and cur.call == ("EXEC [rapor].[Liste] ?, ?", "a'b", 42)


def test_free_form_title_and_text_survive_archive(tmp_path):
    from floem_bi.document import Document
    from floem_bi.document.print_forms import PrintTemplate

    with closing(Document.new(tmp_path)) as doc:
        form = PrintTemplate.model_validate(
            dict(
                kind="invoice",
                title="Satış",
                columns=["ItemCode"],
                layout={
                    "freeText": [
                        dict(id="title", role="title", band="footer", x=12, y=4, w=90, h=15),
                        dict(
                            id="note",
                            role="text",
                            text="Sayın {CardName}",
                            band="header",
                            x=15,
                            y=1,
                            w=70,
                            h=9,
                            locked=True,
                        ),
                    ]
                },
            )
        )
        doc.set_print_template(form)
        doc.content.paginated = library()
        path = tmp_path / "serbest.floem"
        doc.save(path)
    with closing(Document.open(tmp_path, path)) as reopened:
        assert reopened.content.manifest["format_version"] == 6
        assert reopened.content.print_templates[0] == form and reopened.content.paginated == library()


def test_blank_document_needs_no_source_and_fills_one_sheet(tmp_path):
    from floem_bi.document import Document
    from floem_bi.paginated.source import SnapshotSource

    with closing(Document.new(tmp_path)) as doc:
        report = Template(
            id="blank",
            name="Belge",
            bands=[
                Band(
                    kind="reportHeader",
                    height=273,
                    objects=[
                        obj("text", text="Serbest başlık", x=15, y=12),
                        obj("text", id="note", text="Alt metin", x=15, y=250),
                    ],
                ),
                Band(kind="detail", height=0),
            ],
        )
        result = run(Library(reports=[report]), Run(report="blank"), SnapshotSource(*doc._semantic_engine()))
        assert len(result["pages"]) == 1 and "Alt metin" in result["pages"][0]
