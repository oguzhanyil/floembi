import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

type Zoom = "fit" | "width" | number;
export function canvasScale(zoom: Zoom, box: { w: number; h: number }, width: number, height: number) {
  if (typeof zoom === "number") return Math.max(0.1, Math.min(4, zoom));
  if (!box.w || !box.h) return 1;
  const x = Math.max(1, box.w - 32) / Math.max(1, width);
  const y = Math.max(1, box.h - 32) / Math.max(1, height);
  return Math.max(0.01, Math.min(4, zoom === "width" ? x : Math.min(x, y)));
}

/** Yakınlaştırma yalnız görünümü değiştirir; kayıtlı rapor koordinatlarını değiştirmez. */
export function ReportViewport({ width, height, children, banner, onBackground }: {
  width: number; height: number; children: (scale: number) => ReactNode;
  banner?: ReactNode; onBackground?: () => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<Zoom>("fit");
  const before = useRef({ scale: 1, width, height });
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const resize = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    return () => observer.disconnect();
  }, []);
  const scale = canvasScale(zoom, box, width, height);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const previous = before.current;
    if (previous.width !== width || previous.height !== height || zoom === "fit") {
      el.scrollTo(0, 0);
    } else if (previous.scale !== scale) {
      const ratio = scale / previous.scale;
      el.scrollLeft = (el.scrollLeft + el.clientWidth / 2) * ratio - el.clientWidth / 2;
      el.scrollTop = (el.scrollTop + el.clientHeight / 2) * ratio - el.clientHeight / 2;
    }
    before.current = { scale, width, height };
  }, [scale, width, height, zoom]);
  const change = (delta: number) => setZoom(Math.max(0.1, Math.min(4, Math.round((scale + delta) * 100) / 100)));
  return <div className="report-viewport" onKeyDown={(e) => {
    if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).matches("input, textarea, select, [contenteditable=true]")) return;
    if (["+", "=", "-", "0"].includes(e.key)) {
      e.preventDefault();
      if (e.key === "0") setZoom(1); else change(e.key === "-" ? -0.1 : 0.1);
    }
  }}>
    {banner}
    <div className="report-scroll" ref={scroll} tabIndex={0} aria-label="Rapor tuvali" onPointerDown={(e) => {
      const target = e.target as HTMLElement;
      if (target === e.currentTarget || target.classList.contains("report-scroll-space") || target.classList.contains("page")) onBackground?.();
    }}>
      <div className="report-scroll-space" style={{ width: width * scale + 32, height: height * scale + 32 }}>
        {children(scale)}
      </div>
    </div>
    <div className="canvas-zoom" role="group" aria-label="Tuval görünümü">
      <select aria-label="Tuval ölçeği" value={typeof zoom === "number" ? "manual" : zoom}
        onChange={(e) => setZoom(e.target.value === "actual" ? 1 : e.target.value === "width" ? "width" : "fit")}>
        <option value="fit">Sayfaya sığdır</option><option value="width">Genişliğe sığdır</option><option value="actual">%100</option>
        {typeof zoom === "number" && <option value="manual">Özel ölçek</option>}
      </select>
      <button type="button" onClick={() => change(-0.1)} disabled={scale <= 0.1} aria-label="Uzaklaştır">−</button>
      <output aria-live="polite">%{Math.round(scale * 100)}</output>
      <button type="button" onClick={() => change(0.1)} disabled={scale >= 4} aria-label="Yakınlaştır">+</button>
      <button type="button" onClick={() => setZoom(1)} title="Gerçek boyut (Ctrl+0)">%100</button>
    </div>
  </div>;
}
