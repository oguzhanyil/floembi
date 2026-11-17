import type { ModelTable } from "@floem/client";
import { useState } from "react";
import { ColumnTypeIcon, DateTableIcon, HiddenIcon, TableIcon } from "@floem/designer";
import type { Selection } from "./modelUtils";

/** Power BI'daki "Veri" bölmesi: tablolar ve alanlar ağacı, arama. */
export function DataPane({
  tables, selection, onSelect,
}: {
  tables: ModelTable[];
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const needle = q.trim().toLocaleLowerCase("tr");
  const sorted = [...tables].sort((a, b) => a.ad.localeCompare(b.ad, "tr"));

  return (
    <aside className="data-pane">
      <h3>Veri</h3>
      <input className="search" placeholder="Ara" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="tree-scroll">
        {sorted.map((t) => {
          const cols = needle ? t.sutunlar.filter((c) => c.ad.toLocaleLowerCase("tr").includes(needle)) : t.sutunlar;
          const tableHit = !needle || t.ad.toLocaleLowerCase("tr").includes(needle);
          if (!tableHit && cols.length === 0) return null;
          const expanded = needle ? true : !!open[t.ad];
          const isSel = selection?.kind === "table" && selection.table === t.ad;
          return (
            <div key={t.ad}>
              <div className={`dp-table ${isSel ? "selected" : ""} ${t.gizli ? "is-hidden" : ""}`}>
                <button className="chev-btn" onClick={() => setOpen((o) => ({ ...o, [t.ad]: !o[t.ad] }))} aria-label="Aç/kapat">
                  {expanded ? "▾" : "▸"}
                </button>
                <button className="dp-label" onClick={() => onSelect({ kind: "table", table: t.ad })}>
                  {t.tarih_tablosu ? <DateTableIcon /> : <TableIcon />}
                  <span>{t.ad}</span>
                  {t.gizli && <HiddenIcon />}
                </button>
              </div>
              {expanded &&
                (needle && tableHit ? t.sutunlar : cols).map((c) => {
                  const sel = selection?.kind === "column" && selection.table === t.ad && selection.column === c.ad;
                  return (
                    <button
                      key={c.ad}
                      className={`dp-col ${sel ? "selected" : ""} ${c.gizli ? "is-hidden" : ""}`}
                      onClick={() => onSelect({ kind: "column", table: t.ad, column: c.ad })}
                    >
                      <ColumnTypeIcon c={c} />
                      <span>{c.ad}</span>
                      {c.gizli && <HiddenIcon />}
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
