/**
 * Analitik grafikler (ECharts): dağılım, ağaç haritası, ısı haritası, şelale, gösterge.
 * Kurallar charts.tsx ile aynı: sabit renk sırası, "Diğer"e katlama, araç ipucu.
 */
import type { VisualFormat, VisualResult, VisualResultColumn } from "@floem/client";
import { useMemo } from "react";
import { EChart, palette, tooltipBox, type CrossSelect } from "./charts";
import { formatCompact, formatValue } from "./reportUtils";

type Raw = string | number | boolean | null;
const INK = "#605e5c";
const GRIDLINE = "#edebe9";
const NEUTRAL = "#8a8886";            // toplam/ara toplam (şelale) için nötr gri
const MAX_SERIES = 8;
const label = (v: Raw, c: VisualResultColumn) => formatValue(v, c.type, c.format) || "(Boş)";
const num = (v: Raw) => (typeof v === "number" ? v : null);
const pct = (x: number) => `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(x)}`;

// ------------------------------------------------------------------ Dağılım
export function ScatterVisual({
  result, format, hasLegend, selected, onSelect,
}: {
  result: VisualResult;
  format: VisualFormat;
  hasLegend: boolean;
  selected?: unknown;
  onSelect?: CrossSelect;
}) {
  const option = useMemo(() => {
    const cols = result.columns;
    const detail = cols[0];
    const off = hasLegend ? 2 : 1;
    const [xc, yc, sc] = [cols[off], cols[off + 1], cols[off + 2]];
    const sizes = sc ? result.rows.map((r) => num(r[off + 2]) ?? 0) : [];
    const maxSize = Math.max(1, ...sizes.map(Math.abs));
    // Gösterge değerine göre seri; 8'den fazlası "Diğer"
    const groups = new Map<string, Raw[][]>();
    for (const r of result.rows) {
      const key = hasLegend ? label(r[1], cols[1]) : xc.name;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    let names = [...groups.keys()];
    if (names.length > MAX_SERIES) {
      const other = names.slice(MAX_SERIES - 1).flatMap((n) => groups.get(n)!);
      names = names.slice(0, MAX_SERIES - 1);
      groups.set("Diğer", other);
      names.push("Diğer");
    }
    const hasSel = selected !== undefined;
    return {
      animationDuration: 250,
      color: palette(format),
      grid: { left: 56, right: 16, top: hasLegend ? 30 : 12, bottom: 40 },
      legend: hasLegend && format.legend !== "none" ? { top: 0, icon: "circle", itemWidth: 9, textStyle: { color: INK, fontSize: 11 } } : { show: false },
      tooltip: {
        trigger: "item",
        confine: true,
        formatter: (p: { data: { raw: Raw[] } }) => {
          const r = p.data.raw;
          return tooltipBox(label(r[0], detail), [
            { name: xc.name, value: formatValue(r[off], xc.type, xc.format) },
            { name: yc.name, value: formatValue(r[off + 1], yc.type, yc.format) },
            ...(sc ? [{ name: sc.name, value: formatValue(r[off + 2], sc.type, sc.format) }] : []),
          ]);
        },
      },
      xAxis: {
        type: "value", scale: true, name: xc.name, nameLocation: "middle", nameGap: 26, nameTextStyle: { color: INK, fontSize: 11 },
        axisLabel: { color: INK, fontSize: 10, formatter: (v: number) => formatCompact(v) }, splitLine: { lineStyle: { color: GRIDLINE } },
      },
      yAxis: {
        type: "value", scale: true, name: yc.name, nameTextStyle: { color: INK, fontSize: 11 },
        axisLabel: { color: INK, fontSize: 10, formatter: (v: number) => formatCompact(v) }, splitLine: { lineStyle: { color: GRIDLINE } },
      },
      series: names.map((n) => ({
        name: n,
        type: "scatter",
        // Boyut alanı yoksa 10 px; varsa alan karekökle ölçeklenir (8-40 px)
        symbolSize: (_: unknown, p: { data: { raw: Raw[] } }) =>
          sc ? 8 + 32 * Math.sqrt(Math.abs(num(p.data.raw[off + 2]) ?? 0) / maxSize) : 10,
        itemStyle: { borderColor: "#fff", borderWidth: 1 },
        data: groups.get(n)!.map((r) => ({
          value: [num(r[off]), num(r[off + 1])],
          raw: r,
          itemStyle: hasSel && r[0] !== selected ? { opacity: 0.25 } : { opacity: 0.85 },
        })),
      })),
    };
  }, [result, format, hasLegend, selected]);
  return <EChart option={option} onClick={(p) => {
    const raw = (p as unknown as { data?: { raw?: Raw[] } }).data?.raw;
    if (raw) onSelect?.(raw[0]);
  }} />;
}

// ------------------------------------------------------------------ Ağaç haritası
export function TreemapVisual({
  result, format, selected, onSelect,
}: {
  result: VisualResult;
  format: VisualFormat;
  selected?: unknown;
  onSelect?: CrossSelect;
}) {
  const data = useMemo(() => {
    const [cc] = result.columns;
    const rows = result.rows.filter((r) => (num(r[1]) ?? 0) > 0);
    const main = rows.length > MAX_SERIES ? rows.slice(0, MAX_SERIES - 1) : rows;
    const rest = rows.length > MAX_SERIES ? rows.slice(MAX_SERIES - 1) : [];
    const out = main.map((r) => ({ raw: r[0], name: label(r[0], cc), value: r[1] as number }));
    if (rest.length) out.push({ raw: null, name: `Diğer (${rest.length})`, value: rest.reduce((s, r) => s + (r[1] as number), 0) });
    return out;
  }, [result]);
  const option = useMemo(() => {
    const vc = result.columns[1];
    const colors = palette(format);
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    const hasSel = selected !== undefined;
    return {
      animationDuration: 250,
      tooltip: {
        confine: true,
        formatter: (p: { dataIndex: number; name: string; value: number }) =>
          tooltipBox(p.name, [
            { name: vc.name, value: formatValue(p.value, vc.type, vc.format) },
            { name: "Pay", value: pct((p.value / total) * 100) },
          ]),
      },
      series: [{
        type: "treemap",
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: "100%",
        height: "100%",
        itemStyle: { borderColor: "#fff", borderWidth: 2, gapWidth: 2 },
        label: {
          show: true, fontSize: 11, color: "#fff",
          formatter: (p: { name: string; value: number }) => `${p.name}\n${formatCompact(p.value)}`,
        },
        data: data.map((d, i) => ({
          name: d.name, value: d.value,
          itemStyle: { color: d.raw === null ? NEUTRAL : colors[i % colors.length], opacity: hasSel && d.raw !== selected ? 0.35 : 1 },
        })),
      }],
    };
  }, [data, result, format, selected]);
  return <EChart option={option} onClick={(p) => {
    const d = data[p.dataIndex];
    if (d && d.raw !== null) onSelect?.(d.raw);
  }} />;
}

// ------------------------------------------------------------------ Isı haritası
export function HeatmapVisual({ result, selected, onSelect }: { result: VisualResult; selected?: unknown; onSelect?: CrossSelect }) {
  const shaped = useMemo(() => {
    const [yc, xc] = result.columns;
    const ys: Raw[] = [];
    const xs: Raw[] = [];
    const yi = new Map<Raw, number>();
    const xi = new Map<Raw, number>();
    for (const r of result.rows) {
      if (!yi.has(r[0])) { yi.set(r[0], ys.length); ys.push(r[0]); }
      if (!xi.has(r[1])) { xi.set(r[1], xs.length); xs.push(r[1]); }
    }
    const cells = result.rows.map((r) => [xi.get(r[1])!, yi.get(r[0])!, num(r[2])]);
    return { ys, xs, cells, yLabels: ys.map((v) => label(v, yc)), xLabels: xs.map((v) => label(v, xc)) };
  }, [result]);
  const option = useMemo(() => {
    const vc = result.columns[2];
    const vals = shaped.cells.map((c) => c[2]).filter((v): v is number => v !== null);
    const hasSel = selected !== undefined;
    return {
      animationDuration: 250,
      grid: { left: 96, right: 16, top: 8, bottom: 52 },
      tooltip: {
        confine: true,
        formatter: (p: { value: [number, number, number | null] }) =>
          tooltipBox(`${shaped.yLabels[p.value[1]]} · ${shaped.xLabels[p.value[0]]}`, [
            { name: vc.name, value: formatValue(p.value[2], vc.type, vc.format) },
          ]),
      },
      xAxis: { type: "category", data: shaped.xLabels, axisLabel: { color: INK, fontSize: 10, hideOverlap: true }, axisTick: { show: false }, splitArea: { show: false } },
      yAxis: { type: "category", data: shaped.yLabels, axisLabel: { color: INK, fontSize: 10, width: 86, overflow: "truncate" }, axisTick: { show: false } },
      // Sıralı renk: tek ton, açıktan koyuya
      visualMap: {
        min: Math.min(0, ...vals), max: Math.max(1, ...vals), calculable: false, orient: "horizontal", left: "center", bottom: 0,
        itemHeight: 120, itemWidth: 10, textStyle: { color: INK, fontSize: 10 }, formatter: (v: number) => formatCompact(v),
        inRange: { color: ["#e8f0fe", "#9cc2f2", "#2a78d6", "#123f7a"] },
      },
      series: [{
        type: "heatmap",
        data: shaped.cells.map((c) => ({
          value: c,
          itemStyle: hasSel && shaped.ys[c[1] as number] !== selected ? { opacity: 0.3 } : undefined,
        })),
        label: { show: shaped.cells.length <= 60, fontSize: 10, formatter: (p: { value: [number, number, number | null] }) => (p.value[2] === null ? "" : formatCompact(p.value[2])) },
        itemStyle: { borderColor: "#fff", borderWidth: 1 },
      }],
    };
  }, [shaped, result, selected]);
  return <EChart option={option} onClick={(p) => {
    const cell = shaped.cells[p.dataIndex];
    if (cell) onSelect?.(shaped.ys[cell[1] as number]);
  }} />;
}

// ------------------------------------------------------------------ Şelale
export function WaterfallVisual({
  result, format, selected, onSelect,
}: {
  result: VisualResult;
  format: VisualFormat;
  selected?: unknown;
  onSelect?: CrossSelect;
}) {
  const shaped = useMemo(() => {
    const [cc, vc] = result.columns;
    let cum = 0;
    const bars = result.rows.map((r) => {
      const v = num(r[1]) ?? 0;
      const start = cum;
      cum += v;
      return { raw: r[0], name: label(r[0], cc), delta: v, start, end: cum };
    });
    return { bars, total: cum, vc };
  }, [result]);
  const option = useMemo(() => {
    const [up, down] = palette(format);
    const { bars, total, vc } = shaped;
    const hasSel = selected !== undefined;
    const names = [...bars.map((b) => b.name), "Toplam"];
    const base = [...bars.map((b) => Math.min(b.start, b.end)), Math.min(0, total)];
    const height = [...bars.map((b) => Math.abs(b.delta)), Math.abs(total)];
    return {
      animationDuration: 250,
      grid: { left: 56, right: 16, top: 24, bottom: 40 },
      legend: { show: false },
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" }, confine: true,
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0]?.dataIndex ?? 0;
          if (i === bars.length) return tooltipBox("Toplam", [{ name: vc.name, value: formatValue(total, vc.type, vc.format) }]);
          const b = bars[i];
          return tooltipBox(b.name, [
            { name: "Değişim", value: (b.delta >= 0 ? "+" : "") + formatValue(b.delta, vc.type, vc.format) },
            { name: "Kümülatif", value: formatValue(b.end, vc.type, vc.format) },
          ]);
        },
      },
      xAxis: { type: "category", data: names, axisTick: { show: false }, axisLabel: { color: INK, fontSize: 10, hideOverlap: true, width: 80, overflow: "truncate" } },
      yAxis: { type: "value", axisLabel: { color: INK, fontSize: 10, formatter: (v: number) => formatCompact(v) }, splitLine: { lineStyle: { color: GRIDLINE } } },
      series: [
        { type: "bar", stack: "s", silent: true, itemStyle: { color: "transparent" }, data: base, barMaxWidth: 32 },
        {
          type: "bar", stack: "s", barMaxWidth: 32,
          label: format.dataLabels
            ? { show: true, position: "top", fontSize: 10, color: INK, formatter: (p: { dataIndex: number }) => formatCompact(p.dataIndex === bars.length ? total : bars[p.dataIndex].delta) }
            : undefined,
          data: height.map((h, i) => ({
            value: h,
            itemStyle: {
              color: i === bars.length ? NEUTRAL : bars[i].delta >= 0 ? up : down,
              borderRadius: 2,
              opacity: hasSel && i < bars.length && bars[i].raw !== selected ? 0.3 : 1,
            },
          })),
        },
      ],
    };
  }, [shaped, format, selected]);
  return <EChart option={option} onClick={(p) => {
    const b = shaped.bars[p.dataIndex];
    if (b) onSelect?.(b.raw);
  }} />;
}

// ------------------------------------------------------------------ Gösterge (gauge)
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * mag).find((x) => x >= v) ?? v;
}

export function GaugeVisual({
  result, format, hasMax, hasTarget,
}: {
  result: VisualResult;
  format: VisualFormat;
  hasMax: boolean;
  hasTarget: boolean;
}) {
  const option = useMemo(() => {
    const row = result.rows[0] ?? [];
    // Sorgu sırası: değer, [en büyük değer], [hedef]
    const vc = result.columns[0];
    const value = num(row[0]) ?? 0;
    const maxV = hasMax ? num(row[1]) : null;
    const target = hasTarget ? num(row[hasMax ? 2 : 1]) : null;
    const max = maxV ?? niceMax(Math.max(value, target ?? 0) * (target ? 1.2 : 2));
    const [accent] = palette(format);
    const series: Record<string, unknown>[] = [{
      type: "gauge",
      startAngle: 200, endAngle: -20, min: 0, max,
      radius: "95%", center: ["50%", "62%"],
      progress: { show: true, width: 16, itemStyle: { color: accent } },
      axisLine: { lineStyle: { width: 16, color: [[1, "#edebe9"]] } },
      pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false },
      axisLabel: { show: true, distance: -40, color: INK, fontSize: 10, formatter: (v: number) => (v === 0 || v === max ? formatCompact(v) : "") },
      anchor: { show: false },
      title: { show: true, offsetCenter: [0, "32%"], fontSize: 11, color: INK },
      detail: { valueAnimation: true, offsetCenter: [0, "-2%"], fontSize: 22, fontWeight: 600, color: "#201f1e", formatter: () => formatCompact(value) },
      data: [{ value, name: vc.name }],
    }];
    if (target !== null) {
      series.push({
        type: "gauge", startAngle: 200, endAngle: -20, min: 0, max, radius: "95%", center: ["50%", "62%"],
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
        progress: { show: false }, anchor: { show: false }, title: { show: false },
        detail: { show: true, offsetCenter: [0, "52%"], fontSize: 11, color: INK, formatter: () => `Hedef: ${formatCompact(target)}` },
        pointer: { show: true, icon: "rect", length: "18%", width: 3, offsetCenter: [0, "-82%"], itemStyle: { color: "#201f1e" } },
        data: [{ value: target }],
      });
    }
    return {
      animationDuration: 300,
      tooltip: {
        confine: true,
        formatter: () => tooltipBox(vc.name, [
          { name: "Değer", value: formatValue(value, vc.type, vc.format) },
          ...(target !== null ? [{ name: "Hedef", value: formatValue(target, vc.type, vc.format) }, { name: "Gerçekleşme", value: pct((value / (target || 1)) * 100) }] : []),
          { name: "Ölçek", value: `0 – ${formatCompact(max)}` },
        ]),
      },
      series,
    };
  }, [result, format, hasMax, hasTarget]);
  return <EChart option={option} />;
}
