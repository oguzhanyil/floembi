import type { ModelColumn, ReportDefinition, ReportPage, ValueRef, Visual, VisualType } from "@floem/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toUiError, useClient } from "../api";
import { useDocument } from "../document";
import { PageCanvas } from "./PageCanvas";
import { FieldsPane, VisualizationsPane } from "./ReportPanes";
import {
  VISUAL_DEFS, defaultAgg, defaultRole, newId, sameField, snap, usesColumn, type CrossFilter, type WellDef,
} from "@floem/report";
import "./report.css";

const SAVE_DELAY = 300;

/** Power BI rapor görünümü: sayfa tuvali, Görselleştirmeler ve Veri bölmeleri, sayfa sekmeleri. */
export function ReportView() {
  const client = useClient();
  const { doc, patchDoc, setError, registerFlush } = useDocument();
  const [report, setReport] = useState<ReportDefinition>(doc!.report);
  const reportRef = useRef(report);
  const lastSent = useRef(JSON.stringify(doc!.report));
  const timer = useRef<number | null>(null);
  const [pageId, setPageId] = useState(report.pages[0]?.id ?? "p1");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cross, setCross] = useState<CrossFilter | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  // Dışarıdan gelen değişiklik (dosya aç, yeniden adlandırma) yerel taslağı günceller
  useEffect(() => {
    const s = JSON.stringify(doc!.report);
    if (s !== lastSent.current) {
      lastSent.current = s;
      reportRef.current = doc!.report;
      setReport(doc!.report);
      if (!doc!.report.pages.some((p) => p.id === pageId)) setPageId(doc!.report.pages[0]?.id ?? "p1");
    }
  }, [doc, pageId]);

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
      const res = await client.setReport(r);
      patchDoc((d) => ({ ...d, report: r, dirty: res.dirty }));
    } catch (e) {
      setError(toUiError(e));
    }
  }, [client, patchDoc, setError]);

  useEffect(() => registerFlush(send), [registerFlush, send]);

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
  const tables = doc!.model.tablolar;

  const columnOf = useCallback(
    (table: string, column: string): ModelColumn | undefined =>
      tables.find((t) => t.ad === table)?.sutunlar.find((c) => c.ad === column),
    [tables],
  );

  // Veri ya da ilişkiler değişince görseller yeniden sorgulanır
  const dataRev = useMemo(
    () => JSON.stringify([doc!.stats, doc!.model.iliskiler, tables.map((t) => [t.ad, t.sutunlar.map((c) => c.tip)])]),
    [doc, tables],
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

  function addField(v: Visual, table: string, column: string, well?: WellDef["key"]): Visual {
    const c = columnOf(table, column);
    if (!c) return v;
    const role = well ?? defaultRole(c);
    const def = VISUAL_DEFS[v.type].wells.find((w) => w.key === role) ?? VISUAL_DEFS[v.type].wells[0];
    if (def.key === "group") {
      if (v.group.some((g) => sameField(g, { table, column }))) return v;
      const group = def.max && v.group.length >= def.max ? [{ table, column }] : [...v.group, { table, column }];
      return { ...v, group };
    }
    const value: ValueRef = { table, column, agg: defaultAgg(c) };
    const values = def.max && v.values.length >= def.max ? [value] : [...v.values, value];
    return { ...v, values };
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
      // Türü değiştir: uymayan alanları kırp (kart tek değer, grafik tek eksen alanı)
      const wells = VISUAL_DEFS[t].wells;
      const gMax = wells.find((w) => w.key === "group");
      const vMax = wells.find((w) => w.key === "values");
      updateVisual({
        ...selected,
        type: t,
        group: gMax ? (gMax.max ? selected.group.slice(0, gMax.max) : selected.group) : [],
        values: vMax?.max ? selected.values.slice(0, vMax.max) : selected.values,
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
      updateVisual({
        ...selected,
        group: selected.group.filter((g) => !(g.table === table && g.column === column)),
        values: selected.values.filter((x) => "measure" in x || !(x.table === table && x.column === column)),
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
        onDropToWell={(well, t, c) => selected && updateVisual(addField(selected, t, c, well))}
      />
      <FieldsPane tables={tables} visual={selected} onToggle={toggleField} />
    </div>
  );
}
