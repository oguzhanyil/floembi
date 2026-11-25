import type { BandKind, ItemKind, PagedReport, PrintBand, PrintItem } from "@floem/client";

export const bands: Record<BandKind, string> = {
  reportHeader: "Rapor başlığı",
  pageHeader: "Sayfa başlığı",
  groupHeader: "Grup başlığı",
  detail: "Detay",
  groupFooter: "Grup alt bilgisi",
  reportFooter: "Rapor toplamı",
  pageFooter: "Sayfa alt bilgisi",
};
export const tools: Record<ItemKind, string> = {
  text: "Metin kutusu",
  field: "Veri alanı",
  formula: "Formül",
  line: "Çizgi",
  box: "Çerçeve",
  page: "Sayfa numarası",
  barcode: "Barkod / QR",
  subreport: "Alt rapor",
  crossTab: "Çapraz tablo",
};
export function item(kind: ItemKind, opts: Partial<PrintItem> = {}): PrintItem {
  return { id: crypto.randomUUID(), kind, x: 0, y: 0, w: 38, h: 6, ...opts };
}
export function paperWidth(t: PagedReport) {
  return (t.landscape ? (t.paper === "A4" ? 297 : 420) : t.paper === "A4" ? 210 : 297) - 2 * t.margin;
}
export function newReport(table: string, fields: string[], mode = "list"): PagedReport {
  const cols = fields.slice(0, 4),
    cw = 186 / Math.max(1, cols.length);
  const band = (kind: BandKind, height: number, objects: PrintItem[] = []): PrintBand => ({
    kind,
    height,
    objects,
  });
  const t: PagedReport = {
    id: crypto.randomUUID(),
    version: 1,
    name: table ? table + " dökümü" : "Yeni belge",
    category: "",
    table,
    paper: "A4",
    landscape: false,
    margin: 12,
    groups: [],
    sort: [],
    params: [],
    bands: [
      band("reportHeader", 19, [
        item("text", { text: table + " dökümü", w: 185, h: 12, font: 22, bold: true }),
      ]),
      band(
        "pageHeader",
        9,
        cols.map((f, i) =>
          item("text", { text: f, x: i * cw, w: cw, h: 8, bold: true, background: "#e5edf4" }),
        ),
      ),
      band(
        "detail",
        8,
        cols.map((f, i) => item("field", { field: f, x: i * cw, w: cw, h: 7 })),
      ),
      band("reportFooter", 8),
      band("pageFooter", 8, [item("page", { w: 185, h: 7, align: "right" })]),
    ],
  };
  if (mode !== "list" || !table) {
    t.name = mode === "record" && table ? table + " formu" : "Serbest belge";
    const canvas = mode === "record" && table ? "detail" : "reportHeader";
    t.bands = t.bands.map((b) => ({
      ...b,
      height: b.kind === canvas ? 273 : 0,
      objects:
        b.kind === canvas
          ? [item("text", { text: "Belge başlığı", x: 8, y: 8, w: 100, h: 14, font: 22, bold: true })]
          : [],
    }));
  }
  return t;
}
export function sortBands(t: PagedReport) {
  const order: [BandKind, string][] = [
    ["reportHeader", ""],
    ["pageHeader", ""],
    ...t.groups.map((g) => ["groupHeader", g.field] as [BandKind, string]),
    ["detail", ""],
    ...t.groups
      .slice()
      .reverse()
      .map((g) => ["groupFooter", g.field] as [BandKind, string]),
    ["reportFooter", ""],
    ["pageFooter", ""],
  ];
  return order.flatMap(([kind, group]) =>
    t.bands.filter((b) => b.kind === kind && (b.group || "") === group),
  );
}
