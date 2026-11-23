import { useEffect, useState } from "react";
import type { AnalyticsConfig, AnalyticsMetric, AnalyticsRule, ModelTable, ReportDefinition, Visual } from "@floem/client";
import { newId } from "@floem/report";
import "./analyticsPane.css";

export function AnalyticsPane({ report, tables, selected, onChange, onVisual }: { report: ReportDefinition; tables: ModelTable[]; selected?: Visual | null; onChange: (r: ReportDefinition) => void; onVisual: (v: Visual) => void }) {
  const config = report.analytics ?? { metrics: [], rules: [] };
  const measures = tables.flatMap((t) => t.olculer.map((m) => m.ad));
  const fields = tables.flatMap((t) => t.sutunlar.map((c) => ({ table: t.ad, column: c.ad })));
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState({ id: "", label: "", measure: "", unit: "", grain: "", company: "", tolerance: "0.000001" });
  const [rule, setRule] = useState({ metricId: "", label: "", operator: "gt", threshold: "", severity: "warning" });
  const [stamp, setStamp] = useState(config.dataTime ?? ""), [message, setMessage] = useState("");
  useEffect(() => { setStamp(config.dataTime ?? ""); }, [config.dataTime]);
  const update = (next: AnalyticsConfig) => { onChange({ ...report, analytics: { ...next, protocol: "floem-metric/v1" } }); setMessage(""); };
  const edit = (m: AnalyticsMetric) => { setEditing(m.id); setDraft({ id: m.id, label: m.label, measure: m.measure, unit: m.unit, grain: m.grain, company: JSON.stringify(m.company), tolerance: String(m.tolerance ?? .000001) }); };
  const clear = () => { setEditing(""); setDraft({ id: "", label: "", measure: "", unit: "", grain: "", company: "", tolerance: "0.000001" }); };
  return <details className="analytics-pane"><summary>Analytics ve uyarılar · {config.metrics.length} ölçü</summary>
    <p className="hint">Rapor ve uyarı aynı kayıtlı FDX ölçüsünü kullanır. Firma, filtre ve veri/yetki sürümü hesapla birlikte taşınır.</p>
    {selected?.type === "signal" && <label>Bu nesnenin katalog ölçüsü<select aria-label="Nesnenin katalog ölçüsü" value={String(selected.format.metricId ?? "")} onChange={(e) => onVisual({ ...selected, format: { ...selected.format, metricId: e.target.value } })}>
      <option value="">Ölçü seçin</option>{config.metrics.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.id}</option>)}</select></label>}
    <div className="analytics-list">{config.metrics.map((m) => <article key={m.id}><strong>{m.label}</strong><code>{m.id}</code><p>{m.measure} · {m.unit} · {m.grain}</p>
      <div><button type="button" onClick={() => edit(m)}>Düzenle</button><button type="button" onClick={() => update({ ...config, metrics: config.metrics.filter((x) => x.id !== m.id), rules: config.rules.filter((r) => r.metricId !== m.id) })}>Katalogdan kaldır</button></div></article>)}</div>
    <form onSubmit={(e) => {
      e.preventDefault();
      if (!/^[a-zA-Z0-9_.:-]{1,100}$/.test(draft.id) || !draft.label.trim() || !draft.measure || !draft.company || !draft.unit.trim() || !draft.grain.trim() || !draft.tolerance || !Number.isFinite(Number(draft.tolerance)) || Number(draft.tolerance) < 0 || Number(draft.tolerance) > 1000) { setMessage("Kimlik, ölçü, firma alanı, birim, tane ve geçerli tolerans gerekli."); return; }
      if (!editing && config.metrics.some((m) => m.id === draft.id)) { setMessage("Bu katalog kimliği zaten kullanılıyor."); return; }
      if (!editing && config.metrics.length >= 100) { setMessage("Bir raporda en fazla 100 katalog ölçüsü kullanılabilir."); return; }
      const metric: AnalyticsMetric = { id: draft.id, label: draft.label.trim(), measure: draft.measure, unit: draft.unit.trim(), grain: draft.grain.trim(), company: JSON.parse(draft.company), tolerance: Number(draft.tolerance), filters: config.metrics.find((m) => m.id === editing)?.filters ?? [] };
      update({ ...config, metrics: editing ? config.metrics.map((m) => m.id === editing ? metric : m) : [...config.metrics, metric] }); clear();
    }}><strong>{editing ? "Katalog ölçüsünü düzenle" : "Ölçüyü kataloğa bağla"}</strong>
      <label>Katalog kimliği<input aria-label="Katalog kimliği" maxLength={100} disabled={!!editing} value={draft.id} placeholder="satis.net" onChange={(e) => setDraft({ ...draft, id: e.target.value })} /></label>
      <label>Ad<input aria-label="Katalog ölçü adı" maxLength={160} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
      <label>FDX ölçüsü<select aria-label="Katalog FDX ölçüsü" value={draft.measure} onChange={(e) => setDraft({ ...draft, measure: e.target.value })}><option value="">Ölçü seçin</option>{measures.map((m) => <option key={m}>{m}</option>)}</select></label>
      <label>Firma anahtarı<select aria-label="Katalog firma alanı" value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })}><option value="">Alan seçin</option>{fields.map((f) => <option key={JSON.stringify(f)} value={JSON.stringify(f)}>{f.table}[{f.column}]</option>)}</select></label>
      <label>Birim<input aria-label="Katalog birimi" maxLength={60} value={draft.unit} placeholder="TRY / kg / oran (0–1)" onChange={(e) => setDraft({ ...draft, unit: e.target.value })} /></label>
      <label>Tane / hesap anlamı<input aria-label="Katalog tanesi" maxLength={200} value={draft.grain} placeholder="Fatura satırı / dönem sonu bakiye" onChange={(e) => setDraft({ ...draft, grain: e.target.value })} /></label>
      <label>Mutlak karşılaştırma toleransı<input aria-label="Ölçü toleransı" type="number" min="0" max="1000" step="any" value={draft.tolerance} onChange={(e) => setDraft({ ...draft, tolerance: e.target.value })} /></label>
      <div><button type="submit">{editing ? "Ölçüyü güncelle" : "Ölçüyü bağla"}</button>{editing && <button type="button" onClick={clear}>Vazgeç</button>}</div>
    </form>
    <form onSubmit={(e) => {
      e.preventDefault();
      if (!config.metrics.some((m) => m.id === rule.metricId) || !rule.label.trim() || !rule.threshold.trim() || !Number.isFinite(Number(rule.threshold))) { setMessage("Uyarı için ölçü, ad ve sayısal eşik gerekli; sıfır kullanılabilir."); return; }
      if (config.rules.length >= 200) { setMessage("Bir raporda en fazla 200 kural kullanılabilir."); return; }
      const next = { ...rule, id: newId("rule", new Set(config.rules.map((r) => r.id))), threshold: Number(rule.threshold) } as AnalyticsRule;
      update({ ...config, rules: [...config.rules, next] }); setRule({ ...rule, label: "", threshold: "" });
    }}><strong>Eşik kuralı ekle</strong>
      <label>Ölçü<select aria-label="Uyarı ölçüsü" value={rule.metricId} onChange={(e) => setRule({ ...rule, metricId: e.target.value })}><option value="">Ölçü seçin</option>{config.metrics.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      <label>Uyarı adı<input aria-label="Uyarı adı" maxLength={200} value={rule.label} onChange={(e) => setRule({ ...rule, label: e.target.value })} /></label>
      <label>Koşul<select aria-label="Uyarı koşulu" value={rule.operator} onChange={(e) => setRule({ ...rule, operator: e.target.value })}><option value="gt">Büyüktür</option><option value="ge">Büyük veya eşittir</option><option value="lt">Küçüktür</option><option value="le">Küçük veya eşittir</option></select></label>
      <label>Eşik<input aria-label="Uyarı eşiği" type="number" step="any" value={rule.threshold} onChange={(e) => setRule({ ...rule, threshold: e.target.value })} /></label>
      <label>Önem<select aria-label="Uyarı önemi" value={rule.severity} onChange={(e) => setRule({ ...rule, severity: e.target.value })}><option value="info">Bilgi</option><option value="warning">Uyarı</option><option value="critical">Kritik</option></select></label>
      <button type="submit">Kural ekle</button>
    </form>
    {config.rules.map((r) => <div className="analytics-rule" key={r.id}><span>{r.label} · {r.operator} {r.threshold}</span><button type="button" aria-label={`Kuralı kaldır: ${r.label}`} onClick={() => update({ ...config, rules: config.rules.filter((x) => x.id !== r.id) })}>Kaldır</button></div>)}
    <label>Kaynak veri zamanı (ISO, saat dilimi)<input aria-label="Kaynak veri zamanı" placeholder="2026-03-31T23:59:00Z" value={stamp} onChange={(e) => setStamp(e.target.value)} /></label>
    <button type="button" onClick={() => { if (stamp && (!/(Z|[+-]\d\d:\d\d)$/.test(stamp) || !Number.isFinite(Date.parse(stamp)))) { setMessage("Saat dilimi içeren ISO tarih girin veya bilinmiyorsa boş bırakın."); return; } update({ ...config, dataTime: stamp ? new Date(stamp).toISOString() : null }); }}>Veri zamanını kaydet</button>
    <p className="hint">Veri zamanı kaynağın beyanıdır; raporun kaydedildiği/yayımlandığı tarih değildir. Eşik kuralı istatistiksel anomali veya otomatik e-posta gönderimi değildir.</p>
    {message && <p role="alert">{message}</p>}
  </details>;
}
