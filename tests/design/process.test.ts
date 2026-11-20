import assert from "node:assert/strict";
import type { DataScalar, FilterRef, ReportPage, Visual, VisualQuery, VisualResult } from "../../packages/client/src/index";
import { JOURNEY_LIMIT, journeyFilters, journeySlicers, rememberJourney } from "../../packages/report/src/reportJourney";
import { traceKey, traceLimits, traceNeighborhood } from "../../packages/report/src/lineage";
import { toleranceState } from "../../packages/report/src/processValues";
import { resolveVisualAction } from "../../packages/report/src/visualActions";

const test = async (name: string, run: () => void | Promise<void>) => { await run(); console.log(`PASS: ${name}`); };
const field = (column: string) => ({ table: "Edge", column });
const root = { table: "Batch", column: "Id" };
const visual: Visual = { id: "trace", type: "lineage", x: 0, y: 0, w: 700, h: 500, group: ["From", "To", "FromName", "ToName", "Unit", "Relation"].map(field), legend: [root], values: [{ table: "Edge", column: "Qty", agg: "sum" }], filters: [], format: { traceDepth: 4, traceDirection: "downstream" } };
type Edge = [DataScalar, DataScalar, string, string, string, string, number];
const edge = (a: DataScalar, b: DataScalar, unit = "kg", relation = "Üretim"): Edge => [a, b, `Parti ${a}`, `Parti ${b}`, unit, relation, 10];
function runner(rows: Edge[], calls: VisualQuery[] = [], snapshots = ["s1"]) {
  return async (q: VisualQuery): Promise<VisualResult> => {
    calls.push(structuredClone(q));
    const scope = q.filters?.find((f) => f.table === "Edge" && ["From", "To"].includes(f.column));
    const filtered = rows.filter((r) => !scope || scope.values.includes(r[scope.column === "From" ? 0 : 1]));
    const size = q.page?.size ?? 100;
    return { columns: [...visual.group.map((f) => ({ name: f.column, kind: "group" as const, type: "string" })), { name: "Qty", kind: "value", type: "double" }],
      rows: filtered.slice(0, size), truncated: filtered.length > size, page: { offset: 0, size, totalRows: filtered.length, hasMore: filtered.length > size, revision: `query-${calls.length}`, snapshot: snapshots[Math.min(calls.length - 1, snapshots.length - 1)], totalScope: "report_filters" } };
  };
}

await test("Geçiş koşulları daralır, kopyalanır ve geçmiş 20 adımla sınırlıdır", () => {
  const a: FilterRef = { table: "Firma", column: "Kod", op: "in", values: ["F1", "F2"] }, b = { ...a, values: ["F2"] };
  const merged = journeyFilters([a], [a, b]); assert.equal(merged.length, 2);
  merged[0].values.push("F3"); assert.equal(a.values.length, 2);
  let history: { states: number[] }[] = [];
  for (let i = 0; i < 30; i++) history = rememberJourney(history, { states: [i] });
  assert.equal(history.length, JOURNEY_LIMIT); assert.deepEqual(history[0].states, [10]);
  const p: ReportPage = { id: "p", name: "P", width: 1000, height: 700, visuals: [{ ...visual, id: "company", type: "slicer", group: [{ table: "Firma", column: "Kod" }], state: { selected: ["F1"] } }] };
  const states = { untouched: { selected: [0] } };
  assert.deepEqual(journeySlicers(p, [a, b], states).company.selected, ["F2"]);
  assert(!("company" in states));
  assert.deepEqual(resolveVisualAction({ ...visual, format: { action: { type: "back" } } }, [p], "p"), { type: "back" });
});

await test("Zincirin ara düğümü tekrar sayılmaz; yalnız sınır sorgulanır", async () => {
  const calls: VisualQuery[] = [];
  const result = await traceNeighborhood(visual, "A", [], runner([edge("A", "B"), edge("B", "C")], calls));
  assert.equal(result.nodes.length, 3); assert.equal(result.edges.length, 2);
  assert(result.nodes.every((n) => !n.repeated)); assert.equal(result.truncated, false);
  assert.deepEqual(calls.map((q) => q.filters?.at(-1)?.values), [["A"], ["B"], ["C"]]);
  assert(calls.slice(1).every((q) => q.page?.snapshot === "s1"));
});

await test("Elmas ve çevrim tekil kalır; farklı birim/ilişkiler birleştirilmez", async () => {
  const rows = [edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "D"), edge("D", "A"), edge("A", "B", "adet"), edge("A", "B", "kg", "İade")];
  const result = await traceNeighborhood({ ...visual, format: { traceDepth: 4, traceDirection: "both" } }, "A", [], runner(rows));
  assert.equal(result.nodes.length, 4); assert.equal(result.edges.length, 7);
  assert(result.nodes.every((n) => n.repeated)); assert(result.queryCount <= 8);
  assert(result.edges.every((e) => e.amount === 10), "Yeniden görülen kenar miktarı toplanmaz");
});

await test("Üst/alt yön, firma/dönem ve tipli kimlikler korunur", async () => {
  const calls: VisualQuery[] = [];
  const filters: FilterRef[] = [{ ...root, values: [0] }, { table: "Firma", column: "Kod", values: ["F1"] }, { table: "Tarih", column: "Donem", values: ["2026-02"] }];
  const result = await traceNeighborhood({ ...visual, format: { traceDirection: "upstream" } }, "0", filters, runner([edge(0, "0")], calls));
  assert.equal(result.nodes.length, 2); assert.notEqual(traceKey(0), traceKey("0"));
  assert(calls.every((q) => q.filters?.length === 3 && q.filters.at(-1)?.column === "To"));
  assert(calls.every((q) => q.filters?.some((f) => f.table === "Firma") && !q.filters.some((f) => f.table === "Batch")));
  assert.equal(filters.length, 3);
});

await test("Altgraf sınırları, iptal ve sürüm değişimi açıkça sonuçlanır", async () => {
  assert.deepEqual(traceLimits({ ...visual, format: { traceDepth: 999, traceNodes: -5, traceEdges: NaN } }), { depth: 4, nodes: 5, edges: 80 });
  const result = await traceNeighborhood({ ...visual, format: { traceDepth: 1, traceNodes: 5, traceEdges: 5 } }, "A", [], runner(Array.from({ length: 20 }, (_, i) => edge("A", i))));
  assert(result.truncated); assert(result.nodes.length <= 5); assert(result.edges.length <= 5);
  await assert.rejects(() => traceNeighborhood(visual, "A", [], runner([]), () => true), /yenilendi/);
  await assert.rejects(() => traceNeighborhood(visual, "A", [], runner([edge("A", "B")], [], ["s1", "s2"])), /değişti/);
  await assert.rejects(() => traceNeighborhood(visual, "A", [], runner([]), () => false, "other-snapshot"), /değişti/);
});

await test("Tolerans sıfır ve sınırları kabul eder, boş/ters sınırdan karar çıkarmaz", () => {
  assert.equal(toleranceState(0, 0, 0), "pass"); assert.equal(toleranceState(5, 5, 6), "pass");
  assert.equal(toleranceState(7, 5, 6), "fail");
  for (const value of [null, undefined, "5", NaN, Infinity]) assert.equal(toleranceState(value, 5, 6), "unknown");
  assert.equal(toleranceState(5, 6, 4), "unknown"); assert.equal(toleranceState(5, null, 6), "unknown");
});
