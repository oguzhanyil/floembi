import type { PrintLayout } from "./printLayout";

export type FormKind = "invoice" | "quote";
export const detailLabels = {
  LineNum: "Sıra", ItemCode: "Ürün kodu", Dscription: "Açıklama", WhsCode: "Depo",
  Quantity: "Miktar", Price: "Birim fiyat", LineTotal: "Net tutar",
} as const;
export type DetailColumn = keyof typeof detailLabels;
export interface PrintTemplate {
  layout?: PrintLayout | null;
  version: 1;
  kind: FormKind;
  title: string;
  issuer: string;
  note: string;
  accent: string;
  groupBy: "WhsCode" | "ItemCode" | "none";
  subtotals: boolean;
  columns: DetailColumn[];
  logo: string;
  sampleKey: string;
}
export function defaultPrintTemplate(kind: FormKind): PrintTemplate {
  return {
    version: 1, kind, title: kind === "invoice" ? "Satış faturası" : "Satış teklifi",
    issuer: "", note: "", accent: "#205a67", groupBy: "WhsCode", subtotals: true,
    columns: ["LineNum", "ItemCode", "Dscription", "Quantity", "Price", "LineTotal"], logo: "", sampleKey: "",
  };
}
export interface PrintRecord {
  header: { DocNum: string | number; DocDate: string; DocDueDate?: string; CardName: string;
    Address?: string | null; Comments?: string | null; DocCur: string; VatSum: number; DocTotal: number };
  lines: { LineNum: number; ItemCode: string | null; Dscription: string; WhsCode: string | null;
    Quantity: number; Price: number; LineTotal: number }[];
}
export interface PrintChoices { items: { key: string; number: string }[]; more: boolean }
