import type { ColumnType, FilterRef, Visual, VisualState } from "@floem/client";
import { useState } from "react";
import { CategoryChart, PieChartVisual } from "./charts";
import { GaugeVisual, HeatmapVisual, ScatterVisual, TreemapVisual, WaterfallVisual } from "./charts2";
import { MatrixVisual, ProgressVisual } from "./matrix";
import { VISUAL_DEFS, formatValue, groupFields, valueLabel } from "./reportUtils";
import { currentAxis, drillOf, supportsDrill, useMatrixData, useVisualData, type QueryFn } from "./useVisualData";
import { CardVisual, DataGrid, KpiVisual, MultiCard, Slicer } from "./visuals";

export interface CrossFilter {
  visualId: string;
  table: string;
  column: string;
  value: string | number | boolean;
}

export function visualTitle(v: Visual): string {
  if (v.format.showTitle === false) return "";
  if (v.title) return v.title;
  const vals = v.values.map(valueLabel);
  // Drill-down'da başlık o an görünen düzeyi gösterir (Power BI'daki gibi)
  const axis = supportsDrill(v) && v.group.length > 1 ? currentAxis(v) : undefined;
  const grp = axis ? [axis.column, ...(v.legend ?? []).map((g) => g.column)] : groupFields(v).map((g) => g.column);
  if (v.type === "card" || v.type === "kpi") return "";
  if (v.type === "slicer") return grp[0] ?? VISUAL_DEFS.slicer.label;
  if (!vals.length && !grp.length) return VISUAL_DEFS[v.type].label;
  if (!vals.length) return grp.join(", ");
  return grp.length ? `${vals.join(", ")} - ${grp.join(", ")}` : vals.join(", ");
}

/** Çapraz filtre: seçimi yapan görsel dışındaki görsellere uygulanır. */
export function crossFiltersFor(v: Visual, cross: CrossFilter | null): FilterRef[] {
  return cross && cross.visualId !== v.id ? [{ table: cross.table, column: cross.column, op: "in", values: [cross.value] }] : [];
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
  v, extra, dataRev, cross, onCross, run, state, onState, fieldType,
}: {
  v: Visual;
  extra: FilterRef[];
  dataRev: string;
  cross: CrossFilter | null;
  onCross: (value: string | number | boolean | null) => void;
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
          sort={st.sort} onSort={onState ? (sort) => onState({ ...st, sort }) : undefined}
        />
      )}
      {v.type === "card" && <CardVisual result={result} format={v.format} />}
      {v.type === "multicard" && <MultiCard result={result} selected={selected} onSelect={onCross} />}
      {v.type === "kpi" && <KpiVisual result={result} format={v.format} />}
      {v.type === "slicer" && (
        <Slicer result={result} format={v.format} state={st} onState={(s) => onState?.(s)} fieldType={fieldType} />
      )}
    </div>
  );
}
