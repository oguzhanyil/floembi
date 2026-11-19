import writeExcelFile, { type Feature, type SheetData } from "write-excel-file/universal";
import { findElement, getMarkupInsideElement, getOrderOfSiblings, insertElementMarkupAccordingToOrderOfSiblings, setMarkupInsideElement } from "write-excel-file/utility";
import type { ExcelHierarchy } from "./tableExport";

/** Gerçek Excel satır grupları; özet satırı detayın üstünde, açılabilir detaylar dosyada kalır. */
export async function hierarchyExcelBlob(table: ExcelHierarchy): Promise<Blob> {
  const headerCount = table.headers.length;
  const feature: Feature<Blob> = { files: { transform: { "xl/worksheets/sheet{id}.xml": {
    transformElementAttributes(tag, attrs, index) {
      if (tag === "row" && index !== undefined && index >= headerCount) {
        const row = table.outline[index - headerCount];
        if (row) return { ...attrs, outlineLevel: Math.min(7, row.level), hidden: row.hidden ? 1 : 0, collapsed: row.collapsed ? 1 : 0 };
      }
      if (tag === "sheetView") return { ...attrs, showOutlineSymbols: 1 };
      return attrs;
    },
    transform(xml) {
      const outline = '<outlinePr summaryBelow="0" summaryRight="0" showOutlineSymbols="1"/>';
      const properties = findElement(xml, "sheetPr");
      const order = getOrderOfSiblings("xl/worksheets/sheet{id}.xml", "worksheet")!;
      xml = properties ? setMarkupInsideElement(xml, properties, getMarkupInsideElement(xml, properties) + outline)
        : insertElementMarkupAccordingToOrderOfSiblings(xml, `<sheetPr>${outline}</sheetPr>`, order, "worksheet");
      const level = table.outline.reduce((max, row) => Math.max(max, row.level), 0);
      return insertElementMarkupAccordingToOrderOfSiblings(xml,
        `<sheetFormatPr defaultRowHeight="15" outlineLevelRow="${level}"/>`, order, "worksheet");
    },
  } } } };
  const data: SheetData = [
    ...table.headers.map((row) => row.map((cell) => cell && ({ ...cell, fontWeight: "bold" as const, backgroundColor: "#16324F", textColor: "#FFFFFF", alignVertical: "center" as const, wrap: true }))),
    ...table.rows.map((row, i) => row.map((value) => ({
      value: value ?? undefined, wrap: true,
      ...(table.outline[i]?.summary ? { fontWeight: "bold" as const, backgroundColor: "#EAF0F7", topBorderStyle: "thin" as const, topBorderColor: "#CDD9E7" } : {}),
    }))),
  ];
  return writeExcelFile(data, {
    sheet: "Matris", stickyRowsCount: headerCount, stickyColumnsCount: table.frozenColumns, zoomScale: 1,
    columns: table.columns.map((c, i) => ({ width: Math.min(42, Math.max(16, c.name.length + 2,
      ...table.rows.slice(0, 200).map((row) => String(row[i] ?? "").length + 2))) })),
  }, { features: [feature] }).toBlob();
}
