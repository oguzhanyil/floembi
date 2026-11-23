import assert from "node:assert/strict";
import type { ScenarioDefinition, ScenarioReceipt, ReportDefinition, ModelTable } from "../../packages/client/src/index";
import { scenarioValues, scenarioReceiptMatches } from "../../packages/report/src/scenarioState";
import { auditDesign } from "../../packages/designer/src/designAudit";
const test = (name: string, fn: () => void) => { fn(); console.log(`PASS: ${name}`); };
const definition: ScenarioDefinition = { id: "s", label: "Senaryo", company: { table: "T", column: "Firma" }, parameters: [{ id: "p", label: "Hacim", measure: "Varsayım", unit: "%", minimum: -10, maximum: 20, step: .1, defaultValue: 0 }], outputs: [{ measure: "Sonuç", label: "Sonuç", unit: "TRY" }] };
test("F15 sıfır/negatif/ondalık parametre ve sınırlı girdiler", () => {
  assert.deepEqual(scenarioValues(definition, {}).values, { p: 0 });
  assert.deepEqual(scenarioValues(definition, { p: "-0.3" }).values, { p: -.3 });
  for (const p of ["", " ", "wrong", "Infinity", "NaN", "20.1", "-10.1", "0.15"]) assert(scenarioValues(definition, { p }).error);
});
test("F15 yanıtı aynı senaryo, parametre ve çıktı eşlemesini taşımalı", () => {
  const receipt = { id: "s", simulation: true, values: { p: 0 }, outputs: [{ measure: "Sonuç" }] } as ScenarioReceipt;
  assert(scenarioReceiptMatches(receipt, definition, { p: 0 }));
  assert(!scenarioReceiptMatches(receipt, definition, { p: 1 }));
  assert(!scenarioReceiptMatches({ ...receipt, id: "another" }, definition, { p: 0 }));
  assert(!scenarioReceiptMatches({ ...receipt, outputs: [] }, definition, { p: 0 }));
});
test("F15 denetçisi eksik tanım ve FDX bağını bulur; değer kuyusu gerektirmez", () => {
  const report: ReportDefinition = { version: 1, scenarios: [definition], pages: [{ id: "p", name: "Pilot", width: 1000, height: 800, visuals: [{ id: "s", type: "scenario", x: 0, y: 0, w: 900, h: 700, group: [], values: [], filters: [], format: { scenarioId: "s" } }] }] };
  const tables = [{ ad: "T", sutunlar: [{ ad: "Firma", tip: "string" }], olculer: [{ ad: "Varsayım", ifade: "0" }, { ad: "Sonuç", ifade: "[Varsayım]" }] }] as ModelTable[];
  assert.deepEqual(auditDesign(report, tables), []);
  assert(auditDesign(report, []).some((f) => f.code === "MISSING_FIELD"));
  report.scenarios = [];
  assert(auditDesign(report, tables).some((f) => f.code === "SCENARIO_DEFINITION"));
});
