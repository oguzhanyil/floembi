import type { Scalar } from "./index";
export type BandKind =
  | "reportHeader"
  | "pageHeader"
  | "groupHeader"
  | "detail"
  | "groupFooter"
  | "reportFooter"
  | "pageFooter";
export type ItemKind =
  | "text"
  | "field"
  | "formula"
  | "line"
  | "box"
  | "page"
  | "barcode"
  | "subreport"
  | "crossTab";
export type PrintFormat = "auto" | "integer" | "decimal" | "money" | "date";
export interface Condition {
  field: string;
  op: "eq" | "ne" | "ge" | "le" | "gt" | "lt" | "contains";
  value: Scalar;
}
export interface Calculation {
  op:
    | "field"
    | "add"
    | "subtract"
    | "multiply"
    | "divide"
    | "round"
    | "abs"
    | "year"
    | "month"
    | "day"
    | "daysBetween"
    | "if"
    | "count"
    | "sum"
    | "running";
  field: string;
  other?: string;
  value?: Scalar;
  condition?: Condition | null;
  yes?: Scalar;
  no?: Scalar;
  scope?: "section" | "report";
}
export interface PrintItem {
  id: string;
  kind: ItemKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  field?: string;
  color?: string;
  background?: string | null;
  font?: number;
  bold?: boolean;
  locked?: boolean;
  wrap?: boolean;
  align?: "left" | "center" | "right";
  border?: number;
  format?: PrintFormat;
  formula?: Calculation | null;
  rule?: Condition | null;
  ruleColor?: string | null;
  hideWhen?: boolean;
  ruleFormat?: Exclude<PrintFormat, "auto"> | null;
  symbology?: "code128" | "code39" | "ean13" | "qr";
  target?: string;
  childField?: string;
  column?: string;
  measure?: string;
}
export interface PrintBand {
  kind: BandKind;
  group?: string;
  height: number;
  objects: PrintItem[];
}
export interface PrintOrder {
  field: string;
  desc?: boolean;
}
export interface PrintGroup extends PrintOrder {
  newPage?: boolean;
  repeat?: boolean;
}
export interface PrintParameter {
  field: string;
  label: string;
  kind: "choice" | "date" | "number" | "text";
  op: "eq" | "ge" | "le" | "contains";
  default?: Scalar;
}
export interface PagedReport {
  id: string;
  name: string;
  version: number;
  table: string;
  category: string;
  paper: "A4" | "A3";
  landscape: boolean;
  margin: number;
  bands: PrintBand[];
  groups: PrintGroup[];
  sort: PrintOrder[];
  params: PrintParameter[];
}
export interface PagedLibrary {
  reports: PagedReport[];
}
export interface PrintOutput {
  width: number;
  height: number;
  name: string;
  count: number;
  options: Record<string, string[]>;
  pages: string[];
  sheet: Scalar[][];
}
export interface PagedRunner {
  preview(report: string, values: Record<string, Scalar>): Promise<PrintOutput>;
  word(report: string, values: Record<string, Scalar>): Promise<{ word: string }>;
}
export function latestReports(library: PagedLibrary) {
  const items = new Map<string, PagedReport>();
  for (const t of library.reports) if ((items.get(t.id)?.version ?? 0) < t.version) items.set(t.id, t);
  return [...items.values()];
}
