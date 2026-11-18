import type { FilterRef, ModelColumn, ReportPage, Visual } from "@floem/client";
import {
  DrillThroughButton, VisualBody, crossFiltersFor, drillTargets, slicerFilters, snap, toggleCross, toggleCrossRow, visualTitle,
  type CrossFilter, type DrillTarget, type QueryFn,
} from "@floem/report";
import { useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";

import { FIELD_MIME, readPayload, type FieldPayload } from "./fields";

export { FIELD_MIME };

type Drag = { id: string; mode: "move" | "resize"; sx: number; sy: number; orig: Visual; moved: boolean };

/** Sabit boyutlu rapor sayfası (Power BI'daki 16:9 tuval); görseller taşınır ve boyutlandırılır. */
export function PageCanvas({
  page, selectedId, onSelect, onChange, onDelete, onDropField, onDropOnVisual, dataRev, cross, setCross, columnOf, run,
  pages, pageFilters, onDrillThrough, banner,
}: {
  page: ReportPage;
  /** Detaya git hedeflerini bulmak için tüm sayfalar */
  pages: ReportPage[];
  /** Detay sayfasına gelinmişse, gelinen değerin filtreleri */
  pageFilters: FilterRef[];
  onDrillThrough: (t: DrillTarget) => void;
  banner?: ReactNode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (v: Visual) => void;
  onDelete: (id: string) => void;
  onDropField: (field: FieldPayload, x: number, y: number) => void;
  onDropOnVisual: (visualId: string, field: FieldPayload) => void;
  dataRev: string;
  cross: CrossFilter | null;
  setCross: (c: CrossFilter | null) => void;
  columnOf: (table: string, column: string) => ModelColumn | undefined;
  run: QueryFn;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropHover, setDropHover] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = box.w ? Math.max(0.2, Math.min((box.w - 32) / page.width, (box.h - 32) / page.height)) : 1;

  function start(e: RPointerEvent, v: Visual, mode: Drag["mode"]) {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(v.id);
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* işaretçi yakalanamazsa (dokunmatik/test olayları) sürükleme yine de çalışır */
    }
    setDrag({ id: v.id, mode, sx: e.clientX, sy: e.clientY, orig: v, moved: false });
  }

  function move(e: RPointerEvent) {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / scale;
    const dy = (e.clientY - drag.sy) / scale;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    const o = drag.orig;
    const next =
      drag.mode === "move"
        ? {
            ...o,
            x: Math.max(0, Math.min(page.width - o.w, snap(o.x + dx))),
            y: Math.max(0, Math.min(page.height - o.h, snap(o.y + dy))),
          }
        : {
            ...o,
            w: Math.max(120, Math.min(page.width - o.x, snap(o.w + dx))),
            h: Math.max(80, Math.min(page.height - o.y, snap(o.h + dy))),
          };
    if (!drag.moved) setDrag({ ...drag, moved: true });
    onChange(next);
  }

  const readField = readPayload;


  return (
    <div className="page-outer" ref={outer} onPointerDown={() => { onSelect(null); setCross(null); }}>
      {banner}
      <div
        className="page"
        style={{ width: page.width * scale, height: page.height * scale }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(FIELD_MIME)) e.preventDefault();
        }}
        onDrop={(e) => {
          const f = readField(e);
          if (!f) return;
          e.preventDefault();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onDropField(f, (e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
        }}
      >
        {page.visuals.length === 0 && (
          <div className="page-hint">
            Sağdaki <strong>Veri</strong> bölmesinden bir alanı buraya sürükleyin ya da işaretleyin,
            <br />
            veya <strong>Görselleştirmeler</strong> bölmesinden bir görsel seçin.
          </div>
        )}
        {page.visuals.map((v) => {
          const selected = v.id === selectedId;
          const title = visualTitle(v);
          return (
            <div
              key={v.id}
              className={`visual ${selected ? "selected" : ""} ${dropHover === v.id ? "drop" : ""}`}
              style={{ left: v.x * scale, top: v.y * scale, width: v.w * scale, height: v.h * scale }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(v.id);
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(FIELD_MIME)) return;
                e.preventDefault();
                e.stopPropagation();
                if (dropHover !== v.id) setDropHover(v.id);
              }}
              onDragLeave={() => setDropHover(null)}
              onDrop={(e) => {
                const f = readField(e);
                setDropHover(null);
                if (!f) return;
                e.preventDefault();
                e.stopPropagation();
                onDropOnVisual(v.id, f);
              }}
            >
              <div
                className="visual-head"
                onPointerDown={(e) => start(e, v, "move")}
                onPointerMove={move}
                onPointerUp={() => setDrag(null)}
                title="Taşımak için sürükleyin"
              >
                <span className="visual-title">{title}</span>
                <DrillThroughButton targets={drillTargets(pages, page.id, v, cross)} onGo={onDrillThrough} />
                <button
                  className="visual-del"
                  aria-label="Görseli sil"
                  title="Görseli sil (Delete)"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onDelete(v.id)}
                >
                  ✕
                </button>
              </div>
              <div className="visual-content">
                <VisualBody
                  v={v}
                  extra={[...pageFilters, ...crossFiltersFor(v, cross), ...slicerFilters(page.visuals, {}, v.id)]}
                  detailReady={pageFilters.length > 0 || (!!cross && cross.visualId !== v.id)}
                  onCrossRow={(row) => setCross(toggleCrossRow(v, cross, row))}
                  dataRev={dataRev}
                  cross={cross}
                  onCross={(value) => setCross(toggleCross(v, cross, value))}
                  run={run}
                  state={v.state}
                  onState={(state) => onChange({ ...v, state })}
                  fieldType={v.group[0] ? columnOf(v.group[0].table, v.group[0].column)?.tip : undefined}
                />
              </div>
              {selected && (
                <div
                  className="visual-resize"
                  onPointerDown={(e) => start(e, v, "resize")}
                  onPointerMove={move}
                  onPointerUp={() => setDrag(null)}
                  title="Boyutlandır"
                />
              )}
              {v.values.some((x) => !("measure" in x) && !columnOf(x.table, x.column)) ||
              v.group.some((g) => !columnOf(g.table, g.column)) ? (
                <div className="visual-broken">Bu görseldeki bir alan modelde artık yok</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
