import { ReportThemeScope, themedVisual } from "./theme";
import { ImportCompatibility } from "./ImportCompatibility";
import type { FilterRef, ReportDefinition, ReportPage, Visual, VisualAction, VisualState } from "@floem/client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { journeyFilters, journeySlicers } from "./reportJourney";
import { useReportJourney } from "./useReportJourney";
import { ReportViewport } from "./ReportViewport";
import { pageBackground } from "./pageAppearance";
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
import { choosePageLayout, resolvePageVariant } from "./pageLayouts";
import { BindingProvider, RuntimeFrame } from "./BindingRuntime";

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
  const queryRevision = `${dataRev}:${actionRev}:${JSON.stringify(report.analytics ?? null)}`;
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const journey = useReportJourney<{ pageId: typeof pageId; drill: typeof drill; cross: typeof cross; states: typeof states; visibility: typeof visibility }>((s) => {
    setPageId(s.pageId); setDrill(s.drill); setCross(s.cross); setStates(s.states); setVisibility(s.visibility);
  });
  const remember = () => journey.push({ pageId, drill, cross, states, visibility });
  const goBack = () => { if (!journey.back() && drill) { setPageId(drill.from); setDrill(null); setCross(null); } };
  useEffect(() => { journey.clear(); setDrill(null); setCross(null); }, [report]);

  const root = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const base = report.pages.find((p) => p.id === pageId) ?? report.pages[0];
  useLayoutEffect(() => {
    const element = root.current; if (!element) return;
    const resize = () => setAvailableWidth(element.clientWidth);
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    return () => observer.disconnect();
  }, [!!base]);
  const choice = choices[base?.id ?? ""] ?? "auto";
  const variantId = base ? choice === "auto" ? choosePageLayout(base, availableWidth) : base.layouts?.some((v) => v.id === choice) ? choice : null : null;
  const page = useMemo(() => base && resolvePageVariant(base, variantId), [base, variantId]);
  const viewKey = `${page?.id}:${variantId ?? "base"}`;
  const layout = usePageLayout(page ?? emptyPage, JSON.stringify(visibility[page?.id ?? ""] ?? {}), viewKey);
  if (!page) return <div className="viewer-empty">Bu raporda sayfa yok.</div>;
  // Power BI "Sayfaya sığdır" görünümü
  const pageFilters = drill && drill.pageId === page.id ? drill.filters : [];

  function runAction(visual: Visual, chosen?: VisualAction, source?: ActionValue, rowFilters: FilterRef[] = []) {
    const action = resolveVisualAction(visual, report.pages, page.id, chosen, source);
    if (!action) return;
    if (action.type === "page") {
      action.filters = action.keepContext ? journeyFilters(pageFilters, visual.filters, slicerFilters(page.visuals, states), crossFiltersFor(visual, cross), rowFilters, action.filters)
        : rowFilters.length ? rowFilters : action.filters;
      remember();
      if (action.keepContext) setStates((old) => journeySlicers(report.pages.find((p) => p.id === action.pageId)!, action.filters ?? [], old));
      setPageId(action.pageId);
      setCross(null);
      setDrill({ pageId: action.pageId, from: page.id, filters: action.filters ?? [], label: action.label ?? (action.keepContext ? "Firma, dönem ve seçim kapsamı" : "Sayfa geçişi") });
    } else if (action.type === "back") {
      goBack();
    } else if (action.type === "reset") {
      journey.clear();
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
        ...slicerFilters(page.visuals, states), ...rowFilters, ...sourceFilter];
      setActionNotice("FDX ölçüsü hesaplanıyor…");
      void runMeasureAction(run, action.measure, filters).then(setActionNotice)
        .catch((error) => setActionNotice(`FDX ölçüsü çalıştırılamadı: ${String(error)}`));
    } else if (action.type === "function") {
      if (action.name === "refresh") setActionRev((rev) => rev + 1);
      else if (action.name === "clearSelection") { setCross(null); setDrill(null); journey.clear(); }
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
    <div className="viewer" ref={root} data-layout-id={variantId ?? "base"}>
      <ImportCompatibility audit={report.importAudit} />
      <ReportViewport page={page} theme={report.theme} viewKey={viewKey} width={page.width} height={layout.height} onBackground={() => setCross(null)}
        tools={base.layouts?.length ? <label className="viewer-layout-choice">Düzen <select aria-label="Görüntüleme düzeni" value={choice} onChange={(e) => setChoices((old) => ({ ...old, [page.id]: e.target.value }))}>
          <option value="auto">Otomatik · {base.layouts.find((v) => v.id === variantId)?.name ?? "Ana"}</option>
          <option value="base">Ana düzen</option>{base.layouts.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select></label> : undefined} banner={drill && (pageFilters.length > 0 || journey.count > 0) && (
          <DrillBanner
            label={drill.label}
            onBack={goBack}
          />
        )}>
        {(scale) => (
        <ReportThemeScope rootRef={layout.root} theme={report.theme} className="page" style={{ width: page.width * scale, height: layout.height * scale, backgroundColor: pageBackground(page, report.theme) }}>
          {page.visuals.length === 0 && <div className="page-hint">Bu sayfada görsel yok.</div>}
          <BindingProvider key={page.id} visuals={page.visuals} definitions={report.components}>
          {layout.visuals.filter((v) => visibleInLayout(page, v, visibility[page.id] ?? {})).map((v) => {
            const raw = page.visuals.find((node) => node.id === v.id)!;
            const title = visualTitle(v);
            return (
              <VisualContextMenu key={`${page.id}:${v.id}`} visual={v}>
              <RuntimeFrame visual={v.type === "text" ? { ...v, h: raw.h } : v} run={run} revision={queryRevision}
                extra={[...pageFilters, ...crossFiltersFor(v, cross), ...slicerFilters(page.visuals, states, v.id)]}
                selected={cross?.visualId === v.id}
                key={v.id}
                data-visual-id={v.id}
                className={`visual readonly ${v.format.action && v.format.action.type !== "none" ? "actionable" : ""} ${v.format.showTitle === false ? "no-title" : ""} ${v.type === "container" ? "container-frame" : ""} ${v.type === "shape" || v.type === "image" ? "shape-frame" : ""} ${visualMotion(v)}`}
                style={{ left: v.x * scale, top: v.y * scale, width: v.w, height: v.h, scale, transformOrigin: "top left", ...visualStyle(themedVisual(v.type === "text" ? { ...v, h: raw.h } : v, report.theme)), ...inheritedLayoutStyle(page, v, layout.visuals) }}
                role={v.format.action && v.type !== "button" ? "button" : undefined}
                tabIndex={0}
                onKeyDown={(e) => { if (v.format.action && v.type !== "button" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); runAction(v); } }}
                onClick={(e) => { e.stopPropagation(); if (v.type !== "button" && v.format.action) runAction(v); }}
              >{(boundV) => <>
                <div className="visual-head">
                  <span className="visual-title" title={title}>{title}</span>
                  <DrillThroughButton
                    targets={drillTargets(report.pages, page.id, v, cross)}
                    onGo={(t) => {
                      remember();
                      const filters = journeyFilters(pageFilters, slicerFilters(page.visuals, states), t.filters);
                      setStates((old) => journeySlicers(t.page, filters, old));
                      setDrill({ pageId: t.page.id, from: page.id, filters, label: t.label });
                      setPageId(t.page.id);
                      setCross(null);
                    }}
                  />
                </div>
                <div className="visual-content">
                  <VisualBody
                    v={boundV}
                    extra={[...pageFilters, ...crossFiltersFor(v, cross), ...slicerFilters(page.visuals, states, v.id)]}
                    detailReady={pageFilters.length > 0 || (!!cross && cross.visualId !== v.id)}
                    onCrossRow={(row) => setCross(toggleCrossRow(v, cross, row))}
                    onRowAction={v.format.rowAction ? (value) => runAction(v, v.format.rowAction!.action,
                      rowActionValue(v, v.format.rowAction!.sourceIndex, value)) : undefined}
                    onAction={(chosen, source, filters) => runAction(v, chosen, source, filters)}
                    pageWidth={page.width} pageHeight={layout.height}
                    dataRev={queryRevision}
                    cross={cross}
                    onCross={(value) => setCross(toggleCross(v, cross, value))}
                    run={run}
                    state={states[v.id] ?? v.state}
                    onState={(s) => setStates((x) => ({ ...x, [v.id]: s }))}
                  />
                </div>
              </>}</RuntimeFrame>
              </VisualContextMenu>
            );
          })}</BindingProvider>
        </ReportThemeScope>)}
      </ReportViewport>
      {report.pages.length > 1 && (
        <nav className="page-tabs" aria-label="Sayfalar">
          {report.pages.map((p) => (
            <button
              key={p.id}
              className={`page-tab ${p.id === page.id ? "active" : ""}`}
              onClick={() => {
                journey.clear();
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
