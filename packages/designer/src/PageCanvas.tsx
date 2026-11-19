import { ReportThemeScope, themedVisual } from "@floem/report";
import type { ThemeSnapshot } from "@floem/client";
import type { FilterRef, ModelColumn, ReportPage, Visual, VisualAction, VisualState } from "@floem/client";
import {
  DrillThroughButton, VisualBody, crossFiltersFor, drillTargets, slicerFilters, snap, toggleCross, toggleCrossRow, visualTitle,
  visualMotion, visualStyle,
  visualIsVisible, rowActionValue, ReportViewport, VisualContextMenu,
  type ActionValue, type CrossFilter, type DrillTarget, type QueryFn,
} from "@floem/report";
import { useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";

import { FIELD_MIME, readPayload, type FieldPayload } from "./fields";

export { FIELD_MIME };

type Drag = { id: string; mode: "move" | "resize"; sx: number; sy: number; orig: Visual; moved: boolean };

/** Hizalama kılavuzu: dikey (v) çizgi x'te, yatay (h) çizgi y'de; from–to arası çizilir */
type Guide = { o: "v" | "h"; pos: number; from: number; to: number };
type Rect = { x: number; y: number; w: number; h: number };

/** Sayfa birimiyle yapışma mesafesi (ekranda yaklaşık 6–8 px) */
const SNAP = 6;

/**
 * Akıllı kılavuzlar (Power BI'daki gibi): sürüklenen görselin kenarları ve ortası, diğer
 * görsellerin ve sayfanın kenar/orta çizgilerine yaklaşınca oraya yapışır; eşleşen çizgiler
 * kılavuz olarak döner. Taşımada sol/orta/sağ (üst/orta/alt), boyutlandırmada sağ ve alt kenar.
 */
function alignRect(r: Rect, mode: Drag["mode"], others: Rect[], page: { width: number; height: number }) {
  const targets = [{ x: 0, y: 0, w: page.width, h: page.height }, ...others];
  const lines = (t: Rect, axis: "x" | "y") =>
    axis === "x" ? [t.x, t.x + t.w / 2, t.x + t.w] : [t.y, t.y + t.h / 2, t.y + t.h];
  const edges = (q: Rect, axis: "x" | "y") => {
    const [a, m, b] = lines(q, axis);
    return mode === "move" ? [a, m, b] : [b];
  };

  function best(axis: "x" | "y"): number | null {
    let found: number | null = null;
    for (const t of targets) {
      for (const c of lines(t, axis)) {
        for (const e of edges(r, axis)) {
          const d = c - e;
          if (Math.abs(d) <= SNAP && (found === null || Math.abs(d) < Math.abs(found))) found = d;
        }
      }
    }
    return found;
  }

  const dx = best("x");
  const dy = best("y");
  const out = { ...r };
  if (dx !== null) {
    if (mode === "move") out.x += dx;
    else out.w += dx;
  }
  if (dy !== null) {
    if (mode === "move") out.y += dy;
    else out.h += dy;
  }

  // Aynı çizgideki tüm eşleşmeler tek kılavuzda birleşir (çizgi hepsini kapsar)
  const byLine = new Map<string, Guide>();
  const add = (g: Guide) => {
    const k = `${g.o}${g.pos}`;
    const cur = byLine.get(k);
    if (cur) {
      cur.from = Math.min(cur.from, g.from);
      cur.to = Math.max(cur.to, g.to);
    } else byLine.set(k, { ...g });
  };
  for (const t of targets) {
    const isPage = t === targets[0];
    if (dx !== null) {
      for (const c of lines(t, "x")) {
        if (!lines(out, "x").some((e) => Math.abs(e - c) < 0.5)) continue;
        add(isPage
          ? { o: "v", pos: c, from: 0, to: page.height }
          : { o: "v", pos: c, from: Math.min(out.y, t.y), to: Math.max(out.y + out.h, t.y + t.h) });
      }
    }
    if (dy !== null) {
      for (const c of lines(t, "y")) {
        if (!lines(out, "y").some((e) => Math.abs(e - c) < 0.5)) continue;
        add(isPage
          ? { o: "h", pos: c, from: 0, to: page.width }
          : { o: "h", pos: c, from: Math.min(out.x, t.x), to: Math.max(out.x + out.w, t.x + t.w) });
      }
    }
  }
  const guides = [...byLine.values()];
  return { rect: out, snappedX: dx !== null, snappedY: dy !== null, guides };
}

/** Sabit boyutlu rapor sayfası (Power BI'daki 16:9 tuval); görseller taşınır ve boyutlandırılır. */
export function PageCanvas({
  page, selectedId, onSelect, onChange, onDelete, onDropField, onDropOnVisual, dataRev, cross, setCross, columnOf, run,
  pages, pageFilters, onDrillThrough, banner, previewActions, visibleOverrides, previewStates, onPreviewState, onAction,
  onDuplicate, onShiftLayer, onFormat, theme,
}: {
  page: ReportPage;
  theme?: ThemeSnapshot | null;
  previewActions: boolean;
  visibleOverrides: Record<string, boolean>;
  previewStates: Record<string, VisualState>;
  onPreviewState: (id: string, state: VisualState) => void;
  onAction: (visual: Visual, action?: VisualAction, source?: ActionValue) => void;
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
  onDuplicate: (v: Visual) => void;
  onShiftLayer: (id: string, direction: -1 | 1) => void;
  onFormat: (id: string) => void;
  onDropField: (field: FieldPayload, x: number, y: number) => void;
  onDropOnVisual: (visualId: string, field: FieldPayload) => void;
  dataRev: string;
  cross: CrossFilter | null;
  setCross: (c: CrossFilter | null) => void;
  columnOf: (table: string, column: string) => ModelColumn | undefined;
  run: QueryFn;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropHover, setDropHover] = useState<string | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);

  function start(e: RPointerEvent, v: Visual, mode: Drag["mode"]) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (previewActions) return;
    onSelect(v.id);
    if (v.format.locked) return;
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* işaretçi yakalanamazsa (dokunmatik/test olayları) sürükleme yine de çalışır */
    }
    setDrag({ id: v.id, mode, sx: e.clientX, sy: e.clientY, orig: v, moved: false });
  }

  function move(e: RPointerEvent, scale: number) {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / scale;
    const dy = (e.clientY - drag.sy) / scale;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    const o = drag.orig;
    const raw: Rect =
      drag.mode === "move" ? { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h } : { x: o.x, y: o.y, w: o.w + dx, h: o.h + dy };
    // Alt basılıyken kılavuz ve yapışma yok (serbest konum)
    const others = page.visuals.filter((v) => v.id !== o.id);
    const a = e.altKey ? null : alignRect(raw, drag.mode, others, page);
    const r = a?.rect ?? raw;
    // Kılavuza yapışmayan eksende 8 px ızgara
    const gx = (v: number) => (a?.snappedX ? v : e.altKey ? Math.round(v) : snap(v));
    const gy = (v: number) => (a?.snappedY ? v : e.altKey ? Math.round(v) : snap(v));
    const compact = o.type === "button" || o.type === "text" || o.type === "shape";
    const minW = compact ? 40 : o.type === "image" ? 48 : 120;
    const minH = compact ? 28 : o.type === "image" ? 48 : 80;
    const next =
      drag.mode === "move"
        ? {
            ...o,
            x: Math.max(0, Math.min(page.width - o.w, gx(r.x))),
            y: Math.max(0, Math.min(page.height - o.h, gy(r.y))),
          }
        : {
            ...o,
            w: Math.max(minW, Math.min(page.width - o.x, gx(r.w))),
            h: Math.max(minH, Math.min(page.height - o.y, gy(r.h))),
          };
    setGuides(a?.guides ?? []);
    if (!drag.moved) setDrag({ ...drag, moved: true });
    onChange(next);
  }

  function end() {
    setDrag(null);
    setGuides([]);
  }

  const readField = readPayload;


  return (
    <ReportViewport width={page.width} height={page.height} banner={banner}
      onBackground={() => { if (!previewActions) onSelect(null); setCross(null); }}>
      {(scale) => (
      <ReportThemeScope theme={theme}
        className="page"
        style={{ width: page.width * scale, height: page.height * scale, backgroundColor: page.backgroundColor || undefined }}
        onDragOver={(e) => {
          if (previewActions) return;
          if (e.dataTransfer.types.includes(FIELD_MIME)) e.preventDefault();
        }}
        onDrop={(e) => {
          if (previewActions) return;
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
        {guides.map((g, i) => (
          <div
            key={i}
            className={`align-guide ${g.o}`}
            style={
              g.o === "v"
                ? { left: g.pos * scale, top: g.from * scale, height: (g.to - g.from) * scale }
                : { top: g.pos * scale, left: g.from * scale, width: (g.to - g.from) * scale }
            }
          />
        ))}
        {page.visuals.filter((v) => !previewActions || visualIsVisible(v, visibleOverrides)).map((v) => {
          const selected = v.id === selectedId;
          const title = visualTitle(v);
          return (
            <VisualContextMenu key={`${page.id}:${v.id}`} visual={v} onSelect={previewActions ? undefined : () => onSelect(v.id)}
              editItems={previewActions ? [] : [
                { label: "Biçim / özellikler", action: () => onFormat(v.id) },
                { label: "Çoğalt", action: () => onDuplicate(v) },
                { label: v.format.locked ? "Kilidi aç" : "Kilitle", action: () => onChange({ ...v, format: { ...v.format, locked: !v.format.locked } }) },
                { label: "Bir katman öne", disabled: !!v.format.locked || page.visuals.at(-1)?.id === v.id, action: () => onShiftLayer(v.id, 1) },
                { label: "Bir katman geriye", disabled: !!v.format.locked || page.visuals[0]?.id === v.id, action: () => onShiftLayer(v.id, -1) },
                { label: "Sil", disabled: !!v.format.locked, action: () => onDelete(v.id) },
              ]}>
            <div
              key={v.id}
              data-visual-id={v.id}
              className={`visual ${selected ? "selected" : ""} ${previewActions ? "preview" : ""} ${previewActions && v.format.action && v.format.action.type !== "none" ? "actionable" : ""} ${!previewActions && v.format.initiallyHidden ? "initially-hidden" : ""} ${v.format.showTitle === false ? "no-title" : ""} ${v.format.locked ? "locked" : ""} ${v.type === "shape" || v.type === "image" ? "shape-frame" : ""} ${dropHover === v.id ? "drop" : ""} ${visualMotion(v)}`}
              style={{ left: v.x * scale, top: v.y * scale, width: v.w, height: v.h, scale, transformOrigin: "top left", ...visualStyle(themedVisual(v, theme)) }}
              role={previewActions && v.format.action && v.type !== "button" ? "button" : undefined}
              tabIndex={0}
              onKeyDown={(e) => { if (previewActions && v.format.action && v.type !== "button" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onAction(v); } }}
              onClick={(e) => { if (previewActions && v.type !== "button" && v.format.action) { e.stopPropagation(); onAction(v); } }}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (!previewActions) onSelect(v.id);
              }}
              onDragOver={(e) => {
                if (previewActions) return;
                if (!e.dataTransfer.types.includes(FIELD_MIME)) return;
                e.preventDefault();
                e.stopPropagation();
                if (dropHover !== v.id) setDropHover(v.id);
              }}
              onDragLeave={() => setDropHover(null)}
              onDrop={(e) => {
                if (previewActions) return;
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
                onPointerMove={(e) => move(e, scale)}
                onPointerUp={end}
                onPointerCancel={end}
                title="Taşımak için sürükleyin"
              >
                <span className="visual-title" title={title}>{title}</span>
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
                  extra={[...pageFilters, ...crossFiltersFor(v, cross), ...slicerFilters(page.visuals, previewActions ? previewStates : {}, v.id)]}
                  detailReady={pageFilters.length > 0 || (!!cross && cross.visualId !== v.id)}
                  onCrossRow={(row) => setCross(toggleCrossRow(v, cross, row))}
                  onRowAction={previewActions && v.format.rowAction ? (value) => onAction(v, v.format.rowAction!.action,
                    rowActionValue(v, v.format.rowAction!.sourceIndex, value)) : undefined}
                  onAction={previewActions ? (action) => onAction(v, action) : undefined}
                  pageWidth={page.width} pageHeight={page.height}
                  dataRev={dataRev}
                  cross={cross}
                  onCross={(value) => setCross(toggleCross(v, cross, value))}
                  run={run}
                  state={previewActions ? previewStates[v.id] ?? v.state : v.state}
                  onState={(state) => previewActions ? onPreviewState(v.id, state) : onChange({ ...v, state })}
                  fieldType={v.group[0] ? columnOf(v.group[0].table, v.group[0].column)?.tip : undefined}
                />
              </div>
              {selected && !previewActions && (
                <div
                  className="visual-resize"
                  onPointerDown={(e) => start(e, v, "resize")}
                  onPointerMove={(e) => move(e, scale)}
                  onPointerUp={end}
                onPointerCancel={end}
                  title="Boyutlandır"
                />
              )}
              {v.values.some((x) => !("measure" in x) && !columnOf(x.table, x.column)) ||
              v.group.some((g) => !columnOf(g.table, g.column)) ? (
                <div className="visual-broken">Bu görseldeki bir alan modelde artık yok</div>
              ) : null}
            </div>
            </VisualContextMenu>
          );
        })}
      </ReportThemeScope>)}
    </ReportViewport>
  );
}
