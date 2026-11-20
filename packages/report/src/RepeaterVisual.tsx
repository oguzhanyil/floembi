import type { FilterRef, Visual, VisualAction } from "@floem/client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BindingProvider, RuntimeFrame, useRuntimeComponents, useRuntimeFeedback } from "./BindingRuntime";
import { rowTemplate, windowRange, type RowData } from "./dataBindings";
import { gridPageSize } from "./gridPaging";
import { resolvePageLayout, inheritedLayoutStyle, visibleInLayout } from "./layout";
import { useServerPage, PageNavigation, useGridExport } from "./ServerGrid";
import { VisualBody } from "./VisualBody";
import type { QueryFn } from "./useVisualData";
import { allowedExportKinds, downloadTableBlob, tableExportBlob, type TableExportKind } from "./tableExport";
import { rowActionValue, visualIsVisible, type ActionValue } from "./visualActions";
import { useVisualMenuSource } from "./VisualContextMenu";

const noTemplateRun: QueryFn = async () => { throw new Error("Tekrarlayıcıya satır alanı ve bileşen seçin."); };
const noRowQuery: QueryFn = async () => { throw new Error("Satır şablonunda satır veri bağlarını kullanın."); };

export function RepeaterVisual({ v, extra, revision, run, onSelectRow, selectedKey, onAction }: {
  v: Visual; extra: FilterRef[]; revision: string; run: QueryFn; onSelectRow?: (row: unknown[]) => void; selectedKey?: string;
  onAction?: (action: VisualAction, source?: ActionValue, filters?: FilterRef[]) => void;
}) {
  const definitions = useRuntimeComponents(), config = v.repeater;
  const definition = definitions.find((d) => d.id === config?.definitionId && d.version === config.version);
  const template = useMemo(() => {
    try { return { nodes: definition && config ? rowTemplate(definition, config) : [] }; }
    catch (e) { return { nodes: [], error: String(e) }; }
  }, [definition, config]);
  const valid = !!v.group.length && !!definition && !template.error;
  const query = { group: v.group, values: v.values, filters: [...v.filters, ...extra], totals: false };
  const data = useServerPage(query, revision, valid ? run : noTemplateRun, v.format.gridSearch !== false, false, gridPageSize(v.format.gridPageSize));
  const feedback = useRuntimeFeedback(data.error ? "error" : data.loading ? "loading" : !data.result?.rows.length ? "empty" : "ready", data.error, data.reset, valid);
  const download = useGridExport(run, { ...data.query, page: { ...data.query.page!, snapshot: data.result?.page?.snapshot } }, data.scope, v.title ?? "Satır verisi");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const exportRows = async (kind: TableExportKind, all: boolean) => {
    if (!data.result || data.loading || data.error || busy) return;
    setBusy(true); setError("");
    try { downloadTableBlob(all ? await download.load(kind) : await tableExportBlob(data.result, kind), kind, "floem-satir-verisi"); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  useVisualMenuSource("repeater", () => !valid ? [] : allowedExportKinds(v.format).flatMap((kind) => [
    { label: `Bu sayfanın satır verisi · ${kind.toUpperCase()}`, disabled: busy || data.loading || !!data.error, action: () => { void exportRows(kind, false); } },
    { label: `Tüm eşleşen satır verisi · ${kind.toUpperCase()}`, disabled: busy || data.loading || !!data.error, action: () => { void exportRows(kind, true); } },
  ]));
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ height: 400, width: 600 }), [scrollTop, setScrollTop] = useState(0);
  useLayoutEffect(() => {
    const node = viewport.current; if (!node) return;
    const observer = new ResizeObserver(() => setSize({ height: node.clientHeight, width: node.clientWidth }));
    observer.observe(node); setSize({ height: node.clientHeight, width: node.clientWidth }); return () => observer.disconnect();
  }, [!!data.result, valid]);
  useEffect(() => { if (viewport.current) viewport.current.scrollTop = 0; setScrollTop(0); }, [data.scope, data.offset]);
  if (!valid || !config || !definition) return <div className="v-empty" role="status">{template.error ?? "Satır alanlarını ekleyin; Biçim → Satır tekrarlayıcı bölümünden bileşen seçin."}</div>;
  const rows = data.result?.rows ?? [], height = config.itemHeight;
  const range = windowRange(rows.length, scrollTop, size.height, height);
  return <div className="v-repeater" aria-busy={data.loading}>
    {v.format.gridSearch !== false && <input type="search" aria-label="Tekrarlayıcı satırlarında ara" placeholder="Tüm satır gruplarında ara" value={data.search} onChange={(e) => data.setSearch(e.target.value)} />}
    {feedback}
    {!feedback && (data.error || error) && <div className="v-error" role="alert">{data.error ?? error}<button type="button" onClick={() => { setError(""); data.reset(); }}>İlk sayfadan yeniden yükle</button></div>}
    {!feedback && data.loading && <span role="status">Yükleniyor…</span>}
    <div className="v-repeater-viewport" ref={viewport} style={feedback ? { visibility: "hidden" } : undefined} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} inert={data.loading || !!data.error} role="list" aria-label={v.title || "Satır kartları"}>
      <div style={{ height: rows.length * height, position: "relative" }}>
        {rows.slice(range.start, range.end).map((row, n) => {
          const key = JSON.stringify(row.slice(0, v.group.length)), index = range.start + n;
          const rowData: RowData = { row, query: data.query, result: data.result!, selected: key === selectedKey };
          return <div className={`v-repeater-item ${rowData.selected ? "is-selected" : ""}`} key={key} data-row-key={key} role="listitem"
            aria-posinset={(data.result?.page?.offset ?? 0) + index + 1} aria-setsize={data.result?.page?.totalRows}
            style={{ position: "absolute", left: 0, right: 0, top: index * height, height, overflow: "hidden" }}>
            <RowTemplate {...{ v, definition, rowData, onAction, onSelectRow, revision }} nodes={template.nodes} width={size.width} height={height} />
          </div>;
        })}
      </div>
      {!rows.length && !data.loading && <div className="v-no-data" role="status">Bu seçim için satır yok.</div>}
    </div>
    {data.result?.page && <PageNavigation page={data.result.page} next={data.next} loading={data.loading || !!data.error} />}
    <div className="v-note">Kartlar gruplandırılmış satırları gösterir. İndirme kart tasarımını değil satır verisini aktarır.</div>
    {download.feedback}
  </div>;
}

function RowTemplate({ v, definition, nodes, rowData, width, height, revision, onAction, onSelectRow }: {
  v: Visual; definition: import("@floem/client").ComponentDefinition; nodes: Visual[]; rowData: RowData; width: number; height: number; revision: string;
  onAction?: (action: VisualAction, source?: ActionValue, filters?: FilterRef[]) => void; onSelectRow?: (row: unknown[]) => void;
}) {
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const root = nodes.find((n) => n.id === definition.rootId)!;
  const page = useMemo(() => ({ id: "row", name: "Satır şablonu", width: root.w, height: root.h, visuals: nodes }), [nodes, root.w, root.h]);
  const layout = useMemo(() => resolvePageLayout(page), [page]);
  const scale = Math.max(.05, Math.min(width / Math.max(1, root.w), (height - 8) / Math.max(1, layout.height)));
  const filters: FilterRef[] = v.group.map((g, i) => ({ ...g, op: "eq", values: [rowData.row[i]] }));
  const sourceIndex = v.repeater?.actionSourceIndex ?? 0;
  const source = rowActionValue(v, sourceIndex, rowData.row[sourceIndex] ?? null);
  const action = (chosen: VisualAction) => {
    if (chosen.type === "toggle" && nodes.some((n) => n.id === chosen.visualId)) {
      const target = nodes.find((n) => n.id === chosen.visualId)!;
      setVisibility((before) => ({ ...before, [target.id]: !visualIsVisible(target, before) }));
    } else onAction?.(chosen, source, filters);
  };
  return <div className="v-row-template" tabIndex={0} aria-label={`Satırı seç: ${String(rowData.row[0] ?? "Boş")}`}
    onClick={(e) => { e.stopPropagation(); onSelectRow?.(rowData.row); }}
    onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelectRow?.(rowData.row); } }}>
    <BindingProvider visuals={nodes} row={rowData}>
      {layout.visuals.filter((n) => visibleInLayout(page, n, visibility)).map((node) => <RuntimeFrame key={node.id} visual={{ ...node, format: { padding: 0, borderWidth: node.parentId ? 0 : 1, ...(node.type === "button" ? { fontSize: 14 } : {}), ...node.format } }} extra={[]} revision={revision} run={noRowQuery}
        data-template-id={node.id} className="visual readonly no-title" style={{ position: "absolute", left: node.x * scale, top: node.y * scale, width: node.w, height: node.h, scale, transformOrigin: "top left", ...inheritedLayoutStyle(page, node, layout.visuals) }}
        role={node.type !== "button" && node.format.action ? "button" : undefined} tabIndex={node.type !== "button" && node.format.action ? 0 : undefined}
        onClick={node.type !== "button" && node.format.action ? (e) => { e.stopPropagation(); action(node.format.action!); } : undefined}
        onKeyDown={node.type !== "button" && node.format.action ? (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); action(node.format.action!); } } : undefined}>
        {(resolved) => <div className="visual-content"><VisualBody v={resolved} extra={[]} dataRev={revision} cross={null} onCross={() => {}} onAction={action} run={noRowQuery} /></div>}
      </RuntimeFrame>)}
    </BindingProvider>
  </div>;
}
