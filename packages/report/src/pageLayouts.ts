import type { LayoutVisualOverride, PageLayoutVariant, ReportDefinition, ReportPage, Visual } from "@floem/client";

export const layoutFormatKeys = ["fontSize", "titleSize", "padding", "textOverflow", "gridFitColumns", "legend"] as const;
const geometryKeys = ["x", "y", "w", "h", "container", "layoutItem"] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** En dar eşleşen eşik kazanır. Fiziksel piksel/DPR ve tarayıcı yakınlaştırması kullanılmaz. */
export function choosePageLayout(page: ReportPage, availableWidth: number): string | null {
  if (!(availableWidth > 0)) return null;
  return [...(page.layouts ?? [])].sort((a, b) => a.maxWidth - b.maxWidth)
    .find((v) => availableWidth <= v.maxWidth)?.id ?? null;
}

export function resolvePageVariant(base: ReportPage, id?: string | null): ReportPage {
  const variant = base.layouts?.find((v) => v.id === id);
  if (!variant) return base;
  const ranks = new Map((variant.order ?? []).map((key, i) => [key, i]));
  const visuals = base.visuals.map((v) => {
    const o = variant.overrides[v.id];
    return !o ? v : { ...v, ...o, format: { ...v.format, ...o.format },
      ...(o.container ? { container: { ...v.container, ...o.container } } : {}),
      ...(o.layoutItem ? { layoutItem: { ...v.layoutItem, ...o.layoutItem } } : {}) };
  }).sort((a, b) => (ranks.get(a.id) ?? 100000) - (ranks.get(b.id) ?? 100000));
  return { ...base, width: variant.width, height: variant.height,
    displayOption: variant.displayOption ?? "FitToWidth", rootLayout: variant.rootLayout, visuals };
}

/** Silinen nesnelerden kalan konumları temizler; yeni nesneler hiçbir düzende saklanmaz. */
export function prunePageLayouts(page: ReportPage): ReportPage {
  if (!page.layouts?.length) return page;
  const ids = new Set(page.visuals.map((v) => v.id));
  const layouts = page.layouts.map((layout) => ({ ...layout,
    order: layout.order?.filter((id) => ids.has(id)),
    overrides: Object.fromEntries(Object.entries(layout.overrides).filter(([id]) => ids.has(id))) }));
  return same(page.layouts, layouts) ? page : { ...page, layouts };
}
export function pruneReportLayouts(report: ReportDefinition): ReportDefinition {
  const pages = report.pages.map(prunePageLayouts);
  return pages.every((p, i) => p === report.pages[i]) ? report : { ...report, pages };
}

/** Görsel tanımı tek kalır. Yalnız yerleşim ve okunabilirlik istisnaları varyanta yazılır. */
export function editPageVariant(base: ReportPage, id: string | null, edited: ReportPage): ReportPage {
  const variant = base.layouts?.find((v) => v.id === id);
  if (!variant) return prunePageLayouts(edited);
  const overrides: Record<string, LayoutVisualOverride> = Object.create(null);
  const before = new Map(base.visuals.map((v) => [v.id, v]));
  const visuals = edited.visuals.map((v) => {
    const original = before.get(v.id);
    if (!original) return v; // Ekleme bütün düzenlerde ortak nesne oluşturur.
    const shared = { ...v, parentId: original.parentId, format: { ...v.format } };
    const delta: LayoutVisualOverride = {};
    for (const key of geometryKeys) {
      if (!same(original[key], v[key]) && v[key] !== undefined) Object.assign(delta, { [key]: v[key] });
      Object.assign(shared, { [key]: original[key] });
    }
    for (const key of layoutFormatKeys) {
      if (!same(original.format[key], v.format[key]) && v.format[key] !== undefined) {
        delta.format ??= {}; Object.assign(delta.format, { [key]: v.format[key] });
      }
      if (original.format[key] === undefined) delete shared.format[key];
      else shared.format[key] = original.format[key] as never;
    }
    if (Object.keys(delta).length) overrides[v.id] = delta;
    return shared;
  });
  // Temel katman sırası da korunur; eklenen nesneler sona gelir.
  const rank = new Map(base.visuals.map((v, i) => [v.id, i]));
  visuals.sort((a, b) => (rank.get(a.id) ?? 100000) - (rank.get(b.id) ?? 100000));
  return prunePageLayouts({ ...edited, width: base.width, height: base.height,
    rootLayout: base.rootLayout, displayOption: base.displayOption, visuals,
    layouts: base.layouts!.map((v) => v.id !== id ? v : { ...variant, width: edited.width, height: edited.height,
      displayOption: edited.displayOption, rootLayout: edited.rootLayout, order: edited.visuals.map((v) => v.id), overrides }) });
}

/** Dikey başlangıç: nesne kaybı/sorgu kopyası yok. Serbest grupların yerleşimi ayrıca düzenlenebilir. */
export function createPageLayout(page: ReportPage, preset: "phone" | "tablet" | "laptop"): PageLayoutVariant {
  const spec = { phone: { name: "Telefon", width: 390, maxWidth: 600 }, tablet: { name: "Tablet", width: 768, maxWidth: 1024 }, laptop: { name: "Laptop", width: 1280, maxWidth: 1440 } }[preset];
  const used = new Set(page.layouts?.map((v) => v.id));
  let id: string = preset, i = 2; while (used.has(id)) id = `${preset}-${i++}`;
  const overrides: Record<string, LayoutVisualOverride> = Object.create(null);
  const placedWidth = (v: Visual): number => {
    const parent = page.visuals.find((node) => node.id === v.parentId);
    if (!parent) return spec.width - 32;
    const width = placedWidth(parent);
    if ((parent.container?.mode ?? "free") === "free") return Math.max(1, width * v.w / parent.w);
    const grid = parent.container?.mode === "grid" || parent.container?.mode === "horizontal" && preset !== "phone";
    const columns = preset === "phone" ? 1 : preset === "tablet" ? 2 : 3;
    return grid ? Math.max(40, (width - 24 - 12 * (columns - 1)) / columns) : Math.max(40, width - 24);
  };
  for (const v of page.visuals) {
    const o: LayoutVisualOverride = {};
    if (!v.parentId) o.w = spec.width - 32;
    if (v.type === "container") {
      const mode = v.container?.mode ?? "free";
      o.container = mode === "free" ? { ...v.container, autoHeight: true, overflow: "visible" } :
        { ...v.container, kind: "frame", mode: mode === "grid" || mode === "horizontal" && preset !== "phone" ? "grid" : "vertical",
          columns: preset === "phone" ? 1 : preset === "tablet" ? 2 : 3, padding: 12, gap: 12, align: "stretch", autoHeight: true, overflow: "visible" };
    }
    const parent = page.visuals.find((node) => node.id === v.parentId);
    if (parent && (parent.container?.mode ?? "free") === "free") {
      const ratio = placedWidth(parent) / parent.w;
      o.x = v.x * ratio; o.w = Math.max(1, v.w * ratio);
    }
    if (v.layoutItem) o.layoutItem = { ...v.layoutItem, minWidth: Math.min(v.layoutItem.minWidth ?? 40, placedWidth(v)), grow: 0 };
    if (v.type === "text") o.format = { textOverflow: "grow" };
    if (["table", "matrix", "treegrid"].includes(v.type)) o.format = { gridFitColumns: true };
    if (Object.keys(o).length) overrides[v.id] = o;
  }
  return { ...spec, id, height: 640, displayOption: "FitToWidth",
    rootLayout: { mode: "vertical", padding: 16, gap: 16, align: "stretch", autoHeight: true },
    order: [...page.visuals.filter((v) => !v.parentId).sort((a, b) => a.y - b.y || a.x - b.x), ...page.visuals.filter((v) => v.parentId)].map((v) => v.id), overrides };
}
