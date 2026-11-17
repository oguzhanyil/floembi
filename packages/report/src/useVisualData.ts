import type { FilterRef, Visual, VisualQuery, VisualResult } from "@floem/client";
import { FloemApiError } from "@floem/client";
import { useEffect, useMemo, useState } from "react";

export const COLUMN_CHART_LIMIT = 40;

/** Görseli çalıştıran taraf: Desktop'ta yerel servis, web'de floembi.app. */
export type QueryFn = (q: VisualQuery) => Promise<VisualResult>;

export interface VisualError {
  message: string;
  detail?: string;
}

/** Görsel türüne göre sorgu: tablo toplam satırıyla, grafik değere göre azalan, kart tek değer. */
export function buildQuery(v: Visual, extra: FilterRef[]): VisualQuery | null {
  const filters = [...v.filters, ...extra];
  switch (v.type) {
    case "table":
      if (!v.group.length && !v.values.length) return null;
      return { group: v.group, values: v.values, filters, totals: true, limit: 1000 };
    case "column":
      if (!v.group.length || !v.values.length) return null;
      return {
        group: v.group.slice(0, 1), values: v.values, filters,
        order_by: [{ index: 1, desc: true }], limit: COLUMN_CHART_LIMIT,
      };
    case "card":
      if (!v.values.length) return null;
      return { group: [], values: v.values.slice(0, 1), filters, limit: 1 };
  }
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
