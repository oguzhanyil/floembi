import type { ColumnType, FilterRef, ReportPage, Visual, VisualState } from "@floem/client";
import { useEffect, useMemo, useState } from "react";
import { CategoryChart, PieChartVisual } from "./charts";
import { GaugeVisual, HeatmapVisual, ScatterVisual, TreemapVisual, WaterfallVisual } from "./charts2";
import { MatrixVisual, ProgressVisual } from "./matrix";
import { VISUAL_DEFS, formatValue, groupFields, valueLabel } from "./reportUtils";
import {
  currentAxis, drillOf, supportsDrill, trendQuery, useMatrixData, useQueryData, useVisualData, type QueryFn,
} from "./useVisualData";
import { CardVisual, DataGrid, ImageVisual, KpiVisual, MultiCard, ShapeVisual, Slicer, TextVisual, TickerVisual } from "./visuals";

type Scalar = string | number | boolean;

export interface CrossFilter {
  visualId: string;
  table: string;
  column: string;
  value: Scalar;
  /** Tablo satırı seçimi (ana-ayrıntı): satırın diğer gruplama alanları */
  and?: { table: string; column: string; value: Scalar }[];
  /** Seçili satırın anahtarı (gruplama değerlerinin JSON'u) */
  key?: string;
}

export function visualTitle(v: Visual): string {
  if (v.format.showTitle === false) return "";
  if (v.title) return v.title;
  const vals = v.values.map(valueLabel);
  // Drill-down'da başlık o an görünen düzeyi gösterir (Power BI'daki gibi)
  const axis = supportsDrill(v) && v.group.length > 1 ? currentAxis(v) : undefined;
  const grp = axis ? [axis.column, ...(v.legend ?? []).map((g) => g.column)] : groupFields(v).map((g) => g.column);
  if (v.type === "card" || v.type === "kpi" || v.type === "text" || v.type === "shape" || v.type === "image" || v.type === "ticker") return "";
  if (v.type === "slicer") return grp[0] ?? VISUAL_DEFS.slicer.label;
  if (!vals.length && !grp.length) return VISUAL_DEFS[v.type].label;
  if (!vals.length) return grp.join(", ");
  return grp.length ? `${vals.join(", ")} - ${grp.join(", ")}` : vals.join(", ");
}

/** Çapraz filtre: seçimi yapan görsel dışındaki görsellere uygulanır. */
export function crossFiltersFor(v: Visual, cross: CrossFilter | null): FilterRef[] {
  return cross && cross.visualId !== v.id ? selectionFilters(cross) : [];
}

/** Seçimin tüm alanları → filtreler */
export function selectionFilters(cross: CrossFilter): FilterRef[] {
  return [cross, ...(cross.and ?? [])].map((x) => ({ table: x.table, column: x.column, op: "in" as const, values: [x.value] }));
}

/** Tablo satırına tıklama: satırın tüm gruplama alanlarıyla filtre (OINV satırı → INV1 kalemleri). */
export function toggleCrossRow(v: Visual, cross: CrossFilter | null, row: unknown[]): CrossFilter | null {
  const key = JSON.stringify(row.slice(0, v.group.length));
  if (cross && cross.visualId === v.id && cross.key === key) return null;
  const pairs = v.group
    .map((g, i) => ({ table: g.table, column: g.column, value: row[i] }))
    .filter((x): x is { table: string; column: string; value: Scalar } =>
      x.value !== null && x.value !== undefined && typeof x.value !== "object");
  if (!pairs.length) return cross;
  return { visualId: v.id, ...pairs[0], and: pairs.slice(1), key };
}

// ------------------------------------------------------------------ detaya git (drill-through)
export interface DrillTarget {
  page: ReportPage;
  filters: FilterRef[];
  /** Hedef sayfanın alanları ve seçilen değerleri: "CardName = Anadolu Gıda" */
  label: string;
}

/** Görselde yapılan seçimle açılabilecek detay sayfaları (sayfanın tüm detay alanları seçimde olmalı). */
export function drillTargets(pages: ReportPage[], currentPage: string, v: Visual, cross: CrossFilter | null): DrillTarget[] {
  if (!cross || cross.visualId !== v.id) return [];
  const sel = [cross, ...(cross.and ?? [])];
  const out: DrillTarget[] = [];
  for (const p of pages) {
    const fields = p.drillthrough ?? [];
    if (p.id === currentPage || !fields.length) continue;
    const hits = fields.map((f) => sel.find((x) => x.table === f.table && x.column === f.column));
    if (hits.some((h) => !h)) continue;
    out.push({
      page: p,
      filters: selectionFilters(cross),
      label: hits.map((h) => `${h!.column} = ${formatValue(h!.value, undefined) || "(Boş)"}`).join(", "),
    });
  }
  return out;
}

/** Görsel başlığındaki "Detaya git" düğmesi (birden çok hedef varsa menü). */
export function DrillThroughButton({ targets, onGo }: { targets: DrillTarget[]; onGo: (t: DrillTarget) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  if (!targets.length) return null;
  return (
    <span className="v-drillthrough" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <button
        title={targets.length === 1 ? `Detaya git: ${targets[0].page.name} (${targets[0].label})` : "Detaya git"}
        onClick={() => (targets.length === 1 ? onGo(targets[0]) : setOpen(!open))}
      >
        ↪ Detaya git{targets.length === 1 ? `: ${targets[0].page.name}` : " ▾"}
      </button>
      {open && (
        <div className="v-drillthrough-menu">
          {targets.map((t) => (
            <button key={t.page.id} onClick={() => (setOpen(false), onGo(t))}>
              {t.page.name}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** Detay sayfasındayken sayfanın üstündeki şerit: hangi değerle gelindiği + geri. */
export function DrillBanner({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="drill-banner" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <button onClick={onBack} title="Önceki sayfaya dön">
        ← Geri
      </button>
      <span>
        Detay: <strong>{label}</strong>
      </span>
    </div>
  );
}

/** Çapraz filtre seçimini değiştirir (aynı değere ikinci tıklama seçimi kaldırır). */
export function toggleCross(v: Visual, cross: CrossFilter | null, value: unknown): CrossFilter | null {
  // Drill-down'da çapraz filtre o an görünen düzeyin alanıyla yapılır
  const g = supportsDrill(v) ? currentAxis(v) : v.group[0];
  if (!g || value === null || value === undefined || typeof value === "object") return cross;
  const same = cross && cross.visualId === v.id && cross.value === value;
  return same ? null : { visualId: v.id, table: g.table, column: g.column, value: value as string | number | boolean };
}

function ErrorView({ message, detail }: { message: string; detail?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="v-error" role="alert">
      <strong>{message}</strong>
      {detail && (
        <>
          <button className="v-error-more" onClick={() => setOpen(!open)}>
            {open ? "Ayrıntıları gizle" : "Ayrıntılar"}
          </button>
          {open && <pre>{detail}</pre>}
        </>
      )}
    </div>
  );
}

/** Bir görselin içeriği: veriyi getirir ve türüne göre çizer. */
export function VisualBody({
  v, extra, dataRev, cross, onCross, onCrossRow, detailReady, run, state, onState, fieldType,
}: {
  v: Visual;
  extra: FilterRef[];
  dataRev: string;
  cross: CrossFilter | null;
  onCross: (value: string | number | boolean | null) => void;
  /** Tablo satırı seçimi (verilirse satırın tüm alanlarıyla filtreler) */
  onCrossRow?: (row: unknown[]) => void;
  /** Ana-ayrıntı: dışarıdan bir seçim (başka görsel ya da detaya git) var mı */
  detailReady?: boolean;
  run: QueryFn;
  /** Etkileşim durumu (dilimleyici seçimi, sıralama); verilmezse görselin kayıtlı durumu */
  state?: VisualState;
  onState?: (s: VisualState) => void;
  /** Dilimleyici alanının model tipi (aralık dilimleyicisinde tarih/sayı girişi için) */
  fieldType?: ColumnType;
}) {
  const st = state ?? v.state ?? {};
  const vq = st !== v.state ? { ...v, state: st } : v;
  const isMatrix = v.type === "matrix";
  const data = useVisualData(vq, extra, dataRev, run, !isMatrix);
  const mdata = useMatrixData(vq, extra, dataRev, run, isMatrix);
  const tq = useMemo(() => trendQuery(vq, extra), [vq, extra]);
  const tdata = useQueryData(tq, dataRev, run);
  const trend = tdata.state === "ready" ? tdata.result : tdata.state === "loading" ? tdata.previous : undefined;
  const [drillMode, setDrillMode] = useState(false);
  const drillable = supportsDrill(v) && v.group.length > 1;
  const drill = drillOf(vq);
  const handleClick = (value: string | number | boolean | null) => {
    if (drillable && drillMode && drill.level < v.group.length - 1 && value !== null) {
      onState?.({ ...st, drill: { level: drill.level + 1, path: [...drill.path, value] } });
    } else {
      onCross(value);
    }
  };
  const toolbar = drillable && (
    <div className="v-drill" onPointerDown={(e) => e.stopPropagation()}>
      {drill.path.length > 0 && (
        <span className="v-drill-path" title="Bulunduğunuz düzey">
          {drill.path.map((p) => formatValue(p, undefined) || "(Boş)").join(" › ")} ›
        </span>
      )}
      <button
        disabled={drill.level === 0}
        title="Yukarı çık"
        aria-label="Yukarı çık"
        onClick={() => onState?.({ ...st, drill: { level: drill.level - 1, path: drill.path.slice(0, -1) } })}
      >
        ⬆
      </button>
      <button
        className={drillMode ? "on" : ""}
        title={drillMode ? "Detaya inme modu açık: bir değere tıklayınca içine inilir" : "Detaya inme modunu aç"}
        aria-label="Detaya inme modu"
        aria-pressed={drillMode}
        onClick={() => setDrillMode(!drillMode)}
      >
        ⬇
      </button>
      <button
        disabled={drill.level >= v.group.length - 1}
        title={"Sonraki düzey: " + (v.group[Math.min(drill.level + 1, v.group.length - 1)]?.column ?? "")}
        aria-label="Sonraki düzeye geç"
        onClick={() => onState?.({ ...st, drill: { level: drill.level + 1, path: drill.path } })}
      >
        ⇊
      </button>
    </div>
  );
  const selected = cross && cross.visualId === v.id ? cross.value : undefined;
  const outerSelection = detailReady ?? (!!cross && cross.visualId !== v.id);

  if (v.type === "shape") return <ShapeVisual format={v.format} />;
  if (v.type === "image") return <ImageVisual format={v.format} />;
  if (v.type === "text") {
    if (data.state === "error") return <ErrorView {...data.error} />;
    const r = data.state === "ready" ? data.result : data.state === "loading" ? data.previous : undefined;
    return <TextVisual v={v} result={r} loading={data.state === "loading"} />;
  }
  if (v.format.detailOnly && !outerSelection) {
    return <div className="v-detail-wait">Ayrıntıları görmek için başka bir görselde bir değer ya da satır seçin</div>;
  }

  if (isMatrix) {
    if (mdata.state === "empty") {
      return (
        <div className="v-empty">
          {VISUAL_DEFS.matrix.icon}
          <span>Alan ekleyin</span>
        </div>
      );
    }
    if (mdata.state === "error") return <ErrorView {...mdata.error} />;
    const parts = mdata.state === "ready" ? mdata.parts : mdata.previous;
    if (!parts) return <div className="v-empty v-loading">Yükleniyor…</div>;
    return (
      <div className={"v-body " + (mdata.state === "loading" ? "loading" : "")}>
        <MatrixVisual v={v} parts={parts} state={st} onState={onState} selected={selected} onSelect={onCross} />
      </div>
    );
  }

  if (data.state === "empty") {
    return (
      <div className="v-empty">
        {VISUAL_DEFS[v.type].icon}
        <span>Alan ekleyin</span>
      </div>
    );
  }
  if (data.state === "error") return <ErrorView {...data.error} />;
  const result = data.state === "ready" ? data.result : data.previous;
  if (!result) return <div className="v-empty v-loading">Yükleniyor…</div>;
  const def = VISUAL_DEFS[v.type];
  return (
    <div className={`v-body ${data.state === "loading" ? "loading" : ""}`}>
      {toolbar}
      {def.category && (
        <CategoryChart result={result} def={def} format={v.format} hasLegend={!!v.legend?.length} selected={selected} onSelect={handleClick} />
      )}
      {(v.type === "pie" || v.type === "donut") && (
        <PieChartVisual result={result} donut={v.type === "donut"} format={v.format} selected={selected} onSelect={handleClick} />
      )}
      {v.type === "treemap" && <TreemapVisual result={result} format={v.format} selected={selected} onSelect={handleClick} />}
      {v.type === "scatter" && (
        <ScatterVisual result={result} format={v.format} hasLegend={!!v.legend?.length} selected={selected} onSelect={onCross} />
      )}
      {v.type === "heatmap" && <HeatmapVisual result={result} selected={selected} onSelect={onCross} />}
      {v.type === "waterfall" && <WaterfallVisual result={result} format={v.format} selected={selected} onSelect={onCross} />}
      {v.type === "gauge" && (
        <GaugeVisual result={result} format={v.format} hasMax={v.values.length > 1} hasTarget={!!v.target?.length} />
      )}
      {v.type === "progress" && <ProgressVisual result={result} />}
      {v.type === "table" && (
        <DataGrid
          result={result} selected={selected} onSelect={onCross} format={v.format}
          selectedKey={cross && cross.visualId === v.id ? cross.key : undefined}
          onSelectRow={onCrossRow}
          sort={st.sort} onSort={onState ? (sort) => onState({ ...st, sort }) : undefined}
        />
      )}
      {v.type === "card" && <CardVisual result={result} format={v.format} trend={trend} />}
      {v.type === "ticker" && <TickerVisual result={result} format={v.format} />}
      {v.type === "multicard" && <MultiCard result={result} selected={selected} onSelect={onCross} />}
      {v.type === "kpi" && <KpiVisual result={result} format={v.format} trend={trend} />}
      {v.type === "slicer" && (
        <Slicer result={result} format={v.format} state={st} onState={(s) => onState?.(s)} fieldType={fieldType} />
      )}
    </div>
  );
}
