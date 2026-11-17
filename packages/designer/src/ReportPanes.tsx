import type { Agg, ModelTable, ValueRef, Visual, VisualType } from "@floem/client";
import { useState, type DragEvent } from "react";
import { ColumnTypeIcon, DateTableIcon, TableIcon } from "./icons";
import { FIELD_MIME } from "./PageCanvas";
import { AGG_LABEL, VISUAL_DEFS, usesColumn, valueLabel, type WellDef } from "@floem/report";

function readField(e: DragEvent) {
  try {
    return JSON.parse(e.dataTransfer.getData(FIELD_MIME)) as { table: string; column: string };
  } catch {
    return null;
  }
}

function Well({
  def, visual, onDrop, onChange,
}: {
  def: WellDef;
  visual: Visual;
  onDrop: (well: WellDef["key"], table: string, column: string) => void;
  onChange: (v: Visual) => void;
}) {
  const [over, setOver] = useState(false);
  const items = def.key === "group" ? visual.group : visual.values;
  const remove = (i: number) =>
    onChange(def.key === "group"
      ? { ...visual, group: visual.group.filter((_, j) => j !== i) }
      : { ...visual, values: visual.values.filter((_, j) => j !== i) });
  const setAgg = (i: number, agg: Agg) =>
    onChange({ ...visual, values: visual.values.map((x, j) => (j === i && !("measure" in x) ? { ...x, agg } : x)) });

  return (
    <div
      className={`well ${over ? "over" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(FIELD_MIME)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const f = readField(e);
        if (f) {
          e.preventDefault();
          onDrop(def.key, f.table, f.column);
        }
      }}
    >
      <div className="well-label">{def.label}</div>
      {items.length === 0 && <div className="well-empty">Veri alanlarını buraya ekleyin</div>}
      {items.map((it, i) => (
        <div key={i} className="well-item">
          <span className="well-name" title={"measure" in it ? it.measure : `${it.table}[${it.column}]`}>
            {def.key === "group" ? (it as { column: string }).column : valueLabel(it as ValueRef)}
          </span>
          {def.key === "values" && !("measure" in it) && (
            <select
              value={(it as { agg: Agg }).agg}
              onChange={(e) => setAgg(i, e.target.value as Agg)}
              aria-label="Toplama türü"
              title="Bu alanın nasıl özetleneceği"
            >
              {(Object.keys(AGG_LABEL) as Agg[]).map((a) => (
                <option key={a} value={a}>
                  {AGG_LABEL[a]}
                </option>
              ))}
            </select>
          )}
          <button className="well-x" onClick={() => remove(i)} aria-label="Kaldır">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/** Power BI "Görselleştirmeler" bölmesi: görsel türü + seçili görselin alan kutuları. */
export function VisualizationsPane({
  visual, onPickType, onChange, onDropToWell,
}: {
  visual: Visual | null;
  onPickType: (t: VisualType) => void;
  onChange: (v: Visual) => void;
  onDropToWell: (well: WellDef["key"], table: string, column: string) => void;
}) {
  return (
    <aside className="viz-pane">
      <h3>Görselleştirmeler</h3>
      <div className="viz-types">
        {(Object.keys(VISUAL_DEFS) as VisualType[]).map((t) => (
          <button
            key={t}
            className={`viz-type ${visual?.type === t ? "active" : ""}`}
            title={visual ? `${VISUAL_DEFS[t].label} olarak değiştir` : `Yeni ${VISUAL_DEFS[t].label.toLowerCase()}`}
            onClick={() => onPickType(t)}
          >
            <span>{VISUAL_DEFS[t].icon}</span>
            {VISUAL_DEFS[t].label}
          </button>
        ))}
      </div>
      {visual ? (
        <>
          {VISUAL_DEFS[visual.type].wells.map((w) => (
            <Well key={w.key} def={w} visual={visual} onDrop={onDropToWell} onChange={onChange} />
          ))}
          <div className="well">
            <div className="well-label">Başlık</div>
            <input
              type="text"
              value={visual.title ?? ""}
              placeholder="Otomatik"
              onChange={(e) => onChange({ ...visual, title: e.target.value || undefined })}
            />
          </div>
        </>
      ) : (
        <p className="hint pad">Alanlarını görmek için sayfada bir görsel seçin ya da yukarıdan yeni görsel ekleyin.</p>
      )}
    </aside>
  );
}

/** Rapor görünümündeki "Veri" bölmesi: alanı işaretle ya da sürükle. Gizli alanlar görünmez (Power BI). */
export function FieldsPane({
  tables, visual, onToggle,
}: {
  tables: ModelTable[];
  visual: Visual | null;
  onToggle: (table: string, column: string, checked: boolean) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const needle = q.trim().toLocaleLowerCase("tr");
  const visible = tables.filter((t) => !t.gizli).sort((a, b) => a.ad.localeCompare(b.ad, "tr"));
  return (
    <aside className="data-pane">
      <h3>Veri</h3>
      <input className="search" placeholder="Ara" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="tree-scroll">
        {visible.map((t) => {
          const cols = t.sutunlar.filter((c) => !c.gizli && (!needle || c.ad.toLocaleLowerCase("tr").includes(needle)));
          if (needle && !cols.length && !t.ad.toLocaleLowerCase("tr").includes(needle)) return null;
          const expanded = needle ? true : !!open[t.ad];
          return (
            <div key={t.ad}>
              <div className="dp-table">
                <button className="chev-btn" onClick={() => setOpen((o) => ({ ...o, [t.ad]: !o[t.ad] }))} aria-label="Aç/kapat">
                  {expanded ? "▾" : "▸"}
                </button>
                <button className="dp-label" onClick={() => setOpen((o) => ({ ...o, [t.ad]: !o[t.ad] }))}>
                  {t.tarih_tablosu ? <DateTableIcon /> : <TableIcon />}
                  <span>{t.ad}</span>
                </button>
              </div>
              {expanded &&
                cols.map((c) => {
                  const checked = !!visual && usesColumn(visual, t.ad, c.ad);
                  return (
                    <label
                      key={c.ad}
                      className="dp-col field"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(FIELD_MIME, JSON.stringify({ table: t.ad, column: c.ad }));
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      title="Görsele eklemek için işaretleyin ya da sürükleyin"
                    >
                      <input type="checkbox" checked={checked} onChange={(e) => onToggle(t.ad, c.ad, e.target.checked)} />
                      <ColumnTypeIcon c={c} />
                      <span>{c.ad}</span>
                    </label>
                  );
                })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
