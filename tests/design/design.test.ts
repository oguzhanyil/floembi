import assert from "node:assert/strict";
import "./components.test";
import "./appearance.test";
import type { ReportPage, Visual } from "../../packages/client/src/index";
import { resolvePageLayout, visibleInLayout, inheritedLayoutStyle, lockedInLayout } from "../../packages/report/src/layout";
import { alignSelection, groupSelection, ungroup, transformSelection, duplicateSelection, deleteSelection, reparent, reorderSibling, selectionTarget } from "../../packages/designer/src/layoutEditing";
import { DesignHistory } from "../../packages/designer/src/history";

let count = 0;
const test = (name: string, fn: () => void) => { fn(); count++; console.log(`PASS: ${name}`); };
const visual = (id: string, patch: Partial<Visual> = {}): Visual => ({ id, type: "shape", x: 0, y: 0, w: 100, h: 50, group: [], values: [], filters: [], format: {}, ...patch });
const page = (...visuals: Visual[]): ReportPage => ({ id: "p1", name: "Deneme", width: 1280, height: 720, visuals });
const frame = (patch: Partial<Visual> = {}) => visual("frame", { type: "container", x: 20, y: 30, w: 420, h: 240, container: { mode: "vertical", padding: 10, gap: 8 }, ...patch });
const child = (id: string, patch: Partial<Visual> = {}) => visual(id, { parentId: "frame", ...patch });
const resolve = (p: ReportPage, heights = {}) => Object.fromEntries(resolvePageLayout(p, heights).visuals.map((v) => [v.id, v]));
const rect = ({ x, y, w, h }: Visual) => ({ x, y, w, h });

test("Eski düz raporların koordinatları korunur", () => {
  const p = page(visual("a", { x: 15, y: 25, w: 12, h: 8 }));
  assert.deepEqual(resolvePageLayout(p).visuals, p.visuals);
});
test("İç içe serbest kapsayıcılar yerel koordinatlarla çözülür, tanım değişmez", () => {
  const p = page(frame({ container: { mode: "free" } }), child("inner", { type: "container", x: 7, y: 9, container: { mode: "free" } }), visual("a", { parentId: "inner", x: 3, y: 4 }));
  const before = JSON.stringify(p), r = resolve(p);
  assert.equal(r.a.x, 30); assert.equal(r.a.y, 43); assert.equal(JSON.stringify(p), before);
  assert.deepEqual(resolvePageLayout(p).visuals.map((v) => v.id), ["frame", "inner", "a"]);
});
test("Dikey akış, uzatma ve boşluk", () => {
  const r = resolve(page(frame(), child("a"), child("b")));
  assert.deepEqual(rect(r.a), { x: 30, y: 40, w: 400, h: 50 }); assert.equal(r.b.y, 98);
});
test("Yatay kaydırma ve otomatik yükseklik", () => {
  const r = resolve(page(frame({ w: 240, h: 40, container: { mode: "horizontal", padding: 10, gap: 8, wrap: true, autoHeight: true } }), child("a"), child("b"), child("c")));
  assert.equal(r.b.x, 138); assert.equal(r.c.y, 98); assert.equal(r.frame.h, 128);
});
test("Izgara sütunları ve minimum boyut taşma uyarısı", () => {
  const p = page(frame({ w: 240, container: { mode: "grid", padding: 10, gap: 20, columns: 2 } }), child("a"), child("b"), child("c"));
  const r = resolve(p); assert.equal(r.a.w, 100); assert.equal(r.b.x, 150); assert.equal(r.c.y, 110);
  p.visuals[1] = child("a", { layoutItem: { minWidth: 500 } }); assert(resolvePageLayout(p).overflow.has("frame"));
});
test("Ağırlıklı büyüme ve en büyük boyut", () => {
  const r = resolve(page(frame({ h: 240, container: { mode: "vertical", padding: 10, gap: 0 } }), child("a", { layoutItem: { grow: 1, maxHeight: 80 } }), child("b", { layoutItem: { grow: 3 } })));
  assert.equal(r.a.h, 80); assert.equal(r.b.h, 140);
});
test("Dağılım ve çapraz hizalama", () => {
  const r = resolve(page(frame({ container: { mode: "vertical", padding: 10, gap: 0, align: "center", justify: "space-between" } }), child("a"), child("b")));
  assert.equal(r.a.x, 180); assert.equal(r.b.y, 210);
});
test("Boyut sınırına gelen öğenin kalan büyüme payı diğerine aktarılır", () => {
  const r = resolve(page(frame({ h: 240, container: { mode: "vertical", padding: 10, gap: 0 } }), child("a", { layoutItem: { grow: 1, maxHeight: 60 } }), child("b", { layoutItem: { grow: 3 } })));
  assert.equal(r.a.h, 60); assert.equal(r.b.h, 160);
});
test("Çoklu hizalama ve eşit aralık uç noktaları korur", () => {
  const p = page(visual("a", { x: 10, y: 30 }), visual("b", { x: 150, y: 60 }), visual("c", { x: 500, y: 90 }));
  const r = resolve(alignSelection(p, ["a", "b", "c"], "horizontal"));
  assert.equal(r.a.x, 10); assert.equal(r.c.x, 500); assert.equal(r.b.x, 255);
  const top = resolve(alignSelection(p, ["a", "b", "c"], "top")); assert.equal(top.b.y, 30); assert.equal(top.c.y, 30);
});
test("Büyüyen metin komşusunu iter, küçülünce yerleşim geri gelir", () => {
  const p = page(frame({ h: 40, container: { mode: "vertical", padding: 10, gap: 8, autoHeight: true } }), child("a", { type: "text", h: 28, format: { textOverflow: "grow" } }), child("b"));
  const large = resolve(p, { a: 150 }), small = resolve(p, { a: 28 });
  assert.equal(large.b.y - small.b.y, 122); assert.equal(large.frame.h - small.frame.h, 122);
});
test("Ölçülen metin yüksekliğiyle grubu çözmek komşuları üst üste getirmez", () => {
  const p = page(frame({ h: 40, container: { mode: "vertical", padding: 10, gap: 8, autoHeight: true } }), child("a", { type: "text", h: 28, format: { textOverflow: "grow" } }), child("b"));
  const placed = resolvePageLayout(p, { a: 180 }).visuals;
  const next = ungroup(p, "frame", placed), r = resolve(next, { a: 180 });
  assert(r.a.y + r.a.h < r.b.y); assert.equal(next.visuals[0].h, 28);
});
test("Otomatik yüksekliği olan kapsayıcı taşınınca kayıtlı minimum sabit kalır", () => {
  const p = page(frame({ h: 40, container: { mode: "vertical", padding: 10, gap: 8, autoHeight: true } }), child("a", { type: "text", h: 28, format: { textOverflow: "grow" } }), child("b"));
  const placed = resolvePageLayout(p, { a: 180 }).visuals, box = rect(placed[0]);
  const next = transformSelection(p, ["frame"], box, { ...box, x: box.x + 20, y: box.y + 30 }, false, placed);
  assert.equal(next.visuals[0].h, 40); assert.equal(resolve(next, { a: 28 }).frame.h, 106);
});
test("Ata görünürlüğü, kilit, opaklık ve kırpma mirası", () => {
  const p = page(frame({ container: { mode: "free", overflow: "clip" }, format: { initiallyHidden: true, locked: true, opacity: .5 } }), child("a", { x: -10, y: 0, format: { opacity: .5 } }));
  assert(!visibleInLayout(p, p.visuals[1])); assert(visibleInLayout(p, p.visuals[1], { frame: true })); assert(lockedInLayout(p, "a"));
  const r = resolvePageLayout(p).visuals, style = inheritedLayoutStyle(p, r[1], r);
  assert.equal(style.opacity, .25); assert.equal(style.clipPath, "inset(0px 0px 0px 10px)");
});
test("Gruplama/çözme serbest sayfada görüntüyü korur, kimlikler raporda benzersiz", () => {
  const p = page(visual("a", { x: 100, y: 100 }), visual("b", { x: 250, y: 150 }));
  const g = groupSelection(p, ["a", "b"], false, new Set(["a", "b", "v1"])); assert.equal(g.id, "v2");
  const grouped = resolve(g.page); for (const v of p.visuals) assert.deepEqual(rect(grouped[v.id]), rect(v));
  const u = resolve(ungroup(g.page, g.id!)); for (const v of p.visuals) assert.deepEqual(rect(u[v.id]), rect(v));
  assert.equal(selectionTarget(g.page, "a"), g.id); assert.equal(selectionTarget(g.page, "a", true), "a");
});
test("Grup taşıma ve orantılı boyutlandırma", () => {
  const g = groupSelection(page(visual("a", { x: 100, y: 100 }), visual("b", { x: 250, y: 150 })), ["a", "b"]);
  const r = resolve(g.page), box = rect(r[g.id!]);
  const moved = resolve(transformSelection(g.page, [g.id!], box, { ...box, x: box.x + 25, y: box.y + 40 }));
  assert.equal(moved.a.x, 125); assert.equal(moved.b.y, 190);
  const sized = resolve(transformSelection(g.page, [g.id!], box, { ...box, w: box.w * 2, h: box.h * 2 }, true));
  assert.equal(sized.a.w, 200); assert.equal(sized.b.x, 400); assert.equal(sized.b.y, 200);
});
test("Üst kapsayıcı değişirken dünya koordinatı korunur; döngü ve kilit engellenir", () => {
  const p = page(frame({ container: { mode: "free" } }), visual("a", { x: 150, y: 180 }));
  const adopted = reparent(p, ["a"], "frame"); assert.equal(adopted.visuals[1].x, 130); assert.equal(resolve(adopted).a.x, 150);
  const detached = reparent(adopted, ["a"], null); assert.equal(detached.visuals[1].x, 150);
  const nested = page(frame({ container: { mode: "free" } }), child("a", { type: "container" })); assert.equal(reparent(nested, ["frame"], "a"), nested);
  nested.visuals[0].format.locked = true; assert.equal(reparent(nested, ["a"], null), nested);
});
test("Kapsayıcı çoğaltma iç eylem hedeflerini ve alt ağacı eşler", () => {
  const p = page(frame(), child("a", { format: { action: { type: "toggle", visualId: "b" } } }), child("b"));
  const copy = duplicateSelection(p, ["frame", "a"], new Set(p.visuals.map((v) => v.id)));
  assert.equal(copy.ids.length, 1); assert.equal(copy.page.visuals.length, 6);
  const [f, a, b] = copy.page.visuals.slice(3); assert.equal(a.parentId, f.id); assert.equal(a.format.action?.type, "toggle");
  assert.equal((a.format.action as { visualId: string }).visualId, b.id); assert.equal(f.x, 44);
  assert.equal(deleteSelection(copy.page, [f.id]).visuals.length, 3);
});
test("Akış sırası değişir ve geri almaya uygun yeni tanım döner", () => {
  const p = page(frame(), child("a"), child("b"));
  const next = reorderSibling(p, "b", "a"); assert.equal(resolve(next).b.y, 40); assert.equal(resolve(p).a.y, 40);
});
test("100 sürükleme güncellemesi tek geri alma adımıdır", () => {
  const initial = { n: 0 }, h = new DesignHistory(initial); h.begin(); for (let n = 1; n <= 100; n++) h.update({ n }); h.commit();
  assert.equal(h.undo(), initial); assert(!h.canUndo); assert.equal(h.redo().n, 100);
});
test("İptal ve dal değiştirme, yeni belge ve geçmiş sınırı", () => {
  const h = new DesignHistory(0, 3); h.update(1); h.update(2); h.undo(); h.begin(); h.update(9); assert.equal(h.cancel(), 1); assert(h.canRedo); assert.equal(h.redo(), 2);
  h.undo(); h.update(8); assert(!h.canRedo); h.update(9); h.update(10); h.update(11); for (let i = 0; i < 10; i++) h.undo(); assert.equal(h.present, 8);
  h.reset(20); assert(!h.canUndo && !h.canRedo); assert.equal(h.present, 20);
});
console.log(`${count} tasarım/yerleşim testi geçti.`);
