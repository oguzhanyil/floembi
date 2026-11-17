import type { FilterRef, Visual } from "@floem/client";
import { useState } from "react";
import { VISUAL_DEFS, valueLabel } from "./reportUtils";
import { useVisualData, type QueryFn } from "./useVisualData";
import { CardVisual, ColumnChart, TableVisual } from "./visuals";

export interface CrossFilter {
  visualId: string;
  table: string;
  column: string;
  value: string | number | boolean;
}

export function visualTitle(v: Visual): string {
  if (v.title) return v.title;
  const vals = v.values.map(valueLabel);
  const grp = v.group.map((g) => g.column);
  if (v.type === "card") return "";
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
  v, extra, dataRev, cross, onCross, run,
}: {
  v: Visual;
  extra: FilterRef[];
  dataRev: string;
  cross: CrossFilter | null;
  onCross: (value: string | number | boolean | null) => void;
  run: QueryFn;
}) {
  const data = useVisualData(v, extra, dataRev, run);
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
  return (
    <div className={`v-body ${data.state === "loading" ? "loading" : ""}`}>
      {v.type === "table" && <TableVisual result={result} selected={selected} onSelect={onCross} />}
      {v.type === "column" && <ColumnChart result={result} selected={selected} onSelect={onCross} />}
      {v.type === "card" && <CardVisual result={result} />}
    </div>
  );
}
