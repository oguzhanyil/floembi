/** Rapor görselleri ve görüntüleyici: Desktop (tasarım) ve floembi.app (görüntüleme) aynı bileşenleri kullanır. */
import "./visuals.css";

export * from "./reportUtils";
export * from "./visualStyle";
export * from "./visualActions";
export * from "./reportJourney";
export * from "./ReportViewport";
export * from "./pageAppearance";
export * from "./pageLayouts";
export * from "./VisualContextMenu";
export type { ContextMenuItem } from "./ContextMenu";
export * from "./useVisualData";
export * from "./visuals";
export * from "./AgDataGrid";
export * from "./charts";
export * from "./charts2";
export * from "./matrix";
export * from "./VisualBody";
export { ReportViewer } from "./ReportViewer";
export { ScenarioProvider } from "./ScenarioContext";

export * from "./theme";
export * from "./ThemeControls";
export * from "./ImportCompatibility";
export * from "./layout";
export * from "./usePageLayout";
export const createPrintFormPdf = async (...args: Parameters<typeof import("./printFormPdf").printFormPdf>) =>
  (await import("./printFormPdf")).printFormPdf(...args);
