import type { FilterRef, ReportPage, VisualState } from "@floem/client";

/** Aynı alandaki farklı koşullar korunur: bir geçiş mevcut kapsamı genişletmez. */
export function journeyFilters(...groups: (FilterRef[] | undefined)[]): FilterRef[] {
  const unique = new Map<string, FilterRef>();
  for (const filter of groups.flatMap((g) => g ?? [])) unique.set(JSON.stringify(filter), structuredClone(filter));
  return [...unique.values()];
}
export const JOURNEY_LIMIT = 20;
export function rememberJourney<T>(history: T[], snapshot: T): T[] {
  return [...history.slice(-(JOURNEY_LIMIT - 1)), structuredClone(snapshot)];
}

/** Hedefteki eski varsayılan firma/dönem seçimi taşınan bağlamla çelişmesin. */
export function journeySlicers(page: ReportPage, filters: FilterRef[], states: Record<string, VisualState>): Record<string, VisualState> {
  const next = { ...states };
  for (const visual of page.visuals) {
    const field = visual.type === "slicer" ? visual.group[0] : undefined;
    if (!field) continue;
    const conditions = filters.filter((f) => f.table.toLowerCase() === field.table.toLowerCase() && f.column.toLowerCase() === field.column.toLowerCase());
    const sets = conditions.filter((f) => !f.op || f.op === "in" || f.op === "eq").map((f) => f.values);
    const between = conditions.find((f) => f.op === "between");
    if (sets.length) next[visual.id] = { ...states[visual.id], selected: sets[0].filter((v) => sets.every((s) => s.includes(v))), range: [null, null] };
    else if (between) next[visual.id] = { ...states[visual.id], selected: [], range: [between.values[0] as string | number | null, between.values[1] as string | number | null] };
  }
  return next;
}
