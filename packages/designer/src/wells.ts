import type { Agg, FieldRef, ModelColumn, ValueRef, Visual } from "@floem/client";
import { defaultAgg, type WellDef } from "@floem/report";

export const WELL_MIME = "application/x-floem-well";
export type WellDrag = { visualId: string; key: WellDef["key"]; slot?: number; index: number };

export function wellItems(v: Visual, def: WellDef): (FieldRef | ValueRef)[] {
  if (def.key === "group") return v.group;
  if (def.key === "legend") return v.legend ?? [];
  if (def.key === "target") return v.target ?? [];
  return def.slot === undefined ? v.values : v.values[def.slot] ? [v.values[def.slot]] : [];
}

export function setWell(v: Visual, def: WellDef, items: (FieldRef | ValueRef)[]): Visual {
  if (def.key === "values" && def.slot !== undefined) {
    const values = [...v.values];
    if (items.length) values[def.slot] = items[0] as ValueRef;
    else values.splice(def.slot, 1);
    return { ...v, values };
  }
  return { ...v, [def.key]: items } as Visual;
}

export function readWellDrag(raw: string): WellDrag | null {
  try {
    const item = JSON.parse(raw) as WellDrag;
    if (!item || !["group", "legend", "values", "target"].includes(item.key) ||
        !Number.isInteger(item.index) || item.index < 0 ||
        (item.slot !== undefined && (!Number.isInteger(item.slot) || item.slot < 0))) return null;
    return item;
  } catch {
    return null;
  }
}

/** Görsel içindeki alanı kutular arasında taşır; değer toplamasını korur. */
export function moveWellItem(
  visual: Visual, from: WellDef, index: number, to: WellDef, targetIndex: number,
  columnOf: (table: string, column: string) => ModelColumn | undefined,
): Visual {
  const source = wellItems(visual, from);
  if (index < 0 || index >= source.length) return visual;
  const item = source[index];
  const toValue = to.key === "values" || to.key === "target";
  if (!toValue && "measure" in item) return visual;
  let moved: FieldRef | ValueRef = item;
  if (toValue && !("measure" in item) && !("agg" in item)) {
    const column = columnOf(item.table, item.column);
    if (!column) return visual;
    moved = { ...item, agg: defaultAgg(column) as Agg };
  } else if (!toValue && "agg" in item) {
    moved = { table: item.table, column: item.column };
  }

  const sameWell = from.key === to.key && from.slot === to.slot;
  if (sameWell) {
    const next = [...source];
    next.splice(index, 1);
    const at = Math.max(0, Math.min(next.length, targetIndex - (targetIndex > index ? 1 : 0)));
    next.splice(at, 0, moved);
    return setWell(visual, to, next);
  }

  // Yuvalı eksenler aynı diziyi paylaşır. İki dolu eksen arasında sürükleme,
  // ilkini silip diğerini kaydırmak yerine eksenleri yer değiştirir.
  if (from.key === "values" && to.key === "values" &&
      from.slot !== undefined && to.slot !== undefined && visual.values[to.slot]) {
    const values = [...visual.values];
    [values[from.slot], values[to.slot]] = [values[to.slot], values[from.slot]];
    return { ...visual, values };
  }

  const target = wellItems(visual, to);
  if (target.some((x) => "measure" in x && "measure" in moved ? x.measure === moved.measure :
    "table" in x && "table" in moved && x.table === moved.table && x.column === moved.column)) return visual;
  const without = setWell(visual, from, source.filter((_, i) => i !== index));
  const next = [...wellItems(without, to)];
  const at = Math.max(0, Math.min(next.length, targetIndex));
  if (to.max && next.length >= to.max) next.splice(Math.min(at, next.length - 1), 1);
  next.splice(Math.min(at, next.length), 0, moved);
  return setWell(without, to, next);
}
