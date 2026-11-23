import { ReportThemeScope, themedVisual } from "@floem/report";
import type { ThemeSnapshot } from "@floem/client";
import type { FilterRef, ModelColumn, ReportPage, Visual, VisualAction, VisualState } from "@floem/client";
import {
  DrillThroughButton, VisualBody, crossFiltersFor, drillTargets, slicerFilters, snap, toggleCross, toggleCrossRow, visualTitle,
  visualMotion, visualStyle, pageBackground,
  rowActionValue, ReportViewport, VisualContextMenu, usePageLayout, inheritedLayoutStyle, visibleInLayout,
  lockedInLayout, selectionRoots, descendants, rectUnion, containerOptions,
  type ActionValue, type CrossFilter, type DrillTarget, type QueryFn,
} from "@floem/report";
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { canGroup, selectionTarget, transformSelection, reparent, reorderSibling } from "./layoutEditing";
import { BindingProvider, RuntimeFrame } from "../../report/src/BindingRuntime";

import { FIELD_MIME, readPayload, type FieldPayload } from "./fields";

export { FIELD_MIME };

type Drag = { ids: string[]; mode: "move" | "resize"; sx: number; sy: number; original: ReportPage; resolved: Visual[]; box: Rect; last: Rect; moved: boolean };

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
  page, onSelect, onChange, onDelete, onDropField, onDropOnVisual, dataRev, cross, setCross, columnOf, run,
  pages, pageFilters, onDrillThrough, banner, previewActions, visibleOverrides, previewStates, onPreviewState, onAction,
  onDuplicate, onShiftLayer, onFormat, theme, selection, onSelection, onPageChange, onGestureStart, onGestureEnd, onGroup, onUngroup, layout, viewKey, allowStructure = true, components,
}: {
  page: ReportPage;
  components?: import("@floem/client").ComponentDefinition[];
  viewKey?: string;
  allowStructure?: boolean;
  layout: ReturnType<typeof usePageLayout>;
  theme?: ThemeSnapshot | null;
  previewActions: boolean;
  visibleOverrides: Record<string, boolean>;
  previewStates: Record<string, VisualState>;
  onPreviewState: (id: string, state: VisualState) => void;
  onAction: (visual: Visual, action?: VisualAction, source?: ActionValue, filters?: FilterRef[]) => void;
  /** Detaya git hedeflerini bulmak için tüm sayfalar */
  pages: ReportPage[];
  /** Detay sayfasına gelinmişse, gelinen değerin filtreleri */
  pageFilters: FilterRef[];
  onDrillThrough: (t: DrillTarget) => void;
  banner?: ReactNode;
  selectedId: string | null;
  selection: string[];
  onSelection: (ids: string[]) => void;
  onPageChange: (page: ReportPage) => void;
  onGestureStart: () => void;
  onGestureEnd: (cancel?: boolean) => void;
  onGroup: () => void;
  onUngroup: (id: string) => void;
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
  const drag = useRef<Drag | null>(null);
  const [dropHover, setDropHover] = useState<string | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);

  function choose(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, id: string) {
    const target = selection.includes(id) ? id : selectionTarget(page, id, e.ctrlKey || e.metaKey);
    if (e.shiftKey) onSelection(selection.includes(target) ? selection.filter((v) => v !== target) : [...selection, target]);
    else if (!selection.includes(target)) onSelection([target]);
    return target;
  }

  function start(e: RPointerEvent, v: Visual | null, mode: Drag["mode"]) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (previewActions) return;
    const target = v ? choose(e, v.id) : null;
    if (e.shiftKey) return;
    const ids = selectionRoots(page, target && !selection.includes(target) ? [target] : selection).filter((node) => !lockedInLayout(page, node.id)).map((node) => node.id);
    const box = rectUnion(layout.visuals.filter((node) => ids.includes(node.id)));
    if (!box) return;
    if (document.activeElement instanceof HTMLElement && document.activeElement.matches("input,textarea,select")) document.activeElement.blur();
    (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-visual-id]")?.focus({ preventScroll: true });
    onGestureStart();
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* işaretçi yakalanamazsa (dokunmatik/test olayları) sürükleme yine de çalışır */
    }
    drag.current = { ids, mode, sx: e.clientX, sy: e.clientY, original: page, resolved: layout.visuals, box, last: box, moved: false };
  }

  function move(e: RPointerEvent, scale: number) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / scale;
    const dy = (e.clientY - d.sy) / scale;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    const o = d.box;
    const raw: Rect =
      d.mode === "move" ? { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h } : { x: o.x, y: o.y, w: o.w + dx, h: o.h + dy };
    // Alt basılıyken kılavuz ve yapışma yok (serbest konum)
    const excluded = descendants(d.original, d.ids);
    const others = layout.visuals.filter((v) => !excluded.has(v.id));
    const canvasHeight = Math.max(page.height, layout.height);
    const a = e.altKey ? null : alignRect(raw, d.mode, others, { ...page, height: canvasHeight });
    const r = a?.rect ?? raw;
    // Kılavuza yapışmayan eksende 8 px ızgara
    const gx = (v: number) => (a?.snappedX ? v : e.altKey ? Math.round(v) : snap(v));
    const gy = (v: number) => (a?.snappedY ? v : e.altKey ? Math.round(v) : snap(v));
    const single = page.visuals.find((v) => v.id === d.ids[0]);
    const compact = single && ["container", "button", "text", "shape"].includes(single.type);
    const minW = compact || d.ids.length > 1 ? 40 : single?.type === "image" ? 48 : 120;
    const minH = compact || d.ids.length > 1 ? 28 : single?.type === "image" ? 48 : 80;
    const next: Rect =
      d.mode === "move"
        ? {
            ...o,
            x: Math.max(0, Math.min(page.width - o.w, gx(r.x))),
            y: Math.max(0, Math.min(canvasHeight - o.h, gy(r.y))),
          }
        : {
            ...o,
            w: Math.max(minW, Math.min(page.width - o.x, gx(r.w))),
            h: Math.max(minH, Math.min(canvasHeight - o.y, gy(r.h))),
          };
    setGuides(a?.guides ?? []);
    d.moved = true; d.last = next;
    onPageChange(transformSelection(d.original, d.ids, o, next, d.mode === "resize", d.resolved));
  }

  function end(e?: RPointerEvent, cancel = false) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (!cancel && d.moved && d.mode === "move") {
      if (allowStructure && e?.ctrlKey && e.altKey) {
        const excluded = descendants(d.original, d.ids);
        const target = [...layout.visuals].reverse().find((v) => v.type === "container" && !excluded.has(v.id) && !lockedInLayout(page, v.id)
          && d.last.x + d.last.w / 2 >= v.x && d.last.x + d.last.w / 2 <= v.x + v.w && d.last.y + d.last.h / 2 >= v.y && d.last.y + d.last.h / 2 <= v.y + v.h);
        const detached = reparent(d.original, d.ids, null, d.resolved);
        const moved = transformSelection(detached, d.ids, d.box, d.last);
        onPageChange(reparent(moved, d.ids, target?.id ?? null));
      } else if (d.ids.length === 1) {
        const v = d.original.visuals.find((node) => node.id === d.ids[0])!;
        const parent = d.original.visuals.find((node) => node.id === v.parentId);
        const options = parent ? containerOptions(parent) : d.original.rootLayout;
        if (options && options.mode !== "free") {
          const siblings = layout.visuals.filter((node) => (node.parentId ?? null) === (parent?.id ?? null));
          const distance = (node: Visual) => options.mode === "vertical" ? Math.abs(node.y + node.h / 2 - d.last.y - d.last.h / 2)
            : options.mode === "horizontal" && !options.wrap ? Math.abs(node.x + node.w / 2 - d.last.x - d.last.w / 2)
            : Math.hypot(node.x + node.w / 2 - d.last.x - d.last.w / 2, node.y + node.h / 2 - d.last.y - d.last.h / 2);
          const target = siblings.sort((a, b) => distance(a) - distance(b))[0];
          if (target && target.id !== v.id) onPageChange(reorderSibling(d.original, v.id, target.id));
        }
      }
    }
    setGuides([]);
    onGestureEnd(cancel);
  }

  useEffect(() => {
    const cancel = (e: KeyboardEvent) => { if (e.key === "Escape" && drag.current) { e.preventDefault(); e.stopImmediatePropagation(); end(undefined, true); } };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  });
  const selectedBox = rectUnion(layout.visuals.filter((v) => selectionRoots(page, selection).some((node) => node.id === v.id)));

  const readField = readPayload;


  return (
    <ReportViewport page={page} theme={theme} viewKey={viewKey} width={page.width} height={layout.height} banner={banner}
      onBackground={() => { if (!previewActions) onSelect(null); setCross(null); }}>
      {(scale) => (
      <ReportThemeScope theme={theme}
        rootRef={layout.root}
        className="page"
        style={{ width: page.width * scale, height: layout.height * scale, backgroundColor: pageBackground(page, theme) }}
        onPointerMove={(e) => move(e, scale)}
        onPointerUp={(e) => end(e)}
        onPointerCancel={(e) => end(e, true)}
        onLostPointerCapture={(e) => end(e)}
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
        <BindingProvider key={page.id} visuals={page.visuals} definitions={components}>
        {layout.visuals.filter((v) => previewActions ? visibleInLayout(page, v, visibleOverrides) : !(v.format.initiallyHidden && v.format.hideInDesign) || selection.includes(v.id)).map((v) => {
          const raw = page.visuals.find((node) => node.id === v.id)!;
          const selected = selection.includes(v.id);
          const locked = lockedInLayout(page, v.id);
          const title = visualTitle(v);
          return (
            <VisualContextMenu key={`${page.id}:${v.id}`} visual={v} onSelect={previewActions ? undefined : () => { if (!selection.includes(v.id)) onSelect(v.id); }}
              editItems={previewActions ? [] : [
                { label: "Biçim / özellikler", action: () => onFormat(v.id) },
                { label: "Çoğalt", action: () => onDuplicate(raw) },
                { label: "Grupla", disabled: !allowStructure || !canGroup(page, selection), action: onGroup },
                { label: "Grubu çöz", disabled: !allowStructure || v.type !== "container" || locked, action: () => onUngroup(v.id) },
                { label: v.format.locked ? "Kilidi aç" : "Kilitle", action: () => onChange({ ...raw, format: { ...raw.format, locked: !raw.format.locked } }) },
                { label: "Bir katman öne", disabled: locked || page.visuals.at(-1)?.id === v.id, action: () => onShiftLayer(v.id, 1) },
                { label: "Bir katman geriye", disabled: locked || page.visuals[0]?.id === v.id, action: () => onShiftLayer(v.id, -1) },
                { label: "Sil", disabled: locked, action: () => onDelete(v.id) },
              ]}>
            <RuntimeFrame visual={v.type === "text" ? { ...v, h: raw.h } : v} run={run} revision={dataRev} design={!previewActions} selected={previewActions ? cross?.visualId === v.id : selected}
              extra={[...pageFilters, ...crossFiltersFor(v, cross), ...slicerFilters(page.visuals, previewActions ? previewStates : {}, v.id)]}
              key={v.id}
              data-visual-id={v.id}
              className={`visual ${selected ? "selected" : ""} ${previewActions ? "preview" : ""} ${previewActions && v.format.action && v.format.action.type !== "none" ? "actionable" : ""} ${!previewActions && v.format.initiallyHidden ? "initially-hidden" : ""} ${v.format.showTitle === false ? "no-title" : ""} ${locked ? "locked" : ""} ${v.type === "container" ? "container-frame" : ""} ${v.type === "shape" || v.type === "image" ? "shape-frame" : ""} ${dropHover === v.id ? "drop" : ""} ${visualMotion(v)}`}
              style={{ left: v.x * scale, top: v.y * scale, width: v.w, height: v.h, scale, transformOrigin: "top left", ...visualStyle(themedVisual(v.type === "text" ? { ...v, h: raw.h } : v, theme)), ...inheritedLayoutStyle(page, v, layout.visuals) }}
              role={previewActions && v.format.action && v.type !== "button" ? "button" : undefined}
              tabIndex={0}
              onKeyDown={(e) => { if (previewActions && v.format.action && v.type !== "button" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onAction(v); } }}
              onClick={(e) => { if (previewActions && v.type !== "button" && v.format.action) { e.stopPropagation(); onAction(v); } }}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (!previewActions) choose(e, v.id);
              }}
              onDoubleClick={(e) => { if (!previewActions) { e.stopPropagation(); onSelection([v.id]); } }}
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
            >{(boundV) => <>
              <div
                className="visual-head"
                onPointerDown={(e) => start(e, v, "move")}
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
                  v={boundV}
                  extra={[...pageFilters, ...crossFiltersFor(v, cross), ...slicerFilters(page.visuals, previewActions ? previewStates : {}, v.id)]}
                  detailReady={pageFilters.length > 0 || (!!cross && cross.visualId !== v.id)}
                  onCrossRow={(row) => setCross(toggleCrossRow(v, cross, row))}
                  onRowAction={previewActions && v.format.rowAction ? (value) => onAction(v, v.format.rowAction!.action,
                    rowActionValue(v, v.format.rowAction!.sourceIndex, value)) : undefined}
                  onAction={previewActions ? (action, source, filters) => onAction(v, action, source, filters) : undefined}
                  pageWidth={page.width} pageHeight={layout.height}
                  dataRev={dataRev}
                  cross={cross}
                  onCross={(value) => setCross(toggleCross(v, cross, value))}
                  run={run}
                  state={previewActions ? previewStates[v.id] ?? v.state : v.state}
                  onState={(state) => previewActions ? onPreviewState(v.id, state) : onChange({ ...raw, state })}
                  fieldType={v.group[0] ? columnOf(v.group[0].table, v.group[0].column)?.tip : undefined}
                />
              </div>
              {selected && selection.length === 1 && !previewActions && !locked && (
                <div
                  className="visual-resize"
                  onPointerDown={(e) => start(e, v, "resize")}
                  title="Boyutlandır"
                />
              )}
              {v.values.some((x) => !("measure" in x) && !columnOf(x.table, x.column)) ||
              v.group.some((g) => !columnOf(g.table, g.column)) ? (
                <div className="visual-broken">Bu görseldeki bir alan modelde artık yok</div>
              ) : null}
            </>}</RuntimeFrame>
            </VisualContextMenu>
          );
        })}</BindingProvider>
        {selection.length > 1 && selectedBox && !previewActions && <div className="multi-selection" style={{ left: selectedBox.x * scale, top: selectedBox.y * scale, width: selectedBox.w * scale, height: selectedBox.h * scale }}>
          <button type="button" className="multi-selection-move" aria-label="Seçili nesneleri taşı" onPointerDown={(e) => start(e, null, "move")}>{selection.length} nesne</button>
          <div className="visual-resize" role="button" aria-label="Seçili nesneleri boyutlandır" onPointerDown={(e) => start(e, null, "resize")} />
        </div>}
      </ReportThemeScope>)}
    </ReportViewport>
  );
}
