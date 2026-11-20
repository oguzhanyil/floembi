import { useCallback, useState } from "react";
import type { BindingSource, ComponentDefinition, ModelTable, ReportDefinition, Visual, VisualQuery, VisualResult } from "../../packages/client/src/index";
import { ReportDesigner } from "../../packages/designer/src/ReportDesigner";
import { discoverSlots } from "../../packages/designer/src/components";
import { ReportViewer, createTheme } from "../../packages/report/src/index";

const node = (id: string, type: Visual["type"], x: number, y: number, w: number, h: number, props: Partial<Visual> = {}): Visual => ({
  id, type, x, y, w, h, group: [], values: [], filters: [], format: { showTitle: false, padding: 0 }, ...props,
});
const value: BindingSource = { kind: "value", value: { measure: "Net" } };
const rowField = (column: string): BindingSource => ({ kind: "row", field: { table: "T", column } });
const nodes = [
  node("root", "container", 0, 0, 660, 120, { container: { mode: "free", padding: 0 }, format: { showTitle: false, backgroundColor: "#ffffff", radius: 12 } }),
  node("name", "text", 20, 16, 360, 38, { parentId: "root", format: { showTitle: false, fontSize: 23, bold: true, padding: 0 }, bindings: { text: { source: rowField("Name") } } }),
  node("balance", "card", 420, 12, 200, 56, { parentId: "root", bindings: { value: { source: { kind: "row", value: { measure: "Net" } } } }, format: { showTitle: false, padding: 0, categoryLabel: false } }),
  node("status", "icon", 24, 65, 28, 28, { parentId: "root", bindings: { icon: { source: { kind: "row", value: { measure: "Net" } }, rules: [{ op: "gt", value: 0, output: "check" }], fallback: "warning" } } }),
  node("toggle", "button", 170, 76, 165, 32, { parentId: "root", format: { showTitle: false, text: "Bakiyeyi gizle", action: { type: "toggle", visualId: "balance" } } }),
  node("detail", "button", 350, 76, 135, 32, { parentId: "root", format: { showTitle: false, text: "Detaya git", buttonStyle: "solid", action: { type: "page", pageId: "detail" } } }),
  node("url", "button", 500, 76, 135, 32, { parentId: "root", format: { showTitle: false, text: "Kaydı aç", action: { type: "url", url: "https://example.com/customer/{value}" } } }),
];
const definition: ComponentDefinition = { id: "row", version: 1, name: "Özel satır kartı", rootId: "root", visuals: nodes, slots: discoverSlots(nodes) };
const initial: ReportDefinition = { version: 1, theme: createTheme(), components: [definition], pages: [
  { id: "runtime", name: "Canlı tasarım", width: 1280, height: 1000, visuals: [
    node("heading", "text", 36, 24, 1200, 60, { format: { text: "Tasarımınız veriye dönüşsün", showTitle: false, fontSize: 30, bold: true } }),
    node("label", "text", 36, 100, 500, 60, { bindings: { text: { source: value, template: "Toplam: {value}" }, color: { source: value, rules: [{ op: "gt", value: 0, output: "#166534" }], fallback: "#9f1239" } }, states: { loading: { text: "Hesaplanıyor…" }, empty: { text: "Kayıt yok" }, error: { text: "Veri alınamadı" }, hover: { backgroundColor: "#e5eefa" } } }),
    node("counter", "ticker", 850, 100, 370, 120, { bindings: { value: { source: value } }, format: { showTitle: false, animation: "count", animationDuration: 1800 } }),
    node("pulse", "card", 850, 245, 370, 120, { bindings: { value: { source: value } }, format: { showTitle: false, animation: "pulse", animationDuration: 150 } }),
    node("frame", "container", 36, 180, 600, 70, { container: { mode: "free", padding: 0 }, bindings: { visible: { source: value, rules: [{ op: "gt", value: 0, output: true }], fallback: false } } }),
    node("child", "text", 10, 10, 560, 45, { parentId: "frame", format: { showTitle: false, text: "Koşulla görünen kapsayıcı ve çocuğu" } }),
    node("unique", "text", 850, 390, 370, 60, { bindings: { text: { source: { kind: "field", field: { table: "T", column: "Name" } } } } }),
    node("repeater", "repeater", 36, 280, 760, 650, { group: [{ table: "T", column: "Id" }, { table: "T", column: "Name" }], values: [{ measure: "Net" }],
      repeater: { definitionId: "row", version: 1, itemHeight: 130, actionSourceIndex: 1, bindings: Object.fromEntries(definition.slots.map((s) => [s.id, s.defaultBinding!])) }, format: { showTitle: false, gridPageSize: 500, padding: 8 } }),
  ] },
  { id: "detail", name: "Müşteri detayı", width: 1280, height: 720, visuals: [node("detail-name", "text", 40, 40, 900, 80, { bindings: { text: { source: { kind: "field", field: { table: "T", column: "Name" } } } } }), node("detail-total", "card", 40, 150, 600, 180, { values: [{ measure: "Net" }] })] },
] };
const tables: ModelTable[] = [{ ad: "T", kaynak: { katman: "veri", tablo: "T" }, mod: "import", gizli: false, hiyerarsiler: [], sutunlar: [
  { ad: "Id", tip: "int64", gizli: false }, { ad: "Name", tip: "string", gizli: false },
], olculer: [{ ad: "Net", ifade: "1" }] }];

export function RuntimeFixture() {
  const [report, setReport] = useState(initial), [viewer, setViewer] = useState(true), [version, setVersion] = useState(1), [amount, setAmount] = useState<number | null>(42);
  const run = useCallback(async (q: VisualQuery): Promise<VisualResult> => {
    const w = window as unknown as { runtimeQueries: VisualQuery[]; runtimeDelay?: number; runtimeError?: boolean };
    w.runtimeQueries ??= []; w.runtimeQueries.push(q);
    const delay = w.runtimeDelay ?? 0, fail = w.runtimeError;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (fail) throw new Error("Sentetik bağlantı hatası");
    const columns: VisualResult["columns"] = [...q.group.map((f) => ({ name: f.column, kind: "group" as const, type: f.column === "Id" ? "int64" : "string" })), ...q.values.map(() => ({ name: "Net", kind: "value" as const, type: "double" }))];
    const nameFor = (i: number) => i === 0 ? "Örnek / A&B" : `Müşteri ${i}`;
    const chosen = q.filters?.find((f) => f.column === "Id")?.values[0];
    if (!q.page) {
      const rows = q.group.length ? chosen != null ? [[nameFor(Number(chosen))]] : [["A"], ["B"]] : [[chosen != null ? Number(chosen) : amount]];
      return { columns, rows, truncated: false };
    }
    let rows: VisualResult["rows"] = Array.from({ length: 12050 }, (_,i) => [i, nameFor(i), i]);
    if (q.page.search) rows = rows.filter((r) => r.some((s) => String(s).includes(q.page!.search!)));
    const { offset, size } = q.page;
    return { columns, rows: rows.slice(offset, offset+size), truncated: offset+size<rows.length, total: null,
      page: { offset, size, totalRows: rows.length, hasMore: offset+size<rows.length, revision: JSON.stringify([q.group,q.values,q.filters,q.page.search,version]), snapshot: `v${version}`, totalScope: "report_filters" } };
  }, [amount, version]);
  Object.assign(window, { runtimeViewer: setViewer, runtimeAmount: setAmount, runtimeRefresh: () => setVersion((n) => n+1), runtimeReport: report,
    runtimeTheme: (dark: boolean, reducedMotion = false) => setReport((r) => ({ ...r, theme: { ...createTheme("electric", dark ? "dark" : "light"), reducedMotion } })),
    runtimePatch: (id: string, patch: Partial<Visual>) => setReport((r) => ({ ...r, pages: r.pages.map((p) => ({ ...p, visuals: p.visuals.map((v) => v.id === id ? { ...v, ...patch } : v) })) })),
  });
  return <div className="studio runtime-fixture" style={{ height: "100vh" }}>{viewer ? <ReportViewer report={report} run={run} dataRev={String(version)} /> : <ReportDesigner host={{ report, tables, dataRev: String(version), run, save: async (r) => { setReport(r); }, onError: console.error }} />}</div>;
}
