import { useState } from "react";
import type { ReportDefinition, Visual } from "../../packages/client/src/index";
import { ReportDesigner } from "../../packages/designer/src/ReportDesigner";
import { ReportViewer, createTheme, themeStyle } from "../../packages/report/src/index";

const node: Visual = { id: "title", type: "text", x: 80, y: 80, w: 600, h: 80, group: [], values: [], filters: [], format: { showTitle: false, text: "Sayfa görünümü", fontSize: 30 } };
const initial: ReportDefinition = { version: 1, theme: createTheme("electric", "dark"), pages: [
  { id: "width", name: "Genişlik", width: 1280, height: 3200, displayOption: "FitToWidth", backgroundColor: "#ff0000", backgroundTransparency: 50, outspaceColor: "#0000ff", outspaceTransparency: 50, visuals: [node] },
  { id: "actual", name: "Gerçek boyut", width: 1280, height: 900, displayOption: "ActualSize", backgroundColor: "#ffffff", backgroundTransparency: 100, visuals: [{ ...node, id: "actual-title" }] },
  { id: "fit", name: "Sayfaya sığdır", width: 1280, height: 1800, visuals: [{ ...node, id: "fit-title" }] },
] };
export function AppearanceFixture() {
  const [report, setReport] = useState(initial), [viewer, setViewer] = useState(false), [dark, setDark] = useState(false);
  Object.assign(window, { appearanceViewer: setViewer, appearanceAppDark: setDark, appearanceTheme: (mode: "light" | "dark") => setReport((r) => ({ ...r, theme: createTheme("electric", mode) })) });
  const run = async () => ({ columns: [], rows: [], truncated: false });
  const save = async (r: ReportDefinition) => { setReport(r); Object.assign(window, { savedAppearance: r }); };
  return <div className="studio appearance-fixture" style={{ ...themeStyle(createTheme("electric", dark ? "dark" : "light")), height: "100vh" }}>{viewer ? <ReportViewer report={report} run={run} /> : <ReportDesigner host={{ report, tables: [], dataRev: "appearance", run, save, onError: console.error }} />}</div>;
}
