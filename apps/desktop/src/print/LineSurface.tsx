import { useRef, useState, type PointerEvent } from "react";
import { formWidthMm, type LineShape } from "@floem/client";
import { limit } from "./FormObjectProperties";

type Point = { x: number; y: number };
type Drag<T> = { start: Point; line: T; part: "draw" | "start" | "end" | "move" };
export function LineSurface<T extends LineShape>({ line, drawing, selected, guides, snap, select, commit, width = formWidthMm, editHeight = 60, compact }: {
  line: T; drawing?: boolean; selected?: boolean; guides: number[]; snap: boolean;
  select: () => void; commit: (line: T) => void; width?: number; editHeight?: number; compact?: boolean;
}) {
  const gesture = useRef<Drag<T> | null>(null);
  const [preview, setPreview] = useState<T | null>(null);
  const current = preview ?? line;
  const natural = compact ? Math.max(line.y1, line.y2) + line.thickness / 2 : Math.max(4, Math.max(line.y1, line.y2) + 2);
  const height = drawing || preview ? Math.max(editHeight, natural) : Math.max(.2, natural);
  function point(e: PointerEvent<SVGSVGElement>): Point {
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) * width / box.width;
    const y = (e.clientY - box.top) * height / box.height;
    const nearby = snap ? guides.reduce<number | null>((v, g) => Math.abs(g - x) <= 1.5 && (v === null || Math.abs(g - x) < Math.abs(v - x)) ? g : v, null) : null;
    return { x: limit(nearby ?? (snap ? Math.round(x) : x), 0, width), y: limit(snap ? Math.round(y) : y, 0, 60) };
  }
  function moved(p: Point, g: Drag<T>): T {
    if (g.part === "start") return { ...g.line, x1: p.x, y1: p.y };
    if (g.part === "end" || g.part === "draw") return { ...g.line, x2: p.x, y2: p.y };
    const dx = limit(p.x - g.start.x, -Math.min(g.line.x1, g.line.x2), width - Math.max(g.line.x1, g.line.x2));
    const dy = limit(p.y - g.start.y, -Math.min(g.line.y1, g.line.y2), 60 - Math.max(g.line.y1, g.line.y2));
    return { ...g.line, x1: limit(g.line.x1 + dx, 0, width), x2: limit(g.line.x2 + dx, 0, width),
      y1: limit(g.line.y1 + dy, 0, 60), y2: limit(g.line.y2 + dy, 0, 60) };
  }
  const coords = { x1: current.x1, y1: current.y1, x2: current.x2, y2: current.y2 };
  const reset = () => { gesture.current = null; setPreview(null); };
  return <svg className={"form-line-surface" + (drawing ? " drawing" : "")} role="img" aria-label={drawing ? "Çizgi çizim alanı" : "Şablon çizgisi"}
    style={{ height: height + "mm" }} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
    onPointerDown={e => {
      if (e.button !== 0) return;
      const part = drawing ? "draw" : (e.target as SVGElement).dataset.part as Drag<T>["part"] | undefined;
      if (!part) return;
      const start = point(e); const base = drawing ? { ...line, x1: start.x, y1: start.y, x2: start.x, y2: start.y } : line;
      select(); gesture.current = { start, line: base, part }; setPreview(base); e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={e => { if (gesture.current) setPreview(moved(point(e), gesture.current)); }}
    onPointerUp={e => {
      if (!gesture.current) return;
      const next = moved(point(e), gesture.current);
      if (Math.hypot(next.x2 - next.x1, next.y2 - next.y1) >= .5) commit(next);
      reset();
    }} onPointerCancel={reset} onLostPointerCapture={reset}>
    {drawing && !preview && <text x="4" y="9" fill="#536773" fontSize="3.5">Çizginin başlangıcından bitişine sürükleyin</text>}
    {(!drawing || preview) && <>
      <line {...coords} stroke={current.color} strokeWidth={current.thickness}
        strokeDasharray={current.style === "solid" ? undefined : `${current.thickness * (current.style === "dashed" ? 4 : 1)} ${current.thickness * 2}`} />
      <line {...coords} data-part="move" stroke="transparent" strokeWidth="4" cursor="move" />
      {selected && !drawing && <><circle data-part="start" cx={current.x1} cy={current.y1} r="1.3" />
        <circle data-part="end" cx={current.x2} cy={current.y2} r="1.3" /></>}
    </>}
  </svg>;
}
