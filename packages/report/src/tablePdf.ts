import pdfMake from "pdfmake/build/pdfmake";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import regular from "./fonts/Roboto-Regular.ttf?inline";
import medium from "./fonts/Roboto-Medium.ttf?inline";
import fontLicense from "./fonts/LICENSE.txt?raw";
import type { ExportTable } from "./tableExport";
import { formatValue } from "./reportUtils";

// Roboto v2.138 (Apache-2.0). pdfmake'in farklı lisanslı hazır font paketi kullanılmaz.
pdfMake.addVirtualFileSystem({
  "Floem-Regular.ttf": regular.split(",")[1],
  "Floem-Medium.ttf": medium.split(",")[1],
});
pdfMake.addFonts({ Floem: { normal: "Floem-Regular.ttf", bold: "Floem-Medium.ttf", italics: "Floem-Regular.ttf", bolditalics: "Floem-Medium.ttf" } });

export async function tablePdfBlob(table: ExportTable): Promise<Blob> {
  const content: Content[] = [];
  // Geniş tabloları okunaksız küçültmek yerine sütun gruplarına böl.
  const groupSize = 6;
  for (let start = 0; start < table.columns.length;) {
    const end = Math.min(table.columns.length, start + (start ? groupSize - 1 : groupSize));
    const indices = [...(start ? [0] : []), ...Array.from({ length: end - start }, (_, i) => start + i)];
    const cols = indices.map((i) => table.columns[i]);
    content.push({ text: table.title || "Floem BI - Tablo", fontSize: 17, bold: true, color: "#16324F", margin: [0, 0, 0, 6], ...(start ? { pageBreak: "before" as const } : {}) });
    content.push({ text: `${table.rows.length.toLocaleString("tr-TR")} satır · Sütunlar ${start + 1}-${end} / ${table.columns.length}${start ? " (ilk sütun tekrarlanır)" : ""}${table.truncated ? " · Sorgu sınırı nedeniyle yalnız yüklenen satırlar" : ""}`, fontSize: 9, color: "#52647A", margin: [0, 0, 0, 12] });
    const readable = (text: string) => text.replace(/(\S{24})/gu, "$1\u200b");
    content.push({
      table: {
        headerRows: 1, widths: cols.map(() => "*"),
        body: [
          cols.map((c) => ({ text: readable(c.name), bold: true, color: "#FFFFFF", fillColor: "#16324F", alignment: c.kind === "value" ? "right" as const : "left" as const })),
          ...table.rows.map((row, r) => cols.map((c, j) => ({
            text: readable(formatValue(row[indices[j]], c.type, c.format)),
            alignment: c.kind === "value" ? "right" as const : "left" as const,
            fillColor: r % 2 ? "#F1F5F9" : "#FFFFFF",
          }))),
        ],
      },
      layout: { hLineWidth: () => 0.4, vLineWidth: () => 0, hLineColor: () => "#D9E2ED", paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 5, paddingBottom: () => 5 },
    });
    start = end;
  }
  const definition: TDocumentDefinitions = {
    pageSize: "A4", pageOrientation: table.columns.length > 4 ? "landscape" : "portrait",
    pageMargins: [28, 28, 28, 36], defaultStyle: { font: "Floem", fontSize: 9, color: "#233348" },
    info: { title: table.title || "Floem BI - Tablo", creator: "Floem BI", subject: `Roboto v2.138 - Apache-2.0\n${fontLicense}` }, content,
    footer: (page, pages) => ({ text: `${page} / ${pages}`, alignment: "center", fontSize: 8, color: "#52647A", margin: [0, 12, 0, 0] }),
  };
  return pdfMake.createPdf(definition).getBlob();
}
