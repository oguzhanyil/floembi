import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ReportPage, ThemeSnapshot } from "@floem/client";
import { initialZoom, pageBaseColor, transparentColor } from "./pageAppearance";

type Zoom = "fit" | "width" | number;
export function canvasScale(zoom: Zoom, box: { w: number; h: number }, width: number, height: number) {
  if (typeof zoom === "number") return Math.max(0.1, Math.min(4, zoom));
  if (!box.w || !box.h) return 1;
  const x = Math.max(1, box.w - 32) / Math.max(1, width);
  const y = Math.max(1, box.h - 32) / Math.max(1, height);
  return Math.max(0.01, Math.min(4, zoom === "width" ? x : Math.min(x, y)));
}

/** Yakınlaştırma yalnız görünümü değiştirir; kayıtlı rapor koordinatlarını değiştirmez. */
export function ReportViewport({ width, height, children, banner, onBackground, page, theme, viewKey, tools }: {
  width: number; height: number; children: (scale: number) => ReactNode;
  banner?: ReactNode; onBackground?: () => void;
  page?: ReportPage; theme?: ThemeSnapshot | null; viewKey?: string;
  tools?: ReactNode;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zooms, setZooms] = useState<Record<string, { initial: string; zoom: Zoom }>>({});
  const key = viewKey ?? page?.id ?? "canvas", option = page?.displayOption ?? "FitToPage";
  const zoom = zooms[key]?.initial === option ? zooms[key].zoom : initialZoom(option);
  const setZoom = (value: Zoom) => setZooms((old) => ({ ...old, [key]: { initial: option, zoom: value } }));
  const before = useRef({ scale: 1, width, height, key, option });
  useLayoutEffect(() => {
    setZooms((old) => {
      if (!old[key] || old[key].initial === option) return old;
      const next = { ...old }; delete next[key]; return next;
    });
  }, [key, option]);
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
    if (previous.key !== key || previous.option !== option || previous.width !== width || previous.height !== height || zoom === "fit") {
      el.scrollTo(0, 0);
    } else if (previous.scale !== scale) {
      const ratio = scale / previous.scale;
      el.scrollLeft = (el.scrollLeft + el.clientWidth / 2) * ratio - el.clientWidth / 2;
      el.scrollTop = (el.scrollTop + el.clientHeight / 2) * ratio - el.clientHeight / 2;
    }
    before.current = { scale, width, height, key, option };
  }, [scale, width, height, zoom, key, option]);
  const change = (delta: number) => setZoom(Math.max(0.1, Math.min(4, Math.round((scale + delta) * 100) / 100)));
  return <div className="report-viewport" style={{ gridTemplateRows: `${banner ? "auto " : ""}minmax(0, 1fr) auto` }} onKeyDown={(e) => {
    if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).matches("input, textarea, select, [contenteditable=true]")) return;
    if (["+", "=", "-", "0"].includes(e.key)) {
      e.preventDefault();
      if (e.key === "0") setZoom(1); else change(e.key === "-" ? -0.1 : 0.1);
    }
  }}>
    {banner}
    <div className="report-scroll" ref={scroll} tabIndex={0} aria-label="Rapor tuvali" style={{ backgroundColor: "var(--bg, #e9e8e6)" }} onPointerDown={(e) => {
      const target = e.target as HTMLElement;
      if (target === e.currentTarget || target.classList.contains("report-scroll-space") || target.classList.contains("page")) onBackground?.();
    }}>
      <div className="report-scroll-space" style={{ width: width * scale + 32, height: height * scale + 32, backgroundColor: page?.outspaceColor ? transparentColor(page.outspaceColor, page.outspaceTransparency) : undefined }}>
        <div className="report-page-backdrop" style={{ width: width * scale, height: height * scale, backgroundColor: pageBaseColor(theme) }}>{children(scale)}</div>
      </div>
    </div>
    <div className="canvas-zoom" role="group" aria-label="Tuval görünümü">
      {tools}
      <select aria-label="Tuval ölçeği" value={zoom === 1 ? "actual" : typeof zoom === "number" ? "manual" : zoom}
        onChange={(e) => { if (e.target.value !== "manual") setZoom(e.target.value === "actual" ? 1 : e.target.value === "width" ? "width" : "fit"); }}>
        <option value="fit">Sayfaya sığdır</option><option value="width">Genişliğe sığdır</option><option value="actual">%100</option>
        {typeof zoom === "number" && <option value="manual">Özel ölçek</option>}
      </select>
      <button type="button" onClick={() => change(-0.1)} disabled={scale <= 0.1} aria-label="Uzaklaştır">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 6 6M7.5 10.5h6" /></svg>
      </button>
      <output aria-live="polite">%{Math.round(scale * 100)}</output>
      <button type="button" onClick={() => change(0.1)} disabled={scale >= 4} aria-label="Yakınlaştır">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 6 6M7.5 10.5h6M10.5 7.5v6" /></svg>
      </button>
      <button type="button" onClick={() => setZoom(1)} title="Gerçek boyut (Ctrl+0)">%100</button>
    </div>
  </div>;
}
