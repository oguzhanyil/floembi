import { ReportThemeScope, themedVisual } from "./theme";
import { ImportCompatibility } from "./ImportCompatibility";
import type { FilterRef, ReportDefinition, ReportPage, Visual, VisualAction, VisualState } from "@floem/client";
import { useState } from "react";
import { ReportViewport } from "./ReportViewport";
import { VisualContextMenu } from "./VisualContextMenu";
import {
  DrillBanner, DrillThroughButton, VisualBody, crossFiltersFor, drillTargets, toggleCross, toggleCrossRow, visualTitle,
  type CrossFilter,
} from "./VisualBody";
import { slicerFilters, type QueryFn } from "./useVisualData";
import { visualMotion, visualStyle } from "./visualStyle";
import { resolveVisualAction, rowActionValue, runMeasureAction, visualIsVisible, type ActionValue } from "./visualActions";
import { usePageLayout } from "./usePageLayout";
import { visibleInLayout, inheritedLayoutStyle } from "./layout";

const emptyPage: ReportPage = { id: "empty", name: "", width: 1280, height: 720, visuals: [] };

/**
 * Salt okunur ama etkileşimli rapor görüntüleyici (floembi.app): sayfa sekmeleri,
 * görseller, çapraz filtre. Düzenleme Desktop'ta; web'de düzenleme geldiğinde aynı
 * görseller kullanılacak.
 */
export function ReportViewer({
  report, run, dataRev = "", initialPage,
}: {
  report: ReportDefinition;
  run: QueryFn;
  /** Değişince tüm görseller yeniden sorgulanır (yeni yayımlama, yenileme) */
  dataRev?: string;
  initialPage?: string;
}) {
  const [pageId, setPageId] = useState(initialPage ?? report.pages[0]?.id);
  const [cross, setCross] = useState<CrossFilter | null>(null);
  // Detaya git: hangi sayfaya, hangi filtrelerle, nereden gelindi
  const [drill, setDrill] = useState<{ pageId: string; from: string; filters: FilterRef[]; label: string } | null>(null);
  // İzleyicinin dilimleyici seçimleri ve sıralamaları yalnızca bu ekranda yaşar (raporu değiştirmez)
  const [states, setStates] = useState<Record<string, VisualState>>({});
  const [visibility, setVisibility] = useState<Record<string, Record<string, boolean>>>({});
  const [actionRev, setActionRev] = useState(0);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const page = report.pages.find((p) => p.id === pageId) ?? report.pages[0];
  const layout = usePageLayout(page ?? emptyPage, JSON.stringify(visibility[page?.id ?? ""] ?? {}));
  if (!page) return <div className="viewer-empty">Bu raporda sayfa yok.</div>;
  // Power BI "Sayfaya sığdır" görünümü
  const pageFilters = drill && drill.pageId === page.id ? drill.filters : [];

  function runAction(visual: Visual, chosen?: VisualAction, source?: ActionValue) {
    const action = resolveVisualAction(visual, report.pages, page.id, chosen, source);
    if (!action) return;
    if (action.type === "page") {
      setPageId(action.pageId);
      setCross(null);
      setDrill(action.filters?.length ? { pageId: action.pageId, from: page.id, filters: action.filters, label: action.label ?? "Satır değeri" } : null);
    } else if (action.type === "reset") {
      setCross(null);
      setDrill(null);
      setVisibility({});
      setStates(Object.fromEntries(report.pages.flatMap((item) => item.visuals.filter((v) => v.type === "slicer").map((v) => [v.id, {}]))));
    } else if (action.type === "url") {
      window.open(action.url, "_blank", "noopener,noreferrer");
    } else if (action.type === "measure") {
      const sourceFilter: FilterRef[] = action.source?.table && action.source.column && action.source.value !== null
        ? [{ table: action.source.table, column: action.source.column, op: "in", values: [action.source.value] }] : [];
      const filters = [...visual.filters, ...pageFilters, ...crossFiltersFor(visual, cross),
        ...slicerFilters(page.visuals, states), ...sourceFilter];
      setActionNotice("FDX ölçüsü hesaplanıyor…");
      void runMeasureAction(run, action.measure, filters).then(setActionNotice)
        .catch((error) => setActionNotice(`FDX ölçüsü çalıştırılamadı: ${String(error)}`));
    } else if (action.type === "function") {
      if (action.name === "refresh") setActionRev((rev) => rev + 1);
      else if (action.name === "clearSelection") { setCross(null); setDrill(null); }
      else if (action.name === "filterByValue" && action.source?.table && action.source.column && action.source.value !== null)
        setCross({ visualId: visual.id, table: action.source.table, column: action.source.column, value: action.source.value });
    } else {
      const target = page.visuals.find((item) => item.id === action.visualId);
      if (!target) return;
      setVisibility((current) => {
        const before = current[page.id] ?? {};
        return { ...current, [page.id]: { ...before, [target.id]: !visualIsVisible(target, before) } };
      });
    }
  }

  return (
    <div className="viewer">
      <ImportCompatibility audit={report.importAudit} />
      <ReportViewport width={page.width} height={page.height} onBackground={() => setCross(null)} banner={drill && pageFilters.length > 0 && (
          <DrillBanner
            label={drill.label}
            onBack={() => {
              setPageId(drill.from);
              setDrill(null);
              setCross(null);
            }}
          />
        )}>
        {(scale) => (
        <ReportThemeScope rootRef={layout.root} theme={report.theme} className="page" style={{ width: page.width * scale, height: page.height * scale, backgroundColor: page.backgroundColor || undefined }}>
          {page.visuals.length === 0 && <div className="page-hint">Bu sayfada görsel yok.</div>}
          {layout.visuals.filter((v) => visibleInLayout(page, v, visibility[page.id] ?? {})).map((v) => {
            const raw = page.visuals.find((node) => node.id === v.id)!;
            const title = visualTitle(v);
            return (
              <VisualContextMenu key={`${page.id}:${v.id}`} visual={v}>
              <div
                key={v.id}
                data-visual-id={v.id}
                className={`visual readonly ${v.format.action && v.format.action.type !== "none" ? "actionable" : ""} ${v.format.showTitle === false ? "no-title" : ""} ${v.type === "container" ? "container-frame" : ""} ${v.type === "shape" || v.type === "image" ? "shape-frame" : ""} ${visualMotion(v)}`}
                style={{ left: v.x * scale, top: v.y * scale, width: v.w, height: v.h, scale, transformOrigin: "top left", ...visualStyle(themedVisual(v.type === "text" ? { ...v, h: raw.h } : v, report.theme)), ...inheritedLayoutStyle(page, v, layout.visuals) }}
                role={v.format.action && v.type !== "button" ? "button" : undefined}
                tabIndex={0}
                onKeyDown={(e) => { if (v.format.action && v.type !== "button" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); runAction(v); } }}
                onClick={(e) => { e.stopPropagation(); if (v.type !== "button" && v.format.action) runAction(v); }}
              >
                <div className="visual-head">
                  <span className="visual-title" title={title}>{title}</span>
                  <DrillThroughButton
                    targets={drillTargets(report.pages, page.id, v, cross)}
                    onGo={(t) => {
                      setDrill({ pageId: t.page.id, from: page.id, filters: t.filters, label: t.label });
                      setPageId(t.page.id);
                      setCross(null);
                    }}
                  />
                </div>
                <div className="visual-content">
                  <VisualBody
                    v={v}
                    extra={[...pageFilters, ...crossFiltersFor(v, cross), ...slicerFilters(page.visuals, states, v.id)]}
                    detailReady={pageFilters.length > 0 || (!!cross && cross.visualId !== v.id)}
                    onCrossRow={(row) => setCross(toggleCrossRow(v, cross, row))}
                    onRowAction={v.format.rowAction ? (value) => runAction(v, v.format.rowAction!.action,
                      rowActionValue(v, v.format.rowAction!.sourceIndex, value)) : undefined}
                    onAction={(chosen) => runAction(v, chosen)}
                    pageWidth={page.width} pageHeight={page.height}
                    dataRev={`${dataRev}:${actionRev}`}
                    cross={cross}
                    onCross={(value) => setCross(toggleCross(v, cross, value))}
                    run={run}
                    state={states[v.id] ?? v.state}
                    onState={(s) => setStates((x) => ({ ...x, [v.id]: s }))}
                  />
                </div>
              </div>
              </VisualContextMenu>
            );
          })}
        </ReportThemeScope>)}
      </ReportViewport>
      {report.pages.length > 1 && (
        <nav className="page-tabs" aria-label="Sayfalar">
          {report.pages.map((p) => (
            <button
              key={p.id}
              className={`page-tab ${p.id === page.id ? "active" : ""}`}
              onClick={() => {
                setPageId(p.id);
                setCross(null);
                setDrill(null);
              }}
            >
              {p.name}
              {p.drillthrough?.length ? <span className="dt-mark" title="Detay (drill-through) sayfası">↪</span> : null}
            </button>
          ))}
        </nav>
      )}
      {actionNotice && <div className="v-action-notice" role="status"><span>{actionNotice}</span>
        <button type="button" aria-label="Mesajı kapat" onClick={() => setActionNotice(null)}>✕</button></div>}
    </div>
  );
}
