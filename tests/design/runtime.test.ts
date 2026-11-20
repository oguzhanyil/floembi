import assert from "node:assert/strict";
import { appearancePatch, bindingOutput, outputPatch, rowIndex, rowTemplate, sourceQuery, sourceResult, windowRange } from "../../packages/report/src/dataBindings";
import { discoverSlots, mergeDefinitions } from "../../packages/designer/src/components";
import type { ComponentDefinition, DataBinding, Visual } from "../../packages/client/src/index";

const test = (name: string, fn: () => void) => { fn(); console.log(`PASS: ${name}`); };
const binding: DataBinding = { source: { kind: "value", value: { measure: "Net" } }, rules: [{ op: "gt", value: 0, output: "pozitif" }, { op: "blank", output: "boş" }], fallback: "diğer" };
test("Bağ kuralları sıfır, boş, yanlış ve metni ayırır", () => {
  assert.equal(bindingOutput(binding, null), "boş"); assert.equal(bindingOutput(binding, 0), "diğer");
  assert.equal(bindingOutput(binding, 1), "pozitif"); assert.equal(bindingOutput(binding, "1"), "diğer");
  assert.equal(bindingOutput({ ...binding, rules: [], fallback: 42 }, false), false);
  assert.equal(bindingOutput({ ...binding, rules: [{ op: "eq", value: "0012", output: true }] }, "0012"), true);
});
test("Alan tekil olmalı, bağ sorguları filtreleri taşır", () => {
  const source = { kind: "field" as const, field: { table: "T", column: "Ad" } };
  const filters = [{ table: "T", column: "Id", op: "eq" as const, values: [0] }];
  assert.deepEqual(sourceQuery(source, filters), { group: [source.field], values: [], filters, limit: 2 });
  assert.throws(() => sourceResult(source, { columns: [], rows: [["a"], ["b"]], truncated: false }), /birden fazla/);
});
test("Bağ çıktısı metin olarak kalır, CSS ve görünürlük doğrulanır", () => {
  const col = { name: "Net", type: "double" as const, kind: "value" as const };
  assert.equal(outputPatch("text", "<script>x</script>", binding, col).format.text, "<script>x</script>");
  assert.equal(outputPatch("visible", false, binding, col).visible, false);
  assert.throws(() => outputPatch("visible", 0, binding, col), /doğru/);
  assert.throws(() => outputPatch("color", "url(javascript:x)", binding, col), /RRGGBB/);
  assert.throws(() => outputPatch("icon", "<svg>", binding, col), /simge/);
  assert.equal(outputPatch("value", 0, binding, col).result?.rows[0][0], 0);
  assert.deepEqual(appearancePatch({ icon: "check", color: "#ffffff", opacity: 0 }), { buttonIcon: "check", color: "#ffffff", buttonTextColor: "#ffffff", opacity: 0 });
});
const nodes: Visual[] = [{ id: "root", type: "container", x: 0, y: 0, w: 500, h: 120, group: [], values: [], filters: [], format: {} },
  { id: "name", parentId: "root", type: "text", x: 10, y: 10, w: 200, h: 40, group: [], values: [], filters: [], format: {}, bindings: { text: { source: { kind: "row", field: { table: "T", column: "Ad" } } } }, states: { hover: { opacity: .5 } } }];
const def: ComponentDefinition = { id: "row", version: 1, name: "Satır", rootId: "root", visuals: nodes, slots: discoverSlots(nodes) };
test("Satır şablonu yuvaları keşfedilir, eşleme kaynak tanımı değiştirmez", () => {
  assert.deepEqual(def.slots[0].sites[0].path, ["bindings", "text", "source", "field"]);
  const before = JSON.stringify(def);
  const resolved = rowTemplate(def, { definitionId: "row", version: 1, itemHeight: 120, bindings: { [def.slots[0].id]: { table: "F", column: "Name" } } });
  assert.equal(resolved[1].bindings?.text?.source.field?.column, "Name"); assert.equal(JSON.stringify(def), before);
  assert.throws(() => rowTemplate(def, { definitionId: "row", version: 1, itemHeight: 120, bindings: {} }), /eşleyin/);
});
test("Satır alanı tam referansla bulunur, sıfır ve yanlış korunur", () => {
  const row = { query: { group: [{ table: "T", column: "Ad" }], values: [{ table: "T", column: "N", agg: "sum" as const }] },
    result: { columns: [{ name: "Ad", kind: "group" as const, type: "string" as const }, { name: "N", kind: "value" as const, type: "double" as const }], rows: [], truncated: false }, row: ["0012", 0] };
  assert.equal(rowIndex({ kind: "row", value: { table: "T", column: "N" } }, row), 1);
  assert.equal(sourceResult({ kind: "row", value: { table: "T", column: "N" } }, undefined, row).rows[0][0], 0);
  assert.throws(() => rowIndex({ kind: "row", field: { table: "Other", column: "Ad" } }, row), /alanlarında yok/);
  assert.equal(sourceQuery({ kind: "row", field: { table: "T", column: "Ad" } }, []), null);
});
test("12 bin kart için DOM aralığı yalnız görünür satırlar ve tamponu içerir", () => {
  assert.deepEqual(windowRange(12050, 0, 400, 100), { start: 0, end: 6 });
  assert.deepEqual(windowRange(500, 1200, 400, 100), { start: 10, end: 18 });
  assert.deepEqual(windowRange(5, 1000, 400, 100), { start: 5, end: 5 });
});
test("Python varsayılanları aynı bileşen sürümünde çakışma üretmez", () => {
  const fromPython = structuredClone(def);
  const node = fromPython.visuals[1];
  Object.assign(node.bindings!.text!, { fallback: null, template: null, rules: [] });
  Object.assign(node.bindings!.text!.source, { value: null });
  Object.assign(node.states!.hover!, { text: null, color: null, icon: null });
  fromPython.visuals[0].bindings = {}; fromPython.visuals[0].states = {};
  assert.equal(mergeDefinitions([def], [fromPython]).length, 1);
});
