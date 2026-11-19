import type { VisualFormat, VisualResult, VisualResultColumn, VisualState } from "@floem/client";
import { AllCommunityModule, themeQuartz, type ColDef, type GridApi } from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CrossSelect } from "./charts";
import { ActionGlyph } from "./ActionGlyph";
import { formatValue, isNumericType } from "./reportUtils";
import { safeActionIcon } from "./visualActions";

type Raw = string | number | boolean | null;
type GridRow = Record<string, Raw>;
const modules = [AllCommunityModule];
const theme = themeQuartz.withParams({
  fontFamily: '"Segoe UI", system-ui, sans-serif',
  fontSize: 12,
  spacing: 5,
  rowHeight: 30,
  headerHeight: 34,
  foregroundColor: "#202d3e",
  backgroundColor: "#ffffff",
  headerBackgroundColor: "#f4f7fb",
  borderColor: "#dce3ed",
  accentColor: "#2563eb",
});

/** Community sürümünde sanallaştırma, sütun taşıma, sıralama, filtre ve CSV. */
export function AgDataGrid({
  result, selected, onSelect, selectedKey, onSelectRow, onRowAction, sort, onSort, format,
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
}) {
  const gridApi = useRef<GridApi<GridRow> | null>(null);
  const [search, setSearch] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [hidden, setHidden] = useState<number[]>([]);
  const [displayCount, setDisplayCount] = useState(result.rows.length);
  const [columnFiltered, setColumnFiltered] = useState(false);
  const { columns, rows, total } = result;
  const groupCount = columns.filter((c) => c.kind === "group").length;
  const hasSel = selected !== undefined || selectedKey !== undefined;
  const rowAction = format.rowAction;
  const actionIcon = safeActionIcon(rowAction?.iconData);

  const rowData = useMemo(() => rows.map((row) => Object.fromEntries(row.map((value, i) => [`c${i}`, value])) as GridRow), [rows]);
  const pinnedBottomRowData = useMemo(() => total ? [Object.fromEntries(columns.map((c, i) => [
    `c${i}`, c.kind === "group" ? (i === 0 ? "Toplam" : null) : total[i - groupCount] ?? null,
  ])) as GridRow] : [], [columns, total, groupCount]);
  const columnDefs = useMemo<ColDef<GridRow>[]>(() => [
    ...columns.map((c: VisualResultColumn, i): ColDef<GridRow> => ({
      colId: `c${i}`, field: `c${i}`, headerName: c.name,
      minWidth: 88, width: Math.max(110, Math.min(280, c.name.length * 8 + 75)),
      filter: isNumericType(c.type) ? "agNumberColumnFilter" : "agTextColumnFilter",
      floatingFilter: format.gridFilters !== false,
      sortable: true, resizable: true,
      hide: hidden.includes(i),
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
  ], [columns, hidden, format.gridFilters, format.gridPinFirstColumn, sort, rowAction, actionIcon, onRowAction]);

  // Grid API'yi yalnız gridReady olayından sonra kullan.
  useEffect(() => { gridApi.current?.redrawRows(); }, [selected, selectedKey, rows]);
  const exportCsv = () => gridApi.current?.exportDataAsCsv({
    fileName: "floem-tablo.csv",
    skipPinnedBottom: true,
    processCellCallback: ({ value }) => {
      const text = String(value ?? "");
      return /^[\s]*[+\-=@\t\r]/.test(text) ? `'${text}` : text;
    },
  });

  return <div className="v-ag-wrap">
    <div className="v-ag-tools" onPointerDown={(e) => e.stopPropagation()}>
      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="Tabloda ara" aria-label="Tabloda ara" />
      <div className="v-ag-column-menu">
        <button type="button" onClick={() => setColumnsOpen(!columnsOpen)} aria-expanded={columnsOpen}>Sütunlar ▾</button>
        {columnsOpen && <div className="v-ag-column-list">
          {columns.map((c, i) => <label key={i}><input type="checkbox" checked={!hidden.includes(i)}
            onChange={(e) => setHidden((old) => e.target.checked ? old.filter((x) => x !== i) : [...old, i])} />{c.name}</label>)}
        </div>}
      </div>
      <button type="button" onClick={exportCsv} title="Görünen sütunları CSV olarak indir">CSV ↓</button>
      <span className="v-ag-count">{displayCount.toLocaleString("tr-TR")}{displayCount !== rows.length ? ` / ${rows.length.toLocaleString("tr-TR")}` : ""} satır</span>
    </div>
    <div className="v-ag-grid">
      <AgGridProvider modules={modules}>
        <AgGridReact<GridRow> theme={theme} rowData={rowData} columnDefs={columnDefs}
          onGridReady={(event) => { gridApi.current = event.api; }}
          onGridPreDestroyed={() => { gridApi.current = null; }}
          defaultColDef={{ suppressHeaderMenuButton: true }} quickFilterText={search}
          rowHeight={30} headerHeight={34} floatingFiltersHeight={32}
          pagination={format.gridPagination === true} paginationPageSize={Number(format.gridPageSize) || 100}
          paginationPageSizeSelector={false} animateRows={false}
          pinnedBottomRowData={search || columnFiltered || format.showTotals === false ? [] : pinnedBottomRowData}
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
