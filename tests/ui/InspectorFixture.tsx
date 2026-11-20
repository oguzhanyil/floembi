import { useCallback, useState } from "react";
import type { ModelTable, ReportDefinition, Visual, VisualQuery, VisualResult } from "../../packages/client/src/index";
import { ReportDesigner } from "../../packages/designer/src/ReportDesigner";
const v = (id: string, props: Partial<Visual> = {}): Visual => ({ id, type: "text", x: 30, y: 30, w: 350, h: 70, group: [], values: [], filters: [], format: { showTitle: false }, ...props });
const initial: ReportDefinition = { version: 1, pages: [
  { id: "audit", name: "Denetim örnekleri", width: 1280, height: 900, visuals: [
    v("overflow", { title: "Sığmayan açıklama", w: 250, h: 40, format: { showTitle: false, fontSize: 18, padding: 0, text: "Uzun açıklama ".repeat(30) } }),
    v("clean", { y: 110, format: { showTitle: false, fontSize: 16, text: "Bu metin rahat okunur." } }),
    v("small", { y: 200, format: { showTitle: false, fontSize: 9, text: "Küçük yazı örneği" } }),
    v("broken", { type: "card", x: 450, values: [{ measure: "Silinen" }] }),
    v("truncated", { type: "bar", x: 450, y: 160, h: 180, group: [{ table: "T", column: "Ad" }], values: [{ measure: "Satış" }] }),
    v("empty", { type: "card", x: 850, values: [{ measure: "Boş" }] }),
    v("error", { type: "card", x: 850, y: 180, values: [{ measure: "Hatalı" }] }),
    v("paged", { type: "table", x: 30, y: 380, w: 750, h: 420, group: [{ table: "T", column: "Ad" }], values: [{ measure: "Satış" }], format: { showTitle: false, gridDataMode: "server", gridPageSize: 25 } }),
    v("units", { type: "kpi", x: 850, y: 400, values: [{ measure: "Satış" }], target: [{ measure: "Oran" }] }),
  ] },
  { id: "second", name: "Telefon tasarımı", width: 1280, height: 720, visuals: [v("phone-text", { title: "Telefon başlığı", w: 500, format: { showTitle: false, fontSize: 20, text: "Telefon düzenini düzeltin" } })],
    layouts: [{ id: "phone", name: "Telefon", width: 360, height: 720, maxWidth: 500, overrides: { "phone-text": { x: 300, w: 200, format: { fontSize: 9 } } } }] },
] };
const tables: ModelTable[] = [{ ad: "T", kaynak: { katman: "veri", tablo: "T" }, mod: "import", gizli: false, hiyerarsiler: [], sutunlar: [{ ad: "Ad", tip: "string", gizli: false }],
  olculer: [{ ad: "Satış", ifade: "42", bicim: "₺ #,##0" }, { ad: "Oran", ifade: ".5", bicim: "0.0%" }, { ad: "Boş", ifade: "BLANK()" }, { ad: "Hatalı", ifade: "1" }] }];
export function InspectorFixture() {
  const [report, setReport] = useState(initial), [revision, setRevision] = useState(0);
  const run = useCallback(async (q: VisualQuery): Promise<VisualResult> => {
    const w = window as unknown as { auditQueryCount?: number; auditHealthy?: boolean; auditDelay?: number };
    w.auditQueryCount = (w.auditQueryCount ?? 0) + 1;
    const healthy = w.auditHealthy;
    if (w.auditDelay) await new Promise((done) => setTimeout(done, w.auditDelay));
    if (!healthy && q.values.some((r) => r.measure === "Hatalı")) throw new Error("raw-private-error");
    const columns: VisualResult["columns"] = [...q.group.map((f) => ({ name: f.column, kind: "group" as const, type: "string" })), ...q.values.map(() => ({ name: "Değer", kind: "value" as const, type: "double" }))];
    const empty = !healthy && q.values.some((r) => r.measure === "Boş");
    return { columns, rows: empty ? [] : [[...q.group.map(() => "private-row-data"), ...q.values.map(() => 0)]], total: null,
      truncated: !!q.group.length && !healthy, ...(q.page ? { page: { offset: 0, size: 25, totalRows: 1000, hasMore: true, revision: "1", snapshot: "1", totalScope: "report_filters" as const } } : {}) };
  }, []);
  Object.assign(window, { auditInitial: initial, auditReportCurrent: report, setAuditReport: setReport, refreshAuditData: () => setRevision((n) => n + 1) });
  return <div className="studio" style={{ height: "100vh" }}><ReportDesigner host={{ report, tables, run, dataRev: String(revision), save: async () => {
    const w = window as unknown as { auditSaveCount?: number }; w.auditSaveCount = (w.auditSaveCount ?? 0) + 1;
  }, onError: console.error }} /></div>;
}
