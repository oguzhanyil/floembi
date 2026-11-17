import { createContext, useContext } from "react";
import type { Selection } from "./modelUtils";

export interface ColumnPick {
  table: string;
  column: string;
}

export interface ModelViewApi {
  selection: Selection;
  select(s: Selection): void;
  /** Bir sütun diğer tablodaki sütunun üstüne bırakıldı → ilişki penceresi */
  columnDrop(from: ColumnPick, to: ColumnPick): void;
  toggleCollapsed(table: string): void;
  /** Seçili ilişkinin iki ucundaki sütunlar vurgulanır (küçük harfli "Tablo[Sütun]") */
  highlighted: Set<string>;
}

export const ModelViewContext = createContext<ModelViewApi | null>(null);

export function useModelView(): ModelViewApi {
  const c = useContext(ModelViewContext);
  if (!c) throw new Error("ModelViewContext eksik");
  return c;
}

export const DRAG_MIME = "application/x-floem-column";
