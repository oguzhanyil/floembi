import type { VisualResultColumn } from "@floem/client";
import type { ExcelHeaderCell, ExcelHierarchy, TableValue } from "./tableExport";

export interface MatrixExportRow {
  path: TableValue[]; values: TableValue[];
  hidden: boolean; collapsed: boolean; summary: boolean;
}

type ColumnGroup = { path: TableValue[] | null; labels: string[] };

/** Aynı başlık düzeni ekranda ve Excel'de kullanılır. */
export function matrixHeaderLayout(rowColumns: VisualResultColumn[], groups: ColumnGroup[], values: VisualResultColumn[], columnDepth: number) {
  const rowFields: VisualResultColumn[] = rowColumns.length ? rowColumns : [{ name: "Satır", kind: "group", type: "string" }];
  const R = rowFields.length, V = values.length, H = columnDepth + 1;
  const columns = [...rowFields, ...groups.flatMap((g) => values.map((v) => ({ ...v, name: [...g.labels, v.name].filter(Boolean).join(" · ") })))];
  const headers: (ExcelHeaderCell | null)[][] = Array.from({ length: H }, () => Array(columns.length).fill(null));
  rowFields.forEach((field, i) => { headers[0][i] = { value: field.name, rowSpan: H }; });
  for (let level = 0; level < columnDepth; level++) {
    for (let start = 0; start < groups.length;) {
      const group = groups[start];
      if (!group.path) {
        if (level === 0) headers[0][R + start * V] = { value: "Toplam", columnSpan: V, rowSpan: columnDepth };
        start++; continue;
      }
      const prefix = JSON.stringify(group.path.slice(0, level + 1));
      let end = start + 1;
      while (end < groups.length && groups[end].path && JSON.stringify(groups[end].path!.slice(0, level + 1)) === prefix) end++;
      headers[level][R + start * V] = { value: group.labels[level] ?? "", columnSpan: (end - start) * V };
      start = end;
    }
  }
  groups.forEach((_, i) => values.forEach((v, j) => { headers[H - 1][R + i * V + j] = { value: v.name }; }));
  return { columns, headers, frozenColumns: R };
}

/** Satır alanları ayrı sütunlar, sütun hiyerarşisi birleştirilmiş üst başlıklar olarak aktarılır. */
export function matrixExcelLayout(rowColumns: VisualResultColumn[], groups: ColumnGroup[],
  values: VisualResultColumn[], rows: MatrixExportRow[], total: TableValue[], columnDepth: number): ExcelHierarchy {
  const header = matrixHeaderLayout(rowColumns, groups, values, columnDepth);
  const R = header.frozenColumns;
  return {
    ...header,
    rows: [...rows.map((row) => [...Array.from({ length: R }, (_, i) => i === row.path.length - 1 ? row.path[i] ?? "(Boş)" : null), ...row.values]),
      ["Genel toplam", ...Array<TableValue>(R - 1).fill(null), ...total]],
    outline: [...rows.map((row) => ({ level: Math.min(7, row.path.length - 1), hidden: row.hidden, collapsed: row.collapsed, summary: row.summary })),
      { level: 0, hidden: false, collapsed: false, summary: true }],
  };
}
