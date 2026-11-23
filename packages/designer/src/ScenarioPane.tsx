import { useState } from "react";
import type { ModelTable, ReportDefinition, ScenarioDefinition, ScenarioParameter, Visual, WorkspaceRole } from "@floem/client";
import { scenarioValues } from "../../report/src/scenarioState";
import "./scenarioPane.css";

type ParameterDraft = Omit<ScenarioParameter, "minimum" | "maximum" | "step" | "defaultValue"> & { minimum: string; maximum: string; step: string; defaultValue: string };
const parameter = (i: number): ParameterDraft => ({ id: `p${i}`, label: "", measure: "", unit: "%", minimum: "0", maximum: "100", step: "1", defaultValue: "0" });
const blank = () => ({ id: "", label: "", description: "", company: "", parameters: [parameter(1)], outputs: [{ measure: "", label: "", unit: "" }], proposalEnabled: false, submitRoles: ["admin", "member", "contributor"] as WorkspaceRole[] });
const roleNames: Record<WorkspaceRole, string> = { admin: "Yönetici", member: "Üye", contributor: "Katkıda bulunan", viewer: "İzleyici" };
export function ScenarioPane({ report, tables, selected, onChange, onVisual }: { report: ReportDefinition; tables: ModelTable[]; selected?: Visual | null; onChange: (r: ReportDefinition) => void; onVisual: (v: Visual) => void }) {
  const definitions = report.scenarios ?? [], measures = tables.flatMap((t) => t.olculer), fields = tables.flatMap((t) => t.sutunlar.map((c) => ({ table: t.ad, column: c.ad })));
  const [draft, setDraft] = useState(blank), [editing, setEditing] = useState(""), [message, setMessage] = useState("");
  const update = (scenarios: ScenarioDefinition[]) => { onChange({ ...report, scenarios }); setMessage(""); };
  const edit = (s: ScenarioDefinition) => { setEditing(s.id); setDraft({ id: s.id, label: s.label, description: s.description ?? "", company: JSON.stringify(s.company), parameters: s.parameters.map((p) => ({ ...p, minimum: String(p.minimum), maximum: String(p.maximum), step: String(p.step), defaultValue: String(p.defaultValue) })), outputs: s.outputs.map((o) => ({ ...o })), proposalEnabled: s.proposalEnabled ?? false, submitRoles: s.submitRoles ?? ["admin", "member", "contributor"] }); };
  const changeParameter = (index: number, patch: Partial<ParameterDraft>) => setDraft({ ...draft, parameters: draft.parameters.map((p, i) => i === index ? { ...p, ...patch } : p) });
  return <details className="scenario-pane"><summary>Senaryolar · {definitions.length} tanım</summary>
    <p className="hint">Power BI sayısal parametresi gibi: modelde sayısal sabit olan FDX ölçülerini varsayım olarak kullanın; bunlara bağlı çıktı ölçülerini seçin.</p>
    {selected?.type === "scenario" && <label>Seçili nesnenin senaryosu<select aria-label="Nesnenin senaryosu" value={String(selected.format.scenarioId ?? "")} onChange={(e) => onVisual({ ...selected, format: { ...selected.format, scenarioId: e.target.value } })}><option value="">Senaryo seçin</option>{definitions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>}
    {definitions.map((s) => <article key={s.id}><strong>{s.label}</strong><code>{s.id}</code><small>{s.parameters.length} parametre · {s.outputs.length} çıktı</small><div><button type="button" onClick={() => edit(s)}>Düzenle</button><button type="button" onClick={() => update(definitions.filter((x) => x.id !== s.id))}>Senaryoyu kaldır</button></div></article>)}
    <form onSubmit={(event) => {
      event.preventDefault();
      const fail = (text: string) => { setMessage(text); };
      if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(draft.id) || !draft.label.trim() || !draft.company) return fail("Kimlik, ad ve firma alanı gerekli.");
      if (!editing && (definitions.length >= 30 || definitions.some((s) => s.id === draft.id))) return fail("Senaryo kimliği benzersiz olmalı; en fazla 30 tanım kullanılabilir.");
      const parameters = draft.parameters.map((p) => ({ ...p, minimum: Number(p.minimum), maximum: Number(p.maximum), step: Number(p.step), defaultValue: Number(p.defaultValue) }));
      if (new Set(parameters.map((p) => p.id)).size !== parameters.length || new Set(parameters.map((p) => p.measure.toLocaleLowerCase("en"))).size !== parameters.length) return fail("Parametre kimlikleri ve ölçü bağları benzersiz olmalı.");
      for (const [i, p] of parameters.entries()) {
        const saved = measures.find((m) => m.ad === p.measure)?.ifade.trim() ?? "";
        if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(p.id) || !p.label.trim() || !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(saved) || Number(saved) !== p.defaultValue) return fail(`${i + 1}. parametre: ölçü sayısal sabit ve başlangıç değeriyle aynı olmalı.`);
        if (["minimum", "maximum", "step", "defaultValue"].some((key) => !(draft.parameters[i][key as keyof ParameterDraft] as string).trim()) || ![p.minimum, p.maximum, p.defaultValue, p.step].every(Number.isFinite) || p.minimum > p.maximum || Math.max(Math.abs(p.minimum), Math.abs(p.maximum)) > 1e12 || p.step < .000001 || p.step > 1e12) return fail("Parametre sınırları, adım ve başlangıç sayısal ve geçerli olmalı.");
      }
      if (draft.outputs.some((o) => !o.measure || !o.label.trim()) || new Set(draft.outputs.map((o) => o.measure.toLocaleLowerCase("en"))).size !== draft.outputs.length) return fail("Çıktı ölçüleri ve adları gerekli; aynı ölçü bir kez seçilebilir.");
      const next: ScenarioDefinition = { id: draft.id, label: draft.label.trim(), description: draft.description, company: JSON.parse(draft.company), parameters, outputs: draft.outputs, proposalEnabled: draft.proposalEnabled, submitRoles: draft.submitRoles, filters: definitions.find((s) => s.id === editing)?.filters ?? [] };
      const validation = scenarioValues(next, {}); if (validation.error) return fail(validation.error);
      update(editing ? definitions.map((s) => s.id === editing ? next : s) : [...definitions, next]); setDraft(blank()); setEditing("");
    }}><strong>{editing ? "Senaryoyu düzenle" : "Senaryo tanımla"}</strong>
      <label>Kimlik<input aria-label="Senaryo kimliği" maxLength={80} disabled={!!editing} value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} /></label>
      <label>Ad<input aria-label="Senaryo adı" maxLength={160} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
      <label>Açıklama<textarea aria-label="Senaryo açıklaması" maxLength={1000} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
      <label>Firma anahtarı<select aria-label="Senaryo firma alanı" value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })}><option value="">Alan seçin</option>{fields.map((f) => <option key={JSON.stringify(f)} value={JSON.stringify(f)}>{f.table}[{f.column}]</option>)}</select></label>
      {draft.parameters.map((p, i) => <fieldset key={i}><legend>Parametre {i + 1}</legend>
        <label>Kimlik<input aria-label={`Parametre kimliği ${i + 1}`} maxLength={80} value={p.id} onChange={(e) => changeParameter(i, { id: e.target.value })} /></label>
        <label>Ad<input aria-label={`Parametre adı ${i + 1}`} maxLength={160} value={p.label} onChange={(e) => changeParameter(i, { label: e.target.value })} /></label>
        <label>Sabit FDX ölçüsü<select aria-label={`Parametre ölçüsü ${i + 1}`} value={p.measure} onChange={(e) => { const m = measures.find((m) => m.ad === e.target.value); changeParameter(i, { measure: e.target.value, defaultValue: m && Number.isFinite(Number(m.ifade)) ? String(Number(m.ifade)) : p.defaultValue }); }}><option value="">Ölçü seçin</option>{measures.map((m) => <option key={m.ad}>{m.ad}</option>)}</select></label>
        <label>Birim<input aria-label={`Parametre birimi ${i + 1}`} maxLength={40} value={p.unit} onChange={(e) => changeParameter(i, { unit: e.target.value })} /></label>
        {([ ["minimum", "Minimum"], ["maximum", "Maksimum"], ["step", "Adım"], ["defaultValue", "Başlangıç"] ] as const).map(([key, label]) => <label key={key}>{label}<input aria-label={`${label} ${i + 1}`} type="number" step="any" value={p[key]} onChange={(e) => changeParameter(i, { [key]: e.target.value })} /></label>)}
        {draft.parameters.length > 1 && <button type="button" onClick={() => setDraft({ ...draft, parameters: draft.parameters.filter((_, n) => n !== i) })}>Parametreyi kaldır</button>}
      </fieldset>)}<button type="button" disabled={draft.parameters.length >= 12} onClick={() => { let n = 1; while (draft.parameters.some((p) => p.id === `p${n}`)) n++; setDraft({ ...draft, parameters: [...draft.parameters, parameter(n)] }); }}>Parametre ekle</button>
      {draft.outputs.map((o, i) => <fieldset key={i}><legend>Çıktı {i + 1}</legend><label>FDX ölçüsü<select aria-label={`Çıktı ölçüsü ${i + 1}`} value={o.measure} onChange={(e) => setDraft({ ...draft, outputs: draft.outputs.map((item, n) => n === i ? { ...item, measure: e.target.value, label: item.label || e.target.value } : item) })}><option value="">Ölçü seçin</option>{measures.map((m) => <option key={m.ad}>{m.ad}</option>)}</select></label>
        <label>Görünen ad<input aria-label={`Çıktı adı ${i + 1}`} maxLength={160} value={o.label} onChange={(e) => setDraft({ ...draft, outputs: draft.outputs.map((item, n) => n === i ? { ...item, label: e.target.value } : item) })} /></label>
        <label>Birim<input aria-label={`Çıktı birimi ${i + 1}`} maxLength={40} value={o.unit} onChange={(e) => setDraft({ ...draft, outputs: draft.outputs.map((item, n) => n === i ? { ...item, unit: e.target.value } : item) })} /></label>
        {draft.outputs.length > 1 && <button type="button" onClick={() => setDraft({ ...draft, outputs: draft.outputs.filter((_, n) => n !== i) })}>Çıktıyı kaldır</button>}</fieldset>)}
      <button type="button" disabled={draft.outputs.length >= 12} onClick={() => setDraft({ ...draft, outputs: [...draft.outputs, { measure: "", label: "", unit: "" }] })}>Çıktı ekle</button>
      <label className="scenario-check"><input type="checkbox" aria-label="Senaryo öneri akışı" checked={draft.proposalEnabled} onChange={(e) => setDraft({ ...draft, proposalEnabled: e.target.checked })} />Uygulama içi öneri akışı</label>
      {draft.proposalEnabled && <fieldset><legend>Öneri oluşturabilecek roller</legend>{(Object.keys(roleNames) as WorkspaceRole[]).map((role) => <label className="scenario-check" key={role}><input type="checkbox" aria-label={`Öneri yetkisi: ${roleNames[role]}`} checked={draft.submitRoles.includes(role)} onChange={(e) => setDraft({ ...draft, submitRoles: e.target.checked ? [...draft.submitRoles, role] : draft.submitRoles.filter((r) => r !== role) })} />{roleNames[role]}</label>)}<p>Onay/ret yetkisi çalışma alanı Yöneticisi ve Üyesindedir. Kaynak sisteme yazma içermez.</p></fieldset>}
      <button type="submit">{editing ? "Senaryoyu güncelle" : "Senaryoyu kaydet"}</button>{editing && <button type="button" onClick={() => { setDraft(blank()); setEditing(""); setMessage(""); }}>Vazgeç</button>}
    </form>{message && <p role="alert">{message}</p>}
  </details>;
}
