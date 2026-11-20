import type { DataScalar, FieldRef, FilterRef, Visual, VisualQuery, VisualResult } from "@floem/client";
import type { QueryFn } from "./useVisualData";
export interface TraceNode { id: DataScalar; label: string; level: number; repeated: boolean }
export interface TraceEdge { id: string; from: DataScalar; to: DataScalar; amount: DataScalar; unit: string; relation: string; row: DataScalar[] }
export interface TraceResult { nodes: TraceNode[]; edges: TraceEdge[]; truncated: boolean; queryCount: number; columns: VisualResult["columns"] }
export const traceLimits = (v: Visual) => ({ depth: clamp(v.format.traceDepth, 1, 4, 2), nodes: clamp(v.format.traceNodes, 5, 100, 40), edges: clamp(v.format.traceEdges, 5, 200, 80) });
function clamp(n: unknown, min: number, max: number, fallback: number) { return typeof n === "number" && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback; }
export const sameTraceField = (a: FieldRef, b: FieldRef) => a.table.toLowerCase() === b.table.toLowerCase() && a.column.toLowerCase() === b.column.toLowerCase();
export const traceKey = (v: DataScalar) => JSON.stringify(v);

/** Her düzeyde yalnız sınırdaki düğümlerin komşuları sorgulanır; yollar çoğaltılmaz. */
export async function traceNeighborhood(v: Visual, root: DataScalar, filters: FilterRef[], run: QueryFn, cancelled: () => boolean = () => false, snapshot?: string): Promise<TraceResult> {
  if (v.group.length < 2 || !v.legend?.[0]) throw new Error("Kaynak, hedef ve kök parti alanlarını eşleyin.");
  const limits = traceLimits(v), nodes = new Map<string, TraceNode>([[traceKey(root), { id: root, label: String(root), level: 0, repeated: false }]]), edges = new Map<string, TraceEdge>();
  const rootField = v.legend[0];
  // Kök alanının seçimi yürüyüş başlangıcıdır. Diğer firma/dönem koşulları korunur.
  // Yetki filtreleri QueryFn'nin sunucu tarafında her sorguya ayrıca uygulanır.
  const context = filters.filter((f) => !sameTraceField(f, rootField));
  let frontier: DataScalar[] = [root], truncated = false, queryCount = 0, columns: VisualResult["columns"] = [];
  const direction = v.format.traceDirection === "upstream" ? [1] : v.format.traceDirection === "downstream" ? [0] : [0, 1];
  for (let depth = 1; depth <= limits.depth && frontier.length; depth++) {
    const next = new Map<string, DataScalar>();
    for (const side of direction) {
      if (cancelled()) throw new Error("Parti incelemesi yenilendi.");
      const q: VisualQuery = { group: v.group, values: v.values.slice(0, 1), filters: [...context, { ...v.group[side], op: "in", values: frontier }],
        limit: limits.edges + 1, order_by: [{ index: 0, desc: false }, { index: 1, desc: false }], page: { offset: 0, size: limits.edges + 1, snapshot } };
      const result = await run(q); queryCount++; columns = result.columns;
      if (cancelled()) throw new Error("Parti incelemesi yenilendi.");
      if (!result.page?.snapshot || snapshot && result.page.snapshot !== snapshot) throw new Error("Veri veya erişim kapsamı değişti; parti incelemesini yeniden açın.");
      snapshot = result.page.snapshot;
      truncated ||= result.truncated || result.page.hasMore;
      for (const row of result.rows) {
        const [from, to] = row;
        if (from == null || to == null) continue;
        const id = JSON.stringify(row.slice(0, v.group.length));
        if (edges.has(id)) continue;
        if (edges.size >= limits.edges) { truncated = true; continue; }
        const missing = [...new Set([traceKey(from), traceKey(to)])].filter((key) => !nodes.has(key));
        if (nodes.size + missing.length > limits.nodes) { truncated = true; continue; }
        const unit = row[4] == null ? "" : String(row[4]), relation = row[5] == null ? "Bağlantı" : String(row[5]);
        edges.set(id, { id, from, to, amount: v.values.length ? row[v.group.length] : null, unit, relation, row });
        for (const [index, nodeId] of [from, to].entries()) {
          const key = traceKey(nodeId), label = String(row[index + 2] ?? nodeId), existing = nodes.get(key);
          if (existing) existing.label = label;
          else { nodes.set(key, { id: nodeId, label, level: side === 1 ? -depth : depth, repeated: false }); next.set(key, nodeId); }
        }
      }
    }
    frontier = [...next.values()];
    // Son düzeyde incelenmeyen bir sınır varsa kullanıcı tam ağ gösterildiğini sanmamalı.
    if (depth === limits.depth && frontier.length) truncated = true;
  }
  // Birleşen yollar ve çevrimler işaretlenir; sıradan zincirin orta düğümü tekrar değildir.
  const incoming = new Map<string, Set<string>>(), outgoing = new Map<string, string[]>();
  for (const e of edges.values()) {
    const from = traceKey(e.from), to = traceKey(e.to);
    incoming.set(to, (incoming.get(to) ?? new Set()).add(from)); outgoing.set(from, [...(outgoing.get(from) ?? []), to]);
  }
  // Yalnız yüklenmiş en çok 100 düğüm üzerinde erişilebilirlik; bütün yollar üretilmez.
  for (const [key, node] of nodes) {
    node.repeated = (incoming.get(key)?.size ?? 0) > 1;
    const pending = [...(outgoing.get(key) ?? [])], seen = new Set<string>();
    while (pending.length) {
      const next = pending.pop()!;
      if (next === key) { node.repeated = true; break; }
      if (seen.has(next)) continue;
      seen.add(next); pending.push(...(outgoing.get(next) ?? []));
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], truncated, queryCount, columns };
}
