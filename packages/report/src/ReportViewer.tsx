import type { FilterRef, ReportDefinition, VisualState } from "@floem/client";
import { useLayoutEffect, useRef, useState } from "react";
import {
  DrillBanner, DrillThroughButton, VisualBody, crossFiltersFor, drillTargets, toggleCross, toggleCrossRow, visualTitle,
  type CrossFilter,
} from "./VisualBody";
import { slicerFilters, type QueryFn } from "./useVisualData";
import { visualMotion, visualStyle } from "./visualStyle";

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
  const outer = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const page = report.pages.find((p) => p.id === pageId) ?? report.pages[0];
  if (!page) return <div className="viewer-empty">Bu raporda sayfa yok.</div>;
  // Power BI "Sayfaya sığdır" görünümü
  const pageFilters = drill && drill.pageId === page.id ? drill.filters : [];
  const scale = box.w ? Math.max(0.2, Math.min((box.w - 32) / page.width, (box.h - 32) / page.height)) : 1;

  return (
    <div className="viewer">
      <div className="viewer-stage" ref={outer} onClick={() => setCross(null)}>
        {drill && pageFilters.length > 0 && (
          <DrillBanner
            label={drill.label}
            onBack={() => {
              setPageId(drill.from);
              setDrill(null);
              setCross(null);
            }}
          />
        )}
        <div className="page" style={{ width: page.width * scale, height: page.height * scale }}>
          {page.visuals.length === 0 && <div className="page-hint">Bu sayfada görsel yok.</div>}
          {page.visuals.map((v) => {
            const title = visualTitle(v);
            return (
              <div
                key={v.id}
                className={`visual readonly ${v.type === "shape" || v.type === "image" ? "shape-frame" : ""} ${visualMotion(v)}`}
                style={{ left: v.x * scale, top: v.y * scale, width: v.w * scale, height: v.h * scale, ...visualStyle(v) }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="visual-head">
                  <span className="visual-title">{title}</span>
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
                    dataRev={dataRev}
                    cross={cross}
                    onCross={(value) => setCross(toggleCross(v, cross, value))}
                    run={run}
                    state={states[v.id] ?? v.state}
                    onState={(s) => setStates((x) => ({ ...x, [v.id]: s }))}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
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
    </div>
  );
}
