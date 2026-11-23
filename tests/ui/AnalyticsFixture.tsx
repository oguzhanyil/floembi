import { useCallback, useState } from "react";
import type { MetricEvidence, MetricReceipt, ModelTable, ReportDefinition, Visual, VisualQuery, VisualResult } from "../../packages/client/src/index";
import { ReportViewer } from "../../packages/report/src/ReportViewer";
import { ReportDesigner } from "../../packages/designer/src/ReportDesigner";

const field = (table: string, column: string) => ({ table, column });
const visual = (id: string, type: Visual["type"], props: Partial<Visual> = {}): Visual => ({ id, type, x: 30, y: 20, w: 560, h: 100, group: [], values: [], filters: [], format: { showTitle: false }, ...props });
const initial: ReportDefinition = { version: 1, analytics: { dataTime: "2026-03-31T23:59:00+00:00", metrics: [{ id: "sales.net", label: "Net satış", measure: "Net", company: field("Firma", "Kod"), unit: "TRY", grain: "Fatura satırı" }], rules: [{ id: "rule", metricId: "sales.net", label: "Hedef altı", operator: "lt", threshold: 200, severity: "warning" }] }, pages: [{ id: "analytics", name: "Ortak ölçü", width: 1280, height: 1000, visuals: [
  visual("company", "slicer", { w: 350, group: [field("Firma", "Kod")], state: { selected: ["F1"] }, format: { showTitle: false, slicerStyle: "dropdown" } }),
  visual("period", "slicer", { x: 420, w: 350, group: [field("Tarih", "Donem")], state: { selected: ["2026-02"] }, format: { showTitle: false, slicerStyle: "dropdown" } }),
  visual("card", "card", { y: 150, values: [{ measure: "Net" }] }),
  visual("signal", "signal", { y: 280, h: 660, format: { metricId: "sales.net", showTitle: false } }),
] }] };
const tables = [{ ad: "Firma", sutunlar: [{ ad: "Kod", tip: "string" }], olculer: [] }, { ad: "Tarih", sutunlar: [{ ad: "Donem", tip: "string" }], olculer: [] }, { ad: "Satis", sutunlar: [{ ad: "Tutar", tip: "double" }], olculer: [{ ad: "Net", ifade: "SUM(Satis[Tutar])" }] }] as ModelTable[];
type Controls = { analyticsEndpoint?: string; analyticsQueries?: VisualQuery[]; analyticsDelay?: number; analyticsError?: boolean; analyticsValue?: number | null; analyticsReceipt?: MetricReceipt };

export async function fixtureMetric(q: VisualQuery, report = initial, revision = 0): Promise<VisualResult> {
  const w = window as unknown as Controls;
  const error = w.analyticsError, value = w.analyticsValue ?? (w.analyticsValue === null ? null : q.filters?.some((f) => f.values.includes("F2")) ? 1800 : 180);
  if (w.analyticsDelay) await new Promise((done) => setTimeout(done, w.analyticsDelay));
  if (error) throw new Error("Ölçü deneme hatası");
  const company = q.filters?.some((f) => f.values.includes("F2")) ? "F2" : "F1";
  const config = report.analytics!, metric = config.metrics.find((m) => m.id === q.analytics?.metricId);
  if (!metric) throw new Error("Katalog ölçüsü bulunamadı");
  const receipt: MetricReceipt = { protocol: "floem-metric/v1", metricId: metric.id, metricVersion: "a".repeat(64), snapshot: String(revision % 10).repeat(64), contextHash: (company === "F1" ? "c" : "d").repeat(64), dataTime: config.dataTime ?? null, value, datasetVersion: "e".repeat(64), evaluatedAt: "2026-11-20T12:00:00Z", dataTimeStatus: config.dataTime ? "declared" : "unknown", context: { company, companyField: metric.company, filters: q.filters ?? [], unit: metric.unit, grain: metric.grain }, alerts: config.rules.filter((r) => r.metricId === metric.id).map((r) => ({ ...r, status: value === null ? "unknown" : ({ gt: value > r.threshold, ge: value >= r.threshold, lt: value < r.threshold, le: value <= r.threshold }[r.operator]) ? "triggered" : "clear" })), comparison: { status: "not_provided", reasons: [] } };
  const e = q.analytics?.evidence;
  if (e) {
    const same = ["protocol", "metricId", "metricVersion", "snapshot", "contextHash", "dataTime"].every((k) => e[k as keyof MetricEvidence] === receipt[k as keyof MetricEvidence]);
    receipt.comparison = !same ? { status: "context_mismatch", reasons: ["Deneme kapsamı farklı"] } : !receipt.dataTime || value === null || e.value === null ? { status: "unverified", reasons: ["Kaynak zamanı veya değer eksik"] } : value === e.value ? { status: "match", reasons: [] } : { status: "value_mismatch", reasons: ["Değer farkı"] };
  }
  w.analyticsReceipt = receipt;
  return { columns: [{ name: metric.measure, kind: "value", type: "double" }], rows: [[value]], total: null, truncated: false, analytics: receipt };
}

export function AnalyticsFixture() {
  const [report, setReport] = useState(initial), [viewer, setViewer] = useState(true), [revision, setRevision] = useState(0);
  const run = useCallback(async (q: VisualQuery): Promise<VisualResult> => {
    const w = window as unknown as Controls;
    w.analyticsQueries ??= []; w.analyticsQueries.push(structuredClone(q));
    if (w.analyticsEndpoint) {
      const response = await fetch(w.analyticsEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(q) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message ?? "Yerel pilot sorgusu başarısız"); return body;
    }
    if (q.analytics) return fixtureMetric(q, report, revision);
    return { columns: q.group.length ? q.group.map((g) => ({ name: g.column, kind: "group", type: "string" })) : [{ name: "Net", kind: "value", type: "double" }], rows: q.group[0]?.table === "Firma" ? [["F1"], ["F2"]] : q.group[0]?.table === "Tarih" ? [["2026-01"], ["2026-02"]] : [[q.filters?.some((f) => f.values.includes("F2")) ? 1800 : 180]], total: null, truncated: false };
  }, [report.analytics, revision]);
  Object.assign(window, { analyticsViewer: setViewer, analyticsReport: report, setAnalyticsReport: setReport, refreshAnalytics: () => setRevision((n) => n + 1) });
  return <div className="studio analytics-fixture" style={{ height: "100vh" }}>{viewer ? <ReportViewer report={report} run={run} dataRev={String(revision)} /> : <ReportDesigner host={{ report, tables, dataRev: String(revision), run, save: async (next) => { Object.assign(window, { analyticsSaved: next }); setReport(next); }, onError: console.error }} />}</div>;
}
