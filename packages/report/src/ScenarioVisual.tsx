import { useEffect, useId, useRef, useState } from "react";
import type { FilterRef, ScenarioHistory, ScenarioReceipt, ScenarioWorkflow, Visual, VisualResult } from "@floem/client";
import { FloemApiError } from "@floem/client";
import { useScenarios } from "./ScenarioContext";
import { useRuntimeFeedback } from "./BindingRuntime";
import { useQueryDiagnostic } from "./diagnostics";
import { useVisualExports } from "./VisualContextMenu";
import type { QueryFn } from "./useVisualData";
import { formatValue as formatScalar } from "./reportUtils";
import { scenarioReceiptMatches, scenarioValues } from "./scenarioState";
import "./scenario.css";

const textError = (e: unknown) => e instanceof FloemApiError ? [e.message, e.detail].filter(Boolean).join(" · ") : e instanceof Error ? e.message : String(e);
const formatValue = (value: unknown) => formatScalar(value, undefined);
const stateLabel = (status: string) => ({ pending: "İncelemede", approved: "Onaylandı", rejected: "Reddedildi" })[status] ?? status;
function ProposalPanel({ receipt, workflow }: { receipt: ScenarioReceipt; workflow: ScenarioWorkflow }) {
  const [history, setHistory] = useState<ScenarioHistory>(), [note, setNote] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  const [submitted, setSubmitted] = useState(false), [historyError, setHistoryError] = useState("");
  const [requestKey] = useState(() => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""));
  const active = useRef(false), alive = useRef(true);
  const scope = { scenarioId: receipt.id, filters: receipt.context.filters };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    setHistory(undefined);
    setHistoryError("");
    workflow.history(scope).then((next) => { if (current) setHistory(next); }).catch((e) => { if (current) setHistoryError(textError(e)); });
    return () => { current = false; };
  }, [attempt, workflow]);
  const perform = async (work: () => Promise<unknown>, success: string) => {
    if (active.current) return;
    active.current = true; setBusy(true); setMessage("");
    try { await work(); if (alive.current) { setMessage(success); setAttempt((n) => n + 1); } }
    catch (e) { if (alive.current) setMessage(textError(e)); }
    finally { active.current = false; if (alive.current) setBusy(false); }
  };
  return <section className="v-scenario-workflow" aria-label="Senaryo önerileri"><h4>Öneri ve değerlendirme</h4>
    <p>Onay uygulama içi kararı kaydeder. ERP'de belge veya kayıt oluşturmaz.</p>
    <label>Öneri / karar notu<textarea aria-label="Senaryo işlem notu" maxLength={1000} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} /></label>
    <div className="v-scenario-tools"><button type="button" disabled={busy || submitted || !history?.canSubmit || receipt.outputs.some((o) => o.value == null || o.baseline == null)} onClick={() => {
      void perform(async () => { const result = await workflow.create({ ...scope, values: receipt.values, version: receipt.version, snapshot: receipt.snapshot, requestKey, note }); if (alive.current) setSubmitted(true); return result; }, "Öneri kaydedildi; işlem geçmişinde görebilirsiniz.");
    }}>Öneri oluştur</button><button type="button" disabled={busy} onClick={() => { setMessage(""); setAttempt((n) => n + 1); }}>Geçmişi yenile</button></div>
    {message && <p role="status">{message}</p>}
    {!history ? <p role={historyError ? "alert" : "status"}>{historyError || "İşlem geçmişi yükleniyor…"}</p> : <><p>{history.canReview ? "Bu firma için önerileri değerlendirebilirsiniz." : "Bu firma ve güncel veri/yetki kapsamındaki kendi önerileriniz."}</p>
      {!history.items.length && <p>Henüz öneri yok.</p>}
      {history.items.map((item) => <article key={item.id} className="v-scenario-proposal"><strong>#{item.id} · {stateLabel(item.status)}</strong><span>{item.author} · Firma {String(item.receipt.context.company)}</span>
        <p>{item.note}</p><details><summary>Varsayımlar, sonuç ve işlem geçmişi</summary>
          <p>{item.receipt.context.filters.map((f) => `${f.table}[${f.column}]: ${f.values.join(", ")}`).join(" · ")}</p>
          <p>{item.receipt.parameters.map((p) => `${p.label}: ${item.receipt.values[p.id]} ${p.unit}`).join(" · ")}</p>
          {item.receipt.outputs.map((o) => <p key={o.measure}>{o.label}: {formatValue(o.baseline)} → {formatValue(o.value)} {o.unit}</p>)}
          <ol>{item.events.map((event, i) => <li key={i}>{stateLabel(event.status)} · {event.actor} · {new Date(event.at).toLocaleString("tr-TR")} {event.note}</li>)}</ol>
        </details>{history.canReview && item.status === "pending" && <div className="v-scenario-tools"><button type="button" disabled={busy} onClick={() => void perform(() => workflow.decide(item.id, "approved", note), "Öneri onaylandı.")}>Onayla</button>
          <button type="button" disabled={busy} onClick={() => void perform(() => workflow.decide(item.id, "rejected", note), "Öneri reddedildi.")}>Reddet</button></div>}</article>)}
      {history.hasMore && <p>Son 100 öneri gösteriliyor; bu liste bütün işlem geçmişi değildir.</p>}</>}
  </section>;
}

export function ScenarioVisual({ v, extra, revision, run }: { v: Visual; extra: FilterRef[]; revision: string; run: QueryFn }) {
  const { definitions, workflow } = useScenarios(), definition = definitions.find((s) => s.id === v.format.scenarioId);
  const definitionKey = JSON.stringify(definition), uid = useId();
  const [draft, setDraft] = useState<{ key: string; values: Record<string, string> }>(), [attempt, setAttempt] = useState(0);
  const currentDraft = draft?.key === definitionKey ? draft.values : {};
  const input = definition ? scenarioValues(definition, currentDraft) : { values: {}, error: "Senaryolar bölümünden bir senaryo tanımı seçin." };
  const key = JSON.stringify([definitionKey, input, v.filters, extra, revision, attempt]);
  const [response, setResponse] = useState<{ key: string; run: QueryFn; result?: VisualResult; error?: string }>();
  const current = response?.key === key && response.run === run ? response : undefined;
  const receipt = current?.result?.scenario;
  const status = input.error ? "empty" : current?.error ? "error" : receipt ? "ready" : "loading";
  const feedback = useRuntimeFeedback(status, input.error ?? current?.error, () => setAttempt((n) => n + 1));
  useQueryDiagnostic(key, { source: "Görsel sorgusu", status, rows: receipt?.outputs.length });
  useEffect(() => {
    setResponse(undefined);
    if (!definition || input.error) return;
    let alive = true;
    const timer = setTimeout(() => {
      Promise.resolve().then(() => run({ group: [], values: [], filters: [...v.filters, ...extra], scenario: { id: definition.id, values: input.values } }))
        .then((result) => { if (!scenarioReceiptMatches(result.scenario, definition, input.values)) throw new Error("Senaryo sonucu istenen parametrelerle uyuşmuyor; sunucuyu güncelleyip yeniden deneyin."); if (alive) setResponse({ key, run, result }); })
        .catch((e) => { if (alive) setResponse({ key, run, error: textError(e) }); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [key, run]);
  useVisualExports("scenario-export", v.format, () => status === "ready" && current?.result ? { ...current.result, title: definition?.label ?? "Senaryo" } : null);
  if (!definition) return feedback ?? <p className="v-empty">{input.error}</p>;
  const update = (id: string, value: string) => setDraft({ key: definitionKey, values: { ...currentDraft, [id]: value } });
  return <div className="v-scenario"><div className="v-scenario-heading"><strong>{definition.label}</strong><span>Varsayımsal senaryo</span></div>
    {definition.description && <p>{definition.description}</p>}
    <div className="v-scenario-inputs">{definition.parameters.map((p) => <label key={p.id} htmlFor={`${uid}-${p.id}`}>{p.label} <small>{p.unit}</small>
      <input id={`${uid}-${p.id}`} aria-label={`Senaryo parametresi: ${p.label}`} type="number" min={p.minimum} max={p.maximum} step={p.step} value={currentDraft[p.id] ?? String(p.defaultValue)} onChange={(e) => update(p.id, e.target.value)} />
      <input aria-label={`Senaryo kaydırıcısı: ${p.label}`} type="range" min={p.minimum} max={p.maximum} step={p.step} value={input.error ? p.defaultValue : input.values[p.id]} onChange={(e) => update(p.id, e.target.value)} /><small>{p.minimum}–{p.maximum} · Adım {p.step} · Başlangıç {p.defaultValue}</small>
    </label>)}</div><button type="button" onClick={() => setDraft(undefined)}>Varsayımları sıfırla</button>
    {status !== "ready" ? feedback ?? <div role={status === "error" ? "alert" : "status"} aria-busy={status === "loading"}>{input.error ?? current?.error ?? "Senaryo hesaplanıyor…"}
      {status === "error" && <button type="button" onClick={() => setAttempt((n) => n + 1)}>Tekrar dene</button>}</div> : receipt && <>
      <p>Firma: <b>{String(receipt.context.company)}</b> · Mevcut: modelin başlangıç varsayımları</p>
      <div className="v-scenario-results">{receipt.outputs.map((o) => <article key={o.measure}><h4>{o.label} <small>{o.unit}</small></h4>
        <dl><div><dt>Mevcut</dt><dd>{formatValue(o.baseline) || "Veri yok"}</dd></div><div><dt>Senaryo</dt><dd>{formatValue(o.value) || "Veri yok"}</dd></div>
          <div><dt>Fark</dt><dd>{o.delta == null ? "—" : `${o.delta > 0 ? "+" : ""}${formatValue(o.delta)}`}</dd></div><div><dt>Değişim</dt><dd>{o.percent == null ? "—" : `${(o.percent * 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}%`}</dd></div></dl>
        {(o.value == null || o.baseline == null) && <p>Bu kapsamda karşılaştırılabilir veri yok.</p>}</article>)}</div>
      <details><summary>Hesap kapsamı</summary><p>Raporun kayıtlı FDX ölçüleri kullanılır. Varsayımlar bu hesap isteğine aittir.</p><code>{receipt.version}</code><p>{receipt.context.filters.map((f) => `${f.table}[${f.column}] ${f.op ?? "in"} ${f.values.join(", ")}`).join(" · ")}</p></details>
      {definition.proposalEnabled && (workflow ? <ProposalPanel key={JSON.stringify([receipt.snapshot, receipt.version, receipt.contextHash, receipt.values, workflow.scope])} receipt={receipt} workflow={workflow} /> : <p>Öneri oluşturma, onay ve işlem geçmişi için raporu web'de yayımlayın.</p>)}
    </>}
  </div>;
}
