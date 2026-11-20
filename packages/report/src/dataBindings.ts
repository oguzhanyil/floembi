import type { BindingSource, BindingTarget, ComponentDefinition, DataBinding, DataScalar, FilterRef, RepeaterDefinition, StateAppearance, ValueRef, Visual, VisualFormat, VisualQuery, VisualResult } from "@floem/client";
import { formatValue } from "./reportUtils";

export const DATA_ICONS = ["none", "arrow", "back", "refresh", "eye", "link", "play", "file", "menu", "check", "warning", "trendUp", "trendDown", "clock", "user", "box"] as const;
export type DataStatus = "ready" | "loading" | "empty" | "error";
export interface RowData { query: VisualQuery; result: VisualResult; row: DataScalar[]; selected?: boolean }
export const sameValueRef = (a: ValueRef, b: ValueRef) => "measure" in a ? "measure" in b && a.measure === b.measure : !("measure" in b) && a.table === b.table && a.column === b.column && (a.agg ?? "sum") === (b.agg ?? "sum");

export function sourceQuery(source: BindingSource, filters: FilterRef[]): VisualQuery | null {
  if (source.kind === "row") return null;
  return source.kind === "field" ? { group: [source.field], values: [], filters, limit: 2 } : { group: [], values: [source.value], filters, limit: 1 };
}
export function rowIndex(source: BindingSource, row: RowData): number {
  if (source.kind !== "row") throw new Error("Satır şablonunda yalnız satır kaynağı kullanılabilir.");
  const index = source.field ? row.query.group.findIndex((g) => g.table === source.field!.table && g.column === source.field!.column)
    : source.value ? (row.query.values.findIndex((v) => sameValueRef(v, source.value!))) : -1;
  if (index < 0) throw new Error("Satır bağı için gereken alan veya ölçü tekrarlayıcının alanlarında yok.");
  return source.field ? index : row.query.group.length + index;
}
export function sourceResult(source: BindingSource, result?: VisualResult, row?: RowData): VisualResult {
  if (source.kind === "row") {
    if (!row) throw new Error("Satır bağı bir tekrarlayıcı içinde kullanılmalı.");
    const i = rowIndex(source, row);
    return { columns: [{ ...row.result.columns[i], kind: "value" }], rows: [[row.row[i]]], total: null, truncated: false };
  }
  if (!result) throw new Error("Veri bağı sonucu bulunamadı.");
  if (source.kind === "field" && result.rows.length > 1) throw new Error("Alan birden fazla değer döndürdü. Tek değere filtreleyin veya toplam/minimum/maksimum gibi bir toplama seçin.");
  return result;
}
export function bindingOutput(binding: DataBinding, value: DataScalar): DataScalar | undefined {
  const match = binding.rules?.find((r) => {
    if (r.op === "blank") return value === null;
    if (r.op === "notBlank") return value !== null;
    if (r.op === "eq") return value === r.value;
    if (r.op === "ne") return value !== r.value;
    if (typeof value !== "number" || typeof r.value !== "number") return false;
    return r.op === "gt" ? value > r.value : r.op === "ge" ? value >= r.value : r.op === "lt" ? value < r.value : value <= r.value;
  });
  return match ? match.output : binding.rules?.length ? binding.fallback : value ?? binding.fallback;
}
export function outputPatch(target: BindingTarget, output: DataScalar | undefined, binding: DataBinding, column: VisualResult["columns"][number]): { format: Partial<VisualFormat>; visible?: boolean; result?: VisualResult } {
  if (output === undefined) return { format: {} };
  if (target === "visible") {
    if (output !== null && typeof output !== "boolean") throw new Error("Görünürlük bağı doğru/yanlış döndürmeli; bir koşul ekleyin.");
    return { format: {}, visible: output === true };
  }
  if (output === null) return { format: {} };
  if (target === "backgroundColor" || target === "color") {
    if (typeof output !== "string" || !/^(#[a-f\d]{6}|transparent)$/i.test(output)) throw new Error("Renk bağı #RRGGBB veya transparent döndürmeli.");
    return { format: { [target]: output, ...(target === "backgroundColor" ? { buttonColor: output } : { buttonTextColor: output }) } };
  }
  if (target === "icon") {
    if (!DATA_ICONS.includes(output as typeof DATA_ICONS[number])) throw new Error("Simge bağı geçerli bir simge adı döndürmeli.");
    return { format: { buttonIcon: output as VisualFormat["buttonIcon"] } };
  }
  const text = binding.template?.replaceAll("{value}", formatValue(output, column.type, column.format)) ?? formatValue(output, column.type, column.format);
  return target === "text" ? { format: { text } } : { format: {}, result: { columns: [{ ...column, kind: "value", ...(binding.template ? { type: "string" as const, format: null } : {}) }],
    rows: [[binding.template ? text : output]], total: null, truncated: false } };
}
export const appearancePatch = (state?: StateAppearance): Partial<VisualFormat> => {
  if (!state) return {};
  const { icon, ...rest } = Object.fromEntries(Object.entries(state).filter(([, v]) => v != null)) as StateAppearance;
  return { ...rest, ...(icon ? { buttonIcon: icon } : {}), ...(rest.color ? { buttonTextColor: rest.color } : {}), ...(rest.backgroundColor ? { buttonColor: rest.backgroundColor } : {}) };
};

/** Değişmez kitaplık tanımından yalnız çalışma zamanı kopyası; kayıt sayısı kadar nesne saklanmaz. */
export function rowTemplate(def: ComponentDefinition, config: RepeaterDefinition): Visual[] {
  if (def.visuals.some((v) => !["container", "text", "card", "ticker", "shape", "image", "button", "icon"].includes(v.type))) throw new Error("Satır şablonunda yalnız tasarım nesneleri, kart ve sayaç kullanın.");
  const nodes = structuredClone(def.visuals);
  for (const slot of def.slots) {
    const binding = config.bindings[slot.id];
    if (!binding) throw new Error(`Şablon alanını eşleyin: ${slot.label}`);
    for (const site of slot.sites) {
      let obj: unknown = nodes.find((v) => v.id === site.visualId);
      for (const key of site.path) obj = obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
      if (!obj || typeof obj !== "object") throw new Error("Şablon eşleme hedefi bulunamadı.");
      const ref = obj as Record<string, unknown>;
      for (const k of ["table", "column", "measure", "agg", "pageId", "visualId"]) delete ref[k];
      Object.assign(ref, binding);
    }
  }
  if (nodes.some((v) => Object.values(v.bindings ?? {}).some((b) => b?.source.kind !== "row"))) throw new Error("Satır şablonundaki tüm veri bağları satır kaynağını kullanmalı.");
  return nodes;
}

export function windowRange(count: number, scrollTop: number, height: number, itemHeight: number) {
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - 2);
  return { start: Math.min(count, start), end: Math.min(count, Math.ceil((scrollTop + height) / itemHeight) + 2) };
}
