import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { formWidthMm } from "@floem/client";
import { limit } from "./FormObjectProperties";

export function FormSheet({ children, rulers, guides, onGuides }: {
  children: ReactNode; rulers: boolean; guides: number[]; onGuides: (guides: number[]) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1), [height, setHeight] = useState(297);
  const [drag, setDrag] = useState<{ index: number; x: number } | null>(null);
  useEffect(() => {
    const frame = viewport.current, page = body.current;
    if (!frame || !page) return;
    const measure = () => {
      if (!frame.isConnected) return;
      setZoom(Math.min(1.3, Math.max(.25, (frame.clientWidth - 24) / (210 * 96 / 25.4))));
      setHeight(Math.ceil(page.offsetHeight * 25.4 / 96));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(frame); observer.observe(page); measure();
    return () => observer.disconnect();
  }, []);
  const visible = guides.map((x, i) => drag?.index === i ? drag.x : x);
  const coordinate = (e: PointerEvent<HTMLDivElement>) => {
    const bounds = e.currentTarget.getBoundingClientRect();
    return limit((e.clientX - bounds.left) * formWidthMm / bounds.width, 0, formWidthMm);
  };
  return <div className="print-paper-scroll" ref={viewport}><article className="print-paper form-sheet" style={{ zoom }}>
    <div className="form-sheet-body" ref={body}>
      {rulers && <>
        <span className="form-unit">mm</span>
        <div className="form-ruler horizontal" aria-label="Yatay cetvel" title="Kılavuz eklemek için tıklayın. Taşımak için işareti sürükleyin."
          onPointerDown={e => {
            if (e.button !== 0) return;
            const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-guide]");
            handle?.focus({ preventScroll: true });
            const index = handle?.dataset.guide;
            if (index === undefined && guides.length >= 40) return;
            setDrag({ index: index === undefined ? -1 : Number(index), x: coordinate(e) }); e.currentTarget.setPointerCapture(e.pointerId);
          }} onPointerMove={e => { if (drag) setDrag({ ...drag, x: coordinate(e) }); }}
          onPointerUp={e => {
            if (!drag) return;
            const x = coordinate(e), next = [...guides];
            if (drag.index < 0) next.push(x); else next[drag.index] = x;
            onGuides([...new Set(next)]); setDrag(null);
          }} onPointerCancel={() => setDrag(null)} onLostPointerCapture={() => setDrag(null)}>
          {Array.from({ length: 19 }, (_, i) => <span key={i} style={{ left: i * 10 + "mm" }}>{i * 10}</span>)}
          {visible.map((x, i) => <button type="button" key={i} className="form-guide-handle" data-guide={i} style={{ left: x + "mm" }}
            aria-label={`Kılavuz ${x} mm`} title="Silmek için Delete tuşuna basın" onKeyDown={e => {
              if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onGuides(guides.filter((_, j) => i !== j)); }
            }}>▾</button>)}
        </div>
        <div className="form-ruler vertical" aria-label="Dikey cetvel">{Array.from({ length: Math.ceil(height / 10) }, (_, i) =>
          <span key={i} style={{ top: i * 10 + "mm" }}>{i * 10}</span>)}</div>
        {visible.map((x, i) => <i key={i} className="form-guide-line" style={{ left: x + "mm" }} />)}
      </>}
      {children}
    </div>
  </article></div>;
}
