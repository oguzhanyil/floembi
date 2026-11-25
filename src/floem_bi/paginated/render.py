"""Milimetre cinsinden sayfa listesini SVG ve Word'ün kullandığı şekillere çevirir."""

from functools import lru_cache
from itertools import groupby
from xml.etree import ElementTree as ET

import segno
from barcode import Code128, Code39, EAN13
from barcode.errors import BarcodeError

from .font_widths import MEDIUM, REGULAR


@lru_cache(maxsize=1024)
def modules(kind, value):
    if len(value) > 1000:
        raise ValueError("Barkod değeri 1000 karakteri aşıyor")
    if kind == "qr":
        qr = segno.make_qr(value, error="M")
        return list(qr.matrix_iter(border=4))
    try:
        if kind == "ean13":
            if not value.isascii() or not value.isdigit() or len(value) not in (12, 13):
                raise ValueError("EAN-13 için 12 veya 13 rakam gerekli")
            code = EAN13(value[:12])
            if len(value) == 13 and code.get_fullcode() != value:
                raise ValueError("EAN-13 kontrol basamağı geçersiz")
        elif kind == "code39":
            code = Code39(value, add_checksum=False)
        else:
            code = Code128(value)
        return [tuple(int(bit) for bit in "0" * 10 + code.build()[0] + "0" * 10)]
    except BarcodeError as exc:
        raise ValueError(f"{kind} değeri geçersiz: {value}") from exc


def clean(text):
    return "".join(c for c in str(text) if c in "\n\t" or ord(c) >= 32 and c not in "\ufffe\uffff")


def fit_lines(text, box):
    widths = MEDIUM if box["bold"] else REGULAR

    def length(s):
        return sum(widths[ord(c) - 32] if 32 <= ord(c) < 384 else 1000 for c in s) / 1000

    width = max(0.01, box["w"] - 0.6)
    raw = text.expandtabs(4).splitlines() or [""]

    def wrap(size):
        if not box.get("wrap"):
            return raw
        limit = width / size
        lines = []
        for paragraph in raw:
            line = ""
            for word in paragraph.split():
                with_word = (line + " " + word).lstrip()
                if line and length(with_word) > limit:
                    lines.append(line)
                    line = ""
                line = (line + " " + word).lstrip()
            lines.append(line)
        return lines

    size = box["font"] * 25.4 / 72
    lines = wrap(size)
    if len(lines) * size * 1.19 > box["h"]:
        lo, hi = 0.001, size
        for _ in range(12):
            mid = (hi + lo) / 2
            if len(wrap(mid)) * mid * 1.19 > box["h"]:
                hi = mid
            else:
                lo = mid
        size = lo
        lines = wrap(size)
    measures = [length(s) for s in lines]
    return lines, measures, min(size, width / max(0.01, max(measures)))


def shapes(items):
    for o in items:
        x, y, w, h = (o[k] for k in ("x", "y", "w", "h"))
        color, kind = o["color"], o["kind"]
        if o["background"]:
            yield ("rect", x, y, w, h, o["background"])
        if kind == "box":
            b = min(o["border"], h, w)
            for rect in [(x, y, w, b), (x, y + h - b, w, b), (x, y, b, h), (x + w - b, y, b, h)]:
                yield ("rect", *rect, color)
        elif kind == "line":
            # Geniş yatay veya yüksek düşey bölüm ayıracı.
            yield (
                "rect",
                x,
                y,
                w if w >= h else min(w, o["border"]),
                min(h, o["border"]) if w >= h else h,
                color,
            )
        elif kind == "barcode":
            if not o["text"]:
                continue
            bits = modules(o["symbology"], o["text"])
            bw, bh = w / len(bits[0]), h / len(bits)
            if o["symbology"] == "qr":
                bw = bh = min(bw, bh)
            x += (w - bw * len(bits[0])) / 2
            y += (h - bh * len(bits)) / 2
            yield ("rect", x, y, bw * len(bits[0]), bh * len(bits), "#ffffff")
            for r, line in enumerate(bits):
                n = 0
                for bit, group in groupby(line):
                    count = sum(1 for _ in group)
                    if bit:
                        yield ("rect", x + n * bw, y + r * bh, count * bw, bh, "#000000")
                    n += count
        else:
            text = clean(o["text"])
            if not text:
                continue
            lines, measures, size = fit_lines(text, o)
            for i, (line, length) in enumerate(zip(lines, measures)):
                dx = (
                    0.3
                    if o["align"] == "left"
                    else (w - length * size) / 2
                    if o["align"] == "center"
                    else w - length * size - 0.3
                )
                yield ("text", x + max(0, dx), y + size * (0.94 + i * 1.19), size, line, color, o["bold"])


def svg(w, h, drawing):
    root = ET.Element(
        "svg", xmlns="http://www.w3.org/2000/svg", width=str(w), height=str(h), viewBox=f"0 0 {w} {h}"
    )
    for kind, x, y, a, b, color, *style in drawing:
        if kind == "rect":
            ET.SubElement(
                root, "rect", x=f"{x:.4f}", y=f"{y:.4f}", width=f"{a:.4f}", height=f"{b:.4f}", fill=color
            )
        else:
            ET.SubElement(
                root,
                "text",
                {
                    "x": f"{x:.4f}",
                    "y": f"{y:.4f}",
                    "font-size": f"{a:.4f}",
                    "font-family": "Floem",
                    "font-weight": "bold" if style[0] else "normal",
                    "fill": color,
                },
            ).text = b
    return ET.tostring(root, encoding="unicode")
