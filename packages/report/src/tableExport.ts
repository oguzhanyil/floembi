import type { VisualFormat, VisualResultColumn } from "@floem/client";

export type TableValue = string | number | boolean | null;
export interface ExcelHeaderCell { value: string; columnSpan?: number; rowSpan?: number }
export interface ExcelHierarchy {
  columns: VisualResultColumn[];
  headers: (ExcelHeaderCell | null)[][];
  rows: TableValue[][];
  outline: { level: number; hidden: boolean; collapsed: boolean; summary: boolean }[];
  frozenColumns: number;
}
export interface ExportTable {
  title?: string;
  columns: VisualResultColumn[];
  rows: TableValue[][];
  truncated: boolean;
  /** XLSX hiyerarşisi, CSV/PDF'nin görünür satırlarından bağımsız hazırlanır. */
  excel?: () => ExcelHierarchy;
}
export type TableExportKind = "pdf" | "xlsx" | "csv";
export const allowedExportKinds = (format: VisualFormat) => (["pdf", "xlsx", "csv"] as const).filter((kind) =>
  (format.exportData ?? format.gridExport ?? true) && (kind === "pdf" ? (format.exportPdf ?? format.gridExportPdf ?? true)
    : kind === "xlsx" ? (format.exportExcel ?? format.gridExportExcel ?? true) : (format.exportCsv ?? format.gridExportCsv ?? true)));

// CSV hücreleri Excel'de formül olarak yorumlanmasın; sayılar sayısal kalır.
function csvCell(value: TableValue) {
  let text = String(value ?? "");
  if (typeof value === "string" && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function tableExportBlob(table: ExportTable, kind: TableExportKind): Promise<Blob> {
  if (!table.columns.length) throw new Error("İndirmek için en az bir sütunu görünür yapın.");
  if (kind === "csv") {
    const lines = [table.columns.map((c) => c.name), ...table.rows].map((row) => row.map(csvCell).join(","));
    return new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  }
  if (kind === "xlsx") {
    if (table.excel) {
      const { hierarchyExcelBlob } = await import("./matrixExcel");
      return hierarchyExcelBlob(table.excel());
    }
    const { default: writeExcelFile } = await import("write-excel-file/universal");
    return writeExcelFile([
      table.columns.map((c) => ({ value: c.name, fontWeight: "bold" as const, backgroundColor: "#16324F", textColor: "#FFFFFF", wrap: true })),
      ...table.rows.map((row) => row.map((value) => value === null ? null : ({ value, wrap: true }))),
    ], {
      sheet: "Tablo", stickyRowsCount: 1,
      columns: table.columns.map((c, i) => ({ width: Math.min(48, Math.max(14, c.name.length + 2,
        ...table.rows.slice(0, 200).map((row) => String(row[i] ?? "").length + 2))) })),
    }).toBlob();
  }
  const { tablePdfBlob } = await import("./tablePdf");
  return tablePdfBlob(table);
}

export function downloadTableBlob(blob: Blob, kind: TableExportKind, name = "floem-tablo") {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.${kind}`;
  document.body.append(link);
  link.click();
  link.remove();
  // Electron'daki kaydet iletişim kutusunun Blob'u tüketmesine zaman tanı.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
