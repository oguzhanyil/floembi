import type { ImportAudit, ImportFinding, ImportVisualAudit } from "@floem/client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./importCompatibility.css";

const labels = { mapped: "Yerleşim eşlendi", partial: "Kısmi", unsupported: "Desteklenmiyor", skipped: "Atlandı" };
function Findings({ items }: { items: ImportFinding[] }) {
  return <ul>{items.map((i, n) => <li key={n} data-severity={i.severity}><strong>{i.code}</strong> · {i.message}{i.detail && <small>{i.detail}</small>}</li>)}</ul>;
}
function AuditDialog({ audit, onClose, onLocate }: { audit: ImportAudit; onClose: () => void; onLocate?: (pageId: string, visualId: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  useEffect(() => { ref.current?.showModal(); }, []);
  const matches = (v: ImportVisualAudit, pageName: string) => (status === "all" || v.status === status) &&
    JSON.stringify([pageName, v.sourceId, v.sourceType, v.fields, v.issues]).toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr"));
  const count = audit.pages.reduce((n, p) => n + p.visuals.filter((v) => matches(v, p.name)).length, 0);
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(audit, null, 2)], { type: "application/json;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "floem-pbip-uyumluluk.json"; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return createPortal(<dialog ref={ref} className="import-audit-dialog" aria-label="Power BI uyumluluk raporu" onCancel={onClose} onClose={onClose}>
    <header><div><h2>Power BI uyumluluk raporu</h2><span>{audit.source} · Aktarım anındaki inceleme</span></div><button type="button" autoFocus onClick={onClose}>Kapat</button></header>
    <p>Bu dosya tasarım taslağıdır. Veri, ilişkiler ve özgün ölçü formülleri aktarılmadı. “Yerleşim eşlendi” tam biçim veya hesap eşdeğerliği anlamına gelmez. Sonradan yapılan düzeltmeler bu geçmiş kaydını değiştirmez.</p>
    <div className="import-audit-summary">{Object.entries(labels).map(([key, label]) => <span key={key}>{label}: <strong>{audit.summary[key] ?? 0}</strong></span>)}</div>
    <Findings items={audit.issues} />
    <div className="import-audit-tools"><input type="search" aria-label="Uyumluluk raporunda ara" placeholder="Sayfa, nesne, alan veya hata kodu ara" value={query} onChange={(e) => setQuery(e.target.value)} />
      <select aria-label="Uyumluluk durumu" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Tüm durumlar</option>
        {Object.entries(labels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
      <button type="button" onClick={download}>JSON indir</button><span>{count} nesne</span></div>
    {count === 0 && <p>Eşleşen nesne yok.</p>}
    {audit.pages.map((page, pi) => {
      const visuals = page.visuals.filter((v) => matches(v, page.name));
      if (!visuals.length && !page.issues.length) return null;
      return <section key={pi}><h3>{page.name}</h3><Findings items={page.issues} />
        {visuals.map((v, vi) => <details key={vi} className="import-audit-visual"><summary>{labels[v.status]} · {v.sourceType} · {v.sourceId} ({v.issues.length} bulgu)</summary>
          <p>Floem: {v.targetType || "yok"} · {v.targetIds.join(", ") || "Nesne oluşturulmadı"}</p>
          {onLocate && v.targetIds.map((id) => <button type="button" key={id} onClick={() => { onLocate(page.id, id); onClose(); }}>Nesneye git: {id}</button>)}
          {v.fields.length > 0 && <table><thead><tr><th>Rol</th><th>Alan</th><th>Durum</th></tr></thead><tbody>{v.fields.map((f, i) => <tr key={i}><td>{f.role}</td><td>{f.table}[{f.name || "Çözülemedi"}]</td><td>{f.status === "partial" ? "Başvuru / taslak" : "Eşlenmedi"}</td></tr>)}</tbody></table>}
          <Findings items={v.issues} />
        </details>)}
      </section>;
    })}
  </dialog>, document.body);
}

export function ImportCompatibility({ audit, onLocate }: { audit?: ImportAudit | null; onLocate?: (pageId: string, visualId: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!audit || audit.version !== 1) return null;
  return <div className="import-audit-control"><button type="button" onClick={() => setOpen(true)}>⚠ Power BI aktarım raporu</button>
    <p>Tasarım taslağı · {audit.summary.unsupported ?? 0} desteklenmeyen, {audit.summary.partial ?? 0} kısmi nesne</p>
    {open && <AuditDialog audit={audit} onClose={() => setOpen(false)} onLocate={onLocate} />}</div>;
}
