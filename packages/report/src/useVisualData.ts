import type { FilterRef, Visual, VisualQuery, VisualResult, VisualState } from "@floem/client";
import { VISUAL_DEFS } from "./reportUtils";
import { FloemApiError } from "@floem/client";
import { useEffect, useMemo, useState } from "react";

export const CHART_CATEGORY_LIMIT = 50;

/** Görseli çalıştıran taraf: Desktop'ta yerel servis, web'de floembi.app. */
export type QueryFn = (q: VisualQuery) => Promise<VisualResult>;

export interface VisualError {
  message: string;
  detail?: string;
}

/** Görsel türüne göre sorgu. Dönen sütun sırası: gruplama alanları, sonra değerler. */
export function buildQuery(v: Visual, extra: FilterRef[]): VisualQuery | null {
  const filters = [...v.filters, ...extra];
  const def = VISUAL_DEFS[v.type];
  if (def.category) {
    if (!v.group.length || !v.values.length) return null;
    const legend = v.legend ?? [];
    if (legend.length) {
      // Eksen × gösterge: tek değer, istemcide seriye çevrilir
      return { group: [v.group[0], legend[0]], values: v.values.slice(0, 1), filters, limit: 5000 };
    }
    const byValue = !def.category.line;          // çubuklar değere göre, çizgiler eksen sırasıyla
    return {
      group: v.group.slice(0, 1), values: v.values, filters,
      order_by: byValue ? [{ index: 1, desc: true }] : [],
      limit: byValue ? CHART_CATEGORY_LIMIT : 2000,
    };
  }
  switch (v.type) {
    case "table": {
      if (!v.group.length && !v.values.length) return null;
      const sort = v.state?.sort;
      return { group: v.group, values: v.values, filters, totals: true, limit: 10000, order_by: sort ? [sort] : [] };
    }
    case "pie":
    case "donut":
      if (!v.group.length || !v.values.length) return null;
      return { group: v.group.slice(0, 1), values: v.values.slice(0, 1), filters, order_by: [{ index: 1, desc: true }], limit: 200 };
    case "card":
      if (!v.values.length) return null;
      return { group: [], values: v.values.slice(0, 1), filters, limit: 1 };
    case "multicard":
      if (!v.values.length) return null;
      return { group: v.group.slice(0, 1), values: v.values, filters, limit: 200 };
    case "kpi":
      if (!v.values.length) return null;
      return { group: [], values: [...v.values.slice(0, 1), ...(v.target ?? []).slice(0, 1)], filters, limit: 1 };
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
export function useVisualData(v: Visual, extra: FilterRef[], revision: string, run: QueryFn): VisualData {
  const query = useMemo(() => buildQuery(v, extra), [v, extra]);
  const key = query ? JSON.stringify(query) + "#" + revision : "";
  const [data, setData] = useState<VisualData>({ state: "empty" });

  useEffect(() => {
    if (!query) {
      setData({ state: "empty" });
      return;
    }
    let alive = true;
    setData((d) => ({ state: "loading", previous: d.state === "ready" ? d.result : d.state === "loading" ? d.previous : undefined }));
    run(query)
      .then((result) => alive && setData({ state: "ready", result }))
      .catch((e) => alive && setData({ state: "error", error: toError(e) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, run]);

  return data;
}
