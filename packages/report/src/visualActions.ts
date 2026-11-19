import type { ReportPage, Visual } from "@floem/client";

export type ResolvedVisualAction =
  | { type: "page"; pageId: string }
  | { type: "reset" }
  | { type: "toggle"; visualId: string }
  | null;

/** Rapor içindeki tıklama olayını yalnızca mevcut sayfa/nesnelere çözer. */
export function resolveVisualAction(visual: Visual, pages: ReportPage[], currentPageId: string): ResolvedVisualAction {
  const action = visual.format.action;
  if (!action || action.type === "none") return null;
  const current = pages.find((page) => page.id === currentPageId);
  if (!current) return null;
  if (action.type === "page") {
    return pages.some((page) => page.id === action.pageId) ? { type: "page", pageId: action.pageId! } : null;
  }
  if (action.type === "next" || action.type === "previous") {
    const index = pages.findIndex((page) => page.id === currentPageId);
    const step = action.type === "next" ? 1 : -1;
    return pages.length > 1 ? { type: "page", pageId: pages[(index + step + pages.length) % pages.length].id } : null;
  }
  if (action.type === "reset") return { type: "reset" };
  if (action.type === "toggle" && action.visualId && action.visualId !== visual.id &&
      current.visuals.some((target) => target.id === action.visualId)) {
    return { type: "toggle", visualId: action.visualId };
  }
  return null;
}

export function visualIsVisible(visual: Visual, overrides: Record<string, boolean>): boolean {
  return overrides[visual.id] ?? !visual.format.initiallyHidden;
}
