import type { ContainerLayout, ReportPage, Visual } from "@floem/client";

export type Rect = { x: number; y: number; w: number; h: number };
export const containerDefaults: Required<ContainerLayout> = { kind: "frame", mode: "free", padding: 16, gap: 12,
  columns: 2, align: "stretch", justify: "start", wrap: true, autoHeight: false, overflow: "visible" };
export const containerOptions = (v: Visual): Required<ContainerLayout> => ({ ...containerDefaults, ...v.container });
const finite = (n: number | undefined, fallback: number) => Number.isFinite(n) ? n! : fallback;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const bounds = (v: Visual, axis: "Width" | "Height") => [finite(v.layoutItem?.[`min${axis}`], axis === "Width" ? 40 : 28), finite(v.layoutItem?.[`max${axis}`], 20000)];
const size = (v: Visual, n: number, axis: "Width" | "Height") => { const [a, b] = bounds(v, axis); return clamp(n, a, Math.max(a, b)); };

export function ancestors(page: ReportPage, id: string): Visual[] {
  const result: Visual[] = [], index = new Map(page.visuals.map((v) => [v.id, v]));
  let node = index.get(id);
  const seen = new Set([id]);
  while (node?.parentId && result.length < 16) {
    const parent = index.get(node.parentId);
    if (!parent || seen.has(parent.id)) break;
    result.push(parent); seen.add(parent.id); node = parent;
  }
  return result;
}

export const lockedInLayout = (page: ReportPage, id: string) =>
  [page.visuals.find((v) => v.id === id), ...ancestors(page, id)].some((v) => v?.format.locked);

export function visibleInLayout(page: ReportPage, v: Visual, overrides: Record<string, boolean> = {}): boolean {
  return [v, ...ancestors(page, v.id)].every((node) => overrides[node.id] ?? !node.format.initiallyHidden);
}

export function selectionRoots(page: ReportPage, ids: string[]): Visual[] {
  const chosen = new Set(ids);
  return page.visuals.filter((v) => chosen.has(v.id) && !ancestors(page, v.id).some((p) => chosen.has(p.id)));
}

export function descendants(page: ReportPage, ids: string[]): Set<string> {
  const result = new Set(ids);
  for (let pass = 0; pass < 16; pass++) {
    let changed = false;
    for (const v of page.visuals) if (v.parentId && result.has(v.parentId) && !result.has(v.id)) { result.add(v.id); changed = true; }
    if (!changed) break;
  }
  return result;
}

export function rectUnion(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

type Node = { visual: Visual; children: Node[] };
export interface ResolvedLayout { visuals: Visual[]; overflow: Set<string>; height: number }

/** Saf yerleşim hesabı. Kayıtlı tanımı değiştirmez; Desktop/web aynı sonucu kullanır. */
export function resolvePageLayout(page: ReportPage, intrinsicHeights: Record<string, number> = {}, depthLimit = 16): ResolvedLayout {
  if (page.rootLayout && page.rootLayout.mode !== "free") {
    let id = "__page_layout__";
    while (page.visuals.some((v) => v.id === id)) id += "_";
    const root: Visual = { id, type: "container", x: 0, y: 0, w: page.width, h: page.height,
      group: [], values: [], filters: [], format: {}, container: page.rootLayout };
    const inner = resolvePageLayout({ ...page, rootLayout: undefined,
      visuals: [root, ...page.visuals.map((v) => v.parentId ? v : { ...v, parentId: id })] }, intrinsicHeights, depthLimit + 1);
    const height = inner.visuals[0].h;
    const overflow = new Set(inner.overflow);
    if (overflow.delete(id)) overflow.add(page.id);
    return { height, overflow, visuals: inner.visuals.slice(1).map((v) => {
      if (v.parentId !== id) return v;
      const result = { ...v }; delete result.parentId; return result;
    }) };
  }
  const children = new Map<string | null, Visual[]>();
  for (const v of page.visuals) { const key = v.parentId ?? null; children.set(key, [...(children.get(key) ?? []), v]); }
  const visited = new Set<string>(), overflow = new Set<string>();
  function grow(nodes: Node[], space: number, axis: "Width" | "Height", depth: number) {
    const key = axis === "Width" ? "w" : "h";
    let active = nodes.map((node, index) => ({ node, index })).filter(({ node }) => (node.visual.layoutItem?.grow ?? 0) > 0);
    for (let pass = 0; pass < nodes.length && space > .01 && active.length; pass++) {
      const weight = active.reduce((n, { node }) => n + node.visual.layoutItem!.grow!, 0);
      let used = 0;
      const next: typeof active = [];
      for (const { node, index } of active) {
        const previous = node.visual[key], wanted = previous + space * node.visual.layoutItem!.grow! / weight;
        const updated = solveAgain(node, key === "w" ? wanted : node.visual.w, key === "h" ? wanted : undefined, depth);
        nodes[index] = updated; used += Math.max(0, updated.visual[key] - previous);
        if (updated.visual[key] < bounds(updated.visual, axis)[1] - .01) next.push({ node: updated, index });
      }
      if (used < .01) break;
      space = Math.max(0, space - used); active = next;
    }
    return nodes;
  }
  function solve(raw: Visual, forcedW?: number, forcedH?: number, depth = 0): Node {
    const v = { ...raw, w: forcedW === undefined ? raw.w : size(raw, forcedW, "Width"),
      h: forcedH === undefined ? raw.h : size(raw, forcedH, "Height") };
    if (v.type === "text" && v.format.textOverflow === "grow") v.h = size(v, Math.max(v.h, intrinsicHeights[v.id] ?? v.h), "Height");
    if (depth > depthLimit || visited.has(v.id)) return { visual: v, children: [] };
    visited.add(v.id);
    if (v.type !== "container") return { visual: v, children: [] };
    const o = containerOptions(v), pad = o.mode === "free" ? 0 : o.padding;
    const innerW = Math.max(1, v.w - pad * 2), innerH = Math.max(1, v.h - pad * 2);
    const input = children.get(v.id) ?? [];
    let nodes: Node[] = [];
    const offset = (space: number, count: number) => ({ start: o.justify === "center" ? space / 2 : o.justify === "end" ? space : 0,
      gap: o.gap + (o.justify === "space-between" && count > 1 ? space / (count - 1) : 0) });
    const cross = (available: number, actual: number) => o.align === "center" ? (available - actual) / 2 : o.align === "end" ? available - actual : 0;
    if (o.mode === "free") {
      nodes = input.map((child) => solve(child, undefined, undefined, depth + 1));
    } else if (o.mode === "vertical") {
      nodes = input.map((child) => solve(child, o.align === "stretch" ? innerW : Math.min(child.w, innerW), undefined, depth + 1));
      const total = nodes.reduce((n, node) => n + node.visual.h, 0) + Math.max(0, nodes.length - 1) * o.gap;
      let extra = o.autoHeight ? 0 : Math.max(0, innerH - total);
      nodes = grow(nodes, extra, "Height", depth + 1);
      extra = Math.max(0, innerH - nodes.reduce((n, node) => n + node.visual.h, 0) - Math.max(0, nodes.length - 1) * o.gap);
      const spacing = offset(o.autoHeight ? 0 : extra, nodes.length);
      let y = pad + spacing.start;
      for (const node of nodes) { Object.assign(node.visual, { x: pad + cross(innerW, node.visual.w), y }); y += node.visual.h + spacing.gap; }
    } else {
      const rows: Node[][] = [];
      let row: Node[] = [], used = 0;
      const columns = Math.max(1, Math.min(12, o.columns));
      const gridW = (innerW - (columns - 1) * o.gap) / columns;
      for (const child of input) {
        const w = o.mode === "grid" ? (o.align === "stretch" ? gridW : Math.min(gridW, child.w)) : Math.min(child.w, innerW);
        const node = solve(child, w, undefined, depth + 1);
        if (row.length && (o.mode === "grid" ? row.length >= columns : o.wrap && used + o.gap + node.visual.w > innerW)) {
          rows.push(row); row = []; used = 0;
        }
        used += (row.length ? o.gap : 0) + node.visual.w; row.push(node);
      }
      if (row.length) rows.push(row);
      let y = pad;
      for (const current of rows) {
        const natural = current.reduce((n, node) => n + node.visual.w, 0) + Math.max(0, current.length - 1) * o.gap;
        if (o.mode !== "grid") grow(current, Math.max(0, innerW - natural), "Width", depth + 1);
        const height = o.mode === "horizontal" && rows.length === 1 && !o.autoHeight ? Math.max(innerH, ...current.map((n) => n.visual.h)) : Math.max(...current.map((n) => n.visual.h));
        const free = Math.max(0, innerW - current.reduce((n, n2) => n + n2.visual.w, 0) - Math.max(0, current.length - 1) * o.gap);
        const spacing = o.mode === "grid" ? { start: 0, gap: o.gap } : offset(free, current.length);
        let x = pad + spacing.start;
        for (let i = 0; i < current.length; i++) {
          let node = current[i];
          if (o.align === "stretch" && node.visual.h < height) node = solveAgain(node, node.visual.w, height, depth + 1);
          Object.assign(node.visual, { x: o.mode === "grid" ? pad + i * (gridW + o.gap) + cross(gridW, node.visual.w) : x,
            y: y + cross(height, node.visual.h) });
          x += node.visual.w + spacing.gap; nodes.push(node);
        }
        y += height + o.gap;
      }
    }
    const maxY = Math.max(0, ...nodes.map((n) => n.visual.y + n.visual.h));
    if (o.autoHeight) v.h = size(v, Math.max(v.h, maxY + pad), "Height");
    if (nodes.some(({ visual: c }) => c.x < 0 || c.y < 0 || c.x + c.w > v.w + .5 || c.y + c.h > v.h + .5)) overflow.add(v.id);
    return { visual: v, children: nodes };
  }
  function solveAgain(node: Node, w?: number, h?: number, depth = 0): Node {
    const clear = (n: Node) => { visited.delete(n.visual.id); n.children.forEach(clear); };
    clear(node);
    return solve(page.visuals.find((v) => v.id === node.visual.id)!, w, h, depth);
  }
  const roots = (children.get(null) ?? []).map((v) => solve(v));
  const result: Visual[] = [];
  function flatten(node: Node, x = 0, y = 0) {
    const visual = { ...node.visual, x: x + node.visual.x, y: y + node.visual.y };
    result.push(visual); node.children.forEach((child) => flatten(child, visual.x, visual.y));
  }
  roots.forEach((root) => flatten(root));
  return { visuals: result, overflow, height: page.height };
}

/** Düz çizim ağacında kapsayıcı gizleme/kırpma ve opaklık mirası. */
export function inheritedLayoutStyle(page: ReportPage, v: Visual, resolved: Visual[]): { opacity?: number; clipPath?: string } {
  const parents = ancestors(page, v.id);
  const result: { opacity?: number; clipPath?: string } = {};
  if (parents.length) result.opacity = [v, ...parents].reduce((n, p) => n * (p.format.opacity ?? 1), 1);
  let left = v.x, top = v.y, right = v.x + v.w, bottom = v.y + v.h;
  let clipped = false;
  for (const parent of parents) if (containerOptions(parent).overflow === "clip") {
    const p = resolved.find((node) => node.id === parent.id);
    if (p) { left = Math.max(left, p.x); top = Math.max(top, p.y); right = Math.min(right, p.x + p.w); bottom = Math.min(bottom, p.y + p.h); clipped = true; }
  }
  if (clipped) result.clipPath = `inset(${Math.max(0, top - v.y)}px ${Math.max(0, v.x + v.w - right)}px ${Math.max(0, v.y + v.h - bottom)}px ${Math.max(0, left - v.x)}px)`;
  return result;
}
