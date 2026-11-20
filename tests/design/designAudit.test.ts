import assert from "node:assert/strict";
import type { ComponentDefinition, ModelTable, ReportDefinition, Visual } from "../../packages/client/src/index";
import { auditDesign, formatUnit, type AuditRuntime } from "../../packages/designer/src/designAudit";
const test = (name: string, fn: () => void) => { fn(); console.log(`PASS: ${name}`); };
const visual = (id: string, patch: Partial<Visual> = {}): Visual => ({ id, type: "shape", x: 10, y: 10, w: 150, h: 80, group: [], values: [], filters: [], format: {}, ...patch });
const report = (...visuals: Visual[]): ReportDefinition => ({ version: 1, pages: [{ id: "p", name: "Deneme", width: 800, height: 600, visuals }] });
const tables = [{ ad: "T", sutunlar: [{ ad: "Id", anahtar: true, tip: "int64" }, { ad: "Ad", tip: "string" }, { ad: "Tutar", tip: "double", ozet: "sum", bicim: "₺ #,##0.00" }],
  olculer: [{ ad: "Satış", bicim: "₺ #,##0", ifade: "SUM(T[Tutar])" }, { ad: "Oran", bicim: "0.0%", ifade: "0.5" }, { ad: "Adet", ifade: "COUNTROWS(T)" }] }] as ModelTable[];
const runtime = (patch: Partial<AuditRuntime> = {}): AuditRuntime => ({ pageId: "p", layoutId: null, measurements: [], queries: [], ...patch });
const codes = (r: ReportDefinition, live?: AuditRuntime) => auditDesign(r, tables, live).map((f) => f.code);
test("Denetim salt okunur, kimlikler kararlı ve serbest üst üste tasarım geçerli", () => {
  const r = report(visual("a"), visual("b")), before = JSON.stringify(r);
  assert.deepEqual(codes(r), []); assert.deepEqual(auditDesign(r, tables), auditDesign(r, tables)); assert.equal(JSON.stringify(r), before);
});
test("Telefon varyantının sınırı, kapsayıcı koordinatı ve küçük yazı ayrı hedeflenir", () => {
  const r = report(visual("frame", { type: "container", container: { mode: "free", padding: 0 }, x: 100, w: 400 }), visual("text", { type: "text", parentId: "frame", format: { text: "Açıklama", fontSize: 16 } }));
  r.pages[0].layouts = [{ id: "phone", name: "Telefon", width: 360, height: 600, maxWidth: 500, overrides: { text: { x: 200, format: { fontSize: 9 } } } }];
  const findings = auditDesign(r, tables);
  assert(findings.some((f) => f.visualId === "text" && f.layoutId === "phone" && f.code === "SMALL_FONT"));
  assert(!findings.some((f) => f.layoutId === null));
});
test("Başlangıçta gizli nesne geometri uyarısı almaz, kopuk bağı yine bulunur", () => {
  const r = report(visual("a", { x: 900, format: { initiallyHidden: true }, values: [{ measure: "Yok" }] }));
  assert.deepEqual(codes(r), ["MISSING_FIELD"]);
});
test("Kırpan ebeveyn bulunur; görsel çakışması hata sayılmaz", () => {
  const r = report(visual("parent", { type: "container", container: { mode: "free", overflow: "clip" } }), visual("child", { parentId: "parent", x: 130 }));
  assert(codes(r).includes("PARENT_CLIPS"));
});
test("Kartın değer bağı zorunlu kuyuyu karşılar; tüm bağ ve filtre referansları incelenir", () => {
  assert(!codes(report(visual("bound", { type: "card", bindings: { value: { source: { kind: "value", value: { measure: "Satış" } } } } }))).includes("EMPTY_WELL"));
  const findings = auditDesign(report(visual("x", { type: "bar", group: [{ table: "T", column: "Ad" }], values: [{ measure: "Yok" }],
    filters: [{ table: "T", column: "Silindi", values: ["gizli-filtre"] }], bindings: { color: { source: { kind: "value", value: { measure: "Renk" } } } } })), tables);
  assert.equal(findings.filter((f) => f.code === "MISSING_FIELD").length, 3);
  assert(!JSON.stringify(findings).includes("gizli-filtre"));
});
test("Zorunlu kuyular grafik türüne göre seçilir; gösterge genel zorunluluk değildir", () => {
  assert(!codes(report(visual("bar", { type: "bar", group: [{ table: "T", column: "Ad" }], values: [{ measure: "Satış" }] }))).includes("EMPTY_WELL"));
  assert(codes(report(visual("scatter", { type: "scatter", group: [{ table: "T", column: "Ad" }], values: [{ measure: "Satış" }] }))).includes("EMPTY_WELL"));
  assert(codes(report(visual("heat", { type: "heatmap", group: [{ table: "T", column: "Ad" }], values: [{ measure: "Satış" }] }))).includes("EMPTY_WELL"));
});
test("Birim yalnız biçimden çıkarılır; ayrı tablo sütunları karşılaştırma sayılmaz", () => {
  assert.equal(formatUnit('₺ #,##0.00'), "TRY"); assert.equal(formatUnit('0.0%'), "%"); assert.equal(formatUnit('0.00'), undefined); assert.equal(formatUnit('USD EUR 0'), undefined);
  const values = [{ measure: "Satış" }, { measure: "Oran" }];
  assert(codes(report(visual("k", { type: "kpi", values: values.slice(0, 1), target: values.slice(1) }))).includes("UNIT_MISMATCH"));
  assert(!codes(report(visual("t", { type: "table", values }))).includes("UNIT_MISMATCH"));
  assert(codes(report(visual("k", { type: "gauge", values: [{ measure: "Satış" }, { measure: "Adet" }] }))).includes("UNIT_UNKNOWN"));
});
test("Örtük anahtar SUM uyarılır, açık iş ölçüsü körlemesine yorumlanmaz", () => {
  assert(codes(report(visual("k", { type: "card", values: [{ table: "T", column: "Id", agg: "sum" }] }))).includes("AGGREGATION_REVIEW"));
  assert(!codes(report(visual("k", { type: "card", values: [{ measure: "Satış" }] }))).includes("AGGREGATION_REVIEW"));
});
test("Menü içi eylemler incelenir ve URL içeriği rapora taşınmaz", () => {
  const r = report(visual("b", { type: "button", format: { action: { type: "menu", items: [
    { id: "a", label: "a", action: { type: "page", pageId: "missing" } }, { id: "b", label: "b", action: { type: "url", url: "javascript:secret-url" } },
  ] } } }));
  assert.deepEqual(new Set(codes(r)), new Set(["ACTION_PAGE", "ACTION_URL"])); assert(!JSON.stringify(auditDesign(r, tables)).includes("secret-url"));
});
test("Satır şablonu eşlemesi kontrol edilir, hata hedefi tekrarlayıcıdır", () => {
  const def: ComponentDefinition = { id: "row", name: "Satır", description: "", version: 1, rootId: "root", slots: [], visuals: [visual("root", { type: "container" }),
    visual("name", { type: "text", bindings: { text: { source: { kind: "row", field: { table: "T", column: "Ad" } } } } })] };
  const r = report(visual("list", { type: "repeater", group: [{ table: "T", column: "Id" }], repeater: { definitionId: "row", version: 1, itemHeight: 100, bindings: {} } })); r.components = [def];
  assert(auditDesign(r, tables).some((f) => f.code === "ROW_MAPPING" && f.visualId === "list"));
  r.pages[0].visuals[0].group.push({ table: "T", column: "Ad" }); assert(!codes(r).includes("ROW_MAPPING"));
  r.pages[0].visuals[0].repeater!.version = 2; assert(codes(r).includes("REPEATER_TEMPLATE"));
  r.components.push({ ...def, version: 2 }); assert(!codes(r).includes("REPEATER_TEMPLATE"));
  def.visuals.push(visual("button", { type: "button", format: { action: { type: "toggle", visualId: "name" } } }));
  assert(!codes(r).includes("ACTION_VISUAL"));
});
test("Toplanamayan toplam hata sayılmaz ve model referansları harf duyarsızdır", () => {
  const r = report(visual("t", { type: "matrix", group: [{ table: "T", column: "Ad" }], values: [{ table: "T", column: "Id", agg: "distinctcount" }] }));
  assert(codes(r).includes("TOTAL_RECOMPUTED"));
  assert(!codes(r).includes("AGGREGATION_REVIEW"));
  assert(!codes(report(visual("c", { type: "card", values: [{ measure: "satış" }] }))).includes("MISSING_FIELD"));
  assert(!codes(report(visual("t", { type: "table", group: [{ table: "t", column: "ad" }] }))).includes("MISSING_FIELD"));
});
test("Sunucu sayfasının truncated bilgisi veri kaybı sayılmaz; gerçek kesilme ayrıdır", () => {
  const r = report(visual("t", { type: "table", values: [{ measure: "Satış" }], format: { gridDataMode: "server" } }));
  const live = runtime({ queries: [{ visualId: "t", source: "Sunucu sayfası", status: "ready", rows: 100, truncated: true, paged: true }] });
  assert(codes(r, live).includes("PAGED_SCOPE")); assert(!codes(r, live).includes("RESULT_TRUNCATED"));
  live.queries[0].paged = false; assert(codes(r, live).includes("RESULT_TRUNCATED"));
  live.pageId = "old"; assert(!codes(r, live).includes("RESULT_TRUNCATED"));
});
test("Ölçümler ve canlı durum yalnız açık düzene aittir; sıfır boş değildir", () => {
  const r = report(visual("text", { type: "text", format: { text: "Deneme" } }));
  const live = runtime({ measurements: [{ visualId: "text", overflow: true, minFont: 9 }], queries: [{ visualId: "text", source: "Veri bağı", status: "error" }] });
  assert(codes(r, live).includes("TEXT_OVERFLOW")); assert(codes(r, live).includes("RENDERED_SMALL_FONT")); assert(codes(r, live).includes("QUERY_ERROR"));
  live.measurements = []; live.queries[0].status = "ready"; assert.deepEqual(codes(r, live), []);
  live.queries[0].status = "empty"; assert(codes(r, live).includes("EMPTY_RESULT"));
});
