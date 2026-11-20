import type { ModelTable, ReportDefinition } from "@floem/client";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { VisualDiagnostic } from "../../report/src/diagnostics";
import type { ResolvedLayout } from "../../report/src/layout";
import { auditDesign, type AuditTarget } from "./designAudit";
import { useDesignMeasurements } from "./useDesignMeasurements";
import "./designInspector.css";

interface Props {
  report: ReportDefinition; tables: ModelTable[]; pageId: string; layoutId: string | null;
  root: RefObject<HTMLDivElement | null>; scope: string; queries: VisualDiagnostic[]; resolved: ResolvedLayout;
  onLocate(target: AuditTarget): void;
}
const labels = { error: "Hata", warning: "Uyarı", info: "Bilgi" };
export function DesignInspector(props: Props) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="inspector-launch" onClick={() => setOpen(true)}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H5v18h14V3h-4M9 2h6v4H9zM8 12l3 3 5-6" /></svg>Tasarımı denetle
  </button>{open && <InspectorDialog {...props} onClose={() => setOpen(false)} />}</>;
}
function InspectorDialog({ onClose, ...props }: Props & { onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [severity, setSeverity] = useState("all"), [category, setCategory] = useState("all"), [pageFilter, setPageFilter] = useState("all");
  const [search, setSearch] = useState(""), [shown, setShown] = useState(100);
  const measurements = useDesignMeasurements(props.root, props.scope);
  const findings = useMemo(() => auditDesign(props.report, props.tables, { pageId: props.pageId, layoutId: props.layoutId,
    measurements, queries: props.queries, resolved: props.resolved }), [props.report, props.tables, props.pageId, props.layoutId, measurements, props.queries, props.resolved]);
  const filtered = findings.filter((f) => (severity === "all" || severity === f.severity) && (category === "all" || category === f.category)
    && (pageFilter === "all" || pageFilter === f.pageId) && [f.message, f.code, f.pageName, f.layoutName, f.visualName, f.evidence].join(" ").toLocaleLowerCase("tr").includes(search.toLocaleLowerCase("tr")));
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.showModal(); return () => previous?.focus(); }, []);
  useEffect(() => setShown(100), [severity, category, pageFilter, search]);
  const exportFindings = () => {
    // Bilerek yalnız bulgular: rapor tanımı, kayıtlar, URL ve ham sorgu hatası yok.
    const blob = new Blob([JSON.stringify({ version: 1, coverage: "Tüm kayıtlı düzenlerin tanımı; açık düzenin görünür metni ve mevcut sorgu durumları", findings }, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = "floem-tasarim-denetimi.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return createPortal(<dialog ref={ref} className="design-inspector" aria-label="Tasarım ve anlam denetçisi" onCancel={onClose} onClose={onClose}>
    <header><div><h2>Tasarım ve anlam denetçisi</h2><p>Tasarım kararları sizde. Bulgular otomatik düzeltme yapmaz ve yayımlamayı engellemez.</p></div><button type="button" autoFocus onClick={onClose}>Kapat</button></header>
    <div className="inspector-summary">{Object.entries(labels).map(([key, label]) => <span key={key} data-severity={key}>{label} <strong>{findings.filter((f) => f.severity === key).length}</strong></span>)}<button type="button" onClick={exportFindings}>JSON indir</button></div>
    <p className="inspector-coverage">Tanım: tüm sayfalar ve kayıtlı düzenler. Ölçüm ve canlı sorgu durumu: yalnız açık düzenin yüklenmiş nesneleri. Gizli nesne ve sanal listenin yüklenmemiş satırları ölçülmez. Birim/toplama uyarıları iş kuralı kontrolü gerektirir; denetim kusursuzluk belgesi değildir.</p>
    <div className="inspector-filters"><input type="search" aria-label="Denetimde ara" placeholder="Sayfa, nesne veya bulgu ara" value={search} onChange={(e) => setSearch(e.target.value)} />
      <select aria-label="Denetim önem düzeyi" value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="all">Tüm önem düzeyleri</option>{Object.entries(labels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <select aria-label="Denetim kategorisi" value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">Tüm kategoriler</option>{["Yerleşim", "Okunabilirlik", "Veri bağı", "Anlam", "Etkileşim", "Veri kapsamı"].map((k) => <option key={k}>{k}</option>)}</select>
      <select aria-label="Denetim sayfası" value={pageFilter} onChange={(e) => setPageFilter(e.target.value)}><option value="all">Tüm sayfalar</option>{props.report.pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    </div>
    <p role="status" className="inspector-count">{filtered.length} bulgu · {Math.min(shown, filtered.length)} gösteriliyor</p>
    <div className="inspector-results">{!filtered.length && <p className="inspector-empty">Bu kapsamda bulgu yok. Açmadığınız düzenlerin gerçek metin ölçümleri henüz yapılmadı.</p>}
      {filtered.slice(0, shown).map((f) => <article key={f.id} data-code={f.code} data-severity={f.severity} data-page-id={f.pageId} data-layout-id={f.layoutId ?? "base"} data-object-id={f.visualId}>
        <div className="inspector-finding-head"><span>{labels[f.severity]} · {f.category} · {f.basis}</span><button type="button" onClick={() => { onClose(); props.onLocate(f); }}>Nesneye git</button></div>
        <h3>{f.message}</h3><p className="inspector-path">{f.pageName} / {f.layoutName} / {f.visualName}</p>
        <p><strong>Gerekçe:</strong> {f.evidence}</p><p><strong>Öneri:</strong> {f.suggestion}</p><code>{f.code}</code>
      </article>)}
      {filtered.length > shown && <button type="button" className="inspector-more" onClick={() => setShown((n) => n + 100)}>100 bulgu daha göster</button>}
    </div>
  </dialog>, document.body);
}
