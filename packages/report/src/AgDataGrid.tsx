import type { VisualFormat, VisualResult, VisualResultColumn, VisualState } from "@floem/client";
import { AllCommunityModule, themeQuartz, type ColDef, type GridApi } from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CrossSelect } from "./charts";
import { ActionGlyph } from "./ActionGlyph";
import { formatValue, isNumericType } from "./reportUtils";
import { safeActionIcon } from "./visualActions";
import { useVisualMenuSource, visualMenuEnabled } from "./VisualContextMenu";
import { ContextMenu, type ContextMenuItem, type ContextMenuPosition } from "./ContextMenu";
import { allowedExportKinds, downloadTableBlob, tableExportBlob, type ExportTable, type TableExportKind } from "./tableExport";

type Raw = string | number | boolean | null;
type GridRow = Record<string, Raw>;
const modules = [AllCommunityModule];
const theme = themeQuartz.withParams({
  fontFamily: '"Segoe UI", system-ui, sans-serif',
  fontSize: 12,
  spacing: 5,
  headerHeight: 34,
  foregroundColor: "var(--text, #202d3e)",
  backgroundColor: "var(--surface, #ffffff)",
  headerBackgroundColor: "var(--surface-2, #f4f7fb)",
  borderColor: "var(--border, #dce3ed)",
  accentColor: "var(--accent, #2563eb)",
  rowHeight: "var(--row-height, 30px)",
});

/** Community tablosu; sağ tık ve dışa aktarma Floem tarafından sağlanır. */
export function AgDataGrid({
  result, selected, onSelect, selectedKey, onSelectRow, onRowAction, sort, onSort, format, loading = false,
}: {
  result: VisualResult;
  selected?: unknown;
  onSelect?: CrossSelect;
  selectedKey?: string;
  onSelectRow?: (row: Raw[]) => void;
  onRowAction?: (value: Raw) => void;
  sort?: VisualState["sort"];
  onSort?: (s: VisualState["sort"]) => void;
  format: VisualFormat;
  loading?: boolean;
}) {
  const gridApi = useRef<GridApi<GridRow> | null>(null);
  const [search, setSearch] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [hidden, setHidden] = useState<number[]>([]);
  const [displayCount, setDisplayCount] = useState(result.rows.length);
  const [columnFiltered, setColumnFiltered] = useState(false);
  const [menu, setMenu] = useState<(ContextMenuPosition & { exportsOnly?: boolean; colId?: string; row?: GridRow }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const exporting = useRef(false);
  const loadingRef = useRef(loading);
  useLayoutEffect(() => { loadingRef.current = loading; }, [loading]);
  const closeMenu = useCallback(() => setMenu(null), []);
  const { columns, rows, total } = result;
  const groupCount = columns.filter((c) => c.kind === "group").length;
  const hasSel = selected !== undefined || selectedKey !== undefined;
  const rowAction = format.rowAction;
  const actionIcon = safeActionIcon(rowAction?.iconData);
  const filtersEnabled = format.gridFilters !== false;
  const searchEnabled = format.gridSearch !== false;
  const columnsEnabled = format.gridColumnChooser !== false;
  const exportKinds = allowedExportKinds(format);
  const contextEnabled = visualMenuEnabled(format);
  const exportEnabled = exportKinds.length > 0;
  const countEnabled = format.gridRowCount !== false;
  const activeSearch = searchEnabled ? search : "";
  const showTools = searchEnabled || columnsEnabled || exportEnabled || countEnabled;

  const rowData = useMemo(() => rows.map((row) => Object.fromEntries(row.map((value, i) => [`c${i}`, value])) as GridRow), [rows]);
  const pinnedBottomRowData = useMemo(() => total ? [Object.fromEntries(columns.map((c, i) => [
    `c${i}`, c.kind === "group" ? (i === 0 ? "Toplam" : null) : total[i - groupCount] ?? null,
  ])) as GridRow] : [], [columns, total, groupCount]);
  const columnDefs = useMemo<ColDef<GridRow>[]>(() => [
    ...columns.map((c: VisualResultColumn, i): ColDef<GridRow> => ({
      colId: `c${i}`, field: `c${i}`, headerName: c.name,
      minWidth: 88, width: Math.max(110, Math.min(280, c.name.length * 8 + 75)),
      filter: filtersEnabled ? (isNumericType(c.type) ? "agNumberColumnFilter" : "agTextColumnFilter") : false,
      floatingFilter: filtersEnabled,
      sortable: true, resizable: true,
      hide: columnsEnabled && hidden.includes(i),
      pinned: i === 0 && format.gridPinFirstColumn ? "left" : undefined,
      sort: sort?.index === i ? (sort.desc ? "desc" : "asc") : undefined,
      cellClass: c.kind === "value" ? "v-ag-number" : undefined,
      valueFormatter: (params) => formatValue(params.value ?? null, c.type, c.format),
    })),
    ...(rowAction ? [{
      colId: "rowAction", headerName: rowAction.label || "İşlem", width: 72, minWidth: 62,
      pinned: "right" as const, sortable: false, filter: false, resizable: false,
      cellRenderer: (params: { node: { rowPinned?: string | null }; data?: GridRow }) => {
        if (params.node.rowPinned || !params.data) return null;
        const value = params.data[`c${rowAction.sourceIndex}`] ?? null;
        return <button type="button" className="v-ag-action" title={rowAction.label}
          aria-label={`${rowAction.label}: ${String(value ?? "boş")}`}
          disabled={rowAction.sourceIndex < 0 || rowAction.sourceIndex >= columns.length}
          onClick={(e) => { e.stopPropagation(); onRowAction?.(value); }}>
          {actionIcon ? <img className="v-row-action-image" src={actionIcon} alt="" /> : <ActionGlyph icon={rowAction.icon} />}
        </button>;
      },
    } satisfies ColDef<GridRow>] : []),
  ], [columns, hidden, filtersEnabled, columnsEnabled, format.gridPinFirstColumn, sort, rowAction, actionIcon, onRowAction]);

  // Grid API'yi yalnız gridReady olayından sonra kullan.
  useEffect(() => { gridApi.current?.redrawRows(); }, [selected, selectedKey, rows]);
  // Kapatılan araçlar görünmez bir filtre/sütun seçimi bırakmaz.
  useEffect(() => {
    if (!filtersEnabled) {
      gridApi.current?.setFilterModel(null);
      setColumnFiltered(false);
    }
  }, [filtersEnabled]);
  useEffect(() => { if (!searchEnabled) setSearch(""); }, [searchEnabled]);
  useEffect(() => {
    if (!columnsEnabled) { setColumnsOpen(false); setHidden([]); }
  }, [columnsEnabled]);
  useEffect(() => {
    if (menu && (menu.exportsOnly ? !exportEnabled : !contextEnabled)) closeMenu();
  }, [menu, exportEnabled, contextEnabled, closeMenu]);
  const displayedColumns = () => (gridApi.current?.getAllDisplayedColumns() ?? [])
    .map((c) => c.getColId()).filter((id) => /^c\d+$/.test(id));
  const snapshot = (): ExportTable => {
    const ids = displayedColumns();
    const data: Raw[][] = [];
    gridApi.current?.forEachNodeAfterFilterAndSort((node) => {
      if (node.data && !node.rowPinned) data.push(ids.map((id) => node.data![id] ?? null));
    });
    return { columns: ids.map((id) => columns[Number(id.slice(1))]), rows: data, truncated: result.truncated };
  };
  const exportTable = async (kind: TableExportKind) => {
    if (exporting.current || !exportKinds.includes(kind)) return;
    if (loadingRef.current) { setError("Veri güncelleniyor; işlem tamamlanınca yeniden deneyin."); return; }
    exporting.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const blob = await tableExportBlob(snapshot(), kind);
      downloadTableBlob(blob, kind);
      setNotice("İndirme hazır.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Dosya oluşturulamadı. Yeniden deneyin."); }
    finally { exporting.current = false; setBusy(false); }
  };
  const copy = async (text: string) => {
    setError(""); setNotice("");
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const input = document.createElement("textarea");
        input.value = text; input.style.position = "fixed"; input.style.opacity = "0";
        document.body.append(input);
        try { input.select(); if (!document.execCommand("copy")) throw new Error("Panoya kopyalama kullanılamıyor."); }
        finally { input.remove(); }
      }
      setNotice("Panoya kopyalandı.");
    } catch { setError("Panoya kopyalanamadı. Tarayıcının pano iznini kontrol edin."); }
  };
  const openContextMenu = (target: HTMLElement, x: number, y: number) => {
    const cell = target.closest<HTMLElement>("[col-id]");
    const colId = cell?.getAttribute("col-id") ?? undefined;
    const rowEl = target.closest<HTMLElement>(".ag-row[row-index]");
    const rowIndex = rowEl?.getAttribute("row-index");
    const row = rowIndex && /^\d+$/.test(rowIndex) ? gridApi.current?.getDisplayedRowAtIndex(Number(rowIndex))?.data : undefined;
    setMenu({ x, y, origin: cell ?? target, colId: colId && /^c\d+$/.test(colId) ? colId : undefined, row });
  };
  const menuItems: ContextMenuItem[] = [];
  if (!menu?.exportsOnly) {
    const contextRow = menu?.row;
    const contextColumn = menu?.colId;
    const index = contextColumn ? Number(contextColumn.slice(1)) : -1;
    if (contextRow && contextColumn) menuItems.push({ label: "Hücreyi kopyala", action: () => { void copy(formatValue(contextRow[contextColumn] ?? null, columns[index].type, columns[index].format)); } });
    if (contextRow) menuItems.push({ label: "Satırı kopyala", action: () => { void copy(displayedColumns().map((id) => {
      const c = columns[Number(id.slice(1))]; return formatValue(contextRow[id] ?? null, c.type, c.format).replace(/[\t\r\n]+/g, " ");
    }).join("\t")); } });
    if (contextColumn) {
      menuItems.push({ label: "Artan sırala", separator: true, action: () => { gridApi.current?.applyColumnState({ state: [{ colId: contextColumn, sort: "asc" }], defaultState: { sort: null } }); } });
      menuItems.push({ label: "Azalan sırala", action: () => { gridApi.current?.applyColumnState({ state: [{ colId: contextColumn, sort: "desc" }], defaultState: { sort: null } }); } });
    }
    menuItems.push({ label: "Sıralamayı temizle", action: () => { gridApi.current?.applyColumnState({ defaultState: { sort: null } }); } });
    if (filtersEnabled || searchEnabled) menuItems.push({ label: "Arama ve filtreleri temizle", action: () => { setSearch(""); gridApi.current?.setFilterModel(null); } });
    if (columnsEnabled) {
      if (contextColumn) menuItems.push({ label: "Bu sütunu gizle", separator: true, action: () => setHidden((old) => [...new Set([...old, index])]) });
      menuItems.push({ label: "Tüm sütunları göster", action: () => setHidden([]) });
    }
  }
  exportKinds.forEach((kind, i) => menuItems.push({ label: kind === "xlsx" ? "Excel (.xlsx) indir" : `${kind.toUpperCase()} indir`, disabled: busy || loading,
    separator: i === 0 && !menu?.exportsOnly, action: () => { void exportTable(kind); } }));

  const registry = useVisualMenuSource("table", () => menuItems);

  return <div className="v-ag-wrap" onContextMenu={(e) => {
    if (!contextEnabled || (e.target as HTMLElement).closest("input,textarea")) return;
    e.preventDefault(); e.stopPropagation(); openContextMenu(e.target as HTMLElement, e.clientX, e.clientY);
  }} onKeyDown={(e) => {
    if (!contextEnabled || (e.target as HTMLElement).closest("input,textarea") || !(e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) return;
    e.preventDefault(); e.stopPropagation();
    const target = e.target as HTMLElement; const rect = target.getBoundingClientRect();
    openContextMenu(target, rect.left, rect.bottom);
  }}>
    {showTools && <div className="v-ag-tools" onPointerDown={(e) => e.stopPropagation()}>
      {searchEnabled && <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="Tabloda ara" aria-label="Tabloda ara" />}
      {columnsEnabled && <div className="v-ag-column-menu">
        <button type="button" onClick={() => setColumnsOpen(!columnsOpen)} aria-expanded={columnsOpen}>Sütunlar ▾</button>
        {columnsOpen && <div className="v-ag-column-list">
          {columns.map((c, i) => <label key={i}><input type="checkbox" checked={!hidden.includes(i)}
            onChange={(e) => setHidden((old) => e.target.checked ? old.filter((x) => x !== i) : [...old, i])} />{c.name}</label>)}
        </div>}
      </div>}
      {exportEnabled && <button type="button" disabled={busy || loading} aria-haspopup="menu" aria-expanded={menu?.exportsOnly === true}
        onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom, origin: e.currentTarget, exportsOnly: true }); }}
        title="Filtrelenen satırları ve görünen sütunları indir">{busy ? "Hazırlanıyor…" : "İndir ▾"}</button>}
      {countEnabled && <span className="v-ag-count">{displayCount.toLocaleString("tr-TR")}{displayCount !== rows.length ? ` / ${rows.length.toLocaleString("tr-TR")}` : ""} satır</span>}
    </div>}
    {(busy || notice) && <div className="v-table-feedback" role="status">{busy ? "Dosya hazırlanıyor…" : notice}</div>}
    {error && <div className="v-table-feedback error" role="alert">{error}</div>}
    {menu && <ContextMenu position={menu} items={menu.exportsOnly ? menuItems : [...(registry?.itemsExcept("table") ?? []), ...menuItems]} onClose={closeMenu} />}
    <div className="v-ag-grid">
      <AgGridProvider modules={modules}>
        <AgGridReact<GridRow> theme={theme} rowData={rowData} columnDefs={columnDefs}
          onGridReady={(event) => { gridApi.current = event.api; }}
          onGridPreDestroyed={() => { gridApi.current = null; }}
          defaultColDef={{ suppressHeaderMenuButton: true }} quickFilterText={activeSearch}
          rowHeight={30} headerHeight={34} floatingFiltersHeight={filtersEnabled ? 32 : 0}
          pagination={format.gridPagination === true} paginationPageSize={Number(format.gridPageSize) || 100}
          paginationPageSizeSelector={false} animateRows={false}
          pinnedBottomRowData={activeSearch || (filtersEnabled && columnFiltered) || format.showTotals === false ? [] : pinnedBottomRowData}
          getRowClass={(params) => {
            if (params.node.rowPinned) return "v-ag-total";
            const row = params.data;
            if (!row || !hasSel || groupCount === 0) return format.banded !== false && (params.node.rowIndex ?? 0) % 2 ? "v-ag-band" : "";
            const isSel = selectedKey !== undefined
              ? JSON.stringify(Array.from({ length: groupCount }, (_, i) => row[`c${i}`])) === selectedKey
              : row.c0 === selected;
            return isSel ? "v-ag-selected" : "v-ag-dim";
          }}
          onRowClicked={(event) => {
            if (event.node.rowPinned || !event.data || groupCount === 0) return;
            const row = columns.map((_, i) => event.data![`c${i}`] ?? null);
            if (onSelectRow) onSelectRow(row); else onSelect?.(row[0]);
          }}
          onSortChanged={(event) => {
            if (!onSort) return;
            const sorted = event.api.getColumnState().find((c) => c.sort);
            const index = sorted ? Number(sorted.colId.replace(/^c/, "")) : -1;
            if (sorted && !Number.isInteger(index)) return;
            const next = sorted ? { index, desc: sorted.sort === "desc" } : undefined;
            if (next?.index !== sort?.index || next?.desc !== sort?.desc) onSort(next);
          }}
          onModelUpdated={(event) => setDisplayCount(event.api.getDisplayedRowCount())}
          onFilterChanged={(event) => setColumnFiltered(event.api.isColumnFilterPresent())}
        />
      </AgGridProvider>
    </div>
    {result.truncated && <div className="v-note">İlk {rows.length.toLocaleString("tr-TR")} satır gösteriliyor</div>}
  </div>;
}
