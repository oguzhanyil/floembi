import type { Agg, ColumnType, FieldRef, ModelColumn, ValueRef, Visual, VisualType } from "@floem/client";

export const GRID = 8;

export type WellKey = "group" | "legend" | "values" | "target";

export interface WellDef {
  key: WellKey;
  label: string;
  max?: number;
  /** Değer listesinde sabit yuva (dağılım: 0 = X, 1 = Y, 2 = boyut) */
  slot?: number;
  optional?: boolean;
  /** Alan otomatik eklenirken (işaretleme) yalnızca tarih sütunları bu kutuya girer */
  dateOnly?: boolean;
}

export interface VisualDef {
  label: string;
  icon: string;
  wells: WellDef[];
  size: [number, number];
  /** Görselleştirmeler bölmesindeki grup */
  group: "Veri" | "Grafik" | "Kart" | "Etkileşim" | "Ekle";
  /** Kategori grafiği mi (eksen + değer + gösterge) */
  category?: { horizontal?: boolean; stacked?: boolean; line?: boolean; area?: boolean };
}

// Eksen birden fazla alan alabilir: Yıl → Ay → Gün gibi drill-down hiyerarşisi
const AXIS: WellDef = { key: "group", label: "X ekseni" };
const LEGEND: WellDef = { key: "legend", label: "Gösterge", max: 1 };
const YVALUES: WellDef = { key: "values", label: "Y ekseni" };
// Kart ve KPI: değerin dönemlere göre eğilimi (küçük çizgi + önceki döneme göre değişim)
const TREND: WellDef = { key: "group", label: "Trend ekseni", max: 1, optional: true, dateOnly: true };

export const VISUAL_DEFS: Record<VisualType, VisualDef> = {
  table: {
    label: "Tablo", icon: "▦", group: "Veri", size: [480, 320],
    wells: [{ key: "group", label: "Sütunlar" }, { key: "values", label: "Değerler" }],
  },
  column: {
    label: "Kümelenmiş sütun grafiği", icon: "▮", group: "Grafik", size: [520, 320], category: {},
    wells: [AXIS, YVALUES, LEGEND],
  },
  stackedcolumn: {
    label: "Yığılmış sütun grafiği", icon: "▯", group: "Grafik", size: [520, 320], category: { stacked: true },
    wells: [AXIS, YVALUES, LEGEND],
  },
  bar: {
    label: "Kümelenmiş çubuk grafiği", icon: "▬", group: "Grafik", size: [520, 320], category: { horizontal: true },
    wells: [{ key: "group", label: "Y ekseni" }, { key: "values", label: "X ekseni" }, LEGEND],
  },
  stackedbar: {
    label: "Yığılmış çubuk grafiği", icon: "▭", group: "Grafik", size: [520, 320], category: { horizontal: true, stacked: true },
    wells: [{ key: "group", label: "Y ekseni" }, { key: "values", label: "X ekseni" }, LEGEND],
  },
  line: {
    label: "Çizgi grafiği", icon: "⟋", group: "Grafik", size: [560, 300], category: { line: true },
    wells: [AXIS, YVALUES, LEGEND],
  },
  area: {
    label: "Alan grafiği", icon: "◭", group: "Grafik", size: [560, 300], category: { line: true, area: true },
    wells: [AXIS, YVALUES, LEGEND],
  },
  pie: {
    label: "Pasta grafiği", icon: "◔", group: "Grafik", size: [360, 300],
    wells: [{ key: "group", label: "Gösterge" }, { key: "values", label: "Değerler", max: 1 }],
  },
  donut: {
    label: "Halka grafiği", icon: "◎", group: "Grafik", size: [360, 300],
    wells: [{ key: "group", label: "Gösterge" }, { key: "values", label: "Değerler", max: 1 }],
  },
  scatter: {
    label: "Dağılım grafiği", icon: "⁘", group: "Grafik", size: [480, 320],
    wells: [
      { key: "group", label: "Ayrıntılar", max: 1 },
      { key: "values", label: "X ekseni", slot: 0, max: 1 },
      { key: "values", label: "Y ekseni", slot: 1, max: 1 },
      { key: "values", label: "Boyut", slot: 2, max: 1, optional: true },
      { key: "legend", label: "Gösterge", max: 1 },
    ],
  },
  treemap: {
    label: "Ağaç haritası", icon: "▚", group: "Grafik", size: [480, 320],
    wells: [{ key: "group", label: "Kategori" }, { key: "values", label: "Değerler", max: 1 }],
  },
  heatmap: {
    label: "Isı haritası", icon: "▦", group: "Grafik", size: [520, 320],
    wells: [
      { key: "group", label: "Y ekseni", max: 1 },
      { key: "legend", label: "X ekseni", max: 1 },
      { key: "values", label: "Değer", max: 1 },
    ],
  },
  waterfall: {
    label: "Şelale grafiği", icon: "⫶", group: "Grafik", size: [520, 320],
    wells: [{ key: "group", label: "Kategori", max: 1 }, { key: "values", label: "Y ekseni", max: 1 }],
  },
  gauge: {
    label: "Gösterge (gauge)", icon: "◠", group: "Kart", size: [300, 220],
    wells: [
      { key: "values", label: "Değer", slot: 0, max: 1 },
      { key: "values", label: "En büyük değer", slot: 1, max: 1, optional: true },
      { key: "target", label: "Hedef", max: 1 },
    ],
  },
  progress: {
    label: "İlerleme çubuğu", icon: "▰", group: "Kart", size: [320, 110],
    wells: [{ key: "values", label: "Değer", max: 1 }, { key: "target", label: "Hedef", max: 1 }],
  },
  matrix: {
    label: "Matris (pivot)", icon: "⊞", group: "Veri", size: [560, 340],
    wells: [
      { key: "group", label: "Satırlar" },
      { key: "legend", label: "Sütunlar" },
      { key: "values", label: "Değerler" },
    ],
  },
  card: {
    label: "Kart", icon: "▢", group: "Kart", size: [240, 140],
    wells: [{ key: "values", label: "Alan", max: 1 }, TREND],
  },
  multicard: {
    label: "Çok satırlı kart", icon: "☰", group: "Kart", size: [300, 240],
    wells: [{ key: "group", label: "Kategori", max: 1 }, { key: "values", label: "Alanlar" }],
  },
  kpi: {
    label: "KPI kartı", icon: "◆", group: "Kart", size: [280, 160],
    wells: [{ key: "values", label: "Değer", max: 1 }, { key: "target", label: "Hedef", max: 1 }, TREND],
  },
  slicer: {
    label: "Dilimleyici", icon: "☷", group: "Etkileşim", size: [240, 280],
    wells: [{ key: "group", label: "Alan", max: 1 }],
  },
  text: {
    label: "Metin kutusu", icon: "T", group: "Ekle", size: [360, 120],
    wells: [{ key: "values", label: "Dinamik değerler", optional: true }],
  },
  shape: {
    label: "Şekil", icon: "▢", group: "Ekle", size: [280, 120], wells: [],
  },
  image: {
    label: "Görsel", icon: "▣", group: "Ekle", size: [320, 220], wells: [],
  },
  ticker: {
    label: "Animasyonlu sayı", icon: "↗", group: "Kart", size: [280, 160],
    wells: [{ key: "values", label: "Değer", max: 1 }],
  },
};

export const VISUAL_GROUPS: VisualDef["group"][] = ["Grafik", "Kart", "Veri", "Etkileşim", "Ekle"];

/** Görselin tüm gruplama alanları (eksen + gösterge) */
export const groupFields = (v: Visual): FieldRef[] => [...v.group, ...(v.legend ?? [])];

export const AGG_LABEL: Record<Agg, string> = {
  sum: "Toplam",
  avg: "Ortalama",
  min: "En düşük",
  max: "En yüksek",
  count: "Say",
  distinctcount: "Say (Farklı)",
};

/** Sunucudaki report/query.py ile aynı adlandırma (Power BI Türkçe arayüzü) */
export function valueLabel(v: ValueRef): string {
  if ("measure" in v) return v.measure;
  const c = v.column;
  switch (v.agg) {
    case "sum": return `Toplam ${c}`;
    case "avg": return `Ortalama ${c}`;
    case "min": return `En Düşük ${c}`;
    case "max": return `En Yüksek ${c}`;
    case "count": return `${c} Sayısı`;
    case "distinctcount": return `${c} Sayısı (Farklı)`;
  }
}

export const isNumericType = (t: ColumnType) => t === "int32" || t === "int64" || t === "decimal" || t === "double";

/** Power BI'daki varsayılan: sayısal sütun değer olarak (Σ), diğerleri gruplama alanı olarak eklenir. */
export function defaultRole(c: ModelColumn): "group" | "values" {
  return isNumericType(c.tip) && (c.ozet ?? "sum") !== "none" ? "values" : "group";
}

export function defaultAgg(c: ModelColumn): Agg {
  const o = c.ozet ?? "sum";
  if (o === "none") return isNumericType(c.tip) ? "sum" : "count";
  return o as Agg;
}

export function newId(prefix: string, taken: Set<string>): string {
  for (let i = 1; ; i++) {
    const id = `${prefix}${i}`;
    if (!taken.has(id)) return id;
  }
}

export const snap = (v: number) => Math.round(v / GRID) * GRID;

export function sameField(a: FieldRef, b: FieldRef) {
  return a.table === b.table && a.column === b.column;
}

export function usesColumn(v: Visual, table: string, column: string): boolean {
  return groupFields(v).some((g) => g.table === table && g.column === column) ||
    [...v.values, ...(v.target ?? [])].some((x) => !("measure" in x) && x.table === table && x.column === column);
}

// ------------------------------------------------------------------ biçimlendirme
const nf0 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfAuto = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

function parseDate(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
}

const pad = (n: number) => String(n).padStart(2, "0");

function formatDate(d: Date, fmt: string | null | undefined, withTime: boolean): string {
  if (fmt === "MMMM yyyy") return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const date = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  const timeWanted = fmt === "dd.MM.yyyy HH:mm" || (!fmt && withTime && (d.getHours() || d.getMinutes()));
  return timeWanted ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

/** Değeri sütun tipine ve biçim dizesine göre yazar (Türkçe yerel ayar). */
export function formatValue(v: unknown, type: ColumnType | undefined, fmt?: string | null): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (fmt) {
      if (fmt.endsWith("%")) {
        const digits = (fmt.split(".")[1] ?? "").replace("%", "").length;
        return `%${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v * 100)}`;
      }
      const prefix = fmt.startsWith("₺") ? "₺" : "";
      const digits = (fmt.split(".")[1] ?? "").length;
      return prefix + new Intl.NumberFormat("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
    }
    if (type === "int32" || type === "int64") return nf0.format(v);
    if (type === "decimal") return nf2.format(v);
    return nfAuto.format(v);
  }
  if (typeof v === "boolean") return v ? "Doğru" : "Yanlış";
  if (typeof v === "string" && (type === "date" || type === "datetime")) {
    const d = parseDate(v);
    if (d) return formatDate(d, fmt, type === "datetime");
  }
  return String(v);
}

/** Kart ve eksenler için Power BI "Otomatik" görüntü birimleri: B (bin), Mn, Mr. */
export function formatCompact(v: number): string {
  const a = Math.abs(v);
  const f = (x: number, u: string) => `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: x >= 100 ? 0 : x >= 10 ? 1 : 2 }).format(x)} ${u}`;
  if (a >= 1e9) return f(v / 1e9, "Mr");
  if (a >= 1e6) return f(v / 1e6, "Mn");
  if (a >= 1e4) return f(v / 1e3, "B");
  return nfAuto.format(v);
}

/** Kategorik renk sırası (dataviz referans paleti, açık tema; doğrulanmış sıra, döngüyle tekrarlanmaz). */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
