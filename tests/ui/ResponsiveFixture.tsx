import { useCallback, useState } from "react";
import type { ReportDefinition, Visual, VisualQuery, VisualResult } from "../../packages/client/src/index";
import { ReportDesigner } from "../../packages/designer/src/ReportDesigner";
import { ReportViewer } from "../../packages/report/src/index";

const node = (id: string, type: Visual["type"], x: number, y: number, w: number, h: number, format = {}): Visual =>
  ({ id, type, x, y, w, h, group: [], values: [], filters: [], format });
const initial: ReportDefinition = { version: 1, pages: [
  { id: "summary", name: "Özet", width: 1280, height: 900, visuals: [
    node("heading", "text", 40, 40, 1100, 60, { text: "Aynı veri, her ekranda okunabilir rapor", fontSize: 30, showTitle: false }),
    { ...node("region", "slicer", 40, 130, 260, 160), group: [{ table: "Sales", column: "Region" }] },
    { ...node("amount", "card", 340, 130, 360, 110, { fontSize: 30 }), title: "Net satış", values: [{ measure: "Sales" }] },
    { ...node("table", "table", 40, 350, 900, 240), title: "Bölge satışları", group: [{ table: "Sales", column: "Region" }], values: [{ measure: "Sales" }] },
    node("go", "button", 980, 350, 240, 44, { text: "Detaya git", showTitle: false, action: { type: "page", pageId: "detail" } }),
    node("toggle", "button", 980, 410, 240, 44, { text: "Açıklamayı aç", showTitle: false, action: { type: "toggle", visualId: "note" } }),
    node("note", "text", 40, 650, 1000, 70, { text: "Bütün düzenlerde ortak açıklama", initiallyHidden: true, showTitle: false }),
  ] },
  { id: "detail", name: "Detay", width: 1280, height: 720, visuals: [node("back", "button", 40, 40, 280, 48,
    { text: "Özete dön", showTitle: false, action: { type: "page", pageId: "summary" } })] },
] };
export function ResponsiveFixture() {
  const [report, setReport] = useState(initial), [viewer, setViewer] = useState(false), [width, setWidth] = useState("100%"), [webChrome, setWebChrome] = useState(false);
  const run = useCallback(async (q: VisualQuery): Promise<VisualResult> => {
    const testWindow = window as unknown as { responsiveQueries?: number; responsiveResults?: Record<string, VisualResult> };
    testWindow.responsiveQueries = (testWindow.responsiveQueries ?? 0) + 1;
    if (testWindow.responsiveResults) {
      const key = JSON.stringify([q.group ?? [], q.values ?? []]);
      const result = testWindow.responsiveResults[key];
      if (!result) throw new Error('Yerel demo doğrulama sonucu bulunamadı');
      return result;
    }
    const selected = q.filters?.find((f) => f.table === "Sales" && f.column === "Region")?.values;
    const rows = [["Kuzey", 42], ["Güney", 84]].filter((r) => !selected?.length || selected.includes(r[0]));
    const group = { name: "Region", kind: "group" as const, type: "string" };
    const value = { name: "Sales", kind: "value" as const, type: "double" };
    return q.group?.length ? q.values?.length ? { columns: [group, value], rows, truncated: false } :
      { columns: [group], rows: rows.map((r) => [r[0]]), truncated: false } :
      { columns: [value], rows: [[rows.reduce((sum, r) => sum + Number(r[1]), 0)]], truncated: false };
  }, []);
  const save = useCallback(async (r: ReportDefinition) => { setReport(r); Object.assign(window, { savedResponsive: r }); }, []);
  Object.assign(window, { responsiveViewer: setViewer, responsiveWidth: setWidth, responsiveReport: setReport, responsiveChrome: setWebChrome, savedResponsive: report });
  const content = viewer ? <ReportViewer report={report} run={run} /> : <ReportDesigner host={{ report, tables: [], dataRev: "responsive", run, save, onError: console.error }} />;
  return <div className="studio responsive-fixture" style={{ height: "100vh", width }}>
    {webChrome ? <div className="shell"><header className="topbar"><b>floembi.app</b><span className="spacer" /><span className="who">Test kullanıcısı</span></header>
      <nav className="sidenav"><a>Çalışma alanları</a><a>Uygulamalar</a></nav>
      <main className="content"><div className="report-page"><div className="report-bar"><div><strong>Uzun başlıklı satış, sipariş ve cari raporu</strong><span className="muted"> · Satış Ekibi · Son yayımlama 20 Kasım 2026 (Yönetici Kullanıcı) · sürüm 7</span></div>
        <span className="role">Görüntüleyici</span><button>⟳ Yenile</button><button className="primary">⤴ Paylaş</button></div><div className="report-body">{content}</div></div></main>
    </div> : content}
  </div>;
}
