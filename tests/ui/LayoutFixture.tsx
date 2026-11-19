import { useState } from "react";
import type { ModelTable, ReportDefinition, Visual } from "../../packages/client/src/index";
import { ReportDesigner } from "../../packages/designer/src/ReportDesigner";
import { ReportViewer, createTheme, themeStyle } from "../../packages/report/src/index";

const node = (id: string, patch: Partial<Visual>): Visual => ({ id, type: "text", x: 80, y: 120, w: 220, h: 80,
  group: [], values: [], filters: [], format: { showTitle: false, text: id, padding: 8 }, ...patch });
const initial: ReportDefinition = { version: 1, pages: [{ id: "layout", name: "Yerleşim", width: 1280, height: 820, visuals: [
  node("a", { title: "Başlık A", format: { showTitle: false, text: "Satış ve büyüme", fontSize: 24 } }),
  node("b", { x: 360, title: "Başlık B", format: { showTitle: false, text: "Operasyon özeti", fontSize: 24 } }),
  node("frame", { type: "container", title: "Açıklama ve KPI", x: 720, y: 120, w: 450, h: 180,
    container: { mode: "vertical", gap: 12, padding: 16, autoHeight: true, overflow: "visible" },
    format: { showTitle: false, padding: 0, backgroundColor: "#edf5ff", borderColor: "#86b6f0" } }),
  node("explanation", { parentId: "frame", x: 16, y: 16, w: 418, h: 32, title: "Açıklama",
    format: { showTitle: false, text: "Kısa açıklama", fontSize: 18, textOverflow: "grow", padding: 0 } }),
  node("amount", { type: "card", title: "Satış tutarı", parentId: "frame", x: 16, y: 60, w: 418, h: 90,
    values: [{ table: "T", column: "N", agg: "sum" }], format: { showTitle: false } }),
  node("toggle", { type: "button", title: "Bölüm görünürlüğü", x: 80, y: 460, w: 260, h: 54,
    format: { showTitle: false, padding: 0, text: "KPI bölümünü aç / kapat", action: { type: "toggle", visualId: "frame" } } }),
] }] };
let holds: (() => void)[] = [], holding = false;
const tables: ModelTable[] = [{ ad: "T", kaynak: { katman: "veri", tablo: "T" }, mod: "import", gizli: false,
  sutunlar: [{ ad: "N", tip: "double", gizli: false, anahtar: false }], olculer: [], hiyerarsiler: [] }];

export function LayoutFixture() {
  const [report, setReport] = useState(initial), [epoch, setEpoch] = useState(0), [viewer, setViewer] = useState(false);
  const save = async (next: ReportDefinition) => {
    if (holding) await new Promise<void>((done) => holds.push(done));
    Object.assign(window, { savedLayout: next });
    setReport(next);
  };
  Object.assign(window, {
    initialLayout: initial,
    loadLayout: (next: ReportDefinition) => { setReport(next); setEpoch((n) => n + 1); },
    layoutViewer: setViewer,
    holdLayoutSaves: () => { holding = true; },
    releaseLayoutSaves: () => { holding = false; const pending = holds; holds = []; pending.forEach((done) => done()); },
  });
  const run = async () => ({ columns: [{ name: "Tutar", type: "double", kind: "value" as const }], rows: [[42]], truncated: false });
  return <div className="studio" style={{ ...themeStyle(createTheme()), height: "100vh" }}>{viewer ? <ReportViewer key={epoch} report={report} run={run} />
    : <ReportDesigner key={epoch} host={{ report, tables, dataRev: "layout", save, run, onError: console.error }} />}</div>;
}
