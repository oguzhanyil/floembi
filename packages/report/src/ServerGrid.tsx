import type { GridColumnFilter, Visual, VisualQuery, VisualResult, VisualState } from "@floem/client";
import { FloemApiError } from "@floem/client";
import { Fragment, useEffect, useRef, useState } from "react";
import { AgDataGrid } from "./AgDataGrid";
import { collectGridPages, GRID_PDF_LIMIT, gridPageSize } from "./gridPaging";
import { allowedExportKinds, downloadTableBlob, tableExportBlob, type TableExportKind, type TableValue } from "./tableExport";
import { formatValue } from "./reportUtils";
import { useVisualMenuSource } from "./VisualContextMenu";
import { ActionGlyph } from "./ActionGlyph";
import { safeActionIcon } from "./visualActions";
import type { QueryFn } from "./useVisualData";
import { useRuntimeFeedback } from "./BindingRuntime";

const errorMessage = (e: unknown) => e instanceof FloemApiError && e.detail ? `${e.message}: ${e.detail}` : e instanceof Error ? e.message : String(e);

export function useServerPage(base: VisualQuery, revision: string, run: QueryFn, searchEnabled: boolean, filtersEnabled: boolean, size: number, snapshot?: string) {
  const [search, setSearch] = useState(""), [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<GridColumnFilter[]>([]);
  useEffect(() => { if (!searchEnabled) { setSearch(""); setDebounced(""); } }, [searchEnabled]);
  useEffect(() => { if (!filtersEnabled) setFilters([]); }, [filtersEnabled]);
  useEffect(() => { const id = window.setTimeout(() => setDebounced(search), 250); return () => clearTimeout(id); }, [search]);
  const searchValue = searchEnabled ? debounced : "";
  const scope = JSON.stringify([base, revision, searchValue, filtersEnabled ? filters : [], size, snapshot]);
  const [position, setPosition] = useState<{ scope: string; offset: number; revision?: string }>({ scope: "", offset: 0 });
  useEffect(() => { setPosition((previous) => previous.scope === scope ? previous : { scope, offset: 0 }); }, [scope]);
  const [attempt, setAttempt] = useState(0);
  const pos = position.scope === scope ? position : { offset: 0, revision: undefined };
  const query: VisualQuery = { ...base, page: { offset: pos.offset, size, search: searchValue,
    column_filters: filtersEnabled ? filters : [], revision: pos.revision, snapshot } };
  const key = JSON.stringify([query, revision, attempt]);
  const [response, setResponse] = useState<{ key: string; result?: VisualResult; error?: string }>({ key: "" });
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => run(query)).then((result) => {
      if (!result.page) throw new Error("Sunucu sayfalaması için Desktop ve web sunucusunu güncel sürümle yeniden başlatın.");
      if (alive) setResponse({ key, result });
    }).catch((e) => { if (alive) setResponse({ key, error: errorMessage(e) }); });
    return () => { alive = false; };
  }, [key, run]);
  const current = response.key === key;
  const loading = !current || (searchEnabled && search !== debounced);
  const result = response.result;
  const next = (offset: number) => setPosition({ scope, offset, revision: result?.page?.revision });
  const reset = () => { setResponse({ key: "" }); setPosition({ scope: "", offset: 0 }); setAttempt((v) => v + 1); };
  return { query, scope, result, loading, error: current ? response.error : undefined, next, reset,
    search, setSearch, setFilters, offset: pos.offset };
}

export function useGridExport(run: QueryFn, query: VisualQuery, scope: string, title: string) {
  const active = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState("");
  useEffect(() => () => active.current?.abort(), [scope]);
  const load = async (kind: TableExportKind, indexes?: number[]) => {
    if (active.current) throw new Error("Bir indirme zaten hazırlanıyor.");
    const controller = new AbortController(); active.current = controller; setProgress("Sonuçlar alınıyor…");
    try {
      const data = await collectGridPages(run, query, (count, total) => setProgress(`${count.toLocaleString("tr-TR")} / ${total.toLocaleString("tr-TR")} grup alındı`), controller.signal,
        kind === "pdf" ? GRID_PDF_LIMIT : undefined);
      const ids = indexes ?? data.columns.map((_, i) => i);
      setProgress("Dosya hazırlanıyor…");
      const blob = await tableExportBlob({ title, columns: ids.map((i) => data.columns[i]), rows: data.rows.map((r) => ids.map((i) => r[i])), truncated: false }, kind);
      if (controller.signal.aborted) throw new Error("İndirme iptal edildi.");
      return blob;
    } catch (e) { throw new Error(errorMessage(e)); }
    finally { if (active.current === controller) { active.current = null; setProgress(""); } }
  };
  return { load, feedback: progress ? <div className="v-table-feedback" role="status">{progress} <button type="button" onClick={() => active.current?.abort()}>İndirmeyi iptal et</button></div> : null };
}

export function PageNavigation({ page, next, loading }: { page: NonNullable<VisualResult["page"]>; next: (offset: number) => void; loading: boolean }) {
  return <div className="v-server-pages" onPointerDown={(e) => e.stopPropagation()}>
    <button type="button" aria-label="İlk veri sayfası" disabled={loading || page.offset === 0} onClick={() => next(0)}>«</button>
    <button type="button" aria-label="Önceki veri sayfası" disabled={loading || page.offset === 0} onClick={() => next(Math.max(0, page.offset - page.size))}>‹</button>
    <span>{page.totalRows ? `${(page.offset + 1).toLocaleString("tr-TR")}–${Math.min(page.offset + page.size, page.totalRows).toLocaleString("tr-TR")}` : "0"} / {page.totalRows.toLocaleString("tr-TR")} grup</span>
    <button type="button" aria-label="Sonraki veri sayfası" disabled={loading || !page.hasMore} onClick={() => next(page.offset + page.size)}>›</button>
    <button type="button" aria-label="Son veri sayfası" disabled={loading || !page.hasMore} onClick={() => next(Math.max(0, Math.ceil(page.totalRows / page.size) - 1) * page.size)}>»</button>
  </div>;
}
const totalPolicy = "Genel toplam: rapor, dilimleyici ve erişim filtreleri. Sonuç araması/sütun filtreleri hariç; sayfa toplamı değildir.";

export function ServerTable({ v, query, revision, run, state, onState, onSelect, onSelectRow, onRowAction, selected, selectedKey }: {
  v: Visual; query: VisualQuery; revision: string; run: QueryFn; state: VisualState; onState?: (s: VisualState) => void;
  onSelect: (value: TableValue) => void; onSelectRow?: (row: TableValue[]) => void; onRowAction?: (value: TableValue) => void; selected?: unknown; selectedKey?: string;
}) {
  const data = useServerPage(query, revision, run, v.format.gridSearch !== false, v.format.gridFilters !== false, gridPageSize(v.format.gridPageSize));
  const feedback = useRuntimeFeedback(data.error ? "error" : data.loading ? "loading" : !data.result?.rows.length ? "empty" : "ready", data.error, data.reset);
  const download = useGridExport(run, { ...data.query, page: { ...data.query.page!, snapshot: data.result?.page?.snapshot } }, data.scope, v.title ?? "Tablo");
  return <div className="v-server-grid" aria-busy={data.loading}>
    {feedback}
    {data.error && <div className="v-error" role="alert">{data.error}<button type="button" onClick={data.reset}>İlk sayfadan yeniden yükle</button></div>}
    {!data.result ? !data.error && <div role="status">Yükleniyor…</div> : <>
      <AgDataGrid result={data.result} format={v.format} loading={data.loading || !!data.error}
        selected={selected} selectedKey={selectedKey} onSelect={onSelect} onSelectRow={onSelectRow} onRowAction={onRowAction}
        sort={state.sort} onSort={onState ? (sort) => onState({ ...state, sort }) : undefined}
        remote={{ onSearch: data.setSearch, onFilters: data.setFilters, exportAll: download.load }} />
      {data.result.page && <PageNavigation page={data.result.page} next={data.next} loading={data.loading || !!data.error} />}
      {v.format.showTotals !== false && data.result.total && <div className="v-note">{totalPolicy}</div>}
    </>}
    {download.feedback}
  </div>;
}

export function ServerTree({ v, extra, revision, run, state, onState, onSelectRow, onSelect, onRowAction }: {
  v: Visual; extra: NonNullable<VisualQuery["filters"]>; revision: string; run: QueryFn; state: VisualState;
  onState?: (s: VisualState) => void; onSelectRow?: (row: TableValue[]) => void; onSelect: (value: TableValue) => void; onRowAction?: (value: TableValue) => void;
}) {
  const [localExpanded, setLocalExpanded] = useState<string[]>([]), [notice, setNotice] = useState("");
  const expanded = state.expanded ?? localExpanded;
  const toggle = (path: TableValue[]) => {
    const key = JSON.stringify(path), exists = expanded.includes(key);
    if (!exists && expanded.length >= 32) { setNotice("Aynı anda en fazla 32 dal açık tutulabilir. Bir dalı kapatıp yeniden deneyin."); return; }
    setNotice("");
    const next = exists ? expanded.filter((id) => { try { const p = JSON.parse(id); return JSON.stringify(p.slice(0, path.length)) !== key; } catch { return false; } }) : [...expanded, key];
    if (onState) onState({ ...state, expanded: next }); else setLocalExpanded(next);
  };
  return <div className="v-server-tree">
    <p className="v-note">Dallar açıldıkça yüklenir. Her dalın araması, sayfası ve indirmesi o düzeyin gruplarını kapsar; alt düzeyleri kapsamaz.</p>
    <button type="button" disabled={!expanded.length} onClick={() => { setNotice(""); if (onState) onState({ ...state, expanded: [] }); else setLocalExpanded([]); }}>Dalları kapat</button>
    {notice && <p role="status">{notice}</p>}
    <TreeBranch key={JSON.stringify([v.group, v.values, v.filters, extra, revision])} {...{ v, extra, revision, run, expanded, toggle, onSelectRow, onSelect, onRowAction }} path={[]} />
  </div>;
}

function TreeBranch({ v, extra, revision, run, expanded, toggle, path, onSelectRow, onSelect, onRowAction, snapshot }: {
  snapshot?: string;
  v: Visual; extra: NonNullable<VisualQuery["filters"]>; revision: string; run: QueryFn; expanded: string[]; toggle: (path: TableValue[]) => void;
  path: TableValue[]; onSelectRow?: (row: TableValue[]) => void; onSelect: (value: TableValue) => void; onRowAction?: (value: TableValue) => void;
}) {
  const level = path.length + 1, leaf = level === v.group.length;
  const query: VisualQuery = { group: v.group.slice(0, level), values: v.values, filters: [...v.filters, ...extra,
    ...path.map((value, i) => ({ ...v.group[i], op: "eq" as const, values: [value] }))], totals: v.format.showTotals !== false };
  const data = useServerPage(query, revision, run, v.format.gridSearch !== false, false, gridPageSize(v.format.gridPageSize), snapshot);
  const feedback = useRuntimeFeedback(data.error ? "error" : data.loading ? "loading" : !data.result?.rows.length ? "empty" : "ready", data.error, data.reset, !path.length);
  const download = useGridExport(run, { ...data.query, page: { ...data.query.page!, snapshot: data.result?.page?.snapshot } }, data.scope, `${v.title ?? "Ağaç tablo"} · Düzey ${level}`);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const kinds = allowedExportKinds(v.format), result = data.result;
  const exportRows = async (kind: TableExportKind, all: boolean) => {
    if (!result || data.loading || data.error || busy) return;
    setError(""); setBusy(true);
    try { const blob = all ? await download.load(kind) : await tableExportBlob({ ...result, title: `Düzey ${level} · Bu sayfa` }, kind); downloadTableBlob(blob, kind, "floem-dal"); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  useVisualMenuSource(`server-tree:${JSON.stringify(path)}`, () => path.length ? [] : kinds.flatMap((kind) => [
    { label: `Kök düzey · Bu sayfa · ${kind.toUpperCase()}`, disabled: data.loading || busy || !!data.error, action: () => { void exportRows(kind, false); } },
    { label: `Kök düzey · Tüm gruplar · ${kind.toUpperCase()}`, disabled: data.loading || busy || !!data.error, action: () => { void exportRows(kind, true); } },
  ]));
  const cols = result?.columns ?? [];
  return <section className="v-server-branch" aria-label={`Düzey ${level}${path.length ? ` · ${path.map(String).join(" / ")}` : ""}`} aria-busy={data.loading}>
    {feedback}
    <div className="v-server-pages" onPointerDown={(e) => e.stopPropagation()}>
      <strong>{v.group[level - 1]?.column}</strong>
      <button type="button" disabled={data.loading} onClick={data.reset}>Düzeyi yenile</button>
      {v.format.gridSearch !== false && <input type="search" aria-label={`Düzey ${level} gruplarında ara`} placeholder="Bu dalın gruplarında ara" value={data.search} onChange={(e) => data.setSearch(e.target.value)} />}
      {kinds.length > 0 && <details><summary>İndir</summary>{kinds.map((kind) => <Fragment key={kind}>
        <button type="button" disabled={busy || data.loading || !!data.error || !result} onClick={() => void exportRows(kind, false)}>Bu sayfa · {kind.toUpperCase()}</button>
        <button type="button" disabled={busy || data.loading || !!data.error || !result} onClick={() => void exportRows(kind, true)}>Bu düzeyin tüm grupları · {kind.toUpperCase()}</button>
      </Fragment>)}</details>}
    </div>
    {(data.error || error) && <div className="v-error" role="alert">{data.error ?? error}<button type="button" onClick={() => { setError(""); data.reset(); }}>İlk sayfadan yeniden yükle</button></div>}
    {data.loading && <div role="status">Yükleniyor…</div>}
    {result && <><table role="treegrid" inert={data.loading || !!data.error} aria-label={`Düzey ${level} grupları`}>
      <thead><tr>{cols.map((col, i) => <th key={i}>{col.name}</th>)}{v.format.rowAction && <th>İşlem</th>}</tr></thead>
      <tbody>{result.rows.map((row) => {
        const rowPath = row.slice(0, level), key = JSON.stringify(rowPath), open = expanded.includes(key);
        return <Fragment key={key}><tr aria-level={level} aria-expanded={leaf ? undefined : open}>
          {cols.map((col, i) => <td key={i}>{i === level - 1 && !leaf && <button type="button" aria-label={`${open ? "Dalı kapat" : "Dalı aç"}: ${String(row[i] ?? "Boş")}`} onClick={() => toggle(rowPath)}>{open ? "−" : "+"}</button>}
            <button className="v-tree-value" type="button" onClick={() => leaf && onSelectRow ? onSelectRow(row) : onSelect(row[0])}>{formatValue(row[i], col.type, col.format) || "(Boş)"}</button></td>)}
          {v.format.rowAction && <td>{(() => {
            const action = v.format.rowAction!, source = action.sourceIndex < v.group.length ? action.sourceIndex < level ? action.sourceIndex : -1 : level + action.sourceIndex - v.group.length;
            const icon = safeActionIcon(action.iconData);
            return <button type="button" className="v-row-action" disabled={source < 0 || source >= cols.length} onClick={() => onRowAction?.(row[source])}>
              {icon ? <img className="v-row-action-image" src={icon} alt="" /> : <ActionGlyph icon={action.icon} />}{action.label || "İşlem"}</button>;
          })()}</td>}
        </tr>{open && !leaf && <tr><td colSpan={cols.length + (v.format.rowAction ? 1 : 0)}><TreeBranch {...{ v, extra, revision, run, expanded, toggle, onSelectRow, onSelect, onRowAction }} snapshot={result.page?.snapshot} path={rowPath} /></td></tr>}</Fragment>;
      })}</tbody>
    </table>
      {!result.rows.length && !data.loading && <div role="status">Bu dalda eşleşen grup yok.</div>}
      {result.page && <PageNavigation page={result.page} next={data.next} loading={data.loading || !!data.error} />}
      {result.total && v.format.showTotals !== false && <div className="v-note">{totalPolicy}<br />{result.total.map((value, i) => `${cols[level + i]?.name}: ${formatValue(value, cols[level + i]?.type, cols[level + i]?.format)}`).join(" · ")}</div>}
    </>}{download.feedback}
  </section>;
}
