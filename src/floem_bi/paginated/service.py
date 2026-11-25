from base64 import b64encode

from ..connectors import json_value
from .pagination import Layout, ordered
from .render import shapes, svg
from .word import document


def spreadsheet(pages):
    # Tek hücrede tek değer. Sayfaların milimetre eksenleri aynı çalışma sayfasında hizalanır.
    visible = [[o for o in page if o["kind"] in ("text", "barcode") and o["text"]] for page in pages]
    keys = sorted({round(o["x"], 1) for page in visible for o in page})
    cols = {x: i for i, x in enumerate(keys)}
    rows = []
    for page in visible:
        row, y0 = {}, -100
        for o in sorted(page, key=lambda o: (o["y"], o["x"])):
            x, y = cols[round(o["x"], 1)], o["y"]
            if row and (y - y0 > 1.2 or x in row):
                rows.append(row)
                row = {}
            if not row:
                y0 = y
            row[x] = json_value(o.get("value", o["text"]))
        if row:
            rows.append(row)
    if len(rows) * len(cols) > 2_000_000:
        raise ValueError("Tablo çıktısı çok büyük. Rapor parametrelerini daraltın.")
    return [[row.get(i) for i in range(len(cols))] for row in rows]


def run(library, request, source):
    template = library.latest().get(request.report)
    if not template:
        raise ValueError("Rapor kütüphanede bulunamadı")
    rows = source.rows(template)
    options = {}
    for p in template.params:
        if p.kind == "choice":
            options[p.label] = sorted({str(r[p.field]) for r in rows if r[p.field] is not None})
    filtered = ordered(template, rows, request.values)
    layout = Layout(library, source)
    width, height = template.size
    pages = layout.pages(template, filtered)
    drawings, shape_count = [], 0
    for page in pages:
        drawing = []
        for shape in shapes(page):
            shape_count += 1
            if shape_count > 350_000:
                raise ValueError("Çıktı çok büyük. Rapor parametrelerini daraltın.")
            drawing.append(shape)
        drawings.append(drawing)
    if request.output == "word":
        return {"word": b64encode(document(width, height, drawings)).decode("ascii")}
    sheet = spreadsheet(pages)
    return {
        "name": template.name,
        "width": width,
        "height": height,
        "count": len(filtered),
        "options": options,
        "pages": [svg(width, height, d) for d in drawings],
        "sheet": sheet,
    }
