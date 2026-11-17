/**
 * ECharts tabanlı grafikler (Apache-2.0). Yalnızca kullanılan parçalar yüklenir.
 *
 * Kurallar (dataviz rehberi): renkler sabit sırayla (döngü yok; 8'den fazla seri "Diğer"e
 * katlanır), ince işaretler (sütun <= 24 px, 4 px yuvarlak uç), >= 2 seride gösterge,
 * her grafikte araç ipucu, soluk ızgara.
 */
import type { VisualFormat, VisualResult, VisualResultColumn } from "@floem/client";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { SERIES, formatCompact, formatValue, type VisualDef } from "./reportUtils";

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type Raw = string | number | boolean | null;
export type CrossSelect = (value: Raw) => void;

const MAX_SERIES = 8;
const INK = "#605e5c";
const GRIDLINE = "#edebe9";
const AXISLINE = "#c8c6c4";

/** ECharts örneğini React yaşam döngüsüne bağlar; boyut değişince yeniden çizer. */
function EChart({ option, onClick }: { option: echarts.EChartsCoreOption; onClick?: (p: { dataIndex: number; seriesIndex?: number; name: string }) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const click = useRef(onClick);
  click.current = onClick;

  useLayoutEffect(() => {
    const el = ref.current!;
    const c = echarts.init(el, undefined, { renderer: "canvas", locale: "EN" });
    chart.current = c;
    c.on("click", (p) => click.current?.(p as never));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={ref} className="v-echart" />;
}

function palette(format: VisualFormat): string[] {
  const custom = Array.isArray(format.colors) ? (format.colors as string[]) : [];
  return SERIES.map((c, i) => custom[i] || c);
}

const label = (v: Raw, c: VisualResultColumn) => formatValue(v, c.type, c.format) || "(Boş)";

function tooltipBox(title: string, rows: { color?: string; name: string; value: string }[]) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  return (
    `<div class="v-tip"><strong>${esc(title)}</strong>` +
    rows
      .map((r) => `<div>${r.color ? `<i style="background:${r.color}"></i>` : ""}${esc(r.name)}: <b>${esc(r.value)}</b></div>`)
      .join("") +
    "</div>"
  );
}

interface Series {
  name: string;
  col: VisualResultColumn;
  values: (number | null)[];
}

/** Sorgu sonucunu kategori + seri biçimine çevirir (gösterge alanı varsa pivot). */
function shape(result: VisualResult, hasLegend: boolean, sortByTotal: boolean) {
  const cols = result.columns;
  const catCol = cols[0];
  if (!hasLegend) {
    const cats = result.rows.map((r) => r[0]);
    const series: Series[] = cols.slice(1).map((c, i) => ({
      name: c.name, col: c, values: result.rows.map((r) => (typeof r[i + 1] === "number" ? (r[i + 1] as number) : null)),
    }));
    return { catCol, cats, series };
  }
  const valCol = cols[2];
  const catIndex = new Map<Raw, number>();
  const cats: Raw[] = [];
  const totals = new Map<Raw, number>();
  const bySeries = new Map<string, Map<Raw, number>>();
  const seriesTotals = new Map<string, number>();
  for (const r of result.rows) {
    const cat = r[0];
    const s = label(r[1], cols[1]);
    const v = typeof r[2] === "number" ? (r[2] as number) : 0;
    if (!catIndex.has(cat)) {
      catIndex.set(cat, cats.length);
      cats.push(cat);
    }
    totals.set(cat, (totals.get(cat) ?? 0) + v);
    if (!bySeries.has(s)) bySeries.set(s, new Map());
    bySeries.get(s)!.set(cat, (bySeries.get(s)!.get(cat) ?? 0) + v);
    seriesTotals.set(s, (seriesTotals.get(s) ?? 0) + Math.abs(v));
  }
  if (sortByTotal) cats.sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  // En büyük 7 seri ayrı, kalanı "Diğer" (renk döngüsü yok)
  const names = [...bySeries.keys()].sort((a, b) => (seriesTotals.get(b) ?? 0) - (seriesTotals.get(a) ?? 0));
  const keep = names.length > MAX_SERIES ? names.slice(0, MAX_SERIES - 1) : names;
  const other = names.length > MAX_SERIES ? names.slice(MAX_SERIES - 1) : [];
  const series: Series[] = keep.map((n) => ({ name: n, col: valCol, values: cats.map((c) => bySeries.get(n)!.get(c) ?? null) }));
  if (other.length) {
    series.push({
      name: "Diğer", col: valCol,
      values: cats.map((c) => other.reduce((s, n) => s + (bySeries.get(n)!.get(c) ?? 0), 0)),
    });
  }
  return { catCol, cats, series };
}

/** Sütun, çubuk, yığılmış, çizgi ve alan grafikleri. */
export function CategoryChart({
  result, def, format, hasLegend, selected, onSelect,
}: {
  result: VisualResult;
  def: VisualDef;
  format: VisualFormat;
  hasLegend: boolean;
  selected?: unknown;
  onSelect?: CrossSelect;
}) {
  const kind = def.category!;
  const shaped = useMemo(() => shape(result, hasLegend, !kind.line), [result, hasLegend, kind.line]);
  const option = useMemo(() => categoryOption(shaped, kind, format, selected), [shaped, kind, format, selected]);
  return <EChart option={option} onClick={(p) => onSelect?.(shaped.cats[p.dataIndex] ?? null)} />;
}

function categoryOption(
  { catCol, cats, series }: ReturnType<typeof shape>,
  kind: NonNullable<VisualDef["category"]>,
  format: VisualFormat,
  selected: unknown,
): echarts.EChartsCoreOption {
  const colors = palette(format);
  const hasSel = selected !== undefined;
  const legendPos = format.legend ?? "top";
  const showLegend = series.length > 1 && legendPos !== "none";
  const dataLabels = !!format.dataLabels;
  const horizontal = !!kind.horizontal;
  const catLabels = cats.map((c) => label(c, catCol));
  const valueName = series.length === 1 ? series[0].name : "";

  const catAxis = {
    type: "category",
    data: catLabels,
    inverse: horizontal,                       // en büyük değer üstte
    axisTick: { show: false },
    axisLine: { lineStyle: { color: AXISLINE } },
    axisLabel: { color: INK, fontSize: 11, width: horizontal ? 110 : 90, overflow: "truncate", hideOverlap: true },
    name: format.xAxisTitle === false ? "" : catCol.name,
    nameLocation: "middle",
    nameGap: horizontal ? 118 : 28,
    nameTextStyle: { color: INK, fontSize: 11 },
  };
  const valAxis = {
    type: "value",
    axisLabel: { color: INK, fontSize: 10, formatter: (v: number) => formatCompact(v) },
    splitLine: { lineStyle: { color: GRIDLINE } },
    name: format.yAxisTitle ? valueName : "",
    nameLocation: "middle",
    nameGap: 40,
    nameTextStyle: { color: INK, fontSize: 11 },
  };

  return {
    animationDuration: 250,
    color: colors,
    grid: {
      left: horizontal ? 130 : 48, right: 16, top: showLegend && legendPos === "top" ? 30 : 12,
      bottom: showLegend && legendPos === "bottom" ? 54 : 34, containLabel: false,
    },
    legend: showLegend
      ? {
          type: "scroll", icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: INK, fontSize: 11 },
          ...(legendPos === "right" ? { right: 0, top: "middle", orient: "vertical" } : legendPos === "bottom" ? { bottom: 0 } : { top: 0 }),
        }
      : { show: false },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: kind.line ? "line" : "shadow" },
      confine: true,
      formatter: (ps: { dataIndex: number; seriesIndex: number; color: string }[]) => {
        const i = ps[0]?.dataIndex ?? 0;
        return tooltipBox(catLabels[i], ps.map((p) => ({
          color: series.length > 1 ? p.color : undefined,
          name: series[p.seriesIndex].name,
          value: formatValue(series[p.seriesIndex].values[i], series[p.seriesIndex].col.type, series[p.seriesIndex].col.format),
        })));
      },
    },
    xAxis: horizontal ? valAxis : catAxis,
    yAxis: horizontal ? catAxis : valAxis,
    series: series.map((s) => ({
      name: s.name,
      type: kind.line ? "line" : "bar",
      stack: kind.stacked ? "toplam" : undefined,
      barMaxWidth: 24,
      barGap: "10%",
      showSymbol: cats.length <= 31,
      symbolSize: 8,
      lineStyle: { width: 2 },
      areaStyle: kind.area ? { opacity: 0.18 } : undefined,
      itemStyle: kind.line
        ? undefined
        : { borderRadius: kind.stacked ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0], borderColor: "#fff", borderWidth: kind.stacked ? 1 : 0 },
      label: dataLabels
        ? {
            show: true, position: kind.stacked ? "inside" : horizontal ? "right" : "top", fontSize: 10, color: kind.stacked ? "#fff" : INK,
            formatter: (p: { value: number }) => (p.value === null || p.value === undefined ? "" : formatCompact(p.value)),
          }
        : undefined,
      emphasis: { focus: "none" },
      data: s.values.map((v, i) => ({
        value: v,
        itemStyle: hasSel && cats[i] !== selected ? { opacity: 0.3 } : undefined,
      })),
    })),
  };
}

/** Pasta ve halka grafikleri. */
export function PieChartVisual({
  result, donut, format, selected, onSelect,
}: {
  result: VisualResult;
  donut: boolean;
  format: VisualFormat;
  selected?: unknown;
  onSelect?: CrossSelect;
}) {
  const [catCol, valCol] = result.columns;
  const rows = result.rows.filter((r) => typeof r[1] === "number" && (r[1] as number) > 0);
  // 8'den fazla dilim "Diğer"e katlanır
  const main = rows.length > MAX_SERIES ? rows.slice(0, MAX_SERIES - 1) : rows;
  const rest = rows.length > MAX_SERIES ? rows.slice(MAX_SERIES - 1) : [];
  const data = main.map((r) => ({ raw: r[0], name: label(r[0], catCol), value: r[1] as number }));
  if (rest.length) data.push({ raw: null, name: "Diğer", value: rest.reduce((s, r) => s + (r[1] as number), 0) });
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const hasSel = selected !== undefined;
  const legendPos = format.legend ?? "right";
  const colors = palette(format);

  const option: echarts.EChartsCoreOption = {
    animationDuration: 250,
    color: colors,
    legend:
      legendPos === "none"
        ? { show: false }
        : {
            type: "scroll", icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: INK, fontSize: 11 },
            ...(legendPos === "right" ? { right: 0, top: "middle", orient: "vertical" } : legendPos === "bottom" ? { bottom: 0 } : { top: 0 }),
          },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (p: { dataIndex: number; color: string }) => {
        const d = data[p.dataIndex];
        return tooltipBox(d.name, [
          { color: p.color, name: valCol.name, value: formatValue(d.value, valCol.type, valCol.format) },
          { name: "Pay", value: `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format((d.value / total) * 100)}` },
        ]);
      },
    },
    series: [{
      type: "pie",
      radius: donut ? ["48%", "72%"] : [0, "72%"],
      center: legendPos === "right" ? ["38%", "52%"] : ["50%", "52%"],
      itemStyle: { borderColor: "#fff", borderWidth: 2 },
      label: {
        show: format.dataLabels !== false,
        fontSize: 10,
        color: INK,
        formatter: (p: { percent: number }) => `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(p.percent)}`,
      },
      labelLine: { length: 6, length2: 6 },
      data: data.map((d) => ({
        name: d.name, value: d.value,
        itemStyle: hasSel && d.raw !== selected ? { opacity: 0.3 } : undefined,
      })),
    }],
  };
  return <EChart option={option} onClick={(p) => data[p.dataIndex]?.raw !== null && onSelect?.(data[p.dataIndex].raw)} />;
}
