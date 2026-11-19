import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";

/** İki sağ panel: geniş ekranda bölünür, dar ekranda tuvalin üstünde çekmece olur. */
export function DesignerPanels({ children }: { children: [ReactNode, ReactNode] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(1200);
  const [total, setTotal] = useState(500);
  const [split, setSplit] = useState(260);
  const drag = useRef<{ kind: "total" | "split"; x: number; value: number } | null>(null);
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(([e]) => setAvailable(e.contentRect.width));
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  const max = available < 1000 ? Math.min(760, available) : Math.max(440, available - 400);
  const width = Math.min(max, Math.max(440, total));
  const first = Math.max(220, Math.min(width - 220, split));
  function start(e: PointerEvent, kind: "total" | "split") {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, x: e.clientX, value: kind === "total" ? width : first };
  }
  function move(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "total") setTotal(Math.max(440, Math.min(max, d.value - e.clientX + d.x)));
    else setSplit(Math.max(220, Math.min(width - 220, d.value + e.clientX - d.x)));
  }
  const handle = (kind: "total" | "split") => <div role="separator" tabIndex={0}
    className={`pane-resizer ${kind}`} aria-orientation="vertical"
    aria-label={kind === "total" ? "Sağ panellerin genişliği" : "Görselleştirmeler panelinin genişliği"}
    aria-valuenow={Math.round(kind === "total" ? width : first)} aria-valuemin={kind === "total" ? Math.min(440, max) : 220}
    aria-valuemax={Math.round(kind === "total" ? max : Math.max(220, width - 220))}
    onPointerDown={(e) => start(e, kind)} onPointerMove={move}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onKeyDown={(e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const delta = e.key === "ArrowLeft" ? -20 : 20;
      if (kind === "total") setTotal(Math.max(440, Math.min(max, width - delta)));
      else setSplit(Math.max(220, Math.min(width - 220, first + delta)));
    }} />;
  return <div ref={ref} className={`designer-panes ${width < 480 ? "stacked" : ""}`}
    style={{ width, "--viz-pane-width": `${first}px` } as CSSProperties}>
    {handle("total")}{children[0]}{handle("split")}{children[1]}
  </div>;
}
