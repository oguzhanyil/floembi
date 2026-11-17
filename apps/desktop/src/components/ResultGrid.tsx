import type { QueryResult } from "@floem/client";

const nf = new Intl.NumberFormat("tr-TR");

function cell(v: unknown) {
  if (v === null || v === undefined) return <span className="null">null</span>;
  if (typeof v === "number") return <span className="num">{nf.format(v)}</span>;
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/** Sorgu ve önizleme sonuç tablosu (H3'te sanal kaydırmalı TanStack tablosuna geçecek). */
export function ResultGrid({ result }: { result: QueryResult }) {
  return (
    <div className="grid-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th className="rownum">#</th>
            {result.columns.map((c, i) => (
              <th key={i} title={c.type}>
                {c.name}
                <span className="coltype">{c.type}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, r) => (
            <tr key={r}>
              <td className="rownum">{r + 1}</td>
              {row.map((v, c) => (
                <td key={c}>{cell(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function resultSummary(r: QueryResult) {
  const rows = `${nf.format(r.row_count)} satır`;
  const time = `${nf.format(r.elapsed_ms)} ms`;
  return r.truncated ? `${rows} (sınıra ulaşıldı, tamamı gösterilmiyor) · ${time}` : `${rows} · ${time}`;
}
