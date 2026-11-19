import type { ReportDefinition } from "../../packages/client/src/index";

export const auditReport: ReportDefinition = { version: 1, pages: [
  { id: "overview", name: "Özet", width: 960, height: 540, visuals: [] },
  { id: "details", name: "Detay", width: 960, height: 540, visuals: [{ id: "unsupported", type: "text", x: 30, y: 40, w: 400, h: 160,
    group: [], values: [], filters: [], format: { text: "PBIP görseli: funnel", importWarning: "TYPE_UNSUPPORTED" } }] },
], importAudit: { version: 1, source: "Test", scope: "layout_only", summary: { pages: 2, visuals: 2, mapped: 0, partial: 1, unsupported: 1, skipped: 0 },
  issues: [{ code: "MODEL_NOT_IMPORTED", severity: "error", message: "Veri ve özgün ölçü formülleri aktarılmadı.", detail: "" }],
  pages: [{ id: "overview", name: "Özet", issues: [], visuals: [{ sourceId: "measure", sourceType: "card", targetIds: [], targetType: "card", status: "partial",
    fields: [{ role: "Values", table: "Satis", name: "Satış", kind: "measure", status: "partial" }],
    issues: [{ code: "MEASURE_PLACEHOLDER", severity: "warning", message: "Özgün ölçü aktarılmadı.", detail: "" }] }] },
  { id: "details", name: "Detay", issues: [], visuals: [{ sourceId: "unsupported", sourceType: "funnel", targetIds: ["unsupported"], targetType: "text", status: "unsupported", fields: [],
    issues: [{ code: "TYPE_UNSUPPORTED", severity: "error", message: "Görsel desteklenmiyor.", detail: "" }] }] }],
} };
