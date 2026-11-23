import { useCallback, useMemo, useState } from "react";
import type { ModelTable, ReportDefinition, ScenarioDefinition, ScenarioProposal, ScenarioProposalInput, ScenarioWorkflow, VisualQuery, VisualResult } from "../../packages/client/src/index";
import { ReportViewer } from "../../packages/report/src/ReportViewer";
import { ReportDesigner } from "../../packages/designer/src/ReportDesigner";

export const scenarioDefinition: ScenarioDefinition = { id: "sales.margin", label: "Satış ve kâr", company: { table: "Firma", column: "Kod" }, parameters: [
  { id: "discount", label: "İskonto", measure: "Varsayım iskonto yüzdesi", unit: "%", minimum: 0, maximum: 50, step: 1, defaultValue: 0 },
  { id: "volume", label: "Hacim", measure: "Varsayım hacim yüzdesi", unit: "%", minimum: -50, maximum: 100, step: 1, defaultValue: 0 },
  { id: "cost", label: "Maliyet", measure: "Varsayım maliyet yüzdesi", unit: "%", minimum: -50, maximum: 100, step: 1, defaultValue: 0 }],
  outputs: [{ measure: "Senaryo net satışı", label: "Net satış", unit: "TRY" }, { measure: "Senaryo maliyeti", label: "Maliyet", unit: "TRY" }, { measure: "Senaryo brüt kârı", label: "Brüt kâr", unit: "TRY" }], proposalEnabled: true, submitRoles: ["admin", "member", "contributor", "viewer"] };
const initial: ReportDefinition = { version: 1, scenarios: [scenarioDefinition], pages: [{ id: "p", name: "Senaryo", width: 1280, height: 1320, visuals: [
  { id: "company", type: "slicer", x: 30, y: 20, w: 350, h: 100, group: [{ table: "Firma", column: "Kod" }], values: [], filters: [], state: { selected: ["F1"] }, format: { showTitle: false, slicerStyle: "dropdown" } },
  { id: "scenario", type: "scenario", x: 30, y: 150, w: 1150, h: 1100, group: [], values: [], filters: [], format: { scenarioId: "sales.margin", showTitle: false } },
] }] };
const tables = [{ ad: "Firma", sutunlar: [{ ad: "Kod", tip: "string" }], olculer: [] }, { ad: "Satis", sutunlar: [{ ad: "Tutar", tip: "double" }], olculer: [...scenarioDefinition.parameters.map((p) => ({ ad: p.measure, ifade: "0" })), ...scenarioDefinition.outputs.map((o) => ({ ad: o.measure, ifade: "SUM(Satis[Tutar])" }))] }] as ModelTable[];
type Controls = { scenarioQueries?: VisualQuery[]; scenarioEndpoint?: string; scenarioDelay?: number; scenarioError?: boolean; scenarioNoData?: boolean; scenarioZero?: boolean; scenarioBadResult?: boolean; scenarioReviewer?: boolean; scenarioCreateInterrupted?: boolean; scenarioCreates?: ScenarioProposalInput[]; scenarioHistoryError?: boolean };
const records = new Map<string, ScenarioProposal>();
export async function fixtureScenario(q: VisualQuery, definition = scenarioDefinition, revision = 0): Promise<VisualResult> {
  const w = window as unknown as Controls, delay = w.scenarioDelay, error = w.scenarioError, empty = w.scenarioNoData, zero = w.scenarioZero, bad = w.scenarioBadResult;
  const values = Object.fromEntries(definition.parameters.map((p) => [p.id, q.scenario?.values?.[p.id] ?? p.defaultValue]));
  const company = q.filters?.some((f) => f.values.includes("F2")) ? "F2" : "F1", factor = company === "F2" ? 10 : 1;
  if (delay) await new Promise((done) => setTimeout(done, delay));
  if (error) throw new Error("Senaryo deneme hatası");
  const sales = 180 * (1 - (values.discount ?? 0) / 100) * (1 + (values.volume ?? 0) / 100) * factor;
  const cost = 108 * (1 + (values.cost ?? 0) / 100) * (1 + (values.volume ?? 0) / 100) * factor;
  const outputs = definition.outputs.map((o, i) => { const baseline = empty ? null : zero ? 0 : [180, 108, 72][i] * factor; const value = empty ? null : zero ? 0 : [sales, cost, sales - cost][i]; const delta = value === null || baseline === null ? null : value - baseline;
    return { ...o, baseline, value, delta, percent: delta == null || !baseline ? null : delta / Math.abs(baseline) }; });
  return { columns: ["Ölçü", "Birim", "Mevcut", "Senaryo", "Fark", "Değişim"].map((name, i) => ({ name, kind: i < 2 ? "group" : "value", type: i < 2 ? "string" : "double" })), rows: outputs.map((o) => [o.label, o.unit, o.baseline, o.value, o.delta, o.percent]), total: null, truncated: false,
    scenario: { id: definition.id, label: definition.label, version: "a".repeat(64), snapshot: String(revision % 10).repeat(64), dataVersion: "b".repeat(64), securityVersion: "c".repeat(64), simulation: true, contextHash: "d".repeat(64), context: { company, companyField: definition.company, filters: q.filters ?? [] }, values: bad ? { ...values, discount: -999 } : values, parameters: definition.parameters, outputs } };
}

export function ScenarioFixture() {
  const [report, setReport] = useState(initial), [viewer, setViewer] = useState(true), [revision, setRevision] = useState(0);
  const request = async (path: string, body: unknown) => {
    const endpoint = (window as unknown as Controls).scenarioEndpoint;
    const response = await fetch(`${endpoint}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw new Error([value.error?.message ?? value.message, value.error?.detail].filter(Boolean).join(" · ")); return value;
  };
  const run = useCallback(async (q: VisualQuery): Promise<VisualResult> => {
    const w = window as unknown as Controls; w.scenarioQueries ??= []; w.scenarioQueries.push(structuredClone(q));
    if (w.scenarioEndpoint) return request("/query", q);
    if (q.scenario) return fixtureScenario(q, report.scenarios?.find((s) => s.id === q.scenario!.id), revision);
    return { columns: q.group.map((f) => ({ name: f.column, kind: "group", type: "string" })), rows: [["F1"], ["F2"]], total: null, truncated: false };
  }, [report.scenarios, revision]);
  const workflow = useMemo<ScenarioWorkflow>(() => ({ scope: "fixture",
    async history(input) {
      const w = window as unknown as Controls; if (w.scenarioEndpoint) return request("/scenario-proposals/history", input);
      if (w.scenarioHistoryError) throw new Error("Geçmiş deneme hatası");
      return { items: structuredClone([...records.values()]), hasMore: false, canReview: w.scenarioReviewer ?? false, canSubmit: true };
    },
    async create(input) {
      const w = window as unknown as Controls; if (w.scenarioEndpoint) return request("/scenario-proposals", input);
      w.scenarioCreates ??= []; w.scenarioCreates.push(structuredClone(input));
      await new Promise((done) => setTimeout(done, 80));
      const old = records.get(input.requestKey); if (old) return { proposal: old, replayed: true };
      const receipt = (await fixtureScenario({ group: [], values: [], filters: input.filters, scenario: { id: input.scenarioId, values: input.values } }, report.scenarios?.find((s) => s.id === input.scenarioId), revision)).scenario!;
      const record: ScenarioProposal = { id: records.size + 1, scenarioId: input.scenarioId, status: "pending", author: "Deneme izleyicisi", note: input.note, receipt, events: [{ status: "pending", actor: "Deneme izleyicisi", note: input.note, at: "2026-11-23T08:00:00Z" }] };
      records.set(input.requestKey, record);
      if (w.scenarioCreateInterrupted) { w.scenarioCreateInterrupted = false; throw new Error("Yanıt kesildi; aynı istekle yeniden deneyin"); }
      return { proposal: record, replayed: false };
    },
    async decide(id, status, note) {
      const w = window as unknown as Controls; if (w.scenarioEndpoint) return request(`/scenario-proposals/${id}/decision`, { status, note });
      const record = [...records.values()].find((r) => r.id === id)!;
      record.status = status; record.events.push({ status, note, actor: "Deneme yöneticisi", at: "2026-11-23T08:05:00Z" });
      return { proposal: record, replayed: false };
    },
  }), [report.scenarios, revision]);
  Object.assign(window, { scenarioViewer: setViewer, scenarioReport: report, setScenarioReport: setReport, refreshScenario: () => setRevision((n) => n + 1) });
  return <div className="studio scenario-fixture" style={{ height: "100vh" }}>{viewer ? <ReportViewer report={report} run={run} workflow={workflow} dataRev={String(revision)} /> : <ReportDesigner host={{ report, tables, dataRev: String(revision), run, save: async (next) => { setReport(next); Object.assign(window, { scenarioSaved: next }); }, onError: console.error }} />}</div>;
}
