import type { ModelTable } from "@floem/client";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, useState, type DragEvent } from "react";
import { DRAG_MIME, useModelView, type ColumnPick } from "./ModelContext";
import { CalcIcon, ColumnTypeIcon, DateTableIcon, HiddenIcon, KeyIcon, TableIcon } from "@floem/designer";
import { HEADER_H, MAX_ROWS, NODE_WIDTH, ROW_H, TYPE_LABEL, nf } from "./modelUtils";

export type TableNodeData = { table: ModelTable; rows: number | null; collapsed: boolean };
export type TableNodeT = Node<TableNodeData, "table">;

const handleStyle = {
  opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0, pointerEvents: "none",
} as const;

function readDrag(e: DragEvent): ColumnPick | null {
  try {
    return JSON.parse(e.dataTransfer.getData(DRAG_MIME)) as ColumnPick;
  } catch {
    return null;
  }
}

/** Power BI'daki model görünümü tablo kartı. */
function TableNodeImpl({ data }: NodeProps<TableNodeT>) {
  const { table, rows, collapsed } = data;
  const mv = useModelView();
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const sel = mv.selection;
  const tableSelected = sel?.kind === "table" && sel.table === table.ad;

  return (
    <div className={`tcard ${tableSelected ? "selected" : ""} ${table.gizli ? "is-hidden" : ""}`} style={{ width: NODE_WIDTH }}>
      <Handle type="source" position={Position.Right} style={handleStyle} isConnectable={false} />
      <Handle type="target" position={Position.Left} style={handleStyle} isConnectable={false} />
      <div
        className="tcard-head"
        style={{ height: HEADER_H }}
        onClick={() => mv.select({ kind: "table", table: table.ad })}
        title={rows !== null ? `${table.ad} · ${nf.format(rows)} satır` : table.ad}
      >
        {table.tarih_tablosu ? <DateTableIcon /> : <TableIcon />}
        <span className="tcard-title">{table.ad}</span>
        {table.gizli && <HiddenIcon />}
        <button
          className="tcard-toggle nodrag"
          onClick={(e) => {
            e.stopPropagation();
            mv.toggleCollapsed(table.ad);
          }}
          aria-label={collapsed ? "Genişlet" : "Daralt"}
          title={collapsed ? "Genişlet" : "Daralt"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
      </div>
      {!collapsed && (
        <div className="tcard-body nowheel nodrag" style={{ maxHeight: MAX_ROWS * ROW_H + 8 }}>
          {table.sutunlar.map((c) => {
            const key = `${table.ad}[${c.ad}]`.toLowerCase();
            const selected = sel?.kind === "column" && sel.table === table.ad && sel.column === c.ad;
            const cls = [
              "tcard-row",
              selected && "selected",
              c.gizli && "is-hidden",
              mv.highlighted.has(key) && "highlight",
              dropTarget === c.ad && "drop",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div
                key={c.ad}
                className={cls}
                style={{ height: ROW_H }}
                title={`${c.ad} · ${TYPE_LABEL[c.tip]}${c.anahtar ? " · birincil anahtar" : ""}${c.gizli ? " · gizli" : ""}\nİlişki kurmak için başka bir tablodaki sütunun üstüne sürükleyin`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ table: table.ad, column: c.ad }));
                  e.dataTransfer.effectAllowed = "link";
                }}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "link";
                  if (dropTarget !== c.ad) setDropTarget(c.ad);
                }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropTarget(null);
                  const from = readDrag(e);
                  if (from && from.table !== table.ad) mv.columnDrop(from, { table: table.ad, column: c.ad });
                }}
                onClick={() => mv.select({ kind: "column", table: table.ad, column: c.ad })}
              >
                <span className="tcard-ico">
                  <ColumnTypeIcon c={c} />
                </span>
                <span className="tcard-name">{c.ad}</span>
                {c.anahtar && <KeyIcon />}
                {c.gizli && <HiddenIcon />}
              </div>
            );
          })}
          {table.olculer.map((m) => (
            <div key={`m:${m.ad}`} className="tcard-row measure" style={{ height: ROW_H }} title={m.ifade}>
              <span className="tcard-ico">
                <CalcIcon />
              </span>
              <span className="tcard-name">{m.ad}</span>
            </div>
          ))}
          {table.sutunlar.length === 0 && <div className="tcard-row muted">Sütun yok</div>}
        </div>
      )}
    </div>
  );
}

export const TableNode = memo(TableNodeImpl);
