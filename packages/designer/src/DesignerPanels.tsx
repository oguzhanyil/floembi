import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";

/** İki sağ panel: geniş ekranda bölünür, dar ekranda tuvalin üstünde çekmece olur. */
export function DesignerPanels({ children, visualizationsOpen, dataOpen, panelId }: {
  children: [ReactNode, ReactNode]; visualizationsOpen: boolean; dataOpen: boolean; panelId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(1200);
  const [total, setTotal] = useState(500);
  const [split, setSplit] = useState(260);
  const drag = useRef<{ kind: "total" | "split"; x: number; value: number } | null>(null);
  const bothOpen = visualizationsOpen && dataOpen;
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(([e]) => setAvailable(e.contentRect.width));
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  const minimum = bothOpen ? 440 : 220;
  const max = available < 1000 ? Math.min(760, available) : Math.max(minimum, available - 400);
  const requested = bothOpen ? total : visualizationsOpen ? split : total - split;
  const width = Math.min(max, Math.max(minimum, requested));
  const first = Math.max(220, Math.min(width - 220, split));
  function resizeWidth(value: number) {
    const next = Math.max(minimum, Math.min(max, value));
    if (bothOpen) { setTotal(next); setSplit(Math.min(first, next - 220)); }
    else if (visualizationsOpen) { setTotal(Math.max(220, total - split) + next); setSplit(next); }
    else setTotal(split + next);
  }
  function start(e: PointerEvent, kind: "total" | "split") {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, x: e.clientX, value: kind === "total" ? width : first };
  }
  function move(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "total") resizeWidth(d.value - e.clientX + d.x);
    else setSplit(Math.max(220, Math.min(width - 220, d.value + e.clientX - d.x)));
  }
  const handle = (kind: "total" | "split") => <div role="separator" tabIndex={0}
    className={`pane-resizer ${kind}`} aria-orientation="vertical"
    aria-label={kind === "total" ? "Sağ panellerin genişliği" : "Görselleştirmeler panelinin genişliği"}
    aria-valuenow={Math.round(kind === "total" ? width : first)} aria-valuemin={kind === "total" ? Math.min(minimum, max) : 220}
    aria-valuemax={Math.round(kind === "total" ? max : Math.max(220, width - 220))}
    onPointerDown={(e) => start(e, kind)} onPointerMove={move}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onKeyDown={(e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const delta = e.key === "ArrowLeft" ? -20 : 20;
      if (kind === "total") resizeWidth(width - delta);
      else setSplit(Math.max(220, Math.min(width - 220, first + delta)));
    }} />;
  return <div ref={ref} className={`designer-panes ${bothOpen ? (width < 480 ? "stacked" : "") : "single"}`}
    style={{ width, "--viz-pane-width": `${first}px` } as CSSProperties}>
    {handle("total")}
    <div className="designer-panel-slot" id={`${panelId}-visualizations`} hidden={!visualizationsOpen}>{children[0]}</div>
    {bothOpen && handle("split")}
    <div className="designer-panel-slot" id={`${panelId}-data`} hidden={!dataOpen}>{children[1]}</div>
  </div>;
}
