import assert from "node:assert/strict";
import type { ReportPage, Visual } from "../../packages/client/src/index";
import { choosePageLayout, createPageLayout, resolvePageVariant, editPageVariant, pruneReportLayouts } from "../../packages/report/src/pageLayouts";
import { resolvePageLayout } from "../../packages/report/src/layout";
import { DesignHistory } from "../../packages/designer/src/history";

const test = (name: string, fn: () => void) => { fn(); console.log(`PASS: F08 ${name}`); };
const node = (id: string, extra: Partial<Visual> = {}): Visual => ({ id, type: "card", x: 100, y: 30, w: 300, h: 90,
  group: [], values: [{ measure: "Satış" }], filters: [], format: { fontSize: 24 }, ...extra });
const base = (): ReportPage => ({ id: "p", name: "Rapor", width: 1280, height: 720, visuals: [node("a"), node("b", { x: 500, y: 200 })] });
const variants = () => { const p = base(); return { ...p, layouts: [createPageLayout(p, "tablet"), createPageLayout(p, "phone")] }; };

test("eski sabit tuval aynı nesne ve geometriyle kalır", () => {
  const p = base(); assert.equal(resolvePageVariant(p, null), p); assert.equal(choosePageLayout(p, 390), null);
});
test("eşik sınırları, kayıt sırasından bağımsız seçim ve boş alan", () => {
  const p = variants();
  for (const [w, id] of [[0, null], [390, "phone"], [600, "phone"], [601, "tablet"], [1024, "tablet"], [1025, null]] as const) assert.equal(choosePageLayout(p, w), id);
});
test("tüm nesneler ve semantik alan referansları ortaktır", () => {
  const p = variants(), before = JSON.stringify(p), phone = resolvePageVariant(p, "phone");
  assert.equal(phone.visuals.length, p.visuals.length); assert.equal(phone.visuals[0].values, p.visuals[0].values);
  assert.equal(phone.width, 390); assert.equal(JSON.stringify(p), before);
  assert.equal(resolvePageVariant(p, "deleted"), p);
});
test("konum ve yazı boyutu yerel; ölçü, renk ve düğme eylemi ortaktır", () => {
  const p = variants(), phone = resolvePageVariant(p, "phone");
  const edited = { ...phone, visuals: phone.visuals.map((v) => v.id !== "a" ? v : { ...v, x: 11, h: 140, values: [{ measure: "Kar" }],
    format: { ...v.format, fontSize: 18, color: "#123456", action: { type: "page" as const, pageId: "detail" } } }) };
  const saved = editPageVariant(p, "phone", edited), main = saved.visuals[0], next = resolvePageVariant(saved, "phone"), tablet = resolvePageVariant(saved, "tablet");
  assert.equal(main.x, 100); assert.equal(main.h, 90); assert.equal(main.format.fontSize, 24);
  assert.equal(next.visuals[0].x, 11); assert.equal(next.visuals[0].h, 140); assert.equal(next.visuals[0].format.fontSize, 18);
  assert.deepEqual(main.values, [{ measure: "Kar" }]); assert.equal(tablet.visuals[0].format.color, "#123456");
  assert.equal(tablet.visuals[0].format.action?.pageId, "detail"); assert.equal(main.format.action?.pageId, "detail");
  assert(!("values" in saved.layouts![1].overrides.a)); assert.equal(saved.width, 1280);
});
test("yerel sıralama ana sırayı değiştirmez, eklenen/silinen nesneler eşlenir", () => {
  const p = variants(), phone = resolvePageVariant(p, "phone");
  const saved = editPageVariant(p, "phone", { ...phone, visuals: [phone.visuals[1], phone.visuals[0], node("c")] });
  assert.deepEqual(saved.visuals.map((v) => v.id), ["a", "b", "c"]);
  assert.deepEqual(resolvePageVariant(saved, "phone").visuals.map((v) => v.id), ["b", "a", "c"]);
  assert(resolvePageVariant(saved, "tablet").visuals.some((v) => v.id === "c"));
  const clean = pruneReportLayouts({ version: 1, pages: [{ ...saved, visuals: saved.visuals.filter((v) => v.id !== "a") }] });
  assert(!clean.pages[0].layouts![1].overrides.a); assert(!clean.pages[0].layouts![1].order!.includes("a"));
});
test("kök akışı gerçek metin/kapsayıcı yüksekliğini izler ve sayfayı büyütür", () => {
  const p = base(); p.height = 200; p.rootLayout = { mode: "vertical", padding: 16, gap: 12, autoHeight: true };
  p.visuals[0] = node("a", { type: "text", format: { textOverflow: "grow" } });
  const r = resolvePageLayout(p, { a: 800 });
  assert.equal(r.visuals[0].h, 800); assert.equal(r.visuals[1].y, 828); assert.equal(r.height, 934);
  assert(!r.visuals.some((v) => v.parentId)); assert.equal(r.overflow.size, 0);
});
test("serbest grubun çizimi korunur, akış kapsayıcısı telefonda dikeyleşir", () => {
  const p = base(); p.visuals = [node("frame", { type: "container", w: 800, container: { mode: "horizontal" } }),
    node("group", { type: "container", parentId: "frame", container: { kind: "group", mode: "free" } }), node("value", { parentId: "group", x: 20, w: 260 })];
  p.layouts = [createPageLayout(p, "phone")]; const phone = resolvePageVariant(p, "phone"), result = resolvePageLayout(phone);
  assert.equal(phone.visuals.find((v) => v.id === "frame")!.container!.mode, "vertical");
  assert.equal(phone.visuals.find((v) => v.id === "group")!.container!.kind, "group");
  assert(result.visuals.every((v) => v.x >= 0 && v.x + v.w <= 390));
});
test("düzen ekle/düzenle tek geçmiş adımıyla geri alınır", () => {
  const p = base(), history = new DesignHistory({ version: 1, pages: [p] });
  history.update({ version: 1, pages: [{ ...p, layouts: [createPageLayout(p, "phone")] }] });
  assert.equal(history.undo().pages[0].layouts, undefined); assert.equal(history.redo().pages[0].layouts!.length, 1);
});
