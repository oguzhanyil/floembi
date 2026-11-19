import type { Visual, VisualResult, VisualState } from "@floem/client";
import { useMemo, useState } from "react";
import type { CrossSelect } from "./charts";
import { ActionGlyph } from "./ActionGlyph";
import { safeActionIcon } from "./visualActions";
import { formatValue, valueLabel } from "./reportUtils";
import type { MatrixPart } from "./useVisualData";
import { useVisualExports, useVisualMenuSource } from "./VisualContextMenu";
import { allowedExportKinds } from "./tableExport";
import { matrixExcelLayout, matrixHeaderLayout, type MatrixExportRow } from "./matrixExport";

type Raw = string | number | boolean | null;
const MAX_RENDER_ROWS = 3000;
const k = (path: Raw[]) => JSON.stringify(path);

interface RowNode {
  path: Raw[];
  children: RowNode[];
}

/**
 * Power BI matrisi: satır grupları (açılır/kapanır ağaç), sütun grupları, her düzeyde alt
 * toplam. Yalnızca satır alanları verilirse ağaç tablo (tree grid) gibi davranır.
 */
export function MatrixVisual({
  v, parts, state, onState, selected, onSelect, onRowAction, loading = false,
}: {
  v: Visual;
  parts: MatrixPart[];
  state: VisualState;
  onState?: (s: VisualState) => void;
  selected?: unknown;
  onSelect?: CrossSelect;
  onRowAction?: (value: Raw) => void;
  loading?: boolean;
}) {
  const R = v.group.length;
  const C = v.type === "treegrid" ? 0 : (v.legend ?? []).length;
  const V = v.values.length;
  const treeMode = v.type === "treegrid";
  const separateRows = (v.format.matrixRowLayout ?? (treeMode ? "compact" : "columns")) === "columns";
  const rowHeaderCount = separateRows ? Math.max(1, R) : 1;
  const [search, setSearch] = useState("");
  const [treeSort, setTreeSort] = useState("source");

  const model = useMemo(() => {
    // (satır yolu, sütun yolu) → değerler
    const cells = new Map<string, Raw[]>();
    let valueCols: VisualResult["columns"] = [];
    let rowCols: VisualResult["columns"] = [];
    let colCols: VisualResult["columns"] = [];
    for (const { r, c, result } of parts) {
      if (r === R && c === 0) rowCols = result.columns.slice(0, R);
      if (r === 0 && c === C) colCols = result.columns.slice(0, C);
      valueCols = result.columns.slice(r + c);
      for (const row of result.rows) {
        cells.set(k(row.slice(0, r)) + "|" + k(row.slice(r, r + c)), row.slice(r + c));
      }
    }
    // Satır ağacı: her düzeyin sorgusundan sırayla
    const root: RowNode = { path: [], children: [] };
    const index = new Map<string, RowNode>([[k([]), root]]);
    for (let r = 1; r <= R; r++) {
      const part = parts.find((p) => p.r === r && p.c === 0);
      for (const row of part?.result.rows ?? []) {
        const path = row.slice(0, r);
        const key = k(path);
        if (index.has(key)) continue;
        const parent = index.get(k(path.slice(0, -1)));
        if (!parent) continue;
        const node = { path, children: [] };
        parent.children.push(node);
        index.set(key, node);
      }
    }
    // Sütun başlıkları: yaprak sütun birleşimleri (sunucu sırasıyla)
    const colPaths: Raw[][] = [];
    const seen = new Set<string>();
    for (const row of parts.find((p) => p.r === 0 && p.c === C && C > 0)?.result.rows ?? []) {
      const path = row.slice(0, C);
      if (!seen.has(k(path))) {
        seen.add(k(path));
        colPaths.push(path);
      }
    }
    return { cells, root, index, colPaths, valueCols, rowCols, colCols };
  }, [parts, R, C]);

  const expanded = new Set(state.expanded ?? []);
  const clearBranch = (node: RowNode, next: Set<string>) => {
    next.delete(k(node.path));
    node.children.forEach((child) => clearBranch(child, next));
  };
  const toggle = (path: Raw[]) => {
    const key = k(path);
    const next = new Set(expanded);
    const node = model.index.get(key);
    if (node) clearBranch(node, next);
    if (!expanded.has(key)) next.add(key);
    onState?.({ ...state, expanded: [...next] });
  };
  const expandAll = (open: boolean) => {
    if (!open) return onState?.({ ...state, expanded: [] });
    const keys: string[] = [];
    const walk = (n: RowNode) => {
      if (n.path.length && n.children.length) keys.push(k(n.path));
      n.children.forEach(walk);
    };
    walk(model.root);
    onState?.({ ...state, expanded: keys });
  };

  const { cells, root, colPaths, valueCols, rowCols, colCols } = model;
  const colGroups: { label: string; path: Raw[] | null }[] = [
    ...colPaths.map((p) => ({ label: p.map((x, i) => formatValue(x, colCols[i]?.type, colCols[i]?.format) || "(Boş)").join(" · "), path: p })),
    ...(C > 0 ? [{ label: "Toplam", path: null }] : [{ label: "", path: null }]),
  ];
  const valueNames = v.values.map(valueLabel);
  const rowFields = v.group.map((g, i) => ({ ...rowCols[i], name: g.column, kind: "group" as const, type: rowCols[i]?.type ?? "string" as const }));
  const columnGroups = colGroups.map((g) => ({ path: g.path, labels: g.path?.map((x, i) => formatValue(x, colCols[i]?.type, colCols[i]?.format) || "(Boş)") ?? (C ? ["Toplam"] : []) }));
  const measures = valueNames.map((name, i) => ({ ...valueCols[i], name, kind: "value" as const }));
  const headers = matrixHeaderLayout(separateRows ? rowFields : [{ name: v.group.map((g) => g.column).join(" / ") || "Satır", kind: "group", type: "string" }], columnGroups, measures, C).headers;

  const cellValues = (rowPath: Raw[], colPath: Raw[] | null) => cells.get(k(rowPath) + "|" + k(colPath ?? [])) ?? [];
  const fmtVal = (val: Raw | undefined, i: number) => formatValue(val ?? null, valueCols[i]?.type, valueCols[i]?.format);

  // Ağaç tablo: kardeş düğümleri sırala, aramada üst yolları koru.
  const needle = treeMode ? search.trim().toLocaleLowerCase("tr") : "";
  const nodeLabel = (n: RowNode) => formatValue(n.path.at(-1), rowCols[n.path.length - 1]?.type, rowCols[n.path.length - 1]?.format) || "(Boş)";
  const matches = (n: RowNode): boolean => !needle || nodeLabel(n).toLocaleLowerCase("tr").includes(needle) || n.children.some(matches);
  const sortedChildren = (n: RowNode) => {
    if (treeSort === "source") return n.children;
    return [...n.children].sort((a, b) => {
      if (treeSort === "az" || treeSort === "za") {
        const order = nodeLabel(a).localeCompare(nodeLabel(b), "tr", { numeric: true });
        return treeSort === "az" ? order : -order;
      }
      const av = Number(cellValues(a.path, null)[0] ?? 0);
      const bv = Number(cellValues(b.path, null)[0] ?? 0);
      return treeSort === "valueDesc" ? bv - av : av - bv;
    });
  };
  const visible: RowNode[] = [];
  const walk = (n: RowNode) => {
    for (const ch of sortedChildren(n)) {
      if (visible.length >= MAX_RENDER_ROWS) return;
      if (!matches(ch)) continue;
      visible.push(ch);
      if (needle || expanded.has(k(ch.path))) walk(ch);
    }
  };
  walk(root);
  const closedParents = visible.filter((n) => n.children.length && !expanded.has(k(n.path)));
  const openParents = visible.filter((n) => n.children.length && expanded.has(k(n.path)));
  const changeLevel = (open: boolean) => {
    const next = new Set(expanded);
    const deepestOpen = Math.max(0, ...openParents.map((n) => n.path.length));
    const frontier = open ? closedParents : openParents.filter((n) => n.path.length === deepestOpen);
    for (const node of frontier) {
      clearBranch(node, next);
      if (open) next.add(k(node.path));
    }
    onState?.({ ...state, expanded: [...next] });
  };
  const excelSnapshot = () => {
    const rows: MatrixExportRow[] = [];
    const valuesFor = (path: Raw[]) => colGroups.flatMap((g) => valueNames.map((_, i) => cellValues(path, g.path)[i] ?? null));
    const visit = (n: RowNode, hidden: boolean) => {
      for (const child of sortedChildren(n)) {
        if (!matches(child)) continue;
        // Excel en çok 8 satır düzeyi sunar; daha derin detaylar aynı grupta görünür kalır.
        const collapsed = !needle && child.path.length < 8 && child.children.length > 0 && !expanded.has(k(child.path));
        rows.push({ path: child.path, values: valuesFor(child.path), hidden, collapsed, summary: child.children.length > 0 });
        visit(child, hidden || collapsed);
      }
    };
    visit(root, false);
    return matrixExcelLayout(rowFields, columnGroups, measures, rows, valuesFor([]), C);
  };
  const hasSel = selected !== undefined;
  const rowHeader = v.group.map((g) => g.column).join(" / ");
  const exportCsv = () => {
    if (loading) return;
    const safeCell = (value: string) => {
      const guarded = /^[\s]*[+\-=@\t\r]/.test(value) ? `'${value}` : value;
      return `"${guarded.replaceAll('"', '""')}"`;
    };
    const lines = [[rowHeader, ...valueNames].map(safeCell).join(","),
      ...visible.map((n) => [n.path.map(String).join(" / "), ...cellValues(n.path, null).map((x, i) => fmtVal(x, i))].map(safeCell).join(","))];
    const href = URL.createObjectURL(new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = "floem-agac-tablo.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  useVisualMenuSource("matrix", () => [
    ...(R > 1 && onState ? [
      { label: "Bir düzey genişlet", action: () => changeLevel(true), disabled: !!needle || !closedParents.length },
      { label: "Bir düzey daralt", action: () => changeLevel(false), disabled: !!needle || !openParents.length },
      { label: "Tümünü genişlet", action: () => expandAll(true), disabled: !!needle },
      { label: "Tümünü daralt", action: () => expandAll(false), disabled: !!needle },
    ] : []),
    ...(treeMode ? [{ label: "Ağaç aramasını ve sıralamasını temizle", action: () => { setSearch(""); setTreeSort("source"); } }] : []),
  ]);
  useVisualExports("matrix-export", v.format, () => loading ? null : ({
    title: v.title || (treeMode ? "Ağaç tablo" : "Matris"),
    columns: [{ name: rowHeader || "Satır", kind: "group", type: "string" }, ...colGroups.flatMap((g) =>
      valueNames.map((name, i) => ({ ...valueCols[i], name: [g.label, name].filter(Boolean).join(" · "), kind: "value" as const })))],
    rows: visible.map((n) => [n.path.map(String).join(" / "), ...colGroups.flatMap((g) => valueNames.map((_, i) => cellValues(n.path, g.path)[i] ?? null))]),
    truncated: visible.length >= MAX_RENDER_ROWS || parts.some((p) => p.result.truncated),
    excel: excelSnapshot,
  }));

  return (
    <div className="v-matrix-wrap">
      {treeMode && <div className="v-tree-tools">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Ağaçta ara" aria-label="Ağaçta ara" />
        <select value={treeSort} onChange={(e) => setTreeSort(e.target.value)} aria-label="Ağaç sıralaması">
          <option value="source">Kaynak sırası</option><option value="az">Ad A–Z</option>
          <option value="za">Ad Z–A</option><option value="valueDesc">Değer büyükten</option>
          <option value="valueAsc">Değer küçükten</option>
        </select>
        {allowedExportKinds(v.format).includes("csv") && <button type="button" disabled={loading} onClick={exportCsv}>CSV ↓</button>}
      </div>}
      {R > 1 && onState && (
        <div className="v-matrix-tools">
          <button onClick={() => changeLevel(true)} aria-label="Bir düzey genişlet" disabled={!!needle || !closedParents.length}
            title={needle ? "Düzey değiştirmek için aramayı temizleyin" : "Bir sonraki satır düzeyini aç"}>+ Düzey</button>
          <button onClick={() => changeLevel(false)} aria-label="Bir düzey daralt" disabled={!!needle || !openParents.length}
            title="En alttaki açık düzeyi kapat">− Düzey</button>
          <span className="v-matrix-depth">Düzey {Math.max(1, ...visible.map((n) => n.path.length))}/{R}</span>
          <button onClick={() => expandAll(true)} disabled={!!needle} title="Tüm düzeyleri aç">⊞ Tümünü genişlet</button>
          <button onClick={() => expandAll(false)} disabled={!!needle} title="İlk düzeye dön">⊟ Daralt</button>
        </div>
      )}
      <table className="v-matrix">
        <thead>
          {headers.map((row, ri) => <tr key={ri}>
            {row.map((cell, ci) => cell && <th key={ci} rowSpan={cell.rowSpan} colSpan={cell.columnSpan}
              style={{ top: ri * 24 }} scope={ci < rowHeaderCount ? "col" : cell.columnSpan && cell.columnSpan > 1 ? "colgroup" : "col"}
              className={ci < rowHeaderCount ? "rowhead" : `colgroup ${C > 0 && ci >= rowHeaderCount + colPaths.length * V ? "total" : ""}`}>
              {cell.value}
            </th>)}
            {ri === 0 && v.format.rowAction && <th className="v-row-action-head" rowSpan={headers.length} title={v.format.rowAction.label}>⋯</th>}
          </tr>)}
        </thead>
        <tbody>
          {treeMode && needle && visible.length === 0 && <tr><td colSpan={rowHeaderCount + colGroups.length * V + (v.format.rowAction ? 1 : 0)} className="v-tree-empty">Eşleşen satır yok</td></tr>}
          {visible.map((n, rowIndex) => {
            const level = n.path.length;
            const leaf = level === R;
            const open = !!needle || expanded.has(k(n.path));
            const rc = rowCols[level - 1];
            const isSel = hasSel && level === 1 && n.path[0] === selected;
            return (
              <tr
                key={k(n.path)}
                className={`lvl${Math.min(level, 4)} ${leaf ? "" : "subtotal"} ${v.format.banded !== false && rowIndex % 2 ? "band" : ""} ${hasSel && level === 1 ? (isSel ? "sel" : "dim") : ""}`}
              >
                {Array.from({ length: rowHeaderCount }, (_, i) => separateRows && i !== level - 1 ? <td key={i} className="rowlabel" /> : (
                <td key={i} className="rowlabel" style={{ paddingLeft: 6 + (separateRows ? 0 : (level - 1) * 16) }}>
                  {n.children.length > 0 ? (
                    <button className="v-matrix-toggle" onClick={() => toggle(n.path)} disabled={!onState || !!needle} aria-label={open ? "Daralt" : "Genişlet"} aria-expanded={open}>
                      {open ? "−" : "+"}
                    </button>
                  ) : (
                    R > 1 && <span className="v-matrix-spacer" />
                  )}
                  <span className="v-matrix-label" onClick={level === 1 && onSelect ? () => onSelect(n.path[0]) : undefined}>
                    {formatValue(n.path[level - 1], rc?.type, rc?.format) || "(Boş)"}
                  </span>
                </td>))}
                {colGroups.flatMap((g, gi) => {
                  const vals = cellValues(n.path, g.path);
                  return valueNames.map((_, vi) => (
                    <td key={`${gi}-${vi}`} className={`num ${g.path === null && C > 0 ? "total" : ""}`}>
                      {fmtVal(vals[vi], vi)}
                    </td>
                  ));
                })}
                {v.format.rowAction && <td className="v-row-action-cell">
                  {leaf && <button type="button" title={v.format.rowAction.label}
                    aria-label={`${v.format.rowAction.label}: ${String((treeMode ? [...n.path, ...cellValues(n.path, null)] : n.path)[v.format.rowAction.sourceIndex] ?? "boş")}`}
                    disabled={v.format.rowAction.sourceIndex < 0 || v.format.rowAction.sourceIndex >= (treeMode ? n.path.length + cellValues(n.path, null).length : n.path.length)}
                    onClick={(e) => { e.stopPropagation(); onRowAction?.((treeMode ? [...n.path, ...cellValues(n.path, null)] : n.path)[v.format.rowAction!.sourceIndex] ?? null); }}>
                    {safeActionIcon(v.format.rowAction.iconData)
                      ? <img className="v-row-action-image" src={safeActionIcon(v.format.rowAction.iconData)} alt="" /> : <ActionGlyph icon={v.format.rowAction.icon} />}
                  </button>}
                </td>}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="rowlabel" colSpan={rowHeaderCount}>Toplam</td>
            {colGroups.flatMap((g, gi) => {
              const vals = cellValues([], g.path);
              return valueNames.map((_, vi) => (
                <td key={`${gi}-${vi}`} className={`num ${g.path === null && C > 0 ? "total" : ""}`}>
                  {fmtVal(vals[vi], vi)}
                </td>
              ));
            })}
            {v.format.rowAction && <td />}
          </tr>
        </tfoot>
      </table>
      {visible.length >= MAX_RENDER_ROWS && <div className="v-note">İlk {MAX_RENDER_ROWS} satır gösteriliyor</div>}
    </div>
  );
}

/** İlerleme çubuğu: değerin hedefe oranı. */
export function ProgressVisual({ result }: { result: VisualResult }) {
  const [vc, tc] = result.columns;
  const row = result.rows[0] ?? [];
  const value = typeof row[0] === "number" ? row[0] : null;
  const target = tc && typeof row[1] === "number" ? row[1] : null;
  const ratio = value !== null && target ? value / target : null;
  const fill = ratio === null ? 0 : Math.max(0, Math.min(1, ratio));
  const pctText = ratio === null ? "" : `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(ratio * 100)}`;
  return (
    <div className="v-progress">
      <div className="v-progress-top">
        <span className="v-progress-label">{vc.name}</span>
        <span className="v-progress-pct">
          {pctText}
          {ratio !== null && ratio >= 1 && <span className="v-progress-done" title="Hedefe ulaşıldı"> ✓ Hedefe ulaşıldı</span>}
        </span>
      </div>
      <div className="v-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fill * 100)}>
        <div className="v-progress-fill" style={{ width: `${fill * 100}%` }} />
      </div>
      <div className="v-progress-bottom">
        <span>{formatValue(value, vc.type, vc.format)}</span>
        {tc && <span>Hedef: {formatValue(target, tc.type, tc.format)}</span>}
      </div>
    </div>
  );
}
