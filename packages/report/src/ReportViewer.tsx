import type { ReportDefinition } from "@floem/client";
import { useLayoutEffect, useRef, useState } from "react";
import { VisualBody, crossFiltersFor, toggleCross, visualTitle, type CrossFilter } from "./VisualBody";
import type { QueryFn } from "./useVisualData";

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
  const scale = box.w ? Math.max(0.2, Math.min((box.w - 32) / page.width, (box.h - 32) / page.height)) : 1;

  return (
    <div className="viewer">
      <div className="viewer-stage" ref={outer} onClick={() => setCross(null)}>
        <div className="page" style={{ width: page.width * scale, height: page.height * scale }}>
          {page.visuals.length === 0 && <div className="page-hint">Bu sayfada görsel yok.</div>}
          {page.visuals.map((v) => {
            const title = visualTitle(v);
            return (
              <div
                key={v.id}
                className="visual readonly"
                style={{ left: v.x * scale, top: v.y * scale, width: v.w * scale, height: v.h * scale }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="visual-head">
                  <span className="visual-title">{title}</span>
                </div>
                <div className="visual-content">
                  <VisualBody
                    v={v}
                    extra={crossFiltersFor(v, cross)}
                    dataRev={dataRev}
                    cross={cross}
                    onCross={(value) => setCross(toggleCross(v, cross, value))}
                    run={run}
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
              }}
            >
              {p.name}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
