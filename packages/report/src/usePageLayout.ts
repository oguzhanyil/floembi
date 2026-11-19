import type { ReportPage } from "@floem/client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { resolvePageLayout } from "./layout";

/** DOM'un gerçek, ölçeklenmemiş metin yüksekliğini iki görüntüleyicide de kullanır. */
export function usePageLayout(page: ReportPage, visibilityKey = "", viewKey = page.id) {
  const root = useRef<HTMLDivElement>(null);
  const [measurements, setMeasurements] = useState<{ page: string; heights: Record<string, number> }>({ page: viewKey, heights: {} });
  const heights = measurements.page === viewKey ? measurements.heights : {};
  const layout = useMemo(() => resolvePageLayout(page, heights), [page, heights]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const ids = new Set(page.visuals.filter((v) => v.type === "text" && v.format.textOverflow === "grow").map((v) => v.id));
    const observer = new ResizeObserver((entries) => {
      setMeasurements((before) => {
        const next = before.page === viewKey ? { ...before.heights } : {};
        let changed = before.page !== viewKey;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.visualId!;
          const h = entry.borderBoxSize[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight;
          if (h > 0 && Math.abs((next[id] ?? 0) - h) > .5) { next[id] = h; changed = true; }
        }
        return changed ? { page: viewKey, heights: next } : before;
      });
    });
    for (const node of element.querySelectorAll<HTMLElement>("[data-visual-id]")) if (ids.has(node.dataset.visualId!)) observer.observe(node);
    return () => observer.disconnect();
  }, [viewKey, page.visuals, visibilityKey]);
  return { ...layout, root };
}
