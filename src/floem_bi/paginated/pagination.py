"""Band örneklerini üretir ve mm cinsinden sayfalara yerleştirir."""

from collections import defaultdict
from dataclasses import dataclass
from itertools import groupby

from .formula import Totals, day, display, evaluate, matches, number


@dataclass
class Strip:
    height: float
    items: list
    action: str = ""
    repeats: tuple = ()
    record: int = 0


def moved(items, x, y, scale=1):
    return [
        dict(
            i,
            x=x + i["x"] * scale,
            y=y + i["y"] * scale,
            w=i["w"] * scale,
            h=i["h"] * scale,
            font=i["font"] * scale,
            border=i["border"] * scale,
        )
        for i in items
    ]


def label(o, text, **extra):
    return dict(
        dict(
            kind="text",
            x=o.x,
            y=o.y,
            w=o.w,
            h=o.h,
            text=str(text),
            color=o.color,
            font=o.font,
            bold=o.bold,
            align=o.align,
            background=o.background,
            border=o.border,
            wrap=o.kind == "text" and o.wrap,
        ),
        **extra,
    )


def ordered(template, rows, values):
    rows = list(rows)
    for p in template.params:
        value = values.get(p.label, p.default)
        if value is not None and value != "":
            rows = [r for r in rows if matches(r, p.field, p.op, day(value) if p.kind == "date" else value)]
    for order in reversed([*template.groups, *template.sort]):
        rows.sort(key=lambda r: (r[order.field] is None, r[order.field]), reverse=order.desc)
    return rows


class Layout:
    def __init__(self, library, source):
        self.reports = library.latest()
        self.source = source
        self.links = {}
        self.count = 0
        self.expanded = 0

    def strips(self, template, band, scope, index, total, pos, chain):
        if not band or not band.height:
            return []
        row = scope.rows[max(0, index - 1)] if scope.rows else {}
        items, flow = [], None
        for o in band.objects:
            hit = o.rule and o.rule.field in row and matches(row, o.rule.field, o.rule.op, o.rule.value)
            if hit and o.hideWhen:
                continue
            if o.kind in ("crossTab", "subreport"):
                flow = o
                continue
            v = o.text
            if o.kind in ("field", "barcode"):
                v = row.get(o.field) if o.field else o.text
            if o.kind == "formula" and o.formula:
                data, idx = (total, pos) if o.formula.scope == "report" else (scope, index)
                v = (
                    evaluate(o.formula, row, data, idx)
                    if row or o.formula.op in ("sum", "count", "running")
                    else ""
                )
            fmt = o.ruleFormat if hit and o.ruleFormat else o.format
            value = display(v, fmt) if v != "" else ""
            items.append(
                label(
                    o,
                    value,
                    kind=o.kind if o.kind in ("page", "line", "box", "barcode") else "text",
                    color=o.ruleColor if hit and o.ruleColor else o.color,
                    symbology=o.symbology,
                    value=v if o.kind in ("field", "formula") else value,
                )
            )
        if not flow:
            return [Strip(band.height, items)]
        chunks = [Strip(flow.y, items)] if flow.y else []
        if flow.kind == "crossTab":
            if not (flow.field and flow.column and flow.measure):
                raise ValueError("Çapraz tablo için satır, sütun ve değer seçin")
            buckets = defaultdict(dict)
            columns = set()
            for r in scope.rows:
                key, col = r[flow.field], r[flow.column]
                columns.add(col)
                buckets[key][col] = buckets[key].get(col, 0) + number(r[flow.measure])
            cols = sorted(columns, key=str)
            if len(buckets) * max(1, len(cols)) > 180_000:
                raise ValueError("Çapraz tablo çok fazla hücre içeriyor. Parametreleri daraltın.")
            per = max(1, int(flow.w / 22) - 1)
            for start in range(0, max(1, len(cols)), per):
                block = cols[start : start + per]
                width = flow.w / (1 + len(block))

                def cells(values, header=False):
                    return Strip(
                        flow.h,
                        [
                            label(
                                flow,
                                display(v, flow.format) if not header and i else display(v, "auto"),
                                value=v,
                                x=flow.x + i * width,
                                y=0,
                                w=width,
                                h=flow.h,
                                bold=header,
                                background="#e5edf4" if header else flow.background,
                            )
                            for i, v in enumerate(values)
                        ],
                    )

                chunks.append(cells([flow.field, *block], True))
                for key, values in buckets.items():
                    chunks.append(cells([key, *(values.get(c) for c in block)]))
        else:
            child = self.reports.get(flow.target)
            if not child or not flow.field or not flow.childField:
                raise ValueError("Alt rapor ve iki bağlantı alanını seçin")
            if child.id in chain or len(chain) >= 6:
                raise ValueError("Alt rapor döngüsü veya altı düzeyden derin bağlantı")
            key = (child.id, flow.childField)
            if key not in self.links:
                groups = defaultdict(list)
                for r in self.source.rows(child, flow.childField):
                    groups[r[flow.childField]].append(r)
                self.links[key] = groups
            value = row.get(flow.field)
            child_rows = self.links[key].get(value, []) if value is not None else []
            scale = min(1, flow.w / (child.size[0] - 2 * child.margin))
            child_rows = ordered(child, child_rows, {})
            child_total = Totals(child_rows)
            child_chain = (*chain, child.id)

            def scaled(strip):
                return Strip(
                    strip.height * scale,
                    moved(strip.items, flow.x, 0, scale),
                    strip.action,
                    tuple(scaled(s) for s in strip.repeats),
                )

            def child_band(kind):
                band = next((b for b in child.bands if b.kind == kind), None)
                return self.strips(
                    child,
                    band,
                    child_total,
                    min(1, len(child_rows)),
                    child_total,
                    min(1, len(child_rows)),
                    child_chain,
                )

            chunks.extend(scaled(s) for s in child_band("reportHeader"))
            heads = tuple(scaled(s) for s in child_band("pageHeader"))
            chunks.extend(heads)
            chunks.append(Strip(0, [], "push", heads))
            for event, strip in self.events(child, child_rows, child_chain):
                if event == "strip":
                    chunks.append(scaled(strip))
                else:
                    chunks.append(
                        Strip(0, [], event, tuple(scaled(s) for s in strip) if event == "push" else ())
                    )
                self.expanded += 1
                if self.expanded > 180_000:
                    raise ValueError("Alt rapor çok uzun. Parametreleri daraltın.")
            chunks.append(Strip(0, [], "pop"))
        padding = band.height - flow.y - flow.h
        if padding > 0.01:
            chunks.append(Strip(padding, []))
        return chunks

    def events(self, t, rows, chain):
        total = Totals(rows)
        bands = {(b.kind, b.group): b for b in t.bands}

        def emit(kind, scope, index, pos, g=""):
            return self.strips(t, bands.get((kind, g)), scope, index, total, pos, chain)

        def walk(depth, scope, offset):
            if depth == len(t.groups):
                for i in range(len(scope.rows)):
                    for s in emit("detail", scope, i + 1, offset + i + 1):
                        s.record = offset + i + 1
                        yield "strip", s
                return
            g = t.groups[depth]
            for j, (_, group_rows) in enumerate(groupby(scope.rows, lambda r: r[g.field])):
                inner = Totals(list(group_rows))
                if g.newPage and (j or offset):
                    yield "break", None
                header = emit("groupHeader", inner, 1, offset + 1, g.field)
                for s in header:
                    yield "strip", s
                yield "push", header if g.repeat else []
                yield from walk(depth + 1, inner, offset)
                n = len(inner.rows)
                for s in emit("groupFooter", inner, n, offset + n, g.field):
                    yield "strip", s
                yield "pop", None
                offset += n

        yield from walk(0, total, 0)
        for s in emit("reportFooter", total, len(rows), len(rows)):
            yield "strip", s

    def pages(self, t, rows):
        w, h = t.size
        total = Totals(rows)

        def fixed(kind, i):
            band = next((b for b in t.bands if b.kind == kind), None)
            return self.strips(t, band, total, i, total, i, (t.id,))

        height = {b.kind: b.height for b in t.bands}
        bottom = h - t.margin - height.get("pageFooter", 0)
        pages, repeat, ranges = [], [], []

        def append(s, y, page=-1):
            self.count += len(s.items)
            if self.count > 180_000:
                raise ValueError("Rapor çok fazla nesne içeriyor. Parametreleri daraltın.")
            pages[page].extend(moved(s.items, t.margin, y))
            return y + s.height

        def new_page(first=False):
            if len(pages) >= 1500:
                raise ValueError("Rapor 1500 sayfayı aşıyor. Parametreleri daraltın.")
            pages.append([])
            y = t.margin
            if first:
                for s in fixed("reportHeader", min(len(rows), 1)):
                    y = append(s, y)
            ranges.append([y, 0, 0])
            y += height.get("pageHeader", 0)
            for s in (s for group in repeat for s in group):
                y = append(s, y)
            if y > bottom + 0.001:
                raise ValueError("Başlıklar ve alt bilgiler yazdırılabilir alanı dolduruyor")
            return y

        y = new_page(first=True)
        for event, s in self.events(t, rows, (t.id,)):
            if event == "strip" and s.action:
                event, s = s.action, s.repeats
            if event == "push":
                repeat.append(s)
            elif event == "pop":
                repeat.pop()
            elif event == "break":
                y = new_page()
            else:
                if y + s.height > bottom + 0.001:
                    y = new_page()
                if y + s.height > bottom + 0.001:
                    raise ValueError("Bölüm tek sayfaya sığmıyor. Bölüm yüksekliğini azaltın.")
                y = append(s, y)
                if s.record:
                    ranges[-1][1] = ranges[-1][1] or s.record
                    ranges[-1][2] = s.record
        last = min(len(rows), 1)
        for idx, (top, first, end) in enumerate(ranges):
            last = end or last
            for s in fixed("pageHeader", first or last):
                top = append(s, top, idx)
            tail = bottom
            for s in fixed("pageFooter", last):
                tail = append(s, tail, idx)
        for n, items in enumerate(pages, 1):
            for item in items:
                if item["kind"] == "page":
                    item.update(kind="text", text=f"Sayfa {n} / {len(pages)}")
        return pages
