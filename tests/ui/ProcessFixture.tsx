import { useCallback, useState } from "react";
import type { DataScalar, ReportDefinition, Visual, VisualAction, VisualQuery, VisualResult } from "../../packages/client/src/index";
import { ReportViewer } from "../../packages/report/src/ReportViewer";
import { ReportDesigner } from "../../packages/designer/src/ReportDesigner";

const field = (table: string, column: string) => ({ table, column });
const v = (id: string, props: Partial<Visual> = {}): Visual => ({ id, type: "text", x: 30, y: 30, w: 400, h: 60, group: [], values: [], filters: [], format: { showTitle: false }, ...props });
const button = (id: string, y: number, action: VisualAction) => v(id, { type: "button", y, h: 50, format: { showTitle: false, text: id, action } });
const company = (id: string) => v(id, { type: "slicer", group: [field("Firma", "Kod")], h: 100, state: { selected: ["F1"] }, format: { showTitle: false, slicerStyle: "dropdown" } });
const table = (id: string, table: string, pageId: string) => v(id, { type: "table", y: 160, h: 300, w: 800, group: [field(table, "Key")], values: [{ measure: "Net" }], format: { showTitle: false, rowAction: { label: "İncele", icon: "arrow", sourceIndex: 0, action: { type: "page", pageId, keepContext: true } } } });
const initial: ReportDefinition = { version: 1, pages: [
  { id: "list", name: "Liste", width: 1280, height: 900, visuals: [company("company"), v("period", { type: "slicer", x: 470, h: 100, group: [field("Tarih", "Donem")], state: { selected: ["2026-02"] }, format: { showTitle: false, slicerStyle: "dropdown" } }), table("customers", "Musteri", "customer"), button("to-batch", 500, { type: "page", pageId: "batch", keepContext: true })] },
  { id: "customer", name: "Müşteri", width: 1280, height: 900, visuals: [v("customer-summary", { type: "card", values: [{ measure: "Net" }], h: 100 }), table("events", "Belge", "document"), button("customer-back", 500, { type: "back" })] },
  { id: "document", name: "Belge", width: 1280, height: 900, visuals: [v("document-summary", { type: "card", values: [{ measure: "Net" }], h: 100 }), button("document-back", 200, { type: "back" })] },
  { id: "batch", name: "Parti", width: 1280, height: 900, visuals: [company("batch-company"), v("network", { type: "lineage", y: 150, w: 760, h: 560, group: ["From", "To", "FromName", "ToName", "Unit", "Relation"].map((c) => field("Edge", c)), legend: [field("Parti", "Key")], values: [{ table: "Edge", column: "Qty", agg: "sum" }], filters: [{ ...field("Parti", "Key"), values: ["A"] }], format: { showTitle: false, traceDepth: 2, traceDirection: "both" } }),
    v("tolerance", { type: "tolerance", x: 820, y: 150, w: 420, h: 560, group: [field("Kalite", "Key"), field("Kalite", "Test"), field("Kalite", "Unit")], values: ["Value", "Low", "High", "Target"].map((c) => ({ ...field("Kalite", c), agg: "min" })) }), button("batch-back", 760, { type: "back" })] },
] };
type Controls = { processQueries: VisualQuery[]; processDelay?: number; processError?: boolean; processBadSnapshot?: boolean; processManyRoots?: boolean; processEndpoint?: string };
export function ProcessFixture() {
  const [report, setReport] = useState(initial), [viewer, setViewer] = useState(true), [revision, setRevision] = useState(0);
  const run = useCallback(async (q: VisualQuery): Promise<VisualResult> => {
    const w = window as unknown as Controls;
    w.processQueries ??= []; w.processQueries.push(structuredClone(q));
    const delay = w.processDelay ?? 0, error = w.processError, bad = w.processBadSnapshot;
    if (delay) await new Promise((done) => setTimeout(done, delay));
    if (error) throw new Error("Süreç deneme hatası");
    if (w.processEndpoint) {
      const response = await fetch(w.processEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(q) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message ?? "Yerel pilot sorgusu başarısız"); return body;
    }
    const columns: VisualResult["columns"] = [...q.group.map((f) => ({ name: f.column, type: "string", kind: "group" as const })), ...q.values.map((f) => ({ name: f.measure ?? f.column ?? "Değer", type: "double", kind: "value" as const }))];
    const firm = q.filters?.find((f) => f.table === "Firma")?.values[0] ?? "F1";
    let rows: DataScalar[][] = [];
    switch (q.group[0]?.table) {
      case "Firma": rows = [["F1"], ["F2"]]; break;
      case "Tarih": rows = [["2026-01"], ["2026-02"]]; break;
      case "Musteri": rows = [[`${firm}:C001`, 180]]; break;
      case "Belge": rows = [[`${firm}:C001:FAT-02`, 200]]; break;
      case "Parti": rows = w.processManyRoots ? [["A"], ["B"]] : [["A"]]; break;
      case "Kalite": rows = [["Q1", "Sınırdaki ölçüm", "mm", 5, 5, 6, 5.5], ["Q2", "Kusurlu ölçüm", "kg", 11, 5, 6, 5.5], ["Q3", "Eksik ölçüm", "°C", null, 20, 25, 22]]; break;
      case "Edge": {
        rows = [["A", "B", "Ana parti", "Karışım", "kg", "Üretim", 10], ["B", "C", "Karışım", "Ürün", "kg", "Üretim", 20], ["C", "A", "Ürün", "Ana parti", "kg", "İade", 2]];
        const filter = q.filters?.find((f) => f.table === "Edge");
        if (filter) rows = rows.filter((r) => filter.values.includes(r[filter.column === "From" ? 0 : 1]));
        break;
      }
      default: rows = [[firm === "F2" ? 1800 : 180]];
    }
    return { columns, rows, truncated: false, ...(q.page ? { page: { offset: 0, size: q.page.size, totalRows: rows.length, hasMore: false, revision: `q${w.processQueries.length}`, snapshot: bad && q.group[0]?.table === "Edge" ? "changed" : `v${revision}`, totalScope: "report_filters" as const } } : {}) };
  }, [revision]);
  Object.assign(window, { processViewer: setViewer, processReport: report, setProcessReport: setReport, refreshProcess: () => setRevision((n) => n + 1) });
  return <div className="studio process-fixture" style={{ height: "100vh" }}>{viewer ? <ReportViewer report={report} run={run} dataRev={String(revision)} /> : <ReportDesigner host={{ report, tables: [], dataRev: String(revision), run, save: async () => { const w = window as unknown as { processSaveCount?: number }; w.processSaveCount = (w.processSaveCount ?? 0) + 1; }, onError: console.error }} />}</div>;
}
