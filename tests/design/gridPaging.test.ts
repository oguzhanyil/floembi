import assert from "node:assert/strict";
import type { VisualQuery, VisualResult } from "../../packages/client/src/index";
import { collectGridPages, gridColumnFilters, gridPageSize } from "../../packages/report/src/gridPaging";

const query: VisualQuery = { group: [], values: [], page: { offset: 25, size: 25, snapshot: "s1" } };
const calls: VisualQuery[] = [];
const run = async (q: VisualQuery): Promise<VisualResult> => {
  calls.push(q); const offset = q.page!.offset;
  return { columns: [{ name: "Id", kind: "group", type: "int64" }], rows: Array.from({ length: Math.min(1000, 12050 - offset) }, (_, i) => [offset + i]),
    total: null, truncated: true, page: { offset, size: q.page!.size, totalRows: 12050, hasMore: offset + 1000 < 12050, revision: "r1", snapshot: "s1", totalScope: "report_filters" } };
};
const result = await collectGridPages(run, query, () => {}, new AbortController().signal);
assert.equal(result.rows.length, 12050); assert.equal(new Set(result.rows.map((r) => r[0])).size, 12050);
assert.equal(calls[0].page!.offset, 0); assert.equal(calls[1].page!.revision, "r1"); assert.equal(calls[1].page!.snapshot, "s1");
console.log("PASS: F09 tüm sayfalar, 10.000 üstü sonuç ve sürüm bağlamı korunur");
await assert.rejects(collectGridPages(run, query, () => {}, new AbortController().signal, 2000), /2.000/);
console.log("PASS: F09 PDF kapsam sınırı kısmi dosya üretmez");
const cancel = new AbortController();
await assert.rejects(collectGridPages(async (q) => { cancel.abort(); return run(q); }, query, () => {}, cancel.signal), /iptal/);
console.log("PASS: F09 iptal edilen indirme dosya oluşturmaz");
await assert.rejects(collectGridPages(async (q) => ({ ...await run(q), page: { ...((await run(q)).page!), snapshot: "s2" } }), query, () => {}, new AbortController().signal), /sürümü/);
console.log("PASS: F09 veri sürümü değişince indirme reddedilir");
assert.deepEqual(gridColumnFilters({ c0: { filterType: "number", type: "inRange", filter: 2, filterTo: 8 } }), [{ index: 0, kind: "number", op: "inRange", value: 2, value2: 8 }]);
assert.equal(gridPageSize(100000), 100); assert.throws(() => gridColumnFilters({ c1: { filterType: "text", conditions: [{}] } }));
console.log("PASS: F09 filtre sözleşmesi ve sayfa boyutu sınırları");
