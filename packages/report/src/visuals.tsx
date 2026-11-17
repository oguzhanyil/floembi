import type { VisualResult } from "@floem/client";
import { useLayoutEffect, useRef, useState } from "react";
import { SERIES, formatCompact, formatValue } from "./reportUtils";

export type CrossSelect = (value: string | number | boolean | null) => void;

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

// ------------------------------------------------------------------ Tablo
export function TableVisual({
  result, selected, onSelect,
}: {
  result: VisualResult;
  selected?: unknown;
  onSelect?: CrossSelect;
}) {
  const { columns, rows, total } = result;
  const groupCount = columns.filter((c) => c.kind === "group").length;
  const hasSel = selected !== undefined;
  return (
    <div className="v-table-wrap">
      <table className="v-table">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} className={c.kind === "value" ? "num" : ""}>
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => {
            const isSel = hasSel && groupCount > 0 && r[0] === selected;
            return (
              <tr
                key={ri}
                className={hasSel ? (isSel ? "sel" : "dim") : ""}
                onClick={groupCount && onSelect ? () => onSelect(r[0]) : undefined}
              >
                {r.map((v, ci) => (
                  <td key={ci} className={columns[ci].kind === "value" ? "num" : ""}>
                    {formatValue(v, columns[ci].type, columns[ci].format)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {total && (
          <tfoot>
            <tr>
              {columns.map((c, ci) =>
                c.kind === "group" ? (
                  <td key={ci}>{ci === 0 ? "Toplam" : ""}</td>
                ) : (
                  <td key={ci} className="num">
                    {formatValue(total[ci - groupCount], c.type, c.format)}
                  </td>
                ),
              )}
            </tr>
          </tfoot>
        )}
      </table>
      {result.truncated && <div className="v-note">İlk {rows.length.toLocaleString("tr-TR")} satır gösteriliyor</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Kart
export function CardVisual({ result }: { result: VisualResult }) {
  const c = result.columns[0];
  const v = result.rows[0]?.[0] ?? null;
  const [ref, size] = useSize<HTMLDivElement>();
  const text = typeof v === "number" && !c.format ? formatCompact(v) : v === null ? "(Boş)" : formatValue(v, c.type, c.format);
  const font = Math.max(18, Math.min(size.h * 0.42, (size.w / Math.max(text.length, 3)) * 1.6));
  return (
    <div className="v-card" ref={ref}>
      <div className="v-card-value" style={{ fontSize: font }} title={formatValue(v, c.type, c.format)}>
        {text}
      </div>
      <div className="v-card-label">{c.name}</div>
    </div>
  );
}

// ------------------------------------------------------------------ Kümelenmiş sütun grafiği
function niceTicks(max: number, min: number, count = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (hi === lo) return [0, 1];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks = [];
  for (let t = Math.floor(lo / step) * step; t <= hi + step * 1e-9; t += step) ticks.push(+t.toFixed(10));
  if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function bar(x: number, y0: number, w: number, y1: number, r: number) {
  // Üst ucu yuvarlak, tabanı köşeli sütun (negatif değerde ters)
  const up = y1 < y0;
  const h = Math.abs(y1 - y0);
  const rr = Math.min(r, h, w / 2);
  if (up) {
    return `M${x},${y0} V${y1 + rr} Q${x},${y1} ${x + rr},${y1} H${x + w - rr} Q${x + w},${y1} ${x + w},${y1 + rr} V${y0} Z`;
  }
  return `M${x},${y0} V${y1 - rr} Q${x},${y1} ${x + rr},${y1} H${x + w - rr} Q${x + w},${y1} ${x + w},${y1 - rr} V${y0} Z`;
}

export function ColumnChart({
  result, selected, onSelect,
}: {
  result: VisualResult;
  selected?: unknown;
  onSelect?: CrossSelect;
}) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const cat = result.columns[0];
  const series = result.columns.slice(1);
  const rows = result.rows;
  const legendH = series.length > 1 ? 22 : 0;
  const W = size.w;
  const H = size.h - legendH;
  const nums = rows.flatMap((r) => r.slice(1).map((v) => (typeof v === "number" ? v : 0)));
  const ticks = niceTicks(Math.max(0, ...nums), Math.min(0, ...nums));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const tickLabels = ticks.map((t) => formatCompact(t));
  const left = Math.max(28, ...tickLabels.map((t) => t.length * 6.5)) + 8;
  const bottom = 34;
  const top = 8;
  const plotW = Math.max(0, W - left - 8);
  const plotH = Math.max(0, H - top - bottom);
  const y = (v: number) => top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const band = rows.length ? plotW / rows.length : 0;
  const barW = Math.max(2, Math.min(24, (band * 0.7) / Math.max(series.length, 1) - 2));
  const groupW = barW * series.length + 2 * (series.length - 1);
  const maxLabel = Math.max(3, Math.floor(band / 6.5));
  const showEvery = Math.max(1, Math.ceil(28 / Math.max(band, 1)));
  const hasSel = selected !== undefined;

  return (
    <div className="v-chart" ref={ref}>
      {W > 0 && H > 40 && (
        <svg width={W} height={H} role="img" aria-label={`${series.map((s) => s.name).join(", ")} - ${cat.name}`}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? "v-axis" : "v-grid"} />
              <text x={left - 6} y={y(t)} className="v-tick" textAnchor="end" dominantBaseline="central">
                {tickLabels[i]}
              </text>
            </g>
          ))}
          {rows.map((r, i) => {
            const x0 = left + i * band + (band - groupW) / 2;
            const isSel = hasSel && r[0] === selected;
            const label = formatValue(r[0], cat.type, cat.format) || "(Boş)";
            return (
              <g
                key={i}
                className={`v-cat ${hasSel ? (isSel ? "sel" : "dim") : ""}`}
                onMouseMove={(e) => {
                  const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setHover({ i, x: e.clientX - box.left, y: e.clientY - box.top });
                }}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(r[0]);
                }}
              >
                {/* geniş tıklama alanı */}
                <rect x={left + i * band} y={top} width={band} height={plotH} className="v-hit" />
                {series.map((_, si) => {
                  const v = typeof r[si + 1] === "number" ? (r[si + 1] as number) : 0;
                  return (
                    <path key={si} d={bar(x0 + si * (barW + 2), y(0), barW, y(v), 4)} fill={SERIES[si % SERIES.length]} />
                  );
                })}
                {i % showEvery === 0 && (
                  <text x={left + i * band + band / 2} y={top + plotH + 14} className="v-tick" textAnchor="middle">
                    {label.length > maxLabel * showEvery ? label.slice(0, Math.max(1, maxLabel * showEvery - 1)) + "…" : label}
                  </text>
                )}
              </g>
            );
          })}
          <text x={left + plotW / 2} y={H - 4} className="v-axis-title" textAnchor="middle">
            {cat.name}
          </text>
        </svg>
      )}
      {series.length > 1 && (
        <div className="v-legend">
          {series.map((ser, si) => (
            <span key={si}>
              <i style={{ background: SERIES[si % SERIES.length] }} />
              {ser.name}
            </span>
          ))}
        </div>
      )}
      {hover && rows[hover.i] && (
        <div className="v-tooltip" style={{ left: Math.min(hover.x + 12, W - 180), top: Math.max(0, hover.y - 10) }}>
          <strong>{formatValue(rows[hover.i][0], cat.type, cat.format) || "(Boş)"}</strong>
          {series.map((s, si) => (
            <div key={si}>
              {series.length > 1 && <i style={{ background: SERIES[si % SERIES.length] }} />}
              {s.name}: <b>{formatValue(rows[hover.i][si + 1], s.type, s.format)}</b>
            </div>
          ))}
        </div>
      )}
      {result.truncated && <div className="v-note">İlk {rows.length} kategori gösteriliyor</div>}
    </div>
  );
}
