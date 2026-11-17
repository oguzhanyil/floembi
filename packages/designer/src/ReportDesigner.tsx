import type { ModelColumn, ModelTable, ReportDefinition, ReportPage, ValueRef, Visual, VisualType } from "@floem/client";
import {
  VISUAL_DEFS, defaultAgg, defaultRole, newId, sameField, snap, usesColumn, type CrossFilter, type QueryFn, type WellKey,
} from "@floem/report";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageCanvas } from "./PageCanvas";
import { FieldsPane, VisualizationsPane } from "./ReportPanes";
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
  const [cross, setCross] = useState<CrossFilter | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  // Dışarıdan gelen değişiklik (dosya aç, yeniden adlandırma) yerel taslağı günceller
  useEffect(() => {
    const s = JSON.stringify(host.report);
    if (s !== lastSent.current) {
      lastSent.current = s;
      reportRef.current = host.report;
      setReport(host.report);
      if (!host.report.pages.some((p) => p.id === pageId)) setPageId(host.report.pages[0]?.id ?? "p1");
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

  function deleteVisual(id: string) {
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

  /** Alanı görsele ekler: kutu verilmezse alanın türüne göre (sayı → değer, diğerleri → gruplama). */
  function addField(v: Visual, table: string, column: string, well?: WellKey, slot?: number): Visual {
    const c = columnOf(table, column);
    if (!c) return v;
    const wells = VISUAL_DEFS[v.type].wells;
    const wanted = well ?? defaultRole(c);
    // İstenen kutu bu görselde yoksa ilk uygun kutuya (ör. dilimleyiciye sayı → Alan)
    const def =
      wells.find((w) => w.key === wanted) ??
      wells.find((w) => (wanted === "group" || wanted === "legend" ? w.key === "group" : w.key === "values")) ??
      wells[0];
    const field = { table, column };
    if (def.key === "group" || def.key === "legend") {
      const cur = def.key === "group" ? v.group : v.legend ?? [];
      if (cur.some((g) => sameField(g, field))) return v;
      const next = def.max && cur.length >= def.max ? [field] : [...cur, field];
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
    return { id: newId("v", ids), type, ...pos, w, h, group: [], values: [], filters: [], format: {} };
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

  function dropOnCanvas(table: string, column: string, x: number, y: number) {
    const c = columnOf(table, column);
    if (!c) return;
    // Power BI: sayısal alan sütun grafiği, diğerleri tablo oluşturur
    const v = createVisual(defaultRole(c) === "values" ? "column" : "table", { x, y });
    insert(addField(v, table, column));
  }

  function toggleField(table: string, column: string, checked: boolean) {
    if (!checked) {
      if (!selected) return;
      const keep = (g: { table: string; column: string }) => !(g.table === table && g.column === column);
      const keepV = (x: ValueRef) => "measure" in x || keep(x);
      updateVisual({
        ...selected,
        group: selected.group.filter(keep),
        legend: (selected.legend ?? []).filter(keep),
        values: selected.values.filter(keepV),
        target: (selected.target ?? []).filter(keepV),
      });
      return;
    }
    if (selected && !usesColumn(selected, table, column)) {
      updateVisual(addField(selected, table, column));
    } else if (!selected) {
      const c = columnOf(table, column);
      if (!c) return;
      insert(addField(createVisual(defaultRole(c) === "values" ? "column" : "table"), table, column));
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

  return (
    <div className="report-view">
      <div className="report-main">
        <PageCanvas
          page={page}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onChange={updateVisual}
          onDelete={deleteVisual}
          onDropField={dropOnCanvas}
          onDropOnVisual={(id, t, c) => {
            const v = page.visuals.find((x) => x.id === id);
            if (v) updateVisual(addField(v, t, c));
            setSelectedId(id);
          }}
          dataRev={dataRev}
          cross={cross}
          setCross={setCross}
          columnOf={columnOf}
          run={host.run}
        />
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
                }}
                onDoubleClick={() => setRenaming(p.id)}
                title="Yeniden adlandırmak için çift tıklayın"
              >
                {p.name}
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
        visual={selected}
        onPickType={pickType}
        onChange={updateVisual}
        onDropToWell={(well, t, c) => selected && updateVisual(addField(selected, t, c, well.key, well.slot))}
      />
      <FieldsPane tables={tables} visual={selected} onToggle={toggleField} />
    </div>
  );
}
