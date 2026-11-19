import type { ReportPage, Visual } from "@floem/client";
import { ancestors, containerOptions, descendants, lockedInLayout, rectUnion, resolvePageLayout, selectionRoots, type Rect } from "../../report/src/layout";

const idFor = (used: Set<string>) => { let i = 1; while (used.has(`v${i}`)) i++; const id = `v${i}`; used.add(id); return id; };
const storedHeight = (v: Visual, resolved: Visual) => v.type === "text" && v.format.textOverflow === "grow" || v.type === "container" && containerOptions(v).autoHeight ? v.h : resolved.h;
export const canGroup = (page: ReportPage, ids: string[]) => {
  const nodes = selectionRoots(page, ids);
  const chosen = descendants(page, nodes.map((v) => v.id));
  return nodes.length > 1 && nodes.every((v) => !lockedInLayout(page, v.id) && (v.parentId ?? null) === (nodes[0].parentId ?? null))
    && page.visuals.every((v) => !chosen.has(v.id) || ancestors(page, v.id).length < 15);
};

export function groupSelection(page: ReportPage, ids: string[], frame = false, allIds = new Set(page.visuals.map((v) => v.id)), resolved = resolvePageLayout(page).visuals): { page: ReportPage; id: string | null } {
  if (!canGroup(page, ids)) return { page, id: null };
  const nodes = selectionRoots(page, ids);
  const box = rectUnion(nodes.map((v) => resolved.find((r) => r.id === v.id)!))!;
  const parentId = nodes[0].parentId ?? null, parent = resolved.find((v) => v.id === parentId);
  const id = idFor(allIds), chosen = new Set(nodes.map((v) => v.id));
  const pad = frame ? 16 : 0;
  const container: Visual = { id, type: "container", title: frame ? "Kapsayıcı" : "Grup", parentId,
    x: box.x - (parent?.x ?? 0) - pad, y: box.y - (parent?.y ?? 0) - pad, w: box.w + pad * 2, h: box.h + pad * 2,
    container: { kind: frame ? "frame" : "group", mode: "free", padding: frame ? 16 : 0 },
    group: [], values: [], filters: [], format: { showTitle: false, backgroundColor: frame ? "#ffffff" : "transparent", borderWidth: frame ? 1 : 0, padding: 0, shadow: false } };
  const visuals = page.visuals.map((v) => {
    if (!chosen.has(v.id)) return v;
    const r = resolved.find((item) => item.id === v.id)!;
    return { ...v, parentId: id, x: r.x - box.x + pad, y: r.y - box.y + pad, w: r.w, h: storedHeight(v, r) };
  });
  visuals.splice(visuals.findIndex((v) => chosen.has(v.id)), 0, container);
  return { page: { ...page, visuals }, id };
}

export function ungroup(page: ReportPage, id: string, resolved = resolvePageLayout(page).visuals): ReportPage {
  const group = page.visuals.find((v) => v.id === id);
  if (group?.type !== "container" || lockedInLayout(page, id)) return page;
  const parent = resolved.find((v) => v.id === group.parentId);
  return { ...page, visuals: page.visuals.filter((v) => v.id !== id).map((v) => {
    if (v.parentId !== id) return v;
    const r = resolved.find((item) => item.id === v.id)!;
    return { ...v, parentId: group.parentId ?? null, x: r.x - (parent?.x ?? 0), y: r.y - (parent?.y ?? 0), w: r.w, h: storedHeight(v, r) };
  }) };
}

export function reparent(page: ReportPage, ids: string[], parentId: string | null, resolved = resolvePageLayout(page).visuals): ReportPage {
  const nodes = selectionRoots(page, ids);
  const excluded = descendants(page, nodes.map((v) => v.id));
  const parent = page.visuals.find((v) => v.id === parentId);
  if (nodes.some((v) => lockedInLayout(page, v.id)) || parentId && (!parent || parent.type !== "container" || excluded.has(parentId) || lockedInLayout(page, parentId))) return page;
  const parentDepth = parent ? ancestors(page, parent.id).length + 1 : 0;
  if (nodes.some((root) => {
    const subtree = descendants(page, [root.id]), oldDepth = ancestors(page, root.id).length;
    return page.visuals.some((v) => subtree.has(v.id) && parentDepth + ancestors(page, v.id).length - oldDepth > 15);
  })) return page;
  const target = resolved.find((v) => v.id === parentId), chosen = new Set(nodes.map((v) => v.id));
  if (nodes.every((v) => (v.parentId ?? null) === parentId)) return page;
  return { ...page, visuals: page.visuals.map((v) => {
    if (!chosen.has(v.id)) return v;
    const r = resolved.find((item) => item.id === v.id)!;
    return { ...v, parentId, x: r.x - (target?.x ?? 0), y: r.y - (target?.y ?? 0), w: r.w, h: storedHeight(v, r) };
  }) };
}

export function deleteSelection(page: ReportPage, ids: string[]): ReportPage {
  const nodes = selectionRoots(page, ids).filter((v) => !lockedInLayout(page, v.id));
  const removed = descendants(page, nodes.map((v) => v.id));
  return removed.size ? { ...page, visuals: page.visuals.filter((v) => !removed.has(v.id)) } : page;
}

export function duplicateSelection(page: ReportPage, ids: string[], allIds: Set<string>): { page: ReportPage; ids: string[] } {
  const roots = selectionRoots(page, ids), chosen = descendants(page, roots.map((v) => v.id));
  const remap = new Map([...chosen].map((id) => [id, idFor(allIds)])), rootIds = new Set(roots.map((v) => v.id));
  const replaceActions = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(replaceActions);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, key === "visualId" && typeof item === "string" ? remap.get(item) ?? item : replaceActions(item)]));
    return value;
  };
  const copies = page.visuals.filter((v) => chosen.has(v.id)).map((v) => ({ ...structuredClone(v), id: remap.get(v.id)!,
    parentId: v.parentId ? remap.get(v.parentId) ?? v.parentId : null,
    x: v.x + (rootIds.has(v.id) ? 24 : 0), y: v.y + (rootIds.has(v.id) ? 24 : 0),
    format: { ...replaceActions(v.format) as Visual["format"], locked: false } }));
  return { page: { ...page, visuals: [...page.visuals, ...copies] }, ids: roots.map((v) => remap.get(v.id)!) };
}

/** Yerleşim içindeki bir nesnenin grup tutamacını bulur; Ctrl ile doğrudan iç nesne seçilir. */
export function selectionTarget(page: ReportPage, id: string, direct = false): string {
  if (direct) return id;
  return ancestors(page, id).filter((p) => containerOptions(p).kind === "group").at(-1)?.id ?? id;
}

export function transformSelection(page: ReportPage, ids: string[], before: Rect, after: Rect, resize = false, absolute = resolvePageLayout(page).visuals): ReportPage {
  const roots = selectionRoots(page, ids).filter((v) => !lockedInLayout(page, v.id));
  const selected = new Set(roots.map((v) => v.id));
  const scaleRoots = roots.filter((v) => v.type === "container" && containerOptions(v).kind === "group").map((v) => v.id);
  const scaled = resize ? descendants(page, scaleRoots) : new Set<string>();
  const sx = resize ? after.w / Math.max(1, before.w) : 1, sy = resize ? after.h / Math.max(1, before.h) : 1;
  const visuals = page.visuals.map((v) => {
    if (!selected.has(v.id) && !scaled.has(v.id)) return v;
    const r = absolute.find((node) => node.id === v.id)!;
    if (v.parentId && !selected.has(v.id)) return { ...v, x: v.x * sx, y: v.y * sy, w: Math.max(1, v.w * sx), h: Math.max(1, v.h * sy) };
    const parent = absolute.find((node) => node.id === v.parentId);
    if (parent && containerOptions(parent).mode !== "free") return resize ? { ...v, w: Math.max(1, r.w * sx), h: Math.max(1, r.h * sy) } : v;
    return { ...v, x: after.x + (r.x - before.x) * sx - (parent?.x ?? 0),
      y: after.y + (r.y - before.y) * sy - (parent?.y ?? 0), w: resize ? Math.max(1, r.w * sx) : v.w, h: resize ? Math.max(1, r.h * sy) : v.h };
  });
  return visuals.every((v, i) => v === page.visuals[i]) ? page : { ...page, visuals };
}

export function reorderSibling(page: ReportPage, id: string, targetId: string): ReportPage {
  const v = page.visuals.find((node) => node.id === id), target = page.visuals.find((node) => node.id === targetId);
  if (!v || !target || v.id === target.id || (v.parentId ?? null) !== (target.parentId ?? null) || lockedInLayout(page, id)) return page;
  const visuals = [...page.visuals], from = visuals.findIndex((node) => node.id === id), to = visuals.findIndex((node) => node.id === targetId);
  visuals.splice(from, 1); visuals.splice(to, 0, v);
  return { ...page, visuals };
}

export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom" | "horizontal" | "vertical";
export function alignSelection(page: ReportPage, ids: string[], alignment: Alignment, all = resolvePageLayout(page).visuals): ReportPage {
  const roots = selectionRoots(page, ids);
  if (roots.length < 2 || roots.some((v) => lockedInLayout(page, v.id) || v.parentId && containerOptions(page.visuals.find((p) => p.id === v.parentId)!).mode !== "free")) return page;
  const nodes = roots.map((v) => all.find((r) => r.id === v.id)!);
  const box = rectUnion(nodes)!, positions = new Map<string, { x: number; y: number }>();
  if (alignment === "horizontal" || alignment === "vertical") {
    if (nodes.length < 3) return page;
    const axis = alignment === "horizontal" ? "x" : "y", size = axis === "x" ? "w" : "h";
    nodes.sort((a, b) => a[axis] - b[axis]);
    const gap = (box[size] - nodes.reduce((n, v) => n + v[size], 0)) / (nodes.length - 1);
    let at = box[axis];
    for (const v of nodes) { positions.set(v.id, { x: axis === "x" ? at : v.x, y: axis === "y" ? at : v.y }); at += v[size] + gap; }
  } else for (const v of nodes) positions.set(v.id, {
    x: alignment === "left" ? box.x : alignment === "center" ? box.x + (box.w - v.w) / 2 : alignment === "right" ? box.x + box.w - v.w : v.x,
    y: alignment === "top" ? box.y : alignment === "middle" ? box.y + (box.h - v.h) / 2 : alignment === "bottom" ? box.y + box.h - v.h : v.y,
  });
  return { ...page, visuals: page.visuals.map((v) => {
    const next = positions.get(v.id), parent = all.find((p) => p.id === v.parentId);
    return next ? { ...v, x: next.x - (parent?.x ?? 0), y: next.y - (parent?.y ?? 0) } : v;
  }) };
}
