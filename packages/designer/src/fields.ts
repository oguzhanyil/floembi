import type { Visual } from "@floem/client";
import { usesColumn } from "@floem/report";
import type { DragEvent } from "react";

export const FIELD_MIME = "application/x-floem-field";

/** Veri bölmesinden sürüklenen ya da işaretlenen öğe: sütun ya da ölçü. */
export type FieldPayload = { table: string; column: string } | { measure: string };

export const isMeasure = (p: FieldPayload): p is { measure: string } => "measure" in p;

export function readPayload(e: DragEvent): FieldPayload | null {
  try {
    const p = JSON.parse(e.dataTransfer.getData(FIELD_MIME)) as FieldPayload;
    return p && ("measure" in p || ("table" in p && "column" in p)) ? p : null;
  } catch {
    return null;
  }
}

export function usesField(v: Visual, p: FieldPayload): boolean {
  if (isMeasure(p)) {
    return [...v.values, ...(v.target ?? [])].some((x) => "measure" in x && x.measure === p.measure);
  }
  return usesColumn(v, p.table, p.column);
}
