import type { FilterRef, ModelColumn, ModelTable, ReportDefinition, ReportPage, ValueRef, Visual, VisualState, VisualType } from "@floem/client";
import {
  DrillBanner, VISUAL_DEFS, defaultAgg, defaultRole, newId, resolveVisualAction, sameField, snap, visualIsVisible,
  type CrossFilter, type QueryFn, type WellKey,
} from "@floem/report";
import { useCallback, useEffect, useRef, useState } from "react";
import { isMeasure, usesField, type FieldPayload } from "./fields";
import { PageCanvas } from "./PageCanvas";
import { FieldsPane, VisualizationsPane } from "./ReportPanes";
import { moveWellItem } from "./wells";
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
}

/** Power BI rapor görünümü: sayfa tuvali, Görselleştirmeler ve Veri bölmeleri, sayfa sekmeleri. */
export function ReportDesigner({ host }: { host: DesignerHost }) {
  const { save, onError, registerFlush } = host;
  const [report, setReport] = useState<ReportDefinition>(host.report);
  const reportRef = useRef(report);
  const lastSent = useRef(JSON.stringify(host.report));
  const timer = useRef<number | null>(null);
  const [pageId, setPageId] = useState(report.pages[0]?.id ?? "p1");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canvasFocus, setCanvasFocus] = useState((host.report.pages[0]?.width ?? 0) >= 1600);
  const [previewActions, setPreviewActions] = useState(false);
  const [previewVisibility, setPreviewVisibility] = useState<Record<string, Record<string, boolean>>>({});
  const [previewStates, setPreviewStates] = useState<Record<string, VisualState>>({});
  const [cross, setCross] = useState<CrossFilter | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Detaya git (drill-through): hedef sayfa, filtreler, geri dönülecek sayfa
  const [drill, setDrill] = useState<{ pageId: string; from: string; filters: FilterRef[]; label: string } | null>(null);

  // Dışarıdan gelen değişiklik (dosya aç, yeniden adlandırma) yerel taslağı günceller
  useEffect(() => {
    const s = JSON.stringify(host.report);
    if (s !== lastSent.current) {
      lastSent.current = s;
      reportRef.current = host.report;
      setReport(host.report);
      if (!host.report.pages.some((p) => p.id === pageId)) setPageId(host.report.pages[0]?.id ?? "p1");
      setCanvasFocus((host.report.pages[0]?.width ?? 0) >= 1600);
      setPreviewActions(false);
      setPreviewVisibility({});
      setPreviewStates({});
    }
  }, [host.report, pageId]);

  const send = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const r = reportRef.current;
    const s = JSON.stringify(r);
    if (s === lastSent.current) return;
    lastSent.current = s;
    try {
      await save(r);
    } catch (e) {
      onError(e);
    }
  }, [save, onError]);

  useEffect(() => registerFlush?.(send), [registerFlush, send]);

  const update = useCallback(
    (fn: (r: ReportDefinition) => ReportDefinition) => {
      const next = fn(reportRef.current);
      reportRef.current = next;
      setReport(next);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void send(), SAVE_DELAY);
    },
    [send],
  );

  const page = report.pages.find((p) => p.id === pageId) ?? report.pages[0];
  const selected = page?.visuals.find((v) => v.id === selectedId) ?? null;
  const tables = host.tables;
  const dataRev = host.dataRev;

  const columnOf = useCallback(
    (table: string, column: string): ModelColumn | undefined =>
      tables.find((t) => t.ad === table)?.sutunlar.find((c) => c.ad === column),
    [tables],
  );

  const updatePage = (fn: (p: ReportPage) => ReportPage) =>
    update((r) => ({ ...r, pages: r.pages.map((p) => (p.id === page.id ? fn(p) : p)) }));
  const updateVisual = (v: Visual) => updatePage((p) => ({ ...p, visuals: p.visuals.map((x) => (x.id === v.id ? v : x)) }));

  function duplicateVisual(v: Visual) {
    const ids = new Set(page.visuals.map((item) => item.id));
    const copy = { ...v, id: newId("v", ids), x: Math.min(page.width - v.w, v.x + 24),
      y: Math.min(page.height - v.h, v.y + 24), format: { ...v.format, locked: false } };
    updatePage((p) => ({ ...p, visuals: [...p.visuals, copy] }));
    setSelectedId(copy.id);
  }

  function shiftLayer(id: string, direction: -1 | 1) {
    updatePage((p) => {
      const visuals = [...p.visuals];
      const from = visuals.findIndex((v) => v.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= visuals.length) return p;
      [visuals[from], visuals[to]] = [visuals[to], visuals[from]];
      return { ...p, visuals };
    });
  }

  function deleteVisual(id: string) {
    if (page.visuals.find((v) => v.id === id)?.format.locked) return;
    updatePage((p) => ({ ...p, visuals: p.visuals.filter((v) => v.id !== id) }));
    if (selectedId === id) setSelectedId(null);
    if (cross?.visualId === id) setCross(null);
  }

  function freeSpot(w: number, h: number): { x: number; y: number } {
    // Basit yerleşim: soldan sağa, yukarıdan aşağı ilk boş yer
    for (let y = 16; y + h <= page.height; y += 16) {
      for (let x = 16; x + w <= page.width; x += 16) {
        const clash = page.visuals.some((v) => x < v.x + v.w + 8 && x + w + 8 > v.x && y < v.y + v.h + 8 && y + h + 8 > v.y);
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
      ? { x: snap(Math.max(0, Math.min(page.width - w, at.x - w / 2))), y: snap(Math.max(0, Math.min(page.height - h, at.y - 20))) }
      : freeSpot(w, h);
    const ids = new Set(report.pages.flatMap((p) => p.visuals.map((v) => v.id)));
    const format = type === "shape" ? { showTitle: false, backgroundColor: "#2a78d6", padding: 0 } :
      type === "image" ? { showTitle: false, padding: 0 } :
      type === "button" ? { showTitle: false, padding: 0, text: "Düğme", buttonStyle: "solid" as const,
        buttonColor: "#2563eb", buttonTextColor: "#ffffff", buttonIcon: "arrow" as const,
        action: { type: "none" as const } } :
      type === "ticker" ? { animation: "count" as const, animationDuration: 800, shadow: true } : {};
    return { id: newId("v", ids), type, ...pos, w, h, group: [], values: [], filters: [], format };
  }

  function insert(v: Visual) {
    updatePage((p) => ({ ...p, visuals: [...p.visuals, v] }));
    setSelectedId(v.id);
  }

  function pickType(t: VisualType) {
    if (selected) {
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
    if (selected && !usesField(selected, field)) {
      updateVisual(addField(selected, field));
    } else if (!selected) {
      const t = typeFor(field);
      if (t) insert(addField(createVisual(t), field));
    }
  }

  // Delete: seçili görseli sil (bir giriş kutusunda değilken)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Delete" || !selectedId) return;
      if ((e.target as HTMLElement).closest("input,select,textarea,.monaco-editor")) return;
      deleteVisual(selectedId);
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

  function runAction(v: Visual) {
    const action = resolveVisualAction(v, report.pages, page.id);
    if (!action) return;
    if (action.type === "page") {
      setPageId(action.pageId);
      setSelectedId(null);
      setCross(null);
      setDrill(null);
    } else if (action.type === "reset") {
      setCross(null);
      setDrill(null);
      setPreviewVisibility({});
      setPreviewStates(Object.fromEntries(report.pages.flatMap((item) => item.visuals.filter((v) => v.type === "slicer").map((v) => [v.id, {}]))));
    } else {
      const target = page.visuals.find((item) => item.id === action.visualId);
      if (!target) return;
      setPreviewVisibility((current) => {
        const before = current[page.id] ?? {};
        return { ...current, [page.id]: { ...before, [target.id]: !visualIsVisible(target, before) } };
      });
    }
  }

  return (
    <div className={`report-view ${canvasFocus ? "canvas-focus" : ""}`}>
      <div className="report-main">
        <div className="canvas-shell">
        <div className="design-toolbar" aria-label="Serbest tasarım araçları">
          <span className="design-toolbar-label">Serbest tasarım</span>
          <button type="button" aria-pressed={previewActions} onClick={() => {
            setPreviewActions((current) => !current); setSelectedId(null); setPreviewVisibility({}); setPreviewStates({});
          }}>{previewActions ? "Tasarımı düzenle" : "Etkileşimi dene"}</button>
          <button type="button" onClick={() => setCanvasFocus((current) => !current)}
            aria-pressed={canvasFocus} title="Tuval için daha geniş alan aç">{canvasFocus ? "Panelleri göster" : "Tuvali genişlet"}</button>
          <label className="design-page-color" title="Sayfa arka planı">Sayfa <input type="color" value={page.backgroundColor && /^#[0-9a-f]{6}$/i.test(page.backgroundColor) ? page.backgroundColor : "#ffffff"}
            onChange={(e) => updatePage((p) => ({ ...p, backgroundColor: e.target.value }))} /></label>
          {selected && <>
            <span className="design-toolbar-separator" />
            <button type="button" onClick={() => duplicateVisual(selected)} title="Seçili nesnenin kopyasını oluştur">Çoğalt</button>
            <button type="button" onClick={() => shiftLayer(selected.id, -1)} disabled={page.visuals[0]?.id === selected.id} title="Bir katman geriye al">Geriye</button>
            <button type="button" onClick={() => shiftLayer(selected.id, 1)} disabled={page.visuals.at(-1)?.id === selected.id} title="Bir katman öne al">Öne</button>
            <button type="button" onClick={() => updateVisual({ ...selected, format: { ...selected.format, locked: !selected.format.locked } })}
              aria-pressed={!!selected.format.locked} title="Nesneyi kilitle veya kilidi aç">{selected.format.locked ? "Kilidi aç" : "Kilitle"}</button>
            <label className="design-opacity" title="Seçili nesnenin saydamlığı">Opaklık
              <input type="range" min="0" max="100" value={Math.round((selected.format.opacity ?? 1) * 100)}
                onChange={(e) => updateVisual({ ...selected, format: { ...selected.format, opacity: Number(e.target.value) / 100 } })} />
              <span>{Math.round((selected.format.opacity ?? 1) * 100)}%</span>
            </label>
          </>}
        </div>
        <PageCanvas
          page={page}
          previewActions={previewActions}
          visibleOverrides={previewVisibility[page.id] ?? {}}
          previewStates={previewStates}
          onPreviewState={(id, state) => setPreviewStates((current) => ({ ...current, [id]: state }))}
          onAction={runAction}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onChange={updateVisual}
          onDelete={deleteVisual}
          onDropField={dropOnCanvas}
          onDropOnVisual={(id, f) => {
            const v = page.visuals.find((x) => x.id === id);
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
            setDrill({ pageId: t.page.id, from: page.id, filters: t.filters, label: t.label });
            setPageId(t.page.id);
            setSelectedId(null);
            setCross(null);
          }}
          banner={
            drill && pageFilters.length > 0 ? (
              <DrillBanner
                label={drill.label}
                onBack={() => {
                  setPageId(drill.from);
                  setDrill(null);
                  setCross(null);
                }}
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
      <VisualizationsPane
        page={page}
        pages={report.pages}
        onPageChange={(next) => updatePage(() => next)}
        visual={selected}
        onPickType={pickType}
        onChange={updateVisual}
        onDropToWell={(well, f) => selected && updateVisual(addField(selected, f, well.key, well.slot))}
        onMoveWell={(from, to, index) => {
          if (!selected) return;
          const source = VISUAL_DEFS[selected.type].wells.find((w) => w.key === from.key && w.slot === from.slot);
          if (source) updateVisual(moveWellItem(selected, source, from.index, to, index, columnOf));
        }}
      />
      <FieldsPane tables={tables} visual={selected} onToggle={toggleField} onEditMeasure={host.onEditMeasure} />
    </div>
  );
}
