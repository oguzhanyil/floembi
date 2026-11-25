import { detailLabels, formCellText, formRowColor, formTableColumns, formTableRows, formWidthMm, freeTextLines, groupFormLines, mmToPt, scaleLineX,
  type DetailBand, type DetailColumn, type FormBand, type FormColumn, type LineShape, type PrintRecord, type PrintTemplate } from "@floem/client";
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import pdfMake from "./pdfEngine";
import fontLicense from "./fonts/LICENSE.txt?raw";

const fmt = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 6 });
const numeric = new Set<DetailColumn>(["LineNum", "Price", "LineTotal", "Quantity"]);
const ink = "#192d37", muted = "#536773", lineColor = "#dce4e5";
const date = (s?: string) => s?.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3.$2.$1") ?? "";
const wrap = (s: string) => s.replace(/(\S{24})/gu, "$1\u200b");

function vectorLine(line: LineShape, bottom = 0): Content {
  const width = mmToPt(line.thickness);
  return { canvas: [{ type: "line", x1: mmToPt(line.x1), y1: mmToPt(line.y1), x2: mmToPt(line.x2), y2: mmToPt(line.y2),
    lineColor: line.color, lineWidth: width, ...(line.style === "solid" ? {} :
      { dash: { length: width * (line.style === "dashed" ? 4 : 1), space: width * 2 } }) }], margin: [0, 0, 0, bottom] };
}
type DetailCell = { text: string; align: FormColumn["align"]; share: number };
function bandRow(band: DetailBand, cells: DetailCell[], widthMm: number, data: PrintRecord, detail?: PrintRecord["lines"][number], fillColor?: string): TableCell[] {
  const widthPt = mmToPt(widthMm);
  // Olağan detay bantlarını birlikte tut. Uzun açıklamaların sonraki sayfaya akmasına izin ver.
  const textHeight = (value: string, width: number, size: number) => value.split("\n").reduce((h, line) =>
    h + Math.max(1, Math.ceil(line.length / Math.max(1, Math.floor(width / size)))) * size * 1.6, 0);
  let height = 0;
  const stack: Content[] = band.parts.map(part => {
    if (part.type === "line") {
      height += mmToPt(Math.max(part.y1, part.y2) + part.thickness);
      return vectorLine(scaleLineX(part, widthMm / 100), mmToPt(part.thickness / 2));
    }
    if (part.type === "text") {
      const text = formCellText(part.text, data.header, detail) || " ";
      height += textHeight(text, widthPt * part.width / 100, part.size) + 2;
      return { text, alignment: part.align, fontSize: part.size, bold: part.bold, color: part.color, wordBreak: "break-all",
        margin: [widthPt * part.x / 100, 1, widthPt * (100 - part.x - part.width) / 100, 1] };
    }
    height += Math.max(mmToPt(band.minHeight), ...cells.map(c => textHeight(c.text, widthPt * c.share - 4, band.size) + 2));
    return { table: { widths: cells.map(c => widthPt * c.share), heights: mmToPt(band.minHeight),
      body: [cells.map(c => ({ text: c.text || " ", alignment: c.align, fontSize: band.size, color: band.color, bold: band.bold,
        wordBreak: "break-all" as const, margin: [2, 1, 2, 1] as [number, number, number, number] }))] },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 } };
  });
  return [{ stack, colSpan: cells.length, unbreakable: height < 500, fillColor }, ...cells.slice(1).map(() => ({}))];
}
function maySpanPages(row: TableCell[]) {
  const first = row[0];
  return typeof first === "object" && first !== null && "unbreakable" in first && first.unbreakable === false;
}

function bandContent(t: PrintTemplate, band: FormBand, data: PrintRecord): Content[] {
  const content: Content[] = [];
  if (!t.layout) return content;
  const boxes=t.layout.freeText?.filter(o=>o.band===band)??[];
  if(boxes.length){
    const height=Math.max(...boxes.map(o=>o.y+o.h));
    const escape=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const labels=boxes.flatMap(o=>{
      const {size,lines}=freeTextLines(o,o.role==="title"?t.title:formCellText(o.text,data.header));
      const x=o.x+(o.align==="right"?o.w-.4:o.align==="center"?o.w/2:.4);
      return lines.map((line,i)=>`<text x="${x}" y="${o.y+size*(.94+1.18*i)}" fill="${o.color}" font-family="Floem" font-size="${size}" font-weight="${o.bold?"bold":"normal"}" text-anchor="${o.align==="right"?"end":o.align==="center"?"middle":"start"}">${escape(line)}</text>`);
    });
    content.push({svg:`<svg xmlns="http://www.w3.org/2000/svg" width="181" height="${height}" viewBox="0 0 181 ${height}">${labels.join("")}</svg>`,width:mmToPt(181),height:mmToPt(height)});
  }
  for (const block of t.layout.blocks) {
    if (block.band !== band) continue;
    if (block.type === "line") {
      content.push(vectorLine(block, mmToPt(2)));
      continue;
    }
    const count = block.rows[0].cells.length;
    const pad = 3, border = .5;
    const columns = formTableColumns(block);
    const widths = columns.map(col => mmToPt(col.width) - border * (count + 1) / count - pad * 2);
    const rows = formTableRows(block, data, t.layout);
    if (!rows.length) continue;
    const body: TableCell[][] = rows.map(row => {
      const band = block.rows[row.source].detailBand;
      if (band) return bandRow(band, row.cells.map((text, i) => ({ text, align: columns[i].align, share: columns[i].width / block.width })),
        block.width - (2 * pad + 2 * border) / mmToPt(1), data, row.detail, row.color);
      return row.cells.map((cell, i) => ({ text: cell || " ", alignment: columns[i].align, wordBreak: "break-all",
        bold: row.header, fillColor: row.color }));
    });
    // pdfmake tekrarlanan başlığı bölünmez basar. Uzun başlık kendi sayfalarına akmalı.
    content.push({ table: { widths, headerRows: block.header && rows.length > 1 && !maySpanPages(body[0]) ? 1 : 0, body },
      layout: { hLineWidth: () => border, vLineWidth: () => border, hLineColor: () => lineColor, vLineColor: () => lineColor,
        paddingLeft: () => pad, paddingRight: () => pad, paddingTop: () => pad, paddingBottom: () => pad },
      margin: [mmToPt(block.x), 0, 0, mmToPt(2)] });
  }
  return content;
}

export async function printFormPdf(t: PrintTemplate, data: PrintRecord): Promise<Blob> {
  if(t.layout?.freeText?.length) await Promise.all([document.fonts.load("12px Floem"),document.fonts.load("bold 12px Floem")]);
  const h = data.header;
  const currency = h.DocCur === "TRY" ? "TL" : h.DocCur;
  const money = (v: number) => `${fmt.format(v)} ${currency}`;
  const content: Content[] = [];
  if (t.logo) content.push({ image: t.logo, fit: [104, 42], margin: [0, 0, 0, 8] });
  if (t.issuer) content.push({ text: wrap(t.issuer), bold: true, color: t.accent, margin: [0, 0, 0, 5] });
  if(!t.layout?.freeText?.some(o=>o.role==="title")) content.push({ text: wrap(t.title), fontSize: 25, bold: true, margin: [0, 0, 0, 15] });
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
      if (t.layout?.detailBand) {
        body.push(bandRow(t.layout.detailBand, t.columns.map(c => ({ text: formCellText("{" + c + "}", h, row),
          align: numeric.has(c) ? "right" : "left", share: widths[c] / totalWidth })), formWidthMm - 8 / mmToPt(1), data, row, fillColor));
        continue;
      }
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
    content.push({ table: { headerRows: headers.length, keepWithHeaderRows: maySpanPages(body[headers.length]) ? 0 : 1,
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
