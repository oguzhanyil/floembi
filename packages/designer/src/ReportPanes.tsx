import type { Agg, FieldRef, ModelTable, ValueRef, Visual, VisualFormat, VisualType } from "@floem/client";
import {
  AGG_LABEL, SERIES, VISUAL_DEFS, VISUAL_GROUPS, valueLabel, type WellDef, type WellKey,
} from "@floem/report";
import { useState, type ReactNode } from "react";
import { FIELD_MIME, readPayload, usesField, type FieldPayload } from "./fields";
import { CalcIcon, ColumnTypeIcon, DateTableIcon, TableIcon } from "./icons";

const readField = readPayload;

/** Kutudaki öğeler: gruplama kutuları alan, değer kutuları ölçü/toplama tutar. */
function wellItems(v: Visual, def: WellDef): (FieldRef | ValueRef)[] {
  if (def.key === "group") return v.group;
  if (def.key === "legend") return v.legend ?? [];
  if (def.key === "target") return v.target ?? [];
  // Yuvalı değer kutusu (dağılım X/Y/boyut, gösterge değer/en büyük): yalnızca o sıradaki değer
  if (def.slot !== undefined) return v.values[def.slot] ? [v.values[def.slot]] : [];
  return v.values;
}

function setWell(v: Visual, def: WellDef, items: (FieldRef | ValueRef)[]): Visual {
  if (def.key === "values" && def.slot !== undefined) {
    const values = [...v.values];
    if (items.length) values[def.slot] = items[0] as ValueRef;
    else values.splice(def.slot, 1);
    return { ...v, values };
  }
  return { ...v, [def.key]: items } as Visual;
}

const isValueWell = (k: WellKey) => k === "values" || k === "target";

function Well({
  def, visual, onDrop, onChange,
}: {
  def: WellDef;
  visual: Visual;
  onDrop: (well: WellDef, field: FieldPayload) => void;
  onChange: (v: Visual) => void;
}) {
  const [over, setOver] = useState(false);
  const items = wellItems(visual, def);
  const remove = (i: number) => onChange(setWell(visual, def, items.filter((_, j) => j !== i)));
  const setAgg = (i: number, agg: Agg) =>
    onChange(setWell(visual, def, items.map((x, j) => (j === i && "agg" in x ? { ...x, agg } : x))));

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
          onDrop(def, f);
        }
      }}
    >
      <div className="well-label">
        {def.label}
        {def.optional && <span className="well-opt"> (isteğe bağlı)</span>}
      </div>
      {items.length === 0 && <div className="well-empty">Veri alanlarını buraya ekleyin</div>}
      {items.map((it, i) => (
        <div key={i} className="well-item">
          <span className="well-name" title={"measure" in it ? it.measure : `${it.table}[${it.column}]`}>
            {isValueWell(def.key) ? valueLabel(it as ValueRef) : (it as FieldRef).column}
          </span>
          {isValueWell(def.key) && "agg" in it && (
            <select value={it.agg} onChange={(e) => setAgg(i, e.target.value as Agg)} aria-label="Toplama türü" title="Bu alanın nasıl özetleneceği">
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="well">
      <div className="well-label">{title}</div>
      <div className="fmt-body">{children}</div>
    </div>
  );
}

/** Power BI "Görseli biçimlendir": türün desteklediği seçenekler. */
function FormatPanel({ visual, onChange }: { visual: Visual; onChange: (v: Visual) => void }) {
  const f = visual.format;
  const def = VISUAL_DEFS[visual.type];
  const set = (patch: Partial<VisualFormat>) => onChange({ ...visual, format: { ...f, ...patch } });
  const isPie = visual.type === "pie" || visual.type === "donut";
  const isChart = !!def.category || isPie || ["scatter", "treemap", "waterfall"].includes(visual.type);
  const colors = Array.isArray(f.colors) ? (f.colors as string[]) : [];
  const swatches = isPie || visual.legend?.length ? 8 : Math.max(1, Math.min(8, visual.values.length));

  return (
    <>
      <Section title="Başlık">
        <label className="inline">
          <input type="checkbox" checked={f.showTitle !== false} onChange={(e) => set({ showTitle: e.target.checked })} />
          Başlığı göster
        </label>
        <input
          type="text"
          value={visual.title ?? ""}
          placeholder="Otomatik"
          onChange={(e) => onChange({ ...visual, title: e.target.value || undefined })}
        />
      </Section>
      {isChart && (
        <Section title="Grafik">
          <label className="inline">
            <input
              type="checkbox"
              checked={isPie ? f.dataLabels !== false : !!f.dataLabels}
              onChange={(e) => set({ dataLabels: e.target.checked })}
            />
            Veri etiketleri
          </label>
          <label>
            Gösterge
            <select value={f.legend ?? (isPie ? "right" : "top")} onChange={(e) => set({ legend: e.target.value as VisualFormat["legend"] })}>
              <option value="top">Üstte</option>
              <option value="bottom">Altta</option>
              <option value="right">Sağda</option>
              <option value="none">Gizli</option>
            </select>
          </label>
          {def.category && (
            <>
              <label className="inline">
                <input type="checkbox" checked={f.xAxisTitle !== false} onChange={(e) => set({ xAxisTitle: e.target.checked })} />
                Kategori ekseni başlığı
              </label>
              <label className="inline">
                <input type="checkbox" checked={!!f.yAxisTitle} onChange={(e) => set({ yAxisTitle: e.target.checked })} />
                Değer ekseni başlığı
              </label>
            </>
          )}
        </Section>
      )}
      {isChart && (
        <Section title="Renkler">
          <p className="hint">Seriler sabit sırayla renklenir; sırayı buradan değiştirebilirsiniz.</p>
          <div className="fmt-colors">
            {Array.from({ length: swatches }, (_, i) => (
              <label key={i} className="fmt-color" title={`${i + 1}. renk`}>
                <input
                  type="color"
                  value={colors[i] || SERIES[i]}
                  onChange={(e) => {
                    const next = SERIES.map((c, j) => colors[j] || c);
                    next[i] = e.target.value;
                    set({ colors: next });
                  }}
                />
              </label>
            ))}
            {colors.length > 0 && (
              <button className="link" onClick={() => set({ colors: undefined })}>
                Varsayılana dön
              </button>
            )}
          </div>
        </Section>
      )}
      {(visual.type === "table" || visual.type === "matrix") && (
        <Section title={visual.type === "matrix" ? "Matris" : "Tablo"}>
          <label className="inline">
            <input type="checkbox" checked={f.banded !== false} onChange={(e) => set({ banded: e.target.checked })} />
            Satırları dönüşümlü renklendir
          </label>
          <p className="hint">Sıralamak için tablo başlığına tıklayın.</p>
        </Section>
      )}
      {visual.type === "card" && (
        <Section title="Kart">
          <label className="inline">
            <input type="checkbox" checked={f.categoryLabel !== false} onChange={(e) => set({ categoryLabel: e.target.checked })} />
            Kategori etiketi
          </label>
        </Section>
      )}
      {visual.type === "kpi" && (
        <Section title="KPI">
          <label>
            Yön
            <select value={f.higherIsBetter === false ? "low" : "high"} onChange={(e) => set({ higherIsBetter: e.target.value === "high" })}>
              <option value="high">Yüksek olması iyi</option>
              <option value="low">Düşük olması iyi</option>
            </select>
          </label>
        </Section>
      )}
      {visual.type === "slicer" && (
        <Section title="Dilimleyici">
          <label>
            Stil
            <select
              value={f.slicerStyle ?? "list"}
              onChange={(e) => onChange({ ...visual, format: { ...f, slicerStyle: e.target.value as VisualFormat["slicerStyle"] }, state: {} })}
            >
              <option value="list">Liste</option>
              <option value="dropdown">Açılır liste</option>
              <option value="range">Aralık (tarih / sayı)</option>
            </select>
          </label>
        </Section>
      )}
    </>
  );
}

/** Power BI "Görselleştirmeler" bölmesi: görsel türleri + seçili görselin alanları ve biçimi. */
export function VisualizationsPane({
  visual, onPickType, onChange, onDropToWell,
}: {
  visual: Visual | null;
  onPickType: (t: VisualType) => void;
  onChange: (v: Visual) => void;
  onDropToWell: (well: WellDef, field: FieldPayload) => void;
}) {
  const [tab, setTab] = useState<"fields" | "format">("fields");
  return (
    <aside className="viz-pane">
      <h3>Görselleştirmeler</h3>
      {VISUAL_GROUPS.map((g) => (
        <div key={g} className="viz-group">
          <div className="viz-group-label">{g}</div>
          <div className="viz-types">
            {(Object.keys(VISUAL_DEFS) as VisualType[])
              .filter((t) => VISUAL_DEFS[t].group === g)
              .map((t) => (
                <button
                  key={t}
                  className={`viz-type ${visual?.type === t ? "active" : ""}`}
                  title={visual ? `${VISUAL_DEFS[t].label} olarak değiştir` : `Yeni ${VISUAL_DEFS[t].label.toLowerCase()}`}
                  aria-label={VISUAL_DEFS[t].label}
                  onClick={() => onPickType(t)}
                >
                  <span>{VISUAL_DEFS[t].icon}</span>
                </button>
              ))}
          </div>
        </div>
      ))}
      {visual ? (
        <>
          <div className="viz-tabs" role="tablist">
            <button role="tab" className={tab === "fields" ? "active" : ""} onClick={() => setTab("fields")}>
              Alanlar
            </button>
            <button role="tab" className={tab === "format" ? "active" : ""} onClick={() => setTab("format")}>
              Biçim
            </button>
          </div>
          <div className="viz-selected">{VISUAL_DEFS[visual.type].label}</div>
          {tab === "fields" ? (
            VISUAL_DEFS[visual.type].wells.map((w) => (
              <Well key={`${w.key}-${w.slot ?? ""}`} def={w} visual={visual} onDrop={onDropToWell} onChange={onChange} />
            ))
          ) : (
            <FormatPanel visual={visual} onChange={onChange} />
          )}
        </>
      ) : (
        <p className="hint pad">Alanlarını görmek için sayfada bir görsel seçin ya da yukarıdan yeni görsel ekleyin.</p>
      )}
    </aside>
  );
}

/** Rapor görünümündeki "Veri" bölmesi: alanı işaretle ya da sürükle. Gizli alanlar görünmez (Power BI). */
export function FieldsPane({
  tables, visual, onToggle, onEditMeasure,
}: {
  tables: ModelTable[];
  visual: Visual | null;
  onToggle: (field: FieldPayload, checked: boolean) => void;
  onEditMeasure?: (name: string) => void;
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
          const measures = t.olculer.filter((m) => !needle || m.ad.toLocaleLowerCase("tr").includes(needle));
          if (needle && !cols.length && !measures.length && !t.ad.toLocaleLowerCase("tr").includes(needle)) return null;
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
                measures.map((m) => {
                  const field: FieldPayload = { measure: m.ad };
                  const checked = !!visual && usesField(visual, field);
                  return (
                    <label
                      key={`m:${m.ad}`}
                      className="dp-col field measure"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(FIELD_MIME, JSON.stringify(field));
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      title={`${m.ifade}\n\nGörsele eklemek için işaretleyin ya da sürükleyin; düzenlemek için ✎`}
                    >
                      <input type="checkbox" checked={checked} onChange={(e) => onToggle(field, e.target.checked)} />
                      <CalcIcon />
                      <span>{m.ad}</span>
                      {onEditMeasure && (
                        <button
                          className="dp-edit"
                          onClick={(e) => {
                            e.preventDefault();
                            onEditMeasure(m.ad);
                          }}
                          aria-label={`${m.ad} ölçüsünü düzenle`}
                          title="Formül çubuğunda düzenle"
                        >
                          ✎
                        </button>
                      )}
                    </label>
                  );
                })}
              {expanded &&
                cols.map((c) => {
                  const checked = !!visual && usesField(visual, { table: t.ad, column: c.ad });
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
                      <input type="checkbox" checked={checked} onChange={(e) => onToggle({ table: t.ad, column: c.ad }, e.target.checked)} />
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
