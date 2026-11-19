import { useState } from "react";
import type { ComponentLibrary, ComponentLibraryStore, ModelTable, ReportDefinition, VisualQuery, Visual } from "../../packages/client/src/index";
import { ReportDesigner } from "../../packages/designer/src/ReportDesigner";
import { ReportViewer, createTheme, themeStyle } from "../../packages/report/src/index";
import { mergeDefinitions } from "../../packages/designer/src/components";

const node = (id: string, patch: Partial<Visual>): Visual => ({ id, type: "text", x: 0, y: 0, w: 340, h: 54, group: [], values: [], filters: [], format: {}, ...patch });
const initial: ReportDefinition = { version: 1, pages: [{ id: "source", name: "Kaynak", width: 1280, height: 720, visuals: [
  node("frame", { type: "container", x: 60, y: 70, w: 400, h: 240, title: "Özet", container: { mode: "vertical", gap: 12, padding: 20 }, format: { showTitle: false, radius: 12, padding: 0 } }),
  node("heading", { parentId: "frame", format: { showTitle: false, text: "Satış ve operasyon", fontSize: 20, color: "#0866e8", padding: 0 } }),
  node("amount", { parentId: "frame", type: "card", values: [{ measure: "Satış" }], format: { showTitle: false, padding: 0, fontSize: 36 } }),
  node("toggle", { parentId: "frame", type: "button", format: { showTitle: false, text: "Değeri göster / gizle", action: { type: "toggle", visualId: "amount" } } }),
] }, { id: "second", name: "İkinci sayfa", width: 1280, height: 720, visuals: [] }] };
let library: ComponentLibrary = { version: 1, revision: 0, components: [] };
const store: ComponentLibraryStore = {
  async load() { return structuredClone(library); },
  async save(components, revision) { if (revision !== library.revision) throw new Error("Kitaplık değişti"); library = { version: 1, revision: revision + 1, components: mergeDefinitions(components) }; Object.assign(window, { savedLibrary: library }); return structuredClone(library); },
};
const tables: ModelTable[] = [{ ad: "T", kaynak: { katman: "veri", tablo: "T" }, mod: "import", gizli: false, hiyerarsiler: [], sutunlar: [], olculer: ["Satış", "Sipariş"].map((ad) => ({ ad, ifade: "1" })) }];
const run = async (q: VisualQuery) => ({ columns: q.values.map((v) => ({ name: v.measure ?? "Değer", kind: "value" as const, type: "double" })), rows: [q.values.map((v) => v.measure === "Sipariş" ? 72 : 42)], truncated: false });
export function ComponentFixture() {
  const [report, setReport] = useState(initial), [epoch, setEpoch] = useState(0), [viewer, setViewer] = useState(false);
  Object.assign(window, { componentViewer: setViewer, reloadComponentReport: (next: ReportDefinition) => { setReport(next); setEpoch((n) => n+1); }, savedLibrary: library });
  const save = async (next: ReportDefinition) => { Object.assign(window, { savedComponentReport: next }); setReport(next); };
  return <div className="studio" style={{ ...themeStyle(createTheme()), height: "100vh" }}>{viewer ? <ReportViewer key={epoch} report={report} run={run} /> : <ReportDesigner key={epoch} host={{ report, tables, dataRev: "components", componentLibrary: store, save, run, onError: console.error }} />}</div>;
}
