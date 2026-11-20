import type { DataScalar, FilterRef, Visual } from "@floem/client";
import { useEffect, useId, useState } from "react";
import { useRuntimeFeedback } from "./BindingRuntime";
import { useQueryDiagnostic } from "./diagnostics";
import { formatValue as formatScalar } from "./reportUtils";
import type { QueryFn } from "./useVisualData";
import { useVisualExports } from "./VisualContextMenu";
import { traceKey, traceLimits, traceNeighborhood, type TraceResult } from "./lineage";
import "./processVisuals.css";
const formatValue = (value: unknown) => formatScalar(value, undefined);

export function LineageVisual({ v, extra, revision, run }: { v: Visual; extra: FilterRef[]; revision: string; run: QueryFn }) {
  const [choice, setChoice] = useState<{ scope: string; root: DataScalar; history: DataScalar[] }>();
  const [attempt, setAttempt] = useState(0);
  const scope = JSON.stringify([v.group, v.legend, v.values, v.filters, extra, v.format.traceDirection, v.format.traceDepth, v.format.traceNodes, v.format.traceEdges, revision]);
  const selected = choice?.scope === scope ? choice : undefined;
  const key = JSON.stringify([scope, selected?.root, attempt]);
  const [response, setResponse] = useState<{ key: string; status: "loading" | "empty" | "ready" | "error"; root?: DataScalar; result?: TraceResult; message?: string }>();
  const current = response?.key === key ? response : undefined, status = current?.status ?? "loading";
  const feedback = useRuntimeFeedback(status, current?.message, () => setAttempt((n) => n + 1));
  useQueryDiagnostic(key, { source: "Süreç altgrafı", status, rows: current?.result?.edges.length, partial: current?.result?.truncated });
  const marker = useId().replaceAll(":", "");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (v.group.length < 2 || !v.legend?.[0]) return { key, status: "empty" as const, message: "Kaynak/hedef alanlarını ve Kök parti alanını eşleyin." };
      const roots = await run({ group: [v.legend[0]], values: [], filters: [...v.filters, ...extra], limit: 2, page: { offset: 0, size: 2 } });
      if (!alive) throw new Error("Parti incelemesi yenilendi.");
      if (!roots.page?.snapshot) throw new Error("Parti incelemesi için güncel Desktop/web sunucusunu kullanın.");
      if (roots.truncated || roots.rows.length !== 1 || roots.rows[0][0] == null) return { key, status: "empty" as const, message: "Tek bir parti seçin veya parti listesinden İncele ile gelin." };
      const root = selected?.root ?? roots.rows[0][0];
      const result = await traceNeighborhood(v, root, [...v.filters, ...extra], run, () => !alive, roots.page.snapshot);
      return { key, status: "ready" as const, root, result };
    };
    void load().then((next) => { if (alive) setResponse(next); }).catch((e) => { if (alive) setResponse({ key, status: "error", message: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [key, run]);
  const data = current?.result;
  useVisualExports("lineage", v.format, () => data ? { title: v.title || "Parti bağlantıları", columns: data.columns, rows: data.edges.map((e) => e.row), truncated: data.truncated } : null);
  if (status !== "ready") return feedback ?? <div className={`v-trace-status v-trace-${status}`} role={status === "error" ? "alert" : "status"}>
    {status === "loading" ? "Seçili partinin bağlantıları alınıyor…" : current?.message}
    {status === "error" && <button type="button" onClick={() => setAttempt((n) => n + 1)}>Tekrar dene</button>}
  </div>;
  if (!data) return null;
  const levels = [...new Set(data.nodes.map((n) => n.level))].sort((a, b) => a - b), positions = new Map<string, { x: number; y: number }>();
  const width = Math.max(580, levels.length * 190), height = Math.max(280, ...levels.map((level) => data.nodes.filter((n) => n.level === level).length * 90 + 40));
  levels.forEach((level, i) => data.nodes.filter((n) => n.level === level).forEach((n, j) => positions.set(traceKey(n.id), { x: (i + .5) * width / levels.length, y: 45 + j * 90 })));
  const visit = (root: DataScalar) => setChoice({ scope, root, history: [...(selected?.history ?? []), current!.root!].slice(-20) });
  return <div className="v-trace">
    <div className="v-process-tools"><strong>Seçili parti: {data.nodes.find((n) => traceKey(n.id) === traceKey(current?.root ?? null))?.label}</strong>
      <button type="button" disabled={!selected?.history.length} onClick={() => { const history = [...selected!.history], root = history.pop()!; setChoice({ scope, root, history }); }}>Parti geri</button>
      <button type="button" disabled={!selected} onClick={() => setChoice(undefined)}>İlk parti</button></div>
    <p className="v-process-note">{traceLimits(v).depth} adım · {data.nodes.length} tekil düğüm · {data.edges.length} bağlantı. ↻ Yeniden karşılaşılan parti; miktar bağlantıya aittir, üretim toplamı değildir.</p>
    {data.truncated && <p className="v-process-warning" role="status">Sınırlı komşuluk: adım/düğüm/bağlantı sınırı var. Tüm ağın kapsandığı garanti edilmez.</p>}
    <div className="v-trace-scroll"><div className="v-trace-stage" style={{ width, height }}>
      <svg width={width} height={height} aria-label="Parti bağlantı yönleri"><defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0 0 7 3 0 6" fill="currentColor" /></marker></defs>
        {data.edges.map((edge, i) => { const a = positions.get(traceKey(edge.from))!, b = positions.get(traceKey(edge.to))!; const label = `${edge.relation}${edge.amount != null ? ` · ${formatValue(edge.amount)} ${edge.unit}` : ""}`;
          const dx = b.x - a.x, dy = b.y - a.y;
          const inset = 1 / Math.max(Math.abs(dx) / 80, Math.abs(dy) / 26, 1);
          const start = { x: a.x + dx * inset, y: a.y + dy * inset }, end = { x: b.x - dx * inset, y: b.y - dy * inset };
          return <g key={edge.id}><path d={edge.from === edge.to ? `M${a.x - 30} ${a.y - 25}c-70 -45 130 -45 60 0` : `M${start.x} ${start.y} Q${(a.x + b.x) / 2 + (dx === 0 ? 45 : 0)} ${(a.y + b.y) / 2 + (dx === 0 ? 0 : i % 2 ? 12 : -12)} ${end.x} ${end.y}`} fill="none" stroke="currentColor" opacity=".65" markerEnd={`url(#${marker})`} /><title>{label}</title></g>; })}
      </svg>
      {data.nodes.map((node) => { const p = positions.get(traceKey(node.id))!; return <button type="button" className={`v-trace-node ${traceKey(node.id) === traceKey(current?.root ?? null) ? "root" : ""}`} key={traceKey(node.id)}
        style={{ left: p.x - 76, top: p.y - 22 }} title={`${node.label} · ${node.id}`} aria-label={`Partiyi incele: ${node.label}`} onClick={() => visit(node.id)}><span>{node.label}</span>{node.repeated && <span aria-label="Yeniden karşılaşıldı">↻</span>}</button>; })}
    </div></div>
    <details><summary>Bağlantı ayrıntıları · miktarlar toplanmaz</summary><ul>{data.edges.map((e) => <li key={e.id}>{data.nodes.find((n) => n.id === e.from)?.label} → {data.nodes.find((n) => n.id === e.to)?.label} · {e.relation} · {formatValue(e.amount)} {e.unit}</li>)}</ul></details>
    {!data.edges.length && <p role="status">Bu kapsamda bağlantı bulunamadı. Firma/dönem veya yön filtresini kontrol edin.</p>}
  </div>;
}
