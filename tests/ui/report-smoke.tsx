import { createRoot } from "react-dom/client";
import { StrictMode, useState } from "react";
import { VisualBody, visualStyle, ReportViewer } from "../../packages/report/src/index";
import { ReportDesigner } from "../../packages/designer/src/ReportDesigner";
import type { ReportDefinition, Visual, VisualResult } from "../../packages/client/src/index";

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
function App() {
  const [mode, setMode] = useState("fixtures");
  Object.assign(window, { setTestMode: setMode });
  if (mode !== "fixtures") return <div className="studio" style={{ height: "100vh" }}>
    {mode === "viewer" ? <ReportViewer report={report} run={runReport} /> :
      <ReportDesigner host={{ report, tables: [], dataRev: "test", run: runReport, save, onError: console.error }} />}
  </div>;
  return <div className="fixtures">{fixtures.map((v) => <section data-fixture={v.id} key={v.id}>
    <div className="visual no-title" style={{ position: "relative", width: v.w, height: v.h, ...visualStyle(v) }}>
      <div className="visual-content"><VisualBody v={v} extra={[]} dataRev="test" cross={null} onCross={noop} run={run(v.id)} /></div>
    </div>
  </section>)}</div>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
