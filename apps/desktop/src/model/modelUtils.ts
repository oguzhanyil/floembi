import dagre from "@dagrejs/dagre";
import { parseRef, type ColumnType, type ModelColumn, type ModelTable, type Relationship, type Summarize } from "@floem/client";

export const NODE_WIDTH = 230;
export const HEADER_H = 34;
export const ROW_H = 22;
export const MAX_ROWS = 12;

export type Selection =
  | { kind: "table"; table: string }
  | { kind: "column"; table: string; column: string }
  | { kind: "relationship"; kimden: string; kime: string }
  | null;

export const TYPE_LABEL: Record<ColumnType, string> = {
  int32: "Tam sayı",
  int64: "Tam sayı",
  decimal: "Sabit ondalık sayı",
  double: "Ondalık sayı",
  string: "Metin",
  date: "Tarih",
  datetime: "Tarih/saat",
  bool: "Doğru/yanlış",
};

export const TYPE_OPTIONS: ColumnType[] = ["int64", "decimal", "double", "string", "date", "datetime", "bool"];

export const SUMMARIZE_LABEL: Record<Summarize, string> = {
  sum: "Toplam",
  avg: "Ortalama",
  min: "En küçük",
  max: "En büyük",
  count: "Say",
  none: "Özetleme",
};

export const FORMAT_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "Genel" },
  { value: "#,0", label: "Tam sayı (1.234)" },
  { value: "#,0.00", label: "Ondalık (1.234,56)" },
  { value: "₺#,0.00", label: "Para birimi (₺1.234,56)" },
  { value: "0%", label: "Yüzde (12%)" },
  { value: "0.0%", label: "Yüzde (12,3%)" },
  { value: "dd.MM.yyyy", label: "Tarih (17.11.2026)" },
  { value: "dd.MM.yyyy HH:mm", label: "Tarih/saat (17.11.2026 14:30)" },
  { value: "MMMM yyyy", label: "Ay yıl (Kasım 2026)" },
];

export const isNumeric = (t: ColumnType) => t === "int32" || t === "int64" || t === "decimal" || t === "double";
export const isDate = (t: ColumnType) => t === "date" || t === "datetime";

/** Power BI'daki Σ işareti: toplanabilen sayısal sütun. */
export const isSummarized = (c: ModelColumn) => isNumeric(c.tip) && (c.ozet ?? "sum") !== "none";

export function nodeHeight(t: ModelTable, collapsed: boolean): number {
  if (collapsed) return HEADER_H;
  const rows = Math.min(t.sutunlar.length + t.olculer.length, MAX_ROWS);
  return HEADER_H + Math.max(rows, 1) * ROW_H + 8;
}

export function relTables(r: Relationship): [string, string] {
  return [parseRef(r.kimden)[0], parseRef(r.kime)[0]];
}

export function relId(r: { kimden: string; kime: string }): string {
  return `${r.kimden}→${r.kime}`;
}

/** Otomatik yerleşim: olgu tabloları solda, boyutlar sağda (çok → bir yönünde). */
export function autoLayout(
  tables: ModelTable[],
  rels: Relationship[],
  collapsed: Record<string, boolean>,
): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 36, ranksep: 140, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const t of tables) g.setNode(t.ad, { width: NODE_WIDTH, height: nodeHeight(t, !!collapsed[t.ad]) });
  for (const r of rels) {
    const [a, b] = relTables(r);
    if (g.hasNode(a) && g.hasNode(b)) g.setEdge(a, b, { weight: r.aktif ? 2 : 1 });
  }
  dagre.layout(g);
  const out: Record<string, { x: number; y: number }> = {};
  for (const t of tables) {
    const n = g.node(t.ad);
    out[t.ad] = { x: Math.round(n.x - n.width / 2), y: Math.round(n.y - n.height / 2) };
  }
  return out;
}

export const nf = new Intl.NumberFormat("tr-TR");
