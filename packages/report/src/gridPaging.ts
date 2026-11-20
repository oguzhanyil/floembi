import type { GridColumnFilter, VisualQuery, VisualResult } from "@floem/client";
import type { QueryFn } from "./useVisualData";

export const GRID_EXPORT_LIMIT = 100_000;
export const GRID_PDF_LIMIT = 2_000;
export const gridPageSize = (n: unknown) => [25, 50, 100, 250, 500].includes(Number(n)) ? Number(n) : 100;

/** AG Community filtre modeli → sınırlı, parametreli sunucu sözleşmesi. */
export function gridColumnFilters(model: Record<string, unknown>): GridColumnFilter[] {
  return Object.entries(model).flatMap(([key, raw]) => {
    if (!/^c\d+$/.test(key) || !raw || typeof raw !== "object") return [];
    const m = raw as { filterType: "text" | "number"; type: GridColumnFilter["op"]; filter?: string | number; filterTo?: number; conditions?: unknown };
    if (m.conditions || !["text", "number"].includes(m.filterType)) throw new Error("Sunucu modunda sütun başına tek koşul kullanın.");
    return [{ index: Number(key.slice(1)), kind: m.filterType, op: m.type, value: m.filter, value2: m.filterTo }];
  });
}

/** Sayfalar aynı veri/yetki/sorgu sürümünde kalmalı; hiçbir kısmi dosya başarı sayılmaz. */
export async function collectGridPages(run: QueryFn, query: VisualQuery, progress: (count: number, total: number) => void,
  signal: AbortSignal, limit = GRID_EXPORT_LIMIT): Promise<VisualResult> {
  let result: VisualResult | undefined, offset = 0, revision = query.page?.revision, snapshot = query.page?.snapshot;
  const rows: VisualResult["rows"] = [];
  while (true) {
    if (signal.aborted) throw new Error("İndirme iptal edildi.");
    const next = await run({ ...query, page: { ...query.page!, offset, size: 1000, revision, snapshot } });
    if (signal.aborted) throw new Error("İndirme iptal edildi.");
    if (!next.page || (revision && next.page.revision !== revision) || (snapshot && next.page.snapshot !== snapshot) || next.page.offset !== offset) throw new Error("Sunucu sayfalama sürümü değişti. Yeniden deneyin.");
    if (next.page.totalRows > limit) throw new Error(`Bu biçim en fazla ${limit.toLocaleString("tr-TR")} satır aktarır. Arama veya rapor filtreleriyle kapsamı daraltın.`);
    if (result && next.page.totalRows !== result.page!.totalRows) throw new Error("Sonuç kapsamı değişti. Yeniden deneyin.");
    result ??= next; revision = next.page.revision; snapshot = next.page.snapshot;
    rows.push(...next.rows); offset += next.rows.length; progress(offset, next.page.totalRows);
    if (rows.length > limit || (!next.rows.length && next.page.hasMore)) throw new Error("Sunucu sayfalama sonucu tutarsız.");
    if (!next.page.hasMore) {
      if (rows.length !== next.page.totalRows) throw new Error("Sonucun tamamı alınamadı; dosya oluşturulmadı.");
      return { ...result, rows, truncated: false, page: { ...result.page!, offset: 0, hasMore: false } };
    }
  }
}
