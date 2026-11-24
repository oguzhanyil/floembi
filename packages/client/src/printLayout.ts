import { detailLabels, type DetailColumn, type PrintRecord, type PrintTemplate } from "./printForms";

/** A4 çıktıdaki 40 pt yan boşlukların arasında kalan tam milimetreler. */
export const formWidthMm = 181;
export const mmToPt = (value: number) => value * 72 / 25.4;
export const bands = { header: "Belge başlığı", beforeDetail: "Kalemlerden önce", footer: "Belge alt bilgisi" } as const;
export type FormBand = keyof typeof bands;
interface FormObject { id: string; band: FormBand }
export interface LineShape {
  id: string;
  type: "line"; x1: number; y1: number; x2: number; y2: number;
  color: string; thickness: number; style: "solid" | "dashed" | "dotted";
}
export interface FormLine extends LineShape, FormObject {}
/** Satır nesnelerinin yatay konumu satır genişliğinin yüzdesi, düşey konumu mm'dir. */
export interface RowText {
  type: "text"; id: string; text: string; x: number; width: number;
  align: FormColumn["align"]; size: number; bold: boolean; color: string;
}
export type RowPart = { type: "data" } | RowText | LineShape;
export interface DetailBand {
  minHeight: number; size: number; bold: boolean; color: string; parts: RowPart[];
}
export const plainDetailBand: DetailBand = { minHeight: 5, size: 9, bold: false, color: "#192d37", parts: [{ type: "data" }] };
export function scaleLineX<T extends LineShape>(line: T, scale: number): T {
  return { ...line, x1: line.x1 * scale, x2: line.x2 * scale };
}
export interface FormColumn { align: "left" | "center" | "right"; weight: number }
export interface FormTable extends FormObject {
  type: "table"; x: number; width: number; header: boolean;
  repeatRow?: number | null;
  columnFormat?: FormColumn[];
  rows: { cells: string[]; color?: string | null; detailBand?: DetailBand | null }[];
}
export type FormBlock = FormLine | FormTable;
export interface RowRule {
  field: "Quantity" | "Price" | "LineTotal"; op: "gt" | "lt" | "eq"; value: number; color: string;
}
export interface PrintLayout {
  blocks: FormBlock[];
  guides: number[];
  hideMainDetail?: boolean;
  detailBand?: DetailBand | null;
  stripe?: string | null;
  rule?: RowRule | null;
}
export const emptyPrintLayout: PrintLayout = { blocks: [], guides: [] };
export function formTableColumns(table: FormTable) {
  const columns = table.columnFormat ?? table.rows[0].cells.map((): FormColumn => ({ align: "left", weight: 1 }));
  const total = columns.reduce((sum, col) => sum + col.weight, 0);
  const available = table.width - 10 * columns.length;
  return columns.map(col => ({ ...col, width: 10 + available * col.weight / total }));
}
export function groupFormLines(lines: PrintRecord["lines"], field: PrintTemplate["groupBy"]) {
  const groups = new Map<string, PrintRecord["lines"]>();
  for (const line of lines) {
    const key = field === "none" ? "" : String(line[field] ?? "Belirtilmemiş");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(line);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b, "tr", { numeric: true }));
}
export const headerLabels: Record<keyof PrintRecord["header"], string> = {
  DocNum: "Belge numarası", DocDate: "Belge tarihi", DocDueDate: "Vade / geçerlilik", CardName: "Müşteri",
  Address: "Adres", Comments: "Açıklama", DocCur: "Para birimi", VatSum: "Vergi toplamı", DocTotal: "Genel toplam",
};
const decimal = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 6 });
type Detail = PrintRecord["lines"][number];
export function formCellText(text: string, head: PrintRecord["header"], detail?: Detail) {
  return text.replace(/\{(\w+)\}/g, (token, name: string) => {
    if (Object.hasOwn(detailLabels, name) && detail) {
      const key = name as DetailColumn;
      if (key === "LineNum") return String(detail.LineNum + 1);
      if (key === "Quantity") return quantity.format(detail.Quantity);
      if (key === "LineTotal" || key === "Price") return decimal.format(detail[key]);
      return String(detail[key] ?? "");
    }
    const key = name as keyof typeof headerLabels;
    if (!Object.hasOwn(headerLabels, key)) return token;
    const value = head[key];
    if (value == null) return "";
    if (key === "DocTotal" || key === "VatSum") return decimal.format(Number(value));
    if (key === "DocDate" || key === "DocDueDate") return String(value).slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3.$2.$1");
    return String(value);
  });
}
export function formTableRows(table: FormTable, data: PrintRecord, layout: PrintLayout, design = false) {
  const result: { source: number; cells: string[]; color?: string; header: boolean; detail?: Detail }[] = [];
  table.rows.forEach((row, source) => {
    const header = table.header && source === 0;
    const append = (detail?: Detail, i = 0) => result.push({ source, header, detail,
      cells: row.cells.map(cell => formCellText(cell, data.header, detail)),
      color: (detail && formRowColor(layout, detail, i)) || row.color || (header ? "#e6eff0" : undefined) });
    if (table.repeatRow !== source) append();
    else if (design && !data.lines.length) append();
    else (design ? data.lines.slice(0, 4) : data.lines).forEach(append);
  });
  return result;
}
export function formRowColor(layout: PrintLayout | null | undefined, row: PrintRecord["lines"][number], index: number) {
  if (layout?.rule) {
    const { field, op, value, color } = layout.rule;
    const amount = row[field];
    if ((op === "gt" && amount > value) || (op === "lt" && amount < value) || (op === "eq" && amount === value)) return color;
  }
  return index % 2 === 1 ? layout?.stripe ?? undefined : undefined;
}
