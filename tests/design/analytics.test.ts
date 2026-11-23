import assert from "node:assert/strict";
import { readMetricEvidence } from "../../packages/report/src/metricEvidence";
import { auditDesign } from "../../packages/designer/src/designAudit";
import type { ModelTable, ReportDefinition } from "../../packages/client/src/index";

const test = (name: string, fn: () => void) => { fn(); console.log(`PASS: ${name}`); };
const receipt = { protocol: "floem-metric/v1", metricId: "sales.net", metricVersion: "a".repeat(64), snapshot: "b".repeat(64), contextHash: "c".repeat(64), dataTime: "2026-03-31T23:59:00+00:00", value: 0 };
test("F14 kanıtı yalnız sözleşme alanlarını alır; sıfır ve boş farklıdır", () => {
  assert.deepEqual(readMetricEvidence(JSON.stringify({ ...receipt, context: { hidden: "taşınmaz" }, alerts: [] })), receipt);
  assert.equal(readMetricEvidence(JSON.stringify({ ...receipt, value: null, dataTime: null })).value, null);
});
test("F14 eski Analytics JSON, sonlu olmayan değer ve bozuk kapsam kanıtı reddedilir", () => {
  for (const input of ["[]", "null", "broken", '{"value":180}', JSON.stringify({ ...receipt, value: "0" }), JSON.stringify({ ...receipt, value: true }), JSON.stringify({ ...receipt, snapshot: "missing" }), JSON.stringify({ ...receipt, dataTime: "2026-03-31" }), JSON.stringify({ ...receipt, protocol: "v0" }), " ".repeat(65537)])
    assert.throws(() => readMetricEvidence(input));
  assert.throws(() => readMetricEvidence(JSON.stringify(receipt).replace('"value":0', '"value":1e999')));
});
test("F14 tasarım denetimi katalog, FDX, firma alanı ve veri zamanını inceler", () => {
  const r: ReportDefinition = { version: 1, analytics: { metrics: [{ id: "sales.net", label: "Net", measure: "Net", unit: "TRY", grain: "Satır", company: { table: "T", column: "Firma" } }], rules: [] }, pages: [{ id: "p", name: "Pilot", width: 800, height: 600, visuals: [{ id: "s", type: "signal", x: 0, y: 0, w: 500, h: 550, group: [], values: [], filters: [], format: { metricId: "sales.net" } }] }] };
  const tables = [{ ad: "T", olculer: [{ ad: "Net", ifade: "0" }], sutunlar: [{ ad: "Firma", tip: "string" }] }] as ModelTable[];
  assert.deepEqual(auditDesign(r, tables).map((f) => f.code), ["ANALYTICS_DATA_TIME"]);
  r.analytics!.dataTime = receipt.dataTime;
  assert.deepEqual(auditDesign(r, tables), []);
  assert(auditDesign(r, []).some((f) => f.code === "MISSING_FIELD"));
  r.pages[0].visuals[0].format.metricId = "missing";
  assert(auditDesign(r, tables).some((f) => f.code === "ANALYTICS_METRIC"));
});
