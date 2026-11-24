import { detailLabels, formRowColor, formTableColumns, formTableRows, groupFormLines, mmToPt, type DetailColumn, type FormBand, type PrintRecord, type PrintTemplate } from "@floem/client";
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import pdfMake from "./pdfEngine";
import fontLicense from "./fonts/LICENSE.txt?raw";

const fmt = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 6 });
const numeric = new Set<DetailColumn>(["LineNum", "Price", "LineTotal", "Quantity"]);
const ink = "#192d37", muted = "#536773", lineColor = "#dce4e5";
const date = (s?: string) => s?.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3.$2.$1") ?? "";
const wrap = (s: string) => s.replace(/(\S{24})/gu, "$1\u200b");

function bandContent(t: PrintTemplate, band: FormBand, data: PrintRecord): Content[] {
  const content: Content[] = [];
  if (!t.layout) return content;
  for (const block of t.layout.blocks) {
    if (block.band !== band) continue;
    if (block.type === "line") {
      const width = mmToPt(block.thickness);
      content.push({ canvas: [{ type: "line", x1: mmToPt(block.x1), y1: mmToPt(block.y1),
        x2: mmToPt(block.x2), y2: mmToPt(block.y2), lineColor: block.color, lineWidth: width,
        ...(block.style === "solid" ? {} : { dash: { length: width * (block.style === "dashed" ? 4 : 1), space: width * 2 } }) }],
        margin: [0, 0, 0, mmToPt(2)] });
      continue;
    }
    const count = block.rows[0].cells.length;
    const pad = 3, border = .5;
    const columns = formTableColumns(block);
    const widths = columns.map(col => mmToPt(col.width) - border * (count + 1) / count - pad * 2);
    const rows = formTableRows(block, data, t.layout);
    if (!rows.length) continue;
    content.push({ table: { widths, headerRows: block.header && rows.length > 1 ? 1 : 0,
      body: rows.map(row => row.cells.map((cell, i) => ({ text: cell || " ", alignment: columns[i].align, wordBreak: "break-all",
        bold: row.header, fillColor: row.color }))) },
      layout: { hLineWidth: () => border, vLineWidth: () => border, hLineColor: () => lineColor, vLineColor: () => lineColor,
        paddingLeft: () => pad, paddingRight: () => pad, paddingTop: () => pad, paddingBottom: () => pad },
      margin: [mmToPt(block.x), 0, 0, mmToPt(2)] });
  }
  return content;
}

export async function printFormPdf(t: PrintTemplate, data: PrintRecord): Promise<Blob> {
  const h = data.header;
  const currency = h.DocCur === "TRY" ? "TL" : h.DocCur;
  const money = (v: number) => `${fmt.format(v)} ${currency}`;
  const content: Content[] = [];
  if (t.logo) content.push({ image: t.logo, fit: [104, 42], margin: [0, 0, 0, 8] });
  if (t.issuer) content.push({ text: wrap(t.issuer), bold: true, color: t.accent, margin: [0, 0, 0, 5] });
  content.push({ text: wrap(t.title), fontSize: 25, bold: true, margin: [0, 0, 0, 15] });
  content.push(...bandContent(t, "header", data));
  content.push({ columns: [
    { width: "*", stack: [{ text: "MÜŞTERİ", color: muted, fontSize: 8 }, { text: wrap(h.CardName), bold: true, fontSize: 12, margin: [0, 3, 0, 1] }, { text: wrap(h.Address ?? ""), color: muted }] },
    { width: 154, stack: [{ text: String(h.DocNum), bold: true, fontSize: 12 }, { text: `Belge tarihi   ${date(h.DocDate)}` },
      ...(h.DocDueDate ? [{ text: `${t.kind === "quote" ? "Geçerlilik" : "Vade"}   ${date(h.DocDueDate)}` }] : [])] },
  ], columnGap: 18, margin: [0, 0, 0, 15] });
  content.push(...bandContent(t, "beforeDetail", data));

  const widths: Record<DetailColumn, number> = { LineNum: 7, ItemCode: 17, Dscription: 32, WhsCode: 14, Quantity: 11, Price: 16, LineTotal: 17 };
  const totalWidth = t.columns.reduce((n, col) => n + widths[col], 0);
  let detailIndex = 0;
  for (const [group, rows] of t.layout?.hideMainDetail ? [] : groupFormLines(data.lines, t.groupBy)) {
    const headers: TableCell[][] = [];
    const spanning = (text: string, bg: string): TableCell[] => [
      { text: wrap(text), colSpan: t.columns.length, bold: true, color: ink, fillColor: bg },
      ...t.columns.slice(1).map(() => ({})),
    ];
    if (t.groupBy !== "none") headers.push(spanning(`${detailLabels[t.groupBy]} · ${group}`, "#e6eff0"));
    headers.push(t.columns.map(c => ({ text: detailLabels[c], bold: true, color: "#ffffff", fillColor: t.accent,
      alignment: numeric.has(c) ? "right" : "left" })));
    const body: TableCell[][] = [...headers];
    for (const row of rows) {
      const fillColor = formRowColor(t.layout, row, detailIndex++);
      body.push(t.columns.map(c => {
        const value = row[c];
        let text = String(value ?? "—");
        if (c === "Price" || c === "LineTotal") text = fmt.format(row[c]);
        if (c === "Quantity") text = quantity.format(row.Quantity);
        if (c === "LineNum") text = String(row.LineNum + 1);
        return { text: wrap(text), fillColor, alignment: numeric.has(c) ? "right" : "left" };
      }));
    }
    if (t.groupBy !== "none" && t.subtotals) {
      const cents = rows.reduce((sum, row) => sum + Math.round(row.LineTotal * 100), 0);
      body.push(spanning(`Grup ara toplamı   ${money(cents / 100)}`, "#eff4f4"));
    }
    content.push({ table: { headerRows: headers.length, keepWithHeaderRows: 1,
      widths: t.columns.map(c => `${100 * widths[c] / totalWidth}%`), body },
      layout: { hLineWidth: () => 0.4, vLineWidth: () => 0, hLineColor: () => lineColor,
        paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 4, paddingBottom: () => 4 },
      margin: [0, 0, 0, 9] });
  }
  if (!data.lines.length) content.push({ text: "Bu belgede kalem bulunmuyor.", color: muted, margin: [0, 0, 0, 8] });
  content.push(...bandContent(t, "footer", data));
  for (const note of [h.Comments, t.note]) if (note?.trim()) content.push({ text: wrap(note), margin: [0, 4, 0, 8], color: muted });
  content.push({ unbreakable: true, stack: [
    { text: `Vergi toplamı   ${money(h.VatSum)}`, alignment: "right", color: muted },
    { text: `Genel toplam   ${money(h.DocTotal)}`, alignment: "right", bold: true, fontSize: 15, color: t.accent, margin: [0, 4, 0, 0] },
  ] });
  const definition: TDocumentDefinitions = {
    info: { title: `${t.title} · ${h.DocNum}`, creator: "Floem BI Desktop", subject: `Roboto v2.138 - Apache-2.0\n${fontLicense}` },
    pageSize: "A4", pageMargins: [40, 49, 40, 43], defaultStyle: { font: "Floem", fontSize: 9, color: ink },
    header: { columns: [{ text: wrap(String(h.DocNum)), bold: true }, { text: date(h.DocDate), alignment: "right" }],
      margin: [40, 22, 40, 0], color: muted, fontSize: 8 },
    footer: (page, pages) => ({ text: `Sayfa ${page} / ${pages}`, alignment: "right", margin: [40, 15, 40, 0], color: muted, fontSize: 8 }),
    content,
  };
  return pdfMake.createPdf(definition).getBlob();
}
