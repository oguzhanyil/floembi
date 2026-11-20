import { createContext, useContext, useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import type { VisualResult } from "@floem/client";

/** Yalnız durum/sayı bilgisi. Kayıtlar, filtre değerleri ve hata ayrıntıları taşınmaz. */
export interface QueryDiagnostic {
  source: "Görsel sorgusu" | "Matris sorguları" | "Sunucu sayfası" | "Veri bağı";
  status: "loading" | "ready" | "empty" | "error";
  rows?: number;
  limit?: number;
  truncated?: boolean;
  paged?: boolean;
  totalRows?: number;
  totalScope?: string;
}
export interface VisualDiagnostic extends QueryDiagnostic { visualId: string }
type Publish = (scope: string, token: string, value?: VisualDiagnostic) => void;
const Collector = createContext<{ scope: string; ids: Set<string>; publish: Publish } | null>(null);
const VisualScope = createContext<string | undefined>(undefined);

export function DiagnosticProvider({ scope, ids, onChange, children }: { scope: string; ids: string[]; onChange: (value: { scope: string; items: VisualDiagnostic[] }) => void; children: ReactNode }) {
  const latest = useRef(onChange); latest.current = onChange;
  const records = useRef({ scope, items: new Map<string, VisualDiagnostic>() });
  if (records.current.scope !== scope) records.current = { scope, items: new Map() };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const publish = useMemo<Publish>(() => (key, token, value) => {
    if (key !== records.current.scope) return;
    const map = records.current.items;
    if (JSON.stringify(map.get(token)) === JSON.stringify(value)) return;
    if (value) map.set(token, value); else map.delete(token);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => latest.current({ scope: records.current.scope, items: [...records.current.items.values()] }), 80);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const idKey = JSON.stringify(ids);
  const value = useMemo(() => ({ scope, ids: new Set(ids), publish }), [scope, idKey, publish]);
  return <Collector.Provider value={value}>{children}</Collector.Provider>;
}

export function DiagnosticVisual({ id, children }: { id: string; children: ReactNode }) {
  const collector = useContext(Collector), inherited = useContext(VisualScope);
  // Satır şablonunun iç nesneleri rapordaki tekrarlayıcıya aittir.
  return <VisualScope.Provider value={inherited ?? (collector?.ids.has(id) ? id : undefined)}>{children}</VisualScope.Provider>;
}

export function useQueryDiagnostic(key: string, sample?: QueryDiagnostic, explicitId?: string) {
  const ctx = useContext(Collector), inherited = useContext(VisualScope), token = useId();
  const id = inherited ?? (explicitId && ctx?.ids.has(explicitId) ? explicitId : undefined);
  const signature = ctx ? JSON.stringify(sample) : "";
  useEffect(() => {
    if (!ctx || !id || !key || !sample) return;
    ctx.publish(ctx.scope, token, { ...sample, visualId: id });
    return () => ctx.publish(ctx.scope, token);
  }, [ctx, id, key, signature, token]);
}

export function resultDiagnostic(result: VisualResult, source: QueryDiagnostic["source"], limit?: number): QueryDiagnostic {
  return { source, status: result.rows.length ? "ready" : "empty", rows: result.rows.length, limit,
    truncated: result.truncated, paged: !!result.page, totalRows: result.page?.totalRows, totalScope: result.page?.totalScope };
}
