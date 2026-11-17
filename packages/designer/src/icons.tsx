import type { ModelColumn } from "@floem/client";

/** Model görünümü simgeleri (Power BI'daki tablo kartı simgelerine benzer, satır içi SVG). */
const base = { width: 14, height: 14, viewBox: "0 0 16 16", "aria-hidden": true } as const;

export const KeyIcon = () => (
  <svg {...base} className="ico ico-key">
    <circle cx="5" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 8h7M12.5 8v3M14.5 8v2" stroke="currentColor" strokeWidth="1.6" fill="none" />
  </svg>
);

export const SigmaIcon = () => (
  <svg {...base} className="ico ico-sigma">
    <path d="M12 3H4l5 5-5 5h8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

export const CalendarIcon = () => (
  <svg {...base} className="ico ico-date">
    <rect x="2" y="3.5" width="12" height="10.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M2 7h12M5 2v3M11 2v3" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const TextIcon = () => (
  <svg {...base} className="ico ico-text">
    <path d="M3 4h10M8 4v9" stroke="currentColor" strokeWidth="1.6" fill="none" />
  </svg>
);

export const NumberIcon = () => (
  <svg {...base} className="ico ico-num">
    <path d="M6 2.5 4.5 13.5M11.5 2.5 10 13.5M2.5 6h11M2 10.5h11" stroke="currentColor" strokeWidth="1.3" fill="none" />
  </svg>
);

export const BoolIcon = () => (
  <svg {...base} className="ico ico-bool">
    <rect x="1.5" y="4.5" width="13" height="7" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="11" cy="8" r="2" fill="currentColor" />
  </svg>
);

export const CalcIcon = () => (
  <svg {...base} className="ico ico-measure">
    <rect x="3" y="1.5" width="10" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5.5 4.5h5M5.5 8h1M9.5 8h1M5.5 11h1M9.5 11h1" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

export const HiddenIcon = () => (
  <svg {...base} className="ico ico-hidden">
    <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path d="M2.5 13.5 13.5 2.5" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const TableIcon = () => (
  <svg {...base} className="ico ico-table">
    <rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path d="M1.5 6h13M1.5 9.5h13M6 6v7.5" stroke="currentColor" strokeWidth="1.1" />
  </svg>
);

export const DateTableIcon = () => (
  <svg {...base} className="ico ico-datetable">
    <rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path d="M1.5 6h13" stroke="currentColor" strokeWidth="1.1" />
    <circle cx="5" cy="9.5" r="1" fill="currentColor" />
    <circle cx="8" cy="9.5" r="1" fill="currentColor" />
    <circle cx="11" cy="9.5" r="1" fill="currentColor" />
  </svg>
);

const isNumeric = (t: ModelColumn["tip"]) => t === "int32" || t === "int64" || t === "decimal" || t === "double";

/** Sütun tipi simgesi: Σ toplanabilen sayı, # özetlenmeyen sayı, takvim tarih, T metin. */
export function ColumnTypeIcon({ c }: { c: ModelColumn }) {
  if (isNumeric(c.tip) && (c.ozet ?? "sum") !== "none") return <SigmaIcon />;
  if (isNumeric(c.tip)) return <NumberIcon />;
  if (c.tip === "date" || c.tip === "datetime") return <CalendarIcon />;
  if (c.tip === "bool") return <BoolIcon />;
  return <TextIcon />;
}
