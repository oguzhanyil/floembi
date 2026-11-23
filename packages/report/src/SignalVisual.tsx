import { useEffect, useMemo, useState } from "react";
import type { FilterRef, MetricEvidence, Visual, VisualQuery, VisualResult } from "@floem/client";
import { useRuntimeFeedback } from "./BindingRuntime";
import { formatValue } from "./reportUtils";
import type { QueryFn } from "./useVisualData";
import { useQueryDiagnostic } from "./diagnostics";
import { useVisualExports } from "./VisualContextMenu";
import { readMetricEvidence } from "./metricEvidence";
import "./signal.css";

type MetricData = { state: "empty" | "loading" } | { state: "ready"; result: VisualResult } | { state: "error"; error: { message: string; detail?: string } };
/** Kapsam değiştiği render'da önceki makbuz ve dışa aktarım hemen kaldırılır. */
function useMetricData(query: VisualQuery | null, revision: string, run: QueryFn): MetricData {
  const key = JSON.stringify([query, revision]);
  const [response, setResponse] = useState<{ key: string; run: QueryFn; data: MetricData }>();
  const data: MetricData = !query ? { state: "empty" } : response?.key === key && response.run === run ? response.data : { state: "loading" };
  useQueryDiagnostic(key, { source: "Görsel sorgusu", status: data.state, rows: data.state === "ready" ? data.result.rows.length : undefined });
  useEffect(() => {
    if (!query) return;
    setResponse(undefined);
    let alive = true;
    Promise.resolve().then(() => run(query)).then((result) => { if (alive) setResponse({ key, run, data: { state: "ready", result } }); })
      .catch((e) => { if (alive) setResponse({ key, run, data: { state: "error", error: { message: e instanceof Error ? e.message : String(e) } } }); });
    return () => { alive = false; };
  }, [key, run]);
  return data;
}

export function SignalVisual({ v, extra, revision, run }: { v: Visual; extra: FilterRef[]; revision: string; run: QueryFn }) {
  const metricId = typeof v.format.metricId === "string" ? v.format.metricId : "";
  const scope = JSON.stringify([metricId, v.filters, extra, revision]);
  const [attempt, setAttempt] = useState(0), [imported, setImported] = useState<{ scope: string; evidence: MetricEvidence }>();
  const [notice, setNotice] = useState("");
  const evidence = imported?.scope === scope ? imported.evidence : undefined;
  const query = useMemo(() => metricId ? { group: [], values: [], filters: [...v.filters, ...extra], analytics: { metricId, evidence } } : null, [scope, evidence]);
  const data = useMetricData(query, `${revision}:${attempt}`, run);
  const receipt = data.state === "ready" ? data.result.analytics : undefined;
  const status = !metricId ? "empty" : data.state === "ready" && !receipt ? "error" : data.state;
  const message = !metricId ? "Analytics ve uyarılar bölümünden katalog ölçüsü seçin." : data.state === "error" ? [data.error.message, data.error.detail].filter(Boolean).join(" · ") : "Ölçü makbuzu alınamadı; Desktop/web sunucusunu güncelleyin.";
  const feedback = useRuntimeFeedback(status, message, () => setAttempt((n) => n + 1));
  useVisualExports("metric-export", v.format, () => data.state === "ready" && receipt ? { ...data.result, title: v.title || metricId } : null);
  if (!receipt || status !== "ready") return feedback ?? <div className="v-empty" role={status === "error" ? "alert" : "status"} aria-busy={status === "loading"}>
    {status === "loading" ? "Ortak ölçü hesaplanıyor…" : message}
    {status === "error" && <button type="button" onClick={() => setAttempt((n) => n + 1)}>Tekrar dene</button>}
  </div>;
  const compare = { not_provided: "Karşılaştırma kanıtı yüklenmedi", context_mismatch: "Kapsam uyuşmuyor", unverified: "Doğrulanamadı", match: "Kapsam ve değer uyumlu", value_mismatch: "Değer farkı var" }[receipt.comparison.status];
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "floem-olcu-kaniti.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="v-signal">
    <div className="v-signal-value">{receipt.value == null ? "Veri yok" : formatValue(receipt.value, data.state === "ready" ? data.result.columns[0]?.type : undefined)} <small>{receipt.context.unit}</small></div>
    <p>Firma: <b>{String(receipt.context.company)}</b> · {metricId}</p>
    <p className="v-signal-muted">Tane: {receipt.context.grain}</p>
    <p className="v-signal-muted">Kaynak veri zamanı (bildirilen): {receipt.dataTime || "Bildirilmemiş"}</p>
    <div className="v-signal-alerts" aria-label="Ölçü uyarıları">{receipt.alerts.map((rule) => <div className={`v-signal-rule ${rule.status} ${rule.severity}`} key={rule.id}>
      <strong>{rule.status === "unknown" ? "? Hesaplanamadı" : rule.status === "clear" ? "✓ Eşik aşılmadı" : rule.severity === "critical" ? "! Kritik" : rule.severity === "warning" ? "! Uyarı" : "ⓘ Bilgi"}</strong>
      <span>{rule.label}</span><small>{({ gt: ">", ge: "≥", lt: "<", le: "≤" })[rule.operator]} {formatValue(rule.threshold, undefined)} {receipt.context.unit}</small>
    </div>)}{!receipt.alerts.length && <span>Bu ölçü için eşik kuralı tanımlı değil.</span>}</div>
    <div className={`v-signal-compare ${receipt.comparison.status}`} role="status"><strong>{compare}</strong>{receipt.comparison.reasons.map((r) => <p key={r}>{r}</p>)}</div>
    <div className="v-signal-tools"><button type="button" onClick={download}>Ölçü kanıtını indir</button>
      <label className="v-signal-file">Kanıt karşılaştır<input type="file" accept=".json,application/json" aria-label="Ölçü kanıtı yükle" onChange={async (event) => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setImported(undefined);
        try { if (file.size > 65536) throw new Error("Ölçü kanıtı 64 KB sınırını aşıyor."); const next = readMetricEvidence(await file.text()); setImported({ scope, evidence: next }); setNotice(""); }
        catch (e) { setNotice(e instanceof Error ? e.message : "Kanıt okunamadı"); }
      }} /></label>{evidence && <button type="button" onClick={() => setImported(undefined)}>Kanıtı temizle</button>}</div>
    {notice && <p role="alert">{notice}</p>}
    <details><summary>Hesap ve kapsam bilgisi</summary><dl><dt>Ölçü/kural sürümü</dt><dd>{receipt.metricVersion}</dd><dt>Veri/yetki sürümü</dt><dd>{receipt.snapshot}</dd><dt>Değerlendirme zamanı</dt><dd>{receipt.evaluatedAt}</dd></dl>
      <p>Rapor ve uyarı aynı FDX hesabından gelir. Karşılaştırma yüklenen kapsam beyanını sınar; dosyanın kaynağını doğrulamaz. Eşik kuralı istatistiksel anomali değildir.</p>
      <pre>{JSON.stringify(receipt.context.filters, null, 2)}</pre></details>
  </div>;
}
