import type { ColumnType, FilterRef, Visual, VisualState } from "@floem/client";
import { useState } from "react";
import { CategoryChart, PieChartVisual } from "./charts";
import { VISUAL_DEFS, groupFields, valueLabel } from "./reportUtils";
import { useVisualData, type QueryFn } from "./useVisualData";
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
  const grp = groupFields(v).map((g) => g.column);
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
  const g = v.group[0];
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
  const vq = v.type === "table" && st !== v.state ? { ...v, state: st } : v;
  const data = useVisualData(vq, extra, dataRev, run);
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
  const selected = cross && cross.visualId === v.id ? cross.value : undefined;
  const def = VISUAL_DEFS[v.type];
  return (
    <div className={`v-body ${data.state === "loading" ? "loading" : ""}`}>
      {def.category && (
        <CategoryChart result={result} def={def} format={v.format} hasLegend={!!v.legend?.length} selected={selected} onSelect={onCross} />
      )}
      {(v.type === "pie" || v.type === "donut") && (
        <PieChartVisual result={result} donut={v.type === "donut"} format={v.format} selected={selected} onSelect={onCross} />
      )}
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
