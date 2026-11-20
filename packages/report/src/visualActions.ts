import type { FilterRef, ReportPage, Visual, VisualAction } from "@floem/client";
import { formatValue } from "./reportUtils";
import type { QueryFn } from "./useVisualData";

export type ActionValue = { value: string | number | boolean | null; table?: string; column?: string };

export function safeActionIcon(data: string | undefined): string | undefined {
  return data && data.length < 360000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data)
    ? data : undefined;
}

export function rowActionValue(visual: Visual, index: number, value: ActionValue["value"]): ActionValue {
  const field = visual.group[index] ?? (["table", "treegrid", "repeater"].includes(visual.type) ? visual.values[index - visual.group.length] : undefined);
  return field && "table" in field ? { value, table: field.table, column: field.column } : { value };
}

export type ResolvedVisualAction =
  | { type: "page"; pageId: string; filters?: FilterRef[]; label?: string; keepContext?: boolean }
  | { type: "back" }
  | { type: "reset" }
  | { type: "toggle"; visualId: string }
  | { type: "url"; url: string }
  | { type: "function"; name: "refresh" | "clearSelection" | "filterByValue"; source?: ActionValue }
  | { type: "measure"; measure: string; source?: ActionValue }
  | null;

/** Yalnızca HTTP(S) bağlantıları açılır; satır değeri URL'de kodlanır. */
export function actionUrl(template: string | undefined, source?: ActionValue): string | null {
  if (!template) return null;
  if (template.includes("{value}") && !source) return null;
  const expanded = template.replaceAll("{value}", encodeURIComponent(String(source?.value ?? "")));
  try {
    const url = new URL(expanded);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Rapor içindeki tıklama olayını yalnızca mevcut sayfa/nesnelere çözer. */
export function resolveVisualAction(visual: Visual, pages: ReportPage[], currentPageId: string,
  chosen?: VisualAction, source?: ActionValue): ResolvedVisualAction {
  const action = chosen ?? visual.format.action;
  if (!action || action.type === "none") return null;
  const current = pages.find((page) => page.id === currentPageId);
  if (!current) return null;
  if (action.type === "page") {
    if (!pages.some((page) => page.id === action.pageId)) return null;
    const filters: FilterRef[] | undefined = source?.table && source.column && source.value !== null
      ? [{ table: source.table, column: source.column, op: "in", values: [source.value] }] : undefined;
    return { type: "page", pageId: action.pageId!, filters, label: filters ? `${source!.column} = ${source!.value}` : undefined,
      ...(action.keepContext ? { keepContext: true } : {}) };
  }
  if (action.type === "next" || action.type === "previous") {
    const index = pages.findIndex((page) => page.id === currentPageId);
    const step = action.type === "next" ? 1 : -1;
    return pages.length > 1 ? { type: "page", pageId: pages[(index + step + pages.length) % pages.length].id } : null;
  }
  if (action.type === "reset") return { type: "reset" };
  if (action.type === "back") return { type: "back" };
  if (action.type === "url") {
    const url = actionUrl(action.url, source);
    return url ? { type: "url", url } : null;
  }
  if (action.type === "function" && action.functionName === "measure") {
    return action.measure?.trim() ? { type: "measure", measure: action.measure.trim(), source } : null;
  }
  if (action.type === "function" && (action.functionName === "refresh" ||
      action.functionName === "clearSelection" || action.functionName === "filterByValue")) {
    return action.functionName === "filterByValue" && (!source?.table || !source.column || source.value === null)
      ? null : { type: "function", name: action.functionName, source };
  }
  if (action.type === "toggle" && action.visualId && action.visualId !== visual.id &&
      current.visuals.some((target) => target.id === action.visualId)) {
    return { type: "toggle", visualId: action.visualId };
  }
  return null;
}

export async function runMeasureAction(run: QueryFn, measure: string, filters: FilterRef[]): Promise<string> {
  const result = await run({ group: [], values: [{ measure }], filters, limit: 1 });
  const column = result.columns[0];
  return `${measure}: ${column ? formatValue(result.rows[0]?.[0] ?? null, column.type, column.format) || "(Boş)" : "(Boş)"}`;
}

export function visualIsVisible(visual: Visual, overrides: Record<string, boolean>): boolean {
  return overrides[visual.id] ?? !visual.format.initiallyHidden;
}
