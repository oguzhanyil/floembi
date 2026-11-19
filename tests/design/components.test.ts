import assert from "node:assert/strict";
import type { ModelTable, ReportDefinition, ReportPage, Visual } from "../../packages/client/src/index";
import { captureComponent, linkSource, insertComponent, updateInstances, defaultBindings, bindingIssues, mergeDefinitions, parseComponentFile, repairInstances } from "../../packages/designer/src/components";
import { duplicateSelection } from "../../packages/designer/src/layoutEditing";
import { COMPONENT_PRESETS } from "../../packages/designer/src/componentPresets";
import { brandSvg, BRAND_SIZES } from "../../packages/designer/src/brand";

let count = 0;
const test = (name: string, fn: () => void) => { fn(); count++; console.log(`PASS: ${name}`); };
const node = (id: string, patch: Partial<Visual> = {}): Visual => ({ id, type: "text", x: 0, y: 0, w: 260, h: 60, group: [], values: [], filters: [], format: { showTitle: false }, ...patch });
const page: ReportPage = { id: "p1", name: "Kaynak", width: 1280, height: 720, visuals: [
  node("box", { type: "container", x: 50, y: 30, h: 200, container: { mode: "vertical", gap: 12 } }),
  node("label", { parentId: "box", format: { text: "Satış", fontSize: 20 } }),
  node("value", { parentId: "box", type: "card", values: [{ measure: "Satış" }], format: { fontSize: 30, color: "#0866e8" } }),
  node("toggle", { parentId: "box", type: "button", format: { action: { type: "toggle", visualId: "value" } } }),
] };
const tables: ModelTable[] = [{ ad: "T", kaynak: { katman: "veri", tablo: "T" }, mod: "import", gizli: false, hiyerarsiler: [],
  sutunlar: [{ ad: "N", tip: "double", gizli: false, anahtar: false }], olculer: ["Satış", "Sipariş"].map((ad) => ({ ad, ifade: "1" })) }];
const initial = (): ReportDefinition => ({ version: 1, pages: [structuredClone(page), { ...page, id: "p2", name: "Hedef", visuals: [] }] });
const capture = (p = page) => captureComponent(p, "box", "Özet kartı", "Ortak düzen", { id: "summary", version: 1 });
const linked = () => linkSource(initial(), "p1", "box", capture());
const two = () => {
  const r = linked(), def = r.components![0], bindings = { [def.slots[0].id]: { measure: "Sipariş" } };
  return insertComponent(r, "p2", def, bindings, tables);
};
const nextVersion = () => { const d = capture(); d.version = 2; d.visuals.find((v) => v.type === "card")!.format.fontSize = 42; d.visuals.find((v) => v.type === "card")!.format.color = "#00a8e8"; return d; };

test("Bileşen yakalama tek alan yuvası çıkarır; iç eylem kopyaya bağlıdır", () => {
  const d = capture(); assert.equal(d.slots.length, 1); assert.equal(d.visuals[0].x, 0); assert.equal(d.visuals[0].parentId, null);
  assert.equal(d.visuals.find((v) => v.type === "button")!.format.action!.visualId, d.visuals.find((v) => v.type === "card")!.id);
  assert.equal(JSON.stringify(page), JSON.stringify(initial().pages[0]));
});
test("Başka modelde eksik alan engellenir; aynı modelde varsayılan bulunur", () => {
  const d = capture(); assert.equal(Object.keys(defaultBindings(d, [], [page], page)).length, 0);
  assert.equal(bindingIssues(d, {}, tables, [page], page).length, 1);
  assert.equal(bindingIssues(d, defaultBindings(d, tables, [page], page), tables, [page], page).length, 0);
});
test("Metin sütununda sayma ve farklı sayma alan eşlemesine uygundur", () => {
  const model = structuredClone(tables); model[0].sutunlar[0].tip = "string";
  const d = capture(), bindings = { [d.slots[0].id]: { table: "T", column: "N", agg: "distinctcount" as const } };
  assert.equal(bindingIssues(d, bindings, model, [page], page).length, 0);
  assert.equal(bindingIssues(d, { [d.slots[0].id]: { table: "T", column: "N", agg: "sum" } }, model, [page], page).length, 1);
});
test("Dinamik metnin ölçü yer tutucusu yeni alan eşlemesine taşınır", () => {
  const p = structuredClone(page); p.visuals.find((v) => v.type === "text")!.values = [{ measure: "Satış" }];
  p.visuals.find((v) => v.type === "text")!.format.text = "Güncel: [Satış]";
  const d = capture(p), r = initial(); r.pages[0] = p;
  const source = linkSource(r, "p1", "box", d);
  const bindings = { [d.slots[0].id]: { measure: "Sipariş" } };
  const inserted = insertComponent(source, "p2", d, bindings, tables);
  assert.equal(inserted.report.pages[1].visuals.find((v) => v.type === "text")!.format.text, "Güncel: [Sipariş]");
  const changed = updateInstances(source, d, ["box"], tables, bindings).report;
  assert.equal(changed.pages[0].visuals.find((v) => v.type === "text")!.format.text, "Güncel: [Sipariş]");
});
test("Sayfalar arası kullanım farklı ölçü ve benzersiz kimliklerle açılır", () => {
  const { report: r, rootId } = two(), p = r.pages[1], root = p.visuals.find((v) => v.id === rootId)!;
  assert.equal(new Set(r.pages.flatMap((p) => p.visuals.map((v) => v.id))).size, 8);
  const card = p.visuals.find((v) => v.type === "card")!;
  assert.equal(card.values[0].measure, "Sipariş"); assert.equal(p.visuals.find((v) => v.type === "button")!.format.action!.visualId, card.id);
  assert.equal(root.component!.version, 1);
});
test("Ortak sürüm değişir; yerel renk, konum ve her kullanımın ölçüsü korunur", () => {
  const { report: r, rootId } = two(); r.pages[1].visuals.find((v) => v.type === "card")!.format.color = "#ff9900";
  r.pages[1].visuals.find((v) => v.id === rootId)!.x = 700;
  const before = JSON.stringify(r), result = updateInstances(r, nextVersion(), ["box", rootId], tables);
  assert.equal(JSON.stringify(r), before); assert.equal(result.changed, 2);
  assert.equal(result.report.pages[0].visuals.find((v) => v.type === "card")!.format.color, "#00a8e8");
  const card = result.report.pages[1].visuals.find((v) => v.type === "card")!;
  assert.equal(card.format.color, "#ff9900"); assert.equal(card.format.fontSize, 42); assert.equal(card.values[0].measure, "Sipariş");
  assert.equal(result.report.pages[1].visuals.find((v) => v.id === rootId)!.x, 700);
});
test("Eksik yeni yuva açık eşleme ister; seçilmeyen kullanım sabit kalır", () => {
  const { report: r, rootId } = two(), d = nextVersion(); d.visuals.find((v) => v.type === "card")!.target = [{ measure: "Kaynakta var" }];
  d.slots.push({ id: "target", label: "Hedef", kind: "value", defaultBinding: { measure: "Kaynakta var" }, sites: [{ visualId: d.visuals.find((v) => v.type === "card")!.id, path: ["target", "0"] }] });
  assert.throws(() => updateInstances(r, d, [rootId], tables), /Hedef/);
  const next = updateInstances(r, d, [rootId], tables, { target: { measure: "Satış" } }).report;
  assert.equal(next.pages[0].visuals[0].component!.version, 1); assert.equal(next.pages[1].visuals.find((v) => v.type === "card")!.target![0].measure, "Satış");
});
test("Yerel silme ve eklemeler sürüm güncellemesinde korunur", () => {
  const r = linked(); r.pages[0].visuals = r.pages[0].visuals.filter((v) => v.id !== "label");
  r.pages[0].visuals.push(node("local", { parentId: "box", format: { text: "Yerel açıklama" } }));
  const out = updateInstances(r, nextVersion(), ["box"], tables).report.pages[0];
  assert(!out.visuals.some((v) => v.id === "label")); assert(out.visuals.some((v) => v.id === "local"));
});
test("Kaynak sürümde kaldırılan sade nesne silinir, yerel özelleştirilen korunur", () => {
  const r = linked(), d = nextVersion();
  const labelId = d.visuals.find((v) => v.type === "text")!.id;
  d.visuals = d.visuals.filter((v) => v.id !== labelId);
  assert(!updateInstances(r, d, ["box"], tables).report.pages[0].visuals.some((v) => v.id === "label"));
  r.pages[0].visuals.find((v) => v.id === "label")!.format.text = "Yerel başlık";
  assert(updateInstances(r, d, ["box"], tables).report.pages[0].visuals.some((v) => v.id === "label"));
});
test("Yerel silinmiş kimlik yeni kullanımda yeniden kullanılmaz", () => {
  const first = two(), p = first.report.pages[1], removed = p.visuals.find((v) => v.type === "text")!.id;
  p.visuals = p.visuals.filter((v) => v.id !== removed);
  const next = insertComponent(first.report, "p2", first.report.components![0], defaultBindings(first.report.components![0], tables, first.report.pages, p), tables);
  assert(!next.report.pages[1].visuals.some((v) => v.id === removed));
});
test("Kullanım kopyası düğüm eşlemelerini ve yerel silme kimliklerini ayırır", () => {
  const r = linked(), p = r.pages[0]; p.visuals = p.visuals.filter((v) => v.id !== "label");
  const copy = duplicateSelection(p, ["box"], new Set(p.visuals.map((v) => v.id)));
  const root = copy.page.visuals.find((v) => v.id === copy.ids[0])!;
  assert(Object.values(root.component!.nodeMap).every((id) => !Object.values(p.visuals[0].component!.nodeMap).includes(id)));
  assert.equal(copy.page.visuals.find((v) => v.id === root.component!.nodeMap[capture().visuals.find((v) => v.type === "button")!.id])!.format.action!.visualId, root.component!.nodeMap[capture().visuals.find((v) => v.type === "card")!.id]);
});
test("Yeniden yakalama mevcut şablon kimlikleriyle yeni düğümleri çakıştırmaz", () => {
  const r = linked(), p = r.pages[0]; p.visuals.push(node("new", { parentId: "box" }));
  const d = captureComponent(p, "box", "Kopya", "", { id: "new", version: 1 });
  assert.equal(new Set(d.visuals.map((v) => v.id)).size, d.visuals.length);
});
test("Alan bölmesinde eşleme değişince bağlantı yenilenir; alt ağaçtan ayrılınca kopar", () => {
  const r = linked(), p = r.pages[0]; p.visuals.find((v) => v.type === "card")!.values = [{ measure: "Sipariş" }];
  assert.equal(Object.values(repairInstances(p, r.components!).visuals[0].component!.bindings)[0].measure, "Sipariş");
  p.visuals.find((v) => v.type === "card")!.parentId = null;
  assert.equal(repairInstances(p, r.components!).visuals[0].component, undefined);
});
test("Sürüm içerikleri değişmez; geçersiz ve prototip hedefli JSON reddedilir", () => {
  const d = capture(); assert.equal(parseComponentFile(JSON.stringify({ version: 1, components: [d, ...COMPONENT_PRESETS] })).length, 4);
  assert.throws(() => mergeDefinitions([d], [{ ...d, name: "Değişti" }]), /Yeni sürüm/);
  for (const mutate of [(d: ReturnType<typeof capture>) => { d.visuals[0].parentId = d.visuals[1].id; }, (d: ReturnType<typeof capture>) => { d.slots[0].sites[0].path = ["__proto__", "polluted"]; }, (d: ReturnType<typeof capture>) => { d.slots[0].kind = "field"; }, (d: ReturnType<typeof capture>) => { d.visuals[0].type = "toString" as never; }]) {
    const bad = structuredClone(d); mutate(bad); assert.throws(() => parseComponentFile(JSON.stringify({ version: 1, components: [bad] })));
  }
});
test("Harici nesne kimliği şablon kimliğiyle aynı olsa da eşleme korunur", () => {
  const p = structuredClone(page); p.visuals.find((v) => v.type === "button")!.format.action!.visualId = "v1";
  const d = capture(p), r = initial(); r.pages[0].visuals.push(node("v1"));
  const bindings = defaultBindings(d, tables, r.pages, r.pages[0]); const inserted = insertComponent(r, "p1", d, bindings, tables);
  const ids = Object.values(inserted.report.pages[0].visuals.find((v) => v.id === inserted.rootId)!.component!.nodeMap);
  assert.equal(inserted.report.pages[0].visuals.find((v) => ids.includes(v.id) && v.type === "button")!.format.action!.visualId, "v1");
});
test("Marka ailesi bağımsız SVG üretir; küçük simgede ayrıntılar sadeleşir", () => {
  for (const size of BRAND_SIZES) for (const mode of ["light", "dark"] as const) {
    const svg = brandSvg("floembi", "app", mode, size); assert(svg.includes(`height="${size}"`)); assert(!/href=|<script|<foreignObject/.test(svg));
  }
  assert(brandSvg("floembi", "app", "dark", 16).length < brandSvg("floembi", "app", "dark", 128).length);
});
console.log(`${count} bileşen/marka testi geçti.`);
