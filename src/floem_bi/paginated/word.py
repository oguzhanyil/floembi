"""Word uyumlu mutlak konumlu, düzenlenebilir metin ve vektör şekilleri."""

from io import BytesIO
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

PT = 72 / 25.4


def document(width, height, drawings):
    doc = [
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w10="urn:schemas-microsoft-com:office:word"><w:body>'
    ]
    for n, page in enumerate(drawings):
        doc.append(
            "<w:p><w:pPr>"
            + ("<w:pageBreakBefore/>" if n else "")
            + '<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>'
        )
        # Word her yüzen nesneyi ayrı sayfalarsa yüzlerce kalemde yerleşim çok yavaşlar.
        # Tek sayfa çapası altındaki grup, metin kutularını düzenlenebilir tutar.
        doc.append(
            f'<w:r><w:pict><v:group id="page{n + 1}" coordorigin="0,0" coordsize="{round(width * 100)},{round(height * 100)}" '
            f'style="position:absolute;margin-left:0;margin-top:0;width:{width * PT:.3f}pt;height:{height * PT:.3f}pt;'
            'mso-position-horizontal-relative:page;mso-position-vertical-relative:page">'
        )
        for kind, x, y, a, b, color, *style in page:
            is_text = kind == "text"
            top, w, h = (y - 0.94 * a, max(0.1, width - x), a * 1.25) if is_text else (y, a, b)
            pos = f"position:absolute;left:{round(x * 100)};top:{round(top * 100)};width:{max(1, round(w * 100))};height:{max(1, round(h * 100))}"
            fill = 'filled="f"' if is_text else f'fillcolor="{color}"'
            doc.append(f'<v:rect style="{pos}" {fill} stroked="f">')
            if is_text:
                size = max(1, round(a * PT * 2))
                doc.append(
                    '<v:textbox inset="0,0,0,0"><w:txbxContent><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>'
                    '<w:r><w:rPr><w:rFonts w:ascii="Roboto" w:hAnsi="Roboto"/>'
                    + ("<w:b/>" if style[0] else "")
                    + f'<w:color w:val="{color[1:]}"/><w:sz w:val="{size}"/></w:rPr>'
                    + f'<w:t xml:space="preserve">{escape(b)}</w:t></w:r></w:p></w:txbxContent></v:textbox>'
                )
            doc.append("</v:rect>")
        doc.append('<w10:wrap type="none"/></v:group></w:pict></w:r></w:p>')
    doc.append(
        f'<w:sectPr><w:pgSz w:w="{round(width * PT * 20)}" w:h="{round(height * PT * 20)}"/><w:pgMar w:top="0" w:bottom="0" w:left="0" w:right="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>'
    )
    out = BytesIO()
    with ZipFile(out, "w", ZIP_DEFLATED) as z:
        z.writestr(
            "[Content_Types].xml",
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        )
        z.writestr(
            "_rels/.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        )
        z.writestr("word/document.xml", "".join(doc))
    return out.getvalue()
