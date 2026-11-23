import { ImportCompatibility, ReportThemeControls } from "@floem/report";
import type { ComponentLibraryStore, FilterRef, ModelColumn, ModelTable, ReportDefinition, ReportPage, ValueRef, Visual, VisualAction, VisualState, VisualType } from "@floem/client";
import {
  DrillBanner, VISUAL_DEFS, crossFiltersFor, defaultAgg, defaultRole, newId, resolveVisualAction, runMeasureAction,
  sameField, slicerFilters, snap, visualIsVisible,
  type ActionValue, type CrossFilter, type QueryFn, type WellKey,
  containerOptions, lockedInLayout, ancestors, usePageLayout,
  resolvePageVariant, editPageVariant, pruneReportLayouts,
} from "@floem/report";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isMeasure, usesField, type FieldPayload } from "./fields";
import { PageCanvas } from "./PageCanvas";
import { FieldsPane, VisualizationsPane } from "./ReportPanes";
import { moveWellItem } from "./wells";
import { DesignerPanels } from "./DesignerPanels";
import { DesignHistory } from "./history";
import { groupSelection, ungroup, deleteSelection, duplicateSelection, reorderSibling, transformSelection } from "./layoutEditing";
import { LayoutControls } from "./LayoutControls";
import { ComponentLibraryPane } from "./ComponentLibraryPane";
import { repairInstances } from "./components";
import { PageLayoutControls } from "./PageLayoutControls";
import { DiagnosticProvider, type VisualDiagnostic } from "../../report/src/diagnostics";
import { DesignInspector } from "./DesignInspector";
import type { AuditTarget } from "./designAudit";
import { journeyFilters, journeySlicers } from "../../report/src/reportJourney";
import { useReportJourney } from "../../report/src/useReportJourney";
import { AnalyticsPane } from "./AnalyticsPane";
import { ScenarioPane } from "./ScenarioPane";
import { ScenarioProvider } from "@floem/report";
import "./designer.css";

const SAVE_DELAY = 300;

/**
 * Tasarımcının dış dünyayla tek bağlantısı. Desktop'ta yerel servis, web'de floembi.app
 * düzenleme uçları bu arayüzü doldurur; tasarımcı hangisinde çalıştığını bilmez.
 */
export interface DesignerHost {
  tables: ModelTable[];
  /** Sunucudaki/belgedeki son rapor tanımı (dışarıdan değişirse taslak güncellenir) */
  report: ReportDefinition;
  /** Değişince görseller yeniden sorgulanır (veri yenilendi, ilişki değişti...) */
  dataRev: string;
  run: QueryFn;
  /** Raporu kalıcılaştırır; tasarımcı çağrıları birleştirir (300 ms) */
  save(report: ReportDefinition): Promise<void>;
  onError(e: unknown): void;
  /** Kaydet/Yayımla öncesi bekleyen değişikliğin yazılması için */
  registerFlush?(fn: () => Promise<void>): () => void;
  /** Veri bölmesinde ölçünün düzenle düğmesi (Desktop'ta formül çubuğunu açar) */
  onEditMeasure?(name: string): void;
  componentLibrary?: ComponentLibraryStore;
  /** Desktop ribbon alanı; verilmezse araçlar tuval üzerinde gösterilir. */
  toolbarTarget?: HTMLElement | null;
}

/** Power BI rapor görünümü: sayfa tuvali, Görselleştirmeler ve Veri bölmeleri, sayfa sekmeleri. */
export function ReportDesigner({ host }: { host: DesignerHost }) {
  const { save, onError, registerFlush } = host;
  const [report, setReport] = useState<ReportDefinition>(host.report);
  const reportRef = useRef(report);
  const lastSent = useRef(JSON.stringify(host.report));
  const acknowledged = useRef(lastSent.current);
  const sentReports = useRef(new Set([lastSent.current]));
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveGeneration = useRef(0);
  const history = useRef(new DesignHistory(host.report));
  const timer = useRef<number | null>(null);
  const [pageId, setPageId] = useState(report.pages[0]?.id ?? "p1");
  const [layoutChoices, setLayoutChoices] = useState<Record<string, string | null>>({});
  const [selection, setSelection] = useState<string[]>([]);
  const selectedId = selection.at(-1) ?? null;
  const setSelectedId = (id: string | null) => setSelection(id ? [id] : []);
  const [formatRequest, setFormatRequest] = useState(0);
  const [visualizationsOpen, setVisualizationsOpen] = useState((host.report.pages[0]?.width ?? 0) < 1600);
  const [dataOpen, setDataOpen] = useState((host.report.pages[0]?.width ?? 0) < 1600);
  const panelId = useId();
  const canvasFocus = !visualizationsOpen && !dataOpen;
  const [previewActions, setPreviewActions] = useState(false);
  const [previewVisibility, setPreviewVisibility] = useState<Record<string, Record<string, boolean>>>({});
  const [previewStates, setPreviewStates] = useState<Record<string, VisualState>>({});
  const [actionRev, setActionRev] = useState(0);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [cross, setCross] = useState<CrossFilter | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Detaya git (drill-through): hedef sayfa, filtreler, geri dönülecek sayfa
  const [drill, setDrill] = useState<{ pageId: string; from: string; filters: FilterRef[]; label: string } | null>(null);
  const journey = useReportJourney<{ pageId: string; drill: typeof drill; cross: typeof cross; states: typeof previewStates; visibility: typeof previewVisibility }>((s) => {
    setPageId(s.pageId); setDrill(s.drill); setCross(s.cross); setPreviewStates(s.states); setPreviewVisibility(s.visibility); setSelectedId(null);
  });
  const remember = () => journey.push({ pageId, drill, cross, states: previewStates, visibility: previewVisibility });
  const goBack = () => { if (!journey.back() && drill) { setPageId(drill.from); setDrill(null); setCross(null); } };

  // Dışarıdan gelen değişiklik (dosya aç, yeniden adlandırma) yerel taslağı günceller
  useEffect(() => {
    const s = JSON.stringify(host.report);
    if (s !== JSON.stringify(reportRef.current) && !sentReports.current.has(s)) {
      saveGeneration.current++;
      if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
      lastSent.current = s;
      acknowledged.current = s;
      sentReports.current = new Set([s]);
      reportRef.current = host.report;
      history.current.reset(host.report);
      setReport(host.report);
      setSelection([]);
      if (!host.report.pages.some((p) => p.id === pageId)) setPageId(host.report.pages[0]?.id ?? "p1");
      const showPanels = (host.report.pages[0]?.width ?? 0) < 1600;
      setVisualizationsOpen(showPanels);
      setDataOpen(showPanels);
      setPreviewActions(false);
      setPreviewVisibility({});
      setPreviewStates({});
      setLayoutChoices({});
      journey.clear(); setDrill(null); setCross(null);
    }
  }, [host.report]);

  const send = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const r = reportRef.current;
    const s = JSON.stringify(r);
    if (s === lastSent.current) return saveQueue.current;
    lastSent.current = s;
    sentReports.current.add(s);
    if (sentReports.current.size > 150) sentReports.current.delete(sentReports.current.values().next().value!);
    const generation = saveGeneration.current;
    const job = saveQueue.current.catch(() => {}).then(async () => {
      if (generation !== saveGeneration.current) return;
      try { await save(r); acknowledged.current = s; }
      catch (e) { if (lastSent.current === s) lastSent.current = acknowledged.current; sentReports.current.delete(s); onError(e); throw e; }
    });
    saveQueue.current = job;
    return job;
  }, [save, onError]);

  useEffect(() => registerFlush?.(send), [registerFlush, send]);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const update = useCallback(
    (fn: (r: ReportDefinition) => ReportDefinition) => {
      const next = pruneReportLayouts(fn(reportRef.current));
      if (next === reportRef.current) return;
      history.current.update(next);
      reportRef.current = next;
      setReport(next);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void send().catch(() => {}), SAVE_DELAY);
    },
    [send],
  );

  const basePage = report.pages.find((p) => p.id === pageId) ?? report.pages[0];
  const layoutId = basePage?.layouts?.some((v) => v.id === layoutChoices[basePage.id]) ? layoutChoices[basePage.id] : null;
  const page = useMemo(() => resolvePageVariant(basePage, layoutId), [basePage, layoutId]);
  const viewKey = `${page?.id}:${layoutId ?? "base"}`;
  const layout = usePageLayout(page, JSON.stringify(previewVisibility[page?.id] ?? {}), viewKey);
  const selected = page?.visuals.find((v) => v.id === selectedId) ?? null;
  const tables = host.tables;
  const dataRev = `${host.dataRev}:${actionRev}:${JSON.stringify([host.report.analytics ?? null, host.report.scenarios ?? []])}`;
  const diagnosticRevision = useRef(0);
  const diagnosticScope = useMemo(() => `${viewKey}:${dataRev}:${++diagnosticRevision.current}`, [report, viewKey, dataRev]);
  const [diagnostics, setDiagnostics] = useState<{ scope: string; items: VisualDiagnostic[] }>({ scope: "", items: [] });
  const [auditTarget, setAuditTarget] = useState<AuditTarget | null>(null);
  useEffect(() => {
    if (!auditTarget || page.id !== auditTarget.pageId || layoutId !== auditTarget.layoutId) return;
    const frame = requestAnimationFrame(() => {
      const node = [...(layout.root.current?.querySelectorAll<HTMLElement>("[data-visual-id]") ?? [])].find((el) => el.dataset.visualId === auditTarget.visualId);
      node?.scrollIntoView({ block: "nearest", inline: "nearest" });
      node?.focus({ preventScroll: true });
      setAuditTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [auditTarget, page.id, layoutId, layout.root]);

  const columnOf = useCallback(
    (table: string, column: string): ModelColumn | undefined =>
      tables.find((t) => t.ad === table)?.sutunlar.find((c) => c.ad === column),
    [tables],
  );

  const updatePage = (fn: (p: ReportPage) => ReportPage) => update((r) => {
    const before = r.pages.find((p) => p.id === page.id)!;
    const next = repairInstances(editPageVariant(before, layoutId, fn(resolvePageVariant(before, layoutId))), r.components ?? []);
    return before === next ? r : { ...r, pages: r.pages.map((p) => p.id === page.id ? next : p) };
  });
  const updateVisual = (v: Visual) => updatePage((p) => {
    if (ancestors(p, v.id).some((parent) => parent.format.locked)) return p;
    const old = p.visuals.find((node) => node.id === v.id);
    if (!old || old === v) return p;
    if (old.type === "container" && containerOptions(old).kind === "group" && (old.w !== v.w || old.h !== v.h)) {
      const before = layout.visuals.find((node) => node.id === v.id)!;
      const parent = layout.visuals.find((node) => node.id === old.parentId);
      const resized = transformSelection(p, [v.id], before, { x: v.x + (parent?.x ?? 0), y: v.y + (parent?.y ?? 0), w: v.w, h: v.h }, true, layout.visuals);
      return { ...resized, visuals: resized.visuals.map((node) => node.id === v.id ? { ...v, x: node.x, y: node.y, w: node.w, h: node.h } : node) };
    }
    const resolved = old.type === "container" && containerOptions(old).mode !== "free" && containerOptions(v).mode === "free" ? layout.visuals : null;
    const parent = resolved?.find((node) => node.id === v.id);
    return { ...p, visuals: p.visuals.map((x) => x.id === v.id ? v : resolved && x.parentId === v.id ? (() => {
      const r = resolved.find((node) => node.id === x.id)!;
      const growing = x.type === "text" && x.format.textOverflow === "grow" || x.type === "container" && containerOptions(x).autoHeight;
      return { ...x, x: r.x - parent!.x, y: r.y - parent!.y, w: r.w, h: growing ? x.h : r.h };
    })() : x) };
  });

  function changeHistory(direction: "undo" | "redo") {
    const next = history.current[direction]();
    reportRef.current = next; setReport(next);
    if (!next.pages.some((p) => p.id === pageId)) setPageId(next.pages[0]?.id ?? "p1");
    setSelection((ids) => ids.filter((id) => next.pages.some((p) => p.visuals.some((v) => v.id === id))));
    setCross(null);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void send().catch(() => {}), SAVE_DELAY);
  }
  const beginGesture = () => history.current.begin();
  function endGesture(cancel = false) {
    if (cancel) {
      const next = history.current.cancel(); reportRef.current = next; setReport(next);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void send().catch(() => {}), SAVE_DELAY);
    }
    else history.current.commit();
  }
  function groupChosen(frame = false) {
    if (layoutId) return;
    const result = groupSelection(page, selection, frame, new Set(report.pages.flatMap((p) => p.visuals.flatMap((v) => [v.id, ...Object.values(v.component?.nodeMap ?? {})]))), layout.visuals);
    if (result.id) { updatePage(() => result.page); setSelectedId(result.id); }
  }

  function duplicateVisual(v: Visual) {
    const result = duplicateSelection(page, selection.includes(v.id) ? selection : [v.id], new Set(report.pages.flatMap((p) => p.visuals.flatMap((x) => [x.id, ...Object.values(x.component?.nodeMap ?? {})]))));
    updatePage(() => result.page); setSelection(result.ids);
  }

  function shiftLayer(id: string, direction: -1 | 1) {
    updatePage((p) => {
      const node = p.visuals.find((v) => v.id === id);
      const siblings = p.visuals.filter((v) => (v.parentId ?? null) === (node?.parentId ?? null));
      const target = siblings[siblings.findIndex((v) => v.id === id) + direction];
      return target ? reorderSibling(p, id, target.id) : p;
    });
  }

  function deleteVisual(id: string) {
    const ids = selection.includes(id) ? selection : [id];
    updatePage((p) => deleteSelection(p, ids));
    setSelection([]);
    if (cross?.visualId === id) setCross(null);
  }

  function freeSpot(w: number, h: number): { x: number; y: number } {
    // Basit yerleşim: soldan sağa, yukarıdan aşağı ilk boş yer
    for (let y = 16; y + h <= page.height; y += 16) {
      for (let x = 16; x + w <= page.width; x += 16) {
        const clash = page.visuals.some((v) => !v.parentId && x < v.x + v.w + 8 && x + w + 8 > v.x && y < v.y + v.h + 8 && y + h + 8 > v.y);
        if (!clash) return { x, y };
      }
    }
    return { x: 16, y: 16 };
  }

  /** Alanı görsele ekler: kutu verilmezse alanın türüne göre (ölçü/sayı → değer, diğerleri → gruplama). */
  function addField(v: Visual, field: FieldPayload, well?: WellKey, slot?: number): Visual {
    const wells = VISUAL_DEFS[v.type].wells;
    if (isMeasure(field)) {
      // Ölçü yalnızca değer ya da hedef kutusuna girer
      const def = wells.find((w) => w.key === well && (w.key === "values" || w.key === "target")) ??
        wells.find((w) => w.key === "values") ?? wells.find((w) => w.key === "target");
      if (!def) return v;
      const value: ValueRef = { measure: field.measure };
      if (def.key === "values" && slot !== undefined) {
        const values = [...v.values];
        if (slot < values.length) values[slot] = value;
        else values.push(value);
        return { ...v, values };
      }
      const cur = def.key === "values" ? v.values : v.target ?? [];
      if (cur.some((x) => "measure" in x && x.measure === field.measure)) return v;
      const next = def.max && cur.length >= def.max ? [value] : [...cur, value];
      return def.key === "values" ? { ...v, values: next } : { ...v, target: next };
    }
    const { table, column } = field;
    const c = columnOf(table, column);
    if (!c) return v;
    const wanted = well ?? defaultRole(c);
    // İstenen kutu bu görselde yoksa ilk uygun kutuya (ör. dilimleyiciye sayı → Alan)
    let def =
      wells.find((w) => w.key === wanted) ??
      wells.find((w) => (wanted === "group" || wanted === "legend" ? w.key === "group" : w.key === "values")) ??
      wells[0];
    // Kart/KPI trend ekseni yalnızca tarih alanlarını kendiliğinden alır; diğerleri değer olur (Say)
    if (!well && def.dateOnly && c.tip !== "date" && c.tip !== "datetime") {
      def = wells.find((w) => w.key === "values") ?? def;
    }
    const ref = { table, column };
    if (def.key === "group" || def.key === "legend") {
      const cur = def.key === "group" ? v.group : v.legend ?? [];
      if (cur.some((g) => sameField(g, ref))) return v;
      const next = def.max && cur.length >= def.max ? [ref] : [...cur, ref];
      return def.key === "group" ? { ...v, group: next } : { ...v, legend: next };
    }
    const value: ValueRef = { table, column, agg: defaultAgg(c) };
    if (def.key === "values" && slot !== undefined) {
      // Yuvalı kutu: o sıradaki değeri değiştir, sıra boşsa sona ekle
      const values = [...v.values];
      if (slot < values.length) values[slot] = value;
      else values.push(value);
      return { ...v, values };
    }
    const cur = def.key === "values" ? v.values : v.target ?? [];
    const next = def.max && cur.length >= def.max ? [value] : [...cur, value];
    return def.key === "values" ? { ...v, values: next } : { ...v, target: next };
  }

  function createVisual(type: VisualType, at?: { x: number; y: number }): Visual {
    const [w, h] = VISUAL_DEFS[type].size;
    const pos = at
      ? { x: snap(Math.max(0, Math.min(page.width - w, at.x - w / 2))), y: snap(Math.max(0, Math.min(layout.height - h, at.y - 20))) }
      : freeSpot(w, h);
    const ids = new Set(report.pages.flatMap((p) => p.visuals.flatMap((v) => [v.id, ...Object.values(v.component?.nodeMap ?? {})])));
    const format = type === "shape" ? { showTitle: false, backgroundColor: "#2a78d6", padding: 0 } :
      type === "image" ? { showTitle: false, padding: 0 } :
      type === "button" ? { showTitle: false, padding: 0, text: "Düğme", buttonStyle: "solid" as const,
        buttonColor: "#2563eb", buttonTextColor: "#ffffff", buttonIcon: "arrow" as const,
        action: { type: "none" as const } } :
      type === "ticker" ? { animation: "count" as const, animationDuration: 800, shadow: true } : {};
    const parent = !at && type !== "container" && selected?.type === "container" && !lockedInLayout(page, selected.id) ? selected : null;
    return { id: newId("v", ids), type, ...pos, w: parent ? Math.min(w, Math.max(40, parent.w - 32)) : w,
      h: parent ? Math.min(h, Math.max(28, parent.h - 32)) : h,
      ...(parent ? { parentId: parent.id, x: 16, y: 16 } : {}),
      ...(type === "container" ? { title: "Kapsayıcı", container: { kind: "frame" as const, mode: "free" as const, padding: 16 }, } : {}),
      group: [], values: [], filters: [], format: type === "container" ? { showTitle: false, padding: 0 } : format };
  }

  function insert(v: Visual) {
    updatePage((p) => ({ ...p, visuals: [...p.visuals, v] }));
    setSelectedId(v.id);
  }

  function pickType(t: VisualType) {
    if (selected && selected.type !== "container" && t !== "container") {
      // Türü değiştir: alanları yeni türün kutularına taşı, sığmayanları kırp
      const wells = VISUAL_DEFS[t].wells;
      const w = (k: WellKey) => wells.find((x) => x.key === k);
      const fit = <T,>(items: T[], k: WellKey) => {
        const d = w(k);
        if (!d) return [];
        return d.max ? items.slice(0, d.max) : items;
      };
      // Kartlarda gruplama yok; değerleri koru. Dilimleyicide değer yok; ilk gruplama alanını koru.
      const legend = selected.legend ?? [];
      updateVisual({
        ...selected,
        type: t,
        repeater: t === "repeater" ? selected.repeater : undefined,
        bindings: { ...selected.bindings, ...(!["card", "ticker", "text"].includes(t) ? { value: undefined } : {}) },
        group: fit(selected.group.length ? selected.group : legend, "group"),
        legend: fit(legend, "legend"),
        values: fit(selected.values, "values"),
        target: fit(selected.target ?? [], "target"),
        state: t === selected.type ? selected.state : {},
      });
    } else {
      insert(createVisual(t));
    }
  }

  /** Boş sayfaya bırakılan alana uygun görsel: ölçü → kart, sayı → sütun grafiği, diğerleri → tablo (Power BI). */
  function typeFor(field: FieldPayload): VisualType | null {
    if (isMeasure(field)) return "card";
    const c = columnOf(field.table, field.column);
    if (!c) return null;
    return defaultRole(c) === "values" ? "column" : "table";
  }

  function dropOnCanvas(field: FieldPayload, x: number, y: number) {
    const t = typeFor(field);
    if (t) insert(addField(createVisual(t, { x, y }), field));
  }

  function toggleField(field: FieldPayload, checked: boolean) {
    if (!checked) {
      if (!selected) return;
      const keep = (g: { table: string; column: string }) =>
        isMeasure(field) || !(g.table === field.table && g.column === field.column);
      const keepV = (x: ValueRef) =>
        "measure" in x ? !(isMeasure(field) && x.measure === field.measure) : keep(x);
      updateVisual({
        ...selected,
        group: selected.group.filter(keep),
        legend: (selected.legend ?? []).filter(keep),
        values: selected.values.filter(keepV),
        target: (selected.target ?? []).filter(keepV),
      });
      return;
    }
    if (selected && selected.type !== "container" && !usesField(selected, field)) {
      updateVisual(addField(selected, field));
    } else if (!selected || selected.type === "container") {
      const t = typeFor(field);
      if (t) insert(addField(createVisual(t), field));
    }
  }

  // Delete: seçili görseli sil (bir giriş kutusunda değilken)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (previewActions || !(e.target instanceof HTMLElement) || !(e.target.closest(".report-view") || host.toolbarTarget?.contains(e.target))) return;
      if (e.target.closest("input,select,textarea,[contenteditable=true],.monaco-editor,[role=dialog]")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); changeHistory(e.shiftKey ? "redo" : "undo"); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); changeHistory("redo"); }
      else if (mod && e.key.toLowerCase() === "g") { e.preventDefault(); if (layoutId) return; if (e.shiftKey && selected) updatePage((p) => ungroup(p, selected.id, layout.visuals)); else groupChosen(); }
      else if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); setSelection(page.visuals.filter((v) => !v.parentId && !v.format.locked).map((v) => v.id)); }
      else if (mod && e.key.toLowerCase() === "d" && selected) { e.preventDefault(); duplicateVisual(selected); }
      else if (e.key === "Delete" && selectedId) { e.preventDefault(); deleteVisual(selectedId); }
      else if (e.key === "Escape") { if (selected?.parentId) setSelectedId(selected.parentId); else setSelectedId(null); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function addPage() {
    const ids = new Set(report.pages.map((p) => p.id));
    const id = newId("p", ids);
    update((r) => ({ ...r, pages: [...r.pages, { id, name: `Sayfa ${r.pages.length + 1}`, width: 1280, height: 720, visuals: [] }] }));
    setPageId(id);
    setSelectedId(null);
    setCross(null);
  }

  function renamePage(id: string, name: string) {
    const n = name.trim();
    if (n) update((r) => ({ ...r, pages: r.pages.map((p) => (p.id === id ? { ...p, name: n.slice(0, 120) } : p)) }));
    setRenaming(null);
  }

  function removePage(id: string) {
    const p = report.pages.find((x) => x.id === id);
    if (!p || report.pages.length < 2) return;
    if (p.visuals.length && !window.confirm(`'${p.name}' sayfası ve üzerindeki ${p.visuals.length} görsel silinsin mi?`)) return;
    const rest = report.pages.filter((x) => x.id !== id);
    update((r) => ({ ...r, pages: r.pages.filter((x) => x.id !== id) }));
    if (pageId === id) setPageId(rest[0].id);
  }

  if (!page) return null;
  const pageFilters = drill && drill.pageId === page.id ? drill.filters : [];

  function runAction(v: Visual, chosen?: VisualAction, source?: ActionValue, rowFilters: FilterRef[] = []) {
    const action = resolveVisualAction(v, report.pages, page.id, chosen, source);
    if (!action) return;
    if (action.type === "page") {
      action.filters = action.keepContext ? journeyFilters(pageFilters, v.filters, slicerFilters(page.visuals, previewStates), crossFiltersFor(v, cross), rowFilters, action.filters)
        : rowFilters.length ? rowFilters : action.filters;
      remember();
      if (action.keepContext) setPreviewStates((old) => journeySlicers(report.pages.find((p) => p.id === action.pageId)!, action.filters ?? [], old));
      setPageId(action.pageId);
      setSelectedId(null);
      setCross(null);
      setDrill({ pageId: action.pageId, from: page.id, filters: action.filters ?? [], label: action.label ?? (action.keepContext ? "Firma, dönem ve seçim kapsamı" : "Sayfa geçişi") });
    } else if (action.type === "back") {
      goBack();
    } else if (action.type === "reset") {
      journey.clear();
      setCross(null);
      setDrill(null);
      setPreviewVisibility({});
      setPreviewStates(Object.fromEntries(report.pages.flatMap((item) => item.visuals.filter((v) => v.type === "slicer").map((v) => [v.id, {}]))));
    } else if (action.type === "url") {
      window.open(action.url, "_blank", "noopener,noreferrer");
    } else if (action.type === "measure") {
      const sourceFilter: FilterRef[] = action.source?.table && action.source.column && action.source.value !== null
        ? [{ table: action.source.table, column: action.source.column, op: "in", values: [action.source.value] }] : [];
      const filters = [...v.filters, ...pageFilters, ...crossFiltersFor(v, cross),
        ...slicerFilters(page.visuals, previewStates), ...rowFilters, ...sourceFilter];
      setActionNotice("FDX ölçüsü hesaplanıyor…");
      void runMeasureAction(host.run, action.measure, filters).then(setActionNotice)
        .catch((error) => setActionNotice(`FDX ölçüsü çalıştırılamadı: ${String(error)}`));
    } else if (action.type === "function") {
      if (action.name === "refresh") setActionRev((rev) => rev + 1);
      else if (action.name === "clearSelection") { setCross(null); setDrill(null); journey.clear(); }
      else if (action.name === "filterByValue" && action.source?.table && action.source.column && action.source.value !== null)
        setCross({ visualId: v.id, table: action.source.table, column: action.source.column, value: action.source.value });
    } else {
      const target = page.visuals.find((item) => item.id === action.visualId);
      if (!target) return;
      setPreviewVisibility((current) => {
        const before = current[page.id] ?? {};
        return { ...current, [page.id]: { ...before, [target.id]: !visualIsVisible(target, before) } };
      });
    }
  }

  const historyButton = (direction: "undo" | "redo", ribbon = false) => {
    const label = direction === "undo" ? "Geri al" : ribbon ? "İleri al" : "Yinele";
    return <button className={ribbon ? "ribbon-btn" : undefined} type="button" aria-label={label}
      title={`${label} (${direction === "undo" ? "Ctrl+Z" : "Ctrl+Y"})`}
      disabled={previewActions || !(direction === "undo" ? history.current.canUndo : history.current.canRedo)} onClick={() => changeHistory(direction)}>
      <span className={ribbon ? "ribbon-ico" : undefined} aria-hidden="true">{direction === "undo" ? "↶" : "↷"}</span>{ribbon && <span>{label}</span>}
    </button>;
  };
  const modeButton = (ribbon = false) => <button className={ribbon ? "ribbon-btn" : `canvas-mode-toggle ${drill && (pageFilters.length || journey.count) ? "with-drill" : ""}`}
    type="button" aria-label={ribbon ? "İzleyici modu" : "Etkileşim önizlemesi"} aria-pressed={previewActions}
    title={previewActions ? "İzleyici modu açık · tasarıma dön" : "İzleyici modunda etkileşimleri dene"} onClick={() => {
      setPreviewActions((current) => !current); setSelectedId(null); setPreviewVisibility({}); setPreviewStates({});
    }}>
    {ribbon ? <svg className="ribbon-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
      : <svg viewBox="1 1 23 23" aria-hidden="true"><path d="M5 3v18l5-5 3 6 3-1.5-3-6 7-1.5L5 3Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>}
    {ribbon && <span>İzleyici modu</span>}
  </button>;

  return (
    <ScenarioProvider definitions={host.report.scenarios}>
    <DiagnosticProvider scope={diagnosticScope} ids={page.visuals.map((v) => v.id)} onChange={setDiagnostics}>
    <div className={`report-view ${canvasFocus ? "canvas-focus" : ""}`} data-layout-id={layoutId ?? "base"}
      onFocusCapture={(e) => { if (!(e.target as HTMLElement).closest("dialog") && (e.target as HTMLElement).matches("input,textarea,select")) beginGesture(); }}
      onBlurCapture={(e) => { if (!(e.target as HTMLElement).closest("dialog") && (e.target as HTMLElement).matches("input,textarea,select")) endGesture(); }}>
      {host.toolbarTarget && createPortal(<div className="ribbon-report-tools" role="group" aria-label="Rapor tasarımı">{modeButton(true)}{historyButton("undo", true)}{historyButton("redo", true)}</div>, host.toolbarTarget)}
      <div className="panel-toggles" role="group" aria-label="Sağ paneller">
        <button className="panel-toggle" type="button" aria-controls={`${panelId}-visualizations`}
          aria-label={`Görselleştirmeler panelini ${visualizationsOpen ? "gizle" : "göster"}`}
          aria-expanded={visualizationsOpen} onClick={() => setVisualizationsOpen((current) => !current)}>
          <span>Görselleştirmeler</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
        </button>
        <button className="panel-toggle" type="button" aria-controls={`${panelId}-data`}
          aria-label={`Veri panelini ${dataOpen ? "gizle" : "göster"}`}
          aria-expanded={dataOpen} onClick={() => setDataOpen((current) => !current)}>
          <span>Veri</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
        </button>
      </div>
      <div className="report-main">
        <div className="canvas-shell">
        {host.toolbarTarget === undefined && <><div className="design-history" role="group" aria-label="Tasarım geçmişi">{historyButton("undo")}{historyButton("redo")}</div>{modeButton()}</>}
        <PageCanvas
          components={report.components}
          theme={report.theme}
          page={page}
          viewKey={viewKey}
          allowStructure={!layoutId}
          layout={layout}
          previewActions={previewActions}
          visibleOverrides={previewVisibility[page.id] ?? {}}
          previewStates={previewStates}
          onPreviewState={(id, state) => setPreviewStates((current) => ({ ...current, [id]: state }))}
          onAction={runAction}
          selectedId={selectedId}
          selection={selection}
          onSelection={setSelection}
          onPageChange={(next) => updatePage(() => next)}
          onGestureStart={beginGesture}
          onGestureEnd={endGesture}
          onGroup={() => groupChosen()}
          onUngroup={(id) => { if (!layoutId) updatePage((p) => ungroup(p, id, layout.visuals)); setSelectedId(null); }}
          onSelect={setSelectedId}
          onChange={updateVisual}
          onDelete={deleteVisual}
          onDuplicate={duplicateVisual}
          onShiftLayer={shiftLayer}
          onFormat={(id) => { setSelectedId(id); setVisualizationsOpen(true); setFormatRequest((value) => value + 1); }}
          onDropField={dropOnCanvas}
          onDropOnVisual={(id, f) => {
            const v = page.visuals.find((x) => x.id === id);
            if (v?.type === "container" && !lockedInLayout(page, id)) {
              const type = typeFor(f);
              if (type) insert(addField({ ...createVisual(type), parentId: id, x: 16, y: 16 }, f));
              return;
            }
            if (v) updateVisual(addField(v, f));
            setSelectedId(id);
          }}
          dataRev={dataRev}
          cross={cross}
          setCross={setCross}
          columnOf={columnOf}
          run={host.run}
          pages={report.pages}
          pageFilters={pageFilters}
          onDrillThrough={(t) => {
            remember();
            const filters = journeyFilters(pageFilters, slicerFilters(page.visuals, previewStates), t.filters);
            setPreviewStates((old) => journeySlicers(t.page, filters, old));
            setDrill({ pageId: t.page.id, from: page.id, filters, label: t.label });
            setPageId(t.page.id);
            setSelectedId(null);
            setCross(null);
          }}
          banner={
            drill && (pageFilters.length > 0 || journey.count > 0) ? (
              <DrillBanner
                label={drill.label}
                onBack={goBack}
              />
            ) : undefined
          }
        />
        </div>
        <nav className="page-tabs" aria-label="Sayfalar">
          {report.pages.map((p) =>
            renaming === p.id ? (
              <input
                key={p.id}
                className="page-tab-edit"
                autoFocus
                defaultValue={p.name}
                onBlur={(e) => renamePage(p.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <button
                key={p.id}
                className={`page-tab ${p.id === page.id ? "active" : ""}`}
                onClick={() => {
                  journey.clear();
                  setPageId(p.id);
                  setSelectedId(null);
                  setCross(null);
                  setDrill(null);
                }}
                onDoubleClick={() => setRenaming(p.id)}
                title="Yeniden adlandırmak için çift tıklayın"
              >
                {p.name}
                {p.drillthrough?.length ? <span className="dt-mark" title="Detay (drill-through) sayfası">↪</span> : null}
                {report.pages.length > 1 && p.id === page.id && (
                  <span
                    className="page-tab-x"
                    role="button"
                    aria-label="Sayfayı sil"
                    onClick={(e) => {
                      e.stopPropagation();
                      removePage(p.id);
                    }}
                  >
                    ✕
                  </span>
                )}
              </button>
            ),
          )}
          <button className="page-tab add" onClick={addPage} title="Yeni sayfa">
            +
          </button>
        </nav>
      </div>
      <DesignerPanels visualizationsOpen={visualizationsOpen} dataOpen={dataOpen} panelId={panelId}><VisualizationsPane
        components={report.components}
        layoutControls={!previewActions && <LayoutControls page={page} allowStructure={!layoutId} resolved={layout.visuals} selection={selection} onSelect={setSelection}
          onChange={(next) => updatePage(() => next)} onVisual={updateVisual} onGroup={groupChosen}
          onUngroup={(id) => { updatePage((p) => ungroup(p, id, layout.visuals)); setSelectedId(null); }} />}
        themeControls={<><PageLayoutControls page={basePage} activeId={layoutId} onSelect={(id) => setLayoutChoices((old) => ({ ...old, [page.id]: id }))}
          onChange={(next) => update((r) => ({ ...r, pages: r.pages.map((p) => p.id === next.id ? next : p) }))}
          resolved={layout.visuals} contentHeight={layout.height} selection={selection} overflow={layout.overflow} />
          {layoutId ? <p className="layout-hint">Ortak bileşen kitaplığını Ana düzende düzenleyin.</p> : <ComponentLibraryPane report={report} page={page} selection={selection} resolved={layout.visuals} tables={tables} store={host.componentLibrary}
          onChange={(next) => update(() => next)} onSelect={setSelection} onImage={(data, w, h, title) => insert({ ...createVisual("image"), w, h, title, format: { showTitle: false, padding: 0, borderWidth: 0, imageData: data, imageFit: "contain" } })} />}
          <ReportThemeControls value={report.theme} onChange={(theme) => update((r) => ({ ...r, theme }))} />
          <AnalyticsPane report={report} tables={tables} selected={selected} onChange={(next) => update(() => next)} onVisual={updateVisual} />
          <ScenarioPane report={report} tables={tables} selected={selected} onChange={(next) => update(() => next)} onVisual={updateVisual} />
          <DesignInspector report={report} tables={tables} pageId={page.id} layoutId={layoutId} scope={diagnosticScope} root={layout.root} resolved={layout}
            queries={diagnostics.scope === diagnosticScope ? diagnostics.items : []} onLocate={(target) => {
              journey.clear();
              setPageId(target.pageId); setLayoutChoices((old) => ({ ...old, [target.pageId]: target.layoutId }));
              setSelectedId(target.visualId); setDrill(null); setCross(null); setPreviewActions(false);
              setPreviewStates({}); setPreviewVisibility({}); setVisualizationsOpen(true);
              setFormatRequest((n) => n + 1); setAuditTarget(target);
            }} />
          <ImportCompatibility audit={report.importAudit} onLocate={(targetPage, visualId) => {
            journey.clear();
            if (!report.pages.some((p) => p.id === targetPage && p.visuals.some((v) => v.id === visualId))) {
              setActionNotice("Bu nesne aktarım sonrasında silinmiş veya değiştirilmiş."); return;
            }
            setPageId(targetPage); setSelectedId(visualId); setDrill(null); setCross(null);
          }} /></>}
        page={page}
        pages={report.pages}
        tables={tables}
        onPageChange={(next) => updatePage(() => next)}
        visual={selected}
        formatRequest={formatRequest}
        onDuplicate={() => selected && duplicateVisual(selected)}
        onShiftLayer={(step) => selected && shiftLayer(selected.id, step)}
        onPickType={pickType}
        onChange={updateVisual}
        onDropToWell={(well, f) => selected && updateVisual(addField(selected, f, well.key, well.slot))}
        onMoveWell={(from, to, index) => {
          if (!selected) return;
          const source = VISUAL_DEFS[selected.type].wells.find((w) => w.key === from.key && w.slot === from.slot);
          if (source) updateVisual(moveWellItem(selected, source, from.index, to, index, columnOf));
        }}
      />
      <FieldsPane tables={tables} visual={selected} onToggle={toggleField} onEditMeasure={host.onEditMeasure} /></DesignerPanels>
      {actionNotice && <div className="v-action-notice" role="status"><span>{actionNotice}</span>
        <button type="button" aria-label="Mesajı kapat" onClick={() => setActionNotice(null)}>✕</button></div>}
    </div>
    </DiagnosticProvider>
    </ScenarioProvider>
  );
}
