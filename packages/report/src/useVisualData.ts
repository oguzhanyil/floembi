import type { FieldRef, FilterRef, Visual, VisualQuery, VisualResult, VisualState } from "@floem/client";
import { FloemApiError } from "@floem/client";
import { useEffect, useMemo, useState } from "react";
import { VISUAL_DEFS } from "./reportUtils";
import { resultDiagnostic, useQueryDiagnostic } from "./diagnostics";

export const CHART_CATEGORY_LIMIT = 50;
export const MATRIX_ROW_LIMIT = 5000;

/** Görseli çalıştıran taraf: Desktop'ta yerel servis, web'de floembi.app. */
export type QueryFn = (q: VisualQuery) => Promise<VisualResult>;

export interface VisualError {
  message: string;
  detail?: string;
}

// ------------------------------------------------------------------ drill-down
/** Drill-down destekleyen görseller: eksende birden fazla alan varsa hiyerarşi olur. */
export const supportsDrill = (v: Visual) => !!VISUAL_DEFS[v.type].category || v.type === "pie" || v.type === "donut" || v.type === "treemap";

export function drillOf(v: Visual): { level: number; path: (string | number | boolean | null)[] } {
  const d = v.state?.drill;
  if (!d || !supportsDrill(v)) return { level: 0, path: [] };
  const level = Math.max(0, Math.min(d.level, v.group.length - 1));
  return { level, path: d.path.slice(0, level) };
}

/** Görselin o an gösterdiği eksen alanı (drill düzeyine göre). */
export function currentAxis(v: Visual): FieldRef | undefined {
  return v.group[drillOf(v).level];
}

/** Üst düzeylerde seçilen değerler → filtre (Yıl=2026 içindeki aylar gibi). */
function drillFilters(v: Visual): FilterRef[] {
  const { path } = drillOf(v);
  return path.map((val, i) => ({ table: v.group[i].table, column: v.group[i].column, op: "in" as const, values: [val] }));
}

// ------------------------------------------------------------------ sorgular
/** Görsel türüne göre sorgu. Dönen sütun sırası: gruplama alanları, sonra değerler. */
export function buildQuery(v: Visual, extra: FilterRef[]): VisualQuery | null {
  const filters = [...v.filters, ...extra, ...(supportsDrill(v) ? drillFilters(v) : [])];
  const def = VISUAL_DEFS[v.type];
  const axis = currentAxis(v);
  if (v.type === "combo") {
    const values = [...v.values, ...(v.target ?? [])];
    return axis && values.length ? { group:[axis], values, filters, limit:CHART_CATEGORY_LIMIT } : null;
  }
  if (def.category) {
    if (!axis || !v.values.length) return null;
    const legend = v.legend ?? [];
    if (legend.length) {
      // Eksen × gösterge: tek değer, istemcide seriye çevrilir
      return { group: [axis, legend[0]], values: v.values.slice(0, 1), filters, limit: 5000 };
    }
    const byValue = !def.category.line;          // çubuklar değere göre, çizgiler eksen sırasıyla
    return {
      group: [axis], values: v.values, filters,
      order_by: byValue ? [{ index: 1, desc: true }] : [],
      limit: byValue ? CHART_CATEGORY_LIMIT : 2000,
    };
  }
  switch (v.type) {
    case "tolerance":
      if (v.values.length < 3) return null;
      return { group: v.group, values: v.values.slice(0, 4), filters, limit: 100 };
    case "table": {
      if (!v.group.length && !v.values.length) return null;
      const sort = v.state?.sort;
      return { group: v.group, values: v.values, filters, totals: v.format.showTotals !== false, limit: 10000, order_by: sort ? [sort] : [] };
    }
    case "funnel":
    case "pie":
    case "donut":
    case "treemap":
      if (!axis || !v.values.length) return null;
      return { group: [axis], values: v.values.slice(0, 1), filters, order_by: [{ index: 1, desc: true }], limit: 300 };
    case "waterfall":
      if (!v.group.length || !v.values.length) return null;
      return { group: v.group.slice(0, 1), values: v.values.slice(0, 1), filters, limit: 60 };
    case "scatter": {
      if (!v.group.length || v.values.length < 2) return null;
      const legend = (v.legend ?? []).slice(0, 1);
      return { group: [v.group[0], ...legend], values: v.values.slice(0, 3), filters, limit: 3000 };
    }
    case "heatmap": {
      const x = (v.legend ?? [])[0];
      if (!v.group.length || !x || !v.values.length) return null;
      return { group: [v.group[0], x], values: v.values.slice(0, 1), filters, limit: 5000 };
    }
    case "card":
    case "ticker":
      if (!v.values.length) return null;
      return { group: [], values: v.values.slice(0, 1), filters, limit: 1 };
    case "multicard":
      if (!v.values.length) return null;
      return { group: v.group.slice(0, 1), values: v.values, filters, limit: 200 };
    case "kpi":
    case "progress":
      if (!v.values.length) return null;
      return { group: [], values: [...v.values.slice(0, 1), ...(v.target ?? []).slice(0, 1)], filters, limit: 1 };
    case "gauge":
      if (!v.values.length) return null;
      return { group: [], values: [...v.values.slice(0, 2), ...(v.target ?? []).slice(0, 1)], filters, limit: 1 };
    case "text":
      // Metin kutusu: yalnızca dinamik değer varsa sorgu (tek satır)
      if (!v.values.length) return null;
      return { group: [], values: v.values, filters, limit: 1 };
    case "shape":
    case "image":
    case "button":
      return null;
    case "slicer": {
      const f = v.group[0];
      if (!f) return null;
      if (v.format.slicerStyle === "range") {
        return {
          group: [], filters, limit: 1,
          values: [{ table: f.table, column: f.column, agg: "min" }, { table: f.table, column: f.column, agg: "max" }],
        };
      }
      return { group: [f], values: [], filters, limit: 1000 };
    }
  }
  return null;
}

/** Kart/KPI trend ekseni: değerin dönemlere göre serisi (eksen sırasıyla). */
export function trendQuery(v: Visual, extra: FilterRef[]): VisualQuery | null {
  if ((v.type !== "card" && v.type !== "kpi") || !v.group[0] || !v.values.length) return null;
  return {
    group: [v.group[0]], values: v.values.slice(0, 1), filters: [...v.filters, ...extra],
    order_by: [{ index: 0, desc: false }], limit: 400,
  };
}

/**
 * Matris: her (satır düzeyi, sütun düzeyi) birleşimi için ayrı sorgu. Alt toplamlar
 * toplanarak değil, o düzeyde yeniden hesaplanır; "farklı say", "ortalama" gibi
 * toplanamayan değerler de doğru çıkar (DAX'taki gibi).
 */
export function matrixQueries(v: Visual, extra: FilterRef[]): { r: number; c: number; q: VisualQuery }[] | null {
  if (!v.values.length || (v.type === "treegrid" && !v.group.length)) return null;
  const rows = v.group;
  const cols = v.type === "treegrid" ? [] : v.legend ?? [];
  const filters = [...v.filters, ...extra];
  const out: { r: number; c: number; q: VisualQuery }[] = [];
  // Sütunlarda yalnızca yaprak düzey ve genel toplam (ara sütun toplamları sonraki sürümde)
  const colLevels = cols.length ? [0, cols.length] : [0];
  for (let r = 0; r <= rows.length; r++) {
    for (const c of colLevels) {
      out.push({ r, c, q: { group: [...rows.slice(0, r), ...cols.slice(0, c)], values: v.values, filters, limit: MATRIX_ROW_LIMIT } });
    }
  }
  return out;
}

/** Sayfadaki dilimleyicilerin seçimleri → diğer görseller için filtreler. */
export function slicerFilters(visuals: Visual[], states: Record<string, VisualState | undefined>, exceptId?: string): FilterRef[] {
  const out: FilterRef[] = [];
  for (const v of visuals) {
    if (v.type !== "slicer" || v.id === exceptId || !v.group[0]) continue;
    const st = states[v.id] ?? v.state ?? {};
    const { table, column } = v.group[0];
    if (v.format.slicerStyle === "range") {
      const [lo, hi] = st.range ?? [null, null];
      if (lo !== null && hi !== null) out.push({ table, column, op: "between", values: [lo, hi] });
      else if (lo !== null) out.push({ table, column, op: "ge", values: [lo] });
      else if (hi !== null) out.push({ table, column, op: "le", values: [hi] });
    } else if (st.selected?.length) {
      out.push({ table, column, op: "in", values: st.selected });
    }
  }
  return out;
}

// ------------------------------------------------------------------ veri kancaları
export type VisualData =
  | { state: "empty" }
  | { state: "loading"; previous?: VisualResult }
  | { state: "ready"; result: VisualResult }
  | { state: "error"; error: VisualError };

function toError(e: unknown): VisualError {
  if (e instanceof FloemApiError) return { message: e.message, detail: e.detail };
  return { message: "Beklenmeyen hata", detail: String(e) };
}

/** Görselin verisini getirir; aynı sorgu tekrar istenmez, eski yanıt yenisinin üstüne yazılmaz. */
export function useVisualData(v: Visual, extra: FilterRef[], revision: string, run: QueryFn, enabled = true): VisualData {
  const query = useMemo(() => (enabled ? buildQuery(v, extra) : null), [v, extra, enabled]);
  return useQueryData(query, revision, run);
}

/** Verilen sorguyu çalıştırır (null: boş). */
export function useQueryData(query: VisualQuery | null, revision: string, run: QueryFn): VisualData {
  const key = query ? JSON.stringify(query) + "#" + revision : "";
  const [data, setData] = useState<VisualData>({ state: "empty" });
  useQueryDiagnostic(key, data.state === "ready" ? resultDiagnostic(data.result, "Görsel sorgusu", query?.limit) : { source: "Görsel sorgusu", status: data.state });

  useEffect(() => {
    if (!query) {
      setData({ state: "empty" });
      return;
    }
    let alive = true;
    setData((d) => ({ state: "loading", previous: d.state === "ready" ? d.result : d.state === "loading" ? d.previous : undefined }));
    Promise.resolve().then(() => run(query))
      .then((result) => alive && setData({ state: "ready", result }))
      .catch((e) => alive && setData({ state: "error", error: toError(e) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, run]);

  return !query ? { state: "empty" } : data.state === "empty" ? { state: "loading" } : data;
}

export interface MatrixPart {
  r: number;
  c: number;
  result: VisualResult;
}

export type MatrixData =
  | { state: "empty" }
  | { state: "loading"; previous?: MatrixPart[] }
  | { state: "ready"; parts: MatrixPart[] }
  | { state: "error"; error: VisualError };

/** Matrisin tüm düzey sorgularını birlikte çalıştırır. */
export function useMatrixData(v: Visual, extra: FilterRef[], revision: string, run: QueryFn, enabled = true): MatrixData {
  const queries = useMemo(() => (enabled ? matrixQueries(v, extra) : null), [v, extra, enabled]);
  const key = queries ? JSON.stringify(queries) + "#" + revision : "";
  const [data, setData] = useState<MatrixData>({ state: "empty" });
  useQueryDiagnostic(key, data.state === "ready" ? { source: "Matris sorguları", status: data.parts.some((p) => p.result.rows.length) ? "ready" : "empty", rows: Math.max(0, ...data.parts.map((p) => p.result.rows.length)), truncated: data.parts.some((p) => p.result.truncated), limit: MATRIX_ROW_LIMIT } : { source: "Matris sorguları", status: data.state });

  useEffect(() => {
    if (!queries) {
      setData({ state: "empty" });
      return;
    }
    let alive = true;
    setData((d) => ({ state: "loading", previous: d.state === "ready" ? d.parts : d.state === "loading" ? d.previous : undefined }));
    Promise.all(queries.map(({ r, c, q }) => Promise.resolve().then(() => run(q)).then((result) => ({ r, c, result }))))
      .then((parts) => alive && setData({ state: "ready", parts }))
      .catch((e) => alive && setData({ state: "error", error: toError(e) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, run]);

  return !queries ? { state: "empty" } : data.state === "empty" ? { state: "loading" } : data;
}
