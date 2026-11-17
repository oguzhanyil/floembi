import type { VisualFormat, VisualResult, VisualResultColumn, VisualState } from "@floem/client";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatCompact, formatValue, isNumericType } from "./reportUtils";

type Raw = string | number | boolean | null;
export type CrossSelect = (value: Raw) => void;

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

const fmt = (v: Raw | undefined, c: VisualResultColumn) => formatValue(v ?? null, c.type, c.format);

// ------------------------------------------------------------------ Veri ızgarası (Tablo)
const ROW_H = 26;

/** Sanal kaydırmalı tablo: başlığa tıklayınca sıralar, toplam satırı, satıra tıklayınca çapraz filtre. */
export function DataGrid({
  result, selected, onSelect, sort, onSort, format,
}: {
  result: VisualResult;
  selected?: unknown;
  onSelect?: CrossSelect;
  sort?: VisualState["sort"];
  onSort?: (s: VisualState["sort"]) => void;
  format: VisualFormat;
}) {
  const { columns, rows, total } = result;
  const groupCount = columns.filter((c) => c.kind === "group").length;
  const scroller = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_H, overscan: 12 });
  const hasSel = selected !== undefined;
  const banded = format.banded !== false;

  // Sütun genişliği: başlık ve ilk 200 değerin uzunluğuna göre
  const widths = useMemo(
    () =>
      columns.map((c, ci) => {
        let len = c.name.length;
        for (const r of rows.slice(0, 200)) len = Math.max(len, fmt(r[ci], c).length);
        return Math.max(64, Math.min(320, len * 7.4 + 22));
      }),
    [columns, rows],
  );
  const template = widths.map((w) => `${w}px`).join(" ") + " 1fr";

  return (
    <div className="v-grid" ref={scroller}>
      <div className="v-grid-head" style={{ gridTemplateColumns: template }}>
        {columns.map((c, i) => {
          const active = sort?.index === i;
          return (
            <div
              key={i}
              className={`v-grid-th ${c.kind === "value" ? "num" : ""} ${onSort ? "sortable" : ""}`}
              title={onSort ? "Sıralamak için tıklayın" : undefined}
              onClick={onSort ? () => onSort(active && sort?.desc ? undefined : { index: i, desc: active ? true : c.kind === "value" }) : undefined}
            >
              {c.name}
              {active && <span className="sort-ind">{sort?.desc ? " ▼" : " ▲"}</span>}
            </div>
          );
        })}
      </div>
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((it) => {
          const r = rows[it.index];
          const isSel = hasSel && groupCount > 0 && r[0] === selected;
          return (
            <div
              key={it.key}
              className={`v-grid-row ${banded && it.index % 2 ? "band" : ""} ${hasSel ? (isSel ? "sel" : "dim") : ""}`}
              style={{ gridTemplateColumns: template, transform: `translateY(${it.start}px)`, height: ROW_H }}
              onClick={groupCount && onSelect ? () => onSelect(r[0]) : undefined}
            >
              {r.map((val, ci) => (
                <div key={ci} className={columns[ci].kind === "value" ? "num" : ""}>
                  {fmt(val, columns[ci])}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {total && (
        <div className="v-grid-total" style={{ gridTemplateColumns: template }}>
          {columns.map((c, ci) =>
            c.kind === "group" ? (
              <div key={ci}>{ci === 0 ? "Toplam" : ""}</div>
            ) : (
              <div key={ci} className="num">
                {fmt(total[ci - groupCount], c)}
              </div>
            ),
          )}
        </div>
      )}
      {result.truncated && <div className="v-note">İlk {rows.length.toLocaleString("tr-TR")} satır gösteriliyor</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Kartlar
function bigNumber(v: Raw, c: VisualResultColumn): string {
  if (v === null) return "(Boş)";
  return typeof v === "number" && !c.format ? formatCompact(v) : fmt(v, c);
}

export function CardVisual({ result, format }: { result: VisualResult; format: VisualFormat }) {
  const c = result.columns[0];
  const v = result.rows[0]?.[0] ?? null;
  const [ref, size] = useSize<HTMLDivElement>();
  const text = bigNumber(v, c);
  const font = Math.max(18, Math.min(size.h * 0.42, (size.w / Math.max(text.length, 3)) * 1.6));
  return (
    <div className="v-card" ref={ref}>
      <div className="v-card-value" style={{ fontSize: font }} title={fmt(v, c)}>
        {text}
      </div>
      {format.categoryLabel !== false && <div className="v-card-label">{c.name}</div>}
    </div>
  );
}

/** Çok satırlı kart: kategori başına bir satır, her satırda değerler. */
export function MultiCard({ result, selected, onSelect }: { result: VisualResult; selected?: unknown; onSelect?: CrossSelect }) {
  const groupCount = result.columns.filter((c) => c.kind === "group").length;
  const values = result.columns.slice(groupCount);
  const hasSel = selected !== undefined;
  return (
    <div className="v-multicard">
      {result.rows.map((r, ri) => (
        <div
          key={ri}
          className={`v-mc-row ${hasSel ? (r[0] === selected ? "sel" : "dim") : ""}`}
          onClick={groupCount && onSelect ? () => onSelect(r[0]) : undefined}
        >
          {groupCount > 0 && <div className="v-mc-title">{fmt(r[0], result.columns[0])}</div>}
          <div className="v-mc-values">
            {values.map((c, ci) => (
              <div key={ci}>
                <div className="v-mc-value">{bigNumber(r[groupCount + ci], c)}</div>
                <div className="v-mc-label">{c.name}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** KPI: değer, hedef ve fark. Durum renk + simge + metinle gösterilir (yalnızca renk değil). */
export function KpiVisual({ result, format }: { result: VisualResult; format: VisualFormat }) {
  const [vc, tc] = result.columns;
  const row = result.rows[0] ?? [];
  const value = row[0] ?? null;
  const target = tc ? row[1] ?? null : null;
  const [ref, size] = useSize<HTMLDivElement>();
  const higherIsBetter = format.higherIsBetter !== false;
  let status: "good" | "bad" | null = null;
  let diffText = "";
  if (typeof value === "number" && typeof target === "number" && target !== 0) {
    const diff = (value - target) / Math.abs(target);
    status = (diff >= 0) === higherIsBetter ? "good" : "bad";
    diffText = `${diff >= 0 ? "+" : ""}%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(diff * 100)}`;
  }
  const text = bigNumber(value, vc);
  const font = Math.max(18, Math.min(size.h * 0.36, (size.w / Math.max(text.length, 3)) * 1.5));
  return (
    <div className="v-kpi" ref={ref}>
      <div className="v-kpi-main">
        <span className="v-card-value" style={{ fontSize: font }}>{text}</span>
        {status && (
          <span className={`v-kpi-status ${status}`} title={status === "good" ? "Hedefin üstünde" : "Hedefin altında"}>
            {status === "good" ? "▲" : "▼"} {status === "good" ? "İyi" : "Kötü"}
          </span>
        )}
      </div>
      <div className="v-card-label">{vc.name}</div>
      {tc && (
        <div className="v-kpi-target">
          Hedef: {bigNumber(target, tc)} {diffText && <strong className={status ?? ""}>({diffText})</strong>}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Dilimleyici
export function Slicer({
  result, format, state, onState, fieldType,
}: {
  result: VisualResult;
  format: VisualFormat;
  state: VisualState;
  onState: (s: VisualState) => void;
  fieldType?: VisualResultColumn["type"];
}) {
  const style = format.slicerStyle ?? "list";
  if (style === "range") return <RangeSlicer result={result} state={state} onState={onState} fieldType={fieldType} />;
  return <ListSlicer result={result} state={state} onState={onState} dropdown={style === "dropdown"} />;
}

function ListSlicer({
  result, state, onState, dropdown,
}: {
  result: VisualResult;
  state: VisualState;
  onState: (s: VisualState) => void;
  dropdown: boolean;
}) {
  const col = result.columns[0];
  const items = result.rows.map((r) => r[0]);
  const selected = new Set(state.selected ?? []);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const needle = q.trim().toLocaleLowerCase("tr");
  const shown = needle ? items.filter((it) => fmt(it, col).toLocaleLowerCase("tr").includes(needle)) : items;
  const toggle = (it: Raw) => {
    const next = new Set(selected);
    if (next.has(it)) next.delete(it);
    else next.add(it);
    onState({ ...state, selected: [...next] });
  };
  const summary = selected.size === 0 ? "Tümü" : selected.size === 1 ? fmt([...selected][0], col) : `${selected.size} seçili`;

  const list = (
    <div className="v-slicer-list">
      {items.length > 8 && <input className="v-slicer-search" placeholder="Ara" value={q} onChange={(e) => setQ(e.target.value)} />}
      <label className="v-slicer-item all">
        <input type="checkbox" checked={selected.size === 0} onChange={() => onState({ ...state, selected: [] })} />
        Tümünü seç
      </label>
      {shown.map((it, i) => (
        <label key={i} className="v-slicer-item">
          <input type="checkbox" checked={selected.has(it)} onChange={() => toggle(it)} />
          {fmt(it, col) || "(Boş)"}
        </label>
      ))}
    </div>
  );

  if (!dropdown) return list;
  return (
    <div className="v-slicer-dd">
      <button className="v-slicer-dd-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{summary}</span>
        <span>▾</span>
      </button>
      {open && <div className="v-slicer-dd-pop">{list}</div>}
    </div>
  );
}

function RangeSlicer({
  result, state, onState, fieldType,
}: {
  result: VisualResult;
  state: VisualState;
  onState: (s: VisualState) => void;
  fieldType?: VisualResultColumn["type"];
}) {
  const [minCol] = result.columns;
  const type = fieldType ?? minCol.type;
  const isDateField = type === "date" || type === "datetime";
  const [lo, hi] = [result.rows[0]?.[0] ?? null, result.rows[0]?.[1] ?? null];
  const range = state.range ?? [null, null];
  const norm = (v: Raw) => (v === null ? "" : isDateField ? String(v).slice(0, 10) : String(v));
  const set = (i: 0 | 1, raw: string) => {
    const val = raw === "" ? null : isDateField ? raw : Number(raw);
    const next: [string | number | null, string | number | null] = [range[0], range[1]];
    next[i] = val;
    onState({ ...state, range: next });
  };
  const inputType = isDateField ? "date" : isNumericType(type) ? "number" : "text";
  return (
    <div className="v-slicer-range">
      <label>
        Başlangıç
        <input type={inputType} value={norm(range[0])} min={norm(lo)} max={norm(hi)} placeholder={norm(lo)} onChange={(e) => set(0, e.target.value)} />
      </label>
      <label>
        Bitiş
        <input type={inputType} value={norm(range[1])} min={norm(lo)} max={norm(hi)} placeholder={norm(hi)} onChange={(e) => set(1, e.target.value)} />
      </label>
      <div className="v-slicer-hint">
        Veri aralığı: {fmt(lo, { ...minCol, type })} – {fmt(hi, { ...minCol, type })}
      </div>
      {(range[0] !== null || range[1] !== null) && (
        <button className="v-slicer-clear" onClick={() => onState({ ...state, range: [null, null] })}>
          Temizle
        </button>
      )}
    </div>
  );
}
