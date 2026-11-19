import { createRoot } from "react-dom/client";
import { StrictMode, useState } from "react";
import { VisualBody, visualStyle, ReportViewer, AgDataGrid, VISUAL_DEFS } from "../../packages/report/src/index";
import { ReportDesigner } from "../../packages/designer/src/ReportDesigner";
import type { ReportDefinition, Visual, VisualFormat, VisualResult, VisualQuery, VisualType } from "../../packages/client/src/index";
import { tableExportBlob, type TableExportKind } from "../../packages/report/src/tableExport";
import { MatrixFixture } from "./MatrixFixture";
import { ApplicationThemeControl, createTheme } from "../../packages/report/src/index";

const result = (value: number | null): VisualResult => ({
  columns: [{ name: "Tutar", kind: "value", type: "double" }], rows: [[value]], truncated: false,
});
let broken = true;
let rejected = true;
Object.assign(window, { repairVisual: () => { broken = false; rejected = false; } });
const run = (id: string) => async () => {
  if (id === "broken" && broken) return { ...result(1), rows: null } as unknown as VisualResult;
  if (id === "rejected" && rejected) throw new Error("Deneme sorgusu hatası");
  return result(id === "null" ? null : id === "zero" ? 0 : 42);
};
const noop = () => {};
const visual = (id: string, overrides: Partial<Visual> = {}): Visual => ({
  id, type: "card", x: 0, y: 0, w: 240, h: 100, group: [],
  values: [{ table: "T", column: "N", agg: "sum" }], filters: [], format: { showTitle: false }, ...overrides,
});
const fixtures = [
  ...["broken", "rejected", "zero", "null"].map((id) => visual(id)),
  visual("heading", { type: "text", h: 46, format: { showTitle: false, padding: 0, fontSize: 30, text: "Satış Özeti" } }),
  visual("grow", { type: "text", h: 24, format: { showTitle: false, padding: 0, textOverflow: "grow", text: "Uzun açıklama\nİkinci satır\nÜçüncü satır" } }),
  visual("ellipsis", { type: "text", h: 36, format: { showTitle: false, padding: 0, textOverflow: "ellipsis", text: "Sığmayan uzun Türkçe müşteri açıklaması ve ayrıntıları" } }),
];
const report: ReportDefinition = { version: 1, pages: [{ id: "p1", name: "Deneme", width: 1280, height: 860, visuals: [
  visual("move", { type: "text", x: 100, y: 100, w: 400, h: 60, values: [], format: { showTitle: false, fontSize: 24, text: "Floem BI · Tasarım denemesi" } }),
  visual("full-width", { type: "shape", x: 0, y: 700, w: 1280, h: 160, values: [], format: { showTitle: false, backgroundColor: "#0866e8" } }),
] }] };
const save = async (value: ReportDefinition) => { Object.assign(window, { savedReport: value }); };
const runReport = async () => result(42);
const menuTypes = Object.keys(VISUAL_DEFS) as VisualType[];
const menuReport: ReportDefinition = { version: 1, pages: [{ id: "objects", name: "Nesneler", width: 1280, height: 2200,
  visuals: menuTypes.map((type, index) => visual(`object-${type}`, { type, x: (index % 3) * 420, y: Math.floor(index / 3) * 240, w: 400, h: 220,
    group: [ { table: "T", column: "Bölge" }, ...(["matrix", "treegrid"].includes(type) ? [{ table: "T", column: "Şehir" }] : []) ],
    legend: [ { table: "T", column: "Dönem" } ],
    values: [{ table: "T", column: "N", agg: "sum" }, ...(type === "scatter" ? [{ table: "T", column: "N", agg: "max" as const }] : [])],
    format: { showTitle: false, text: "Nesne metni", action: type === "button" ? { type: "page", pageId: "second" } : undefined },
  })) }, { id: "second", name: "İkinci sayfa", width: 1280, height: 860, visuals: [] }] };
let holdMenuQueries = false;
const heldMenuQueries: (() => void)[] = [];
Object.assign(window, { pauseMenuQueries: () => { holdMenuQueries = true; }, resumeMenuQueries: () => {
  holdMenuQueries = false; heldMenuQueries.splice(0).forEach((done) => done());
} });
const runMenuReport = async (q: VisualQuery): Promise<VisualResult> => {
  if (holdMenuQueries) await new Promise<void>((done) => heldMenuQueries.push(done));
  return ({
  columns: [...q.group.map((g) => ({ name: g.column, kind: "group" as const, type: "string" })),
    ...q.values.map((_, i) => ({ name: `Değer ${i + 1}`, kind: "value" as const, type: "double" }))],
  rows: (q.group.length ? [1, 2] : [1]).map((i) => [...q.group.map((g) => `${g.column} ${i}`), ...q.values.map(() => i * 10)]), truncated: false,
}); };
const gridResult: VisualResult = {
  columns: [{ name: "Müşteri", kind: "group", type: "string" }, { name: "Tutar", kind: "value", type: "double" }],
  rows: [["Alpha", 1], ["Beta", 2], ["Gamma", 3]], total: [6], truncated: false,
};
function GridFixture() {
  const [format, setFormat] = useState<VisualFormat>({});
  const [data, setData] = useState(gridResult);
  Object.assign(window, { setGridResult: setData, setGridOptions: (patch: VisualFormat) => setFormat((old) => ({ ...old, ...patch })) });
  return <div className="grid-fixture" style={{ width: 700, height: 400 }}><AgDataGrid result={data} format={format} /></div>;
}
Object.assign(window, { exportSample: async (kind: TableExportKind) => {
  const table = {
    columns: Array.from({ length: 8 }, (_, i) => ({ name: i === 0 ? "Müşteri / Açıklama" : `Ölçü ${i}`, kind: i === 0 ? "group" as const : "value" as const, type: i === 0 ? "string" : "double" })),
    rows: Array.from({ length: 120 }, (_, i) => [`İstanbul Şubesi ${i + 1} - Çığ ÖĞÜŞİ ıçi uzun açıklama`, ...Array.from({ length: 7 }, (_, j) => (i + 1) * (j + 1))]), truncated: true,
  };
  const blob = await tableExportBlob(table, kind);
  return new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
} });
function App() {
  const [mode, setMode] = useState("fixtures");
  const [allReport, setAllReport] = useState(menuReport);
  Object.assign(window, { setTestMode: setMode, menuTypes, setAllReport });
  if (mode === "grid") return <GridFixture />;
  if (mode === "matrix") return <MatrixFixture />;
  if (mode === "theme") return <div className="studio theme-fixture" style={{ height: "100vh" }}><ApplicationThemeControl />
    <ReportDesigner host={{ report: { ...report, theme: createTheme("electric", "light") }, tables: [], dataRev: "theme", run: runReport, save, onError: console.error }} />
  </div>;
  if (mode !== "fixtures") return <div className="studio" style={{ height: "100vh" }}>
    {mode.endsWith("viewer") ? <ReportViewer report={mode.startsWith("all") ? allReport : report} run={mode.startsWith("all") ? runMenuReport : runReport} /> :
      <ReportDesigner host={{ report: mode.startsWith("all") ? allReport : report, tables: [], dataRev: "test", run: mode.startsWith("all") ? runMenuReport : runReport, save, onError: console.error }} />}
  </div>;
  return <div className="fixtures">{fixtures.map((v) => <section data-fixture={v.id} key={v.id}>
    <div className="visual no-title" style={{ position: "relative", width: v.w, height: v.h, ...visualStyle(v) }}>
      <div className="visual-content"><VisualBody v={v} extra={[]} dataRev="test" cross={null} onCross={noop} run={run(v.id)} /></div>
    </div>
  </section>)}</div>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
