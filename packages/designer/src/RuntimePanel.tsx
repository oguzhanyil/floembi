import type { BindingSource, BindingTarget, ComponentDefinition, DataBinding, DataScalar, DesignState, ModelTable, ReportPage, StateAppearance, ValueRef, Visual } from "@floem/client";
import { useEffect, useState } from "react";
import { DATA_ICONS } from "../../report/src/dataBindings";
import { bindingChoices, defaultBindings, latestDefinitions } from "./components";

const targets: Record<BindingTarget, string> = { text: "Metin", value: "Değer", backgroundColor: "Zemin rengi", color: "Yazı/simge rengi", icon: "Simge", visible: "Görünürlük" };
const states: Record<DesignState, string> = { normal: "Normal", hover: "Üzerine gelme / odak", selected: "Seçili", loading: "Yükleniyor", empty: "Boş veri", error: "Hata" };
const operators = { eq: "Eşit", ne: "Eşit değil", gt: "Büyük", ge: "Büyük/eşit", lt: "Küçük", le: "Küçük/eşit", blank: "Boş", notBlank: "Dolu" };
const numeric = (text: string): DataScalar => text.trim() && Number.isFinite(Number(text)) ? Number(text) : text;

export function SourcePicker({ source, tables, onChange }: { source: BindingSource; tables: ModelTable[]; onChange: (s: BindingSource) => void }) {
  const fields = tables.flatMap((t) => t.sutunlar.map((c) => ({ label: `${t.ad}[${c.ad}]`, field: { table: t.ad, column: c.ad }, numeric: ["int32", "int64", "decimal", "double"].includes(c.tip) })));
  const values = [...tables.flatMap((t) => t.olculer.map((m) => ({ label: `[${m.ad}]`, ref: { measure: m.ad } as ValueRef }))),
    ...fields.map((f) => ({ label: f.label, ref: { ...f.field, agg: f.numeric ? "sum" as const : "count" as const } }))];
  const options: { label: string; source: BindingSource }[] = source.kind === "field" ? fields.map((f) => ({ label: f.label, source: { kind: "field" as const, field: f.field } })) : source.kind === "value" ? values.map((v) => ({ label: v.label, source: { kind: "value" as const, value: v.ref } })) : [
    ...fields.map((f) => ({ label: f.label, source: { kind: "row" as const, field: f.field } })), ...values.map((v) => ({ label: v.label + " · ölçü/değer", source: { kind: "row" as const, value: v.ref } })),
  ];
  const current = JSON.stringify(source.kind === "field" || source.kind === "row" && source.field ? source.field : source.value);
  return <>
    <label>Kaynak türü<select aria-label="Veri bağı kaynak türü" value={source.kind} onChange={(e) => {
      const kind = e.target.value as BindingSource["kind"];
      if (kind === "value" && values[0]) onChange({ kind, value: values[0].ref });
      else if (kind !== "value" && fields[0]) onChange({ kind, field: fields[0].field });
    }}><option value="value">FDX ölçüsü / toplanmış sütun</option><option value="field">Tek alan değeri</option><option value="row">Tekrarlayıcının mevcut satırı</option></select></label>
    <label>Alan / ölçü<select aria-label="Veri bağı alanı" value={current} onChange={(e) => { const next = options.find((o) => JSON.stringify(o.source.field ?? o.source.value) === e.target.value); if (next) onChange(next.source); }}>
      <option value="" disabled>Alan seçin</option>{options.map((o, i) => <option key={i} value={JSON.stringify(o.source.field ?? o.source.value)}>{o.label}</option>)}
    </select></label>
    {source.value && !("measure" in source.value) && <label>Toplama<select aria-label="Veri bağı toplaması" value={source.value.agg} onChange={(e) => onChange({ ...source, value: { ...source.value, agg: e.target.value as "sum" } } as BindingSource)}>
      {Object.entries({ sum: "Toplam", avg: "Ortalama", min: "En düşük", max: "En yüksek", count: "Say", distinctcount: "Farklı say" }).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
    </select></label>}
  </>;
}
function Output({ target, value, onChange }: { target: BindingTarget; value?: DataScalar; onChange: (v: DataScalar) => void }) {
  if (target === "visible") return <select aria-label="Kural çıktısı" value={value === true ? "true" : "false"} onChange={(e) => onChange(e.target.value === "true")}><option value="true">Görünür</option><option value="false">Gizli</option></select>;
  if (target === "icon") return <select aria-label="Kural çıktısı" value={String(value ?? "arrow")} onChange={(e) => onChange(e.target.value)}>{DATA_ICONS.map((icon) => <option key={icon} value={icon}>{icon}</option>)}</select>;
  if (target === "color" || target === "backgroundColor") return <input aria-label="Kural çıktısı" type="color" value={typeof value === "string" && /^#[a-f\d]{6}$/i.test(value) ? value : "#0866e8"} onChange={(e) => onChange(e.target.value)} />;
  return <input aria-label="Kural çıktısı" type="text" value={String(value ?? "")} onChange={(e) => onChange(target === "value" ? numeric(e.target.value) : e.target.value)} />;
}

export function RuntimePanel({ visual, tables, components = [], pages, page, onChange }: { visual: Visual; tables: ModelTable[]; components?: ComponentDefinition[]; pages: ReportPage[]; page: ReportPage; onChange: (v: Visual) => void }) {
  const [target, setTarget] = useState<BindingTarget>("text"), [state, setState] = useState<DesignState>("normal"), [preview, setPreview] = useState("actual");
  useEffect(() => () => { window.dispatchEvent(new CustomEvent("floem-preview-state", { detail: { id: visual.id, state: "actual" } })); }, [visual.id]);
  const setBinding = (key: BindingTarget, patch?: Partial<DataBinding>) => {
    const bindings = { ...visual.bindings };
    if (!patch) delete bindings[key]; else bindings[key] = { ...bindings[key], ...patch } as DataBinding;
    onChange({ ...visual, bindings });
  };
  const available = (Object.keys(targets) as BindingTarget[]).filter((t) => t === "value" ? ["text", "card", "ticker"].includes(visual.type) : t === "text" ? ["text", "shape", "button", "card", "ticker"].includes(visual.type) : t === "icon" ? ["icon", "button"].includes(visual.type) : true);
  useEffect(() => { if (!available.includes(target)) setTarget(available[0]); }, [visual.type]);
  const firstValue = tables.flatMap((t) => t.olculer)[0];
  const firstField = tables.flatMap((t) => t.sutunlar.map((c) => ({ table: t.ad, column: c.ad })))[0];
  const source: BindingSource | undefined = firstValue ? { kind: "value", value: { measure: firstValue.ad } } : firstField ? { kind: "field", field: firstField } : undefined;
  const setAppearance = (patch?: Partial<StateAppearance>) => { const next = { ...visual.states }; if (!patch) delete next[state]; else next[state] = { ...next[state], ...patch }; onChange({ ...visual, states: next }); };
  return <>
    <details className="runtime-panel" open><summary>Veri bağları</summary>
      <p className="hint">Bağlar rapor ve erişim filtrelerini kullanır. Tek alan birden fazla değer döndürürse hata gösterilir. Satır kaynağı tekrarlayıcı şablonları içindir.</p>
      <label>Bağlanacak özellik<select aria-label="Bağlanacak özellik" value={target} onChange={(e) => setTarget(e.target.value as BindingTarget)}>{available.map((t) => <option key={t} value={t}>{targets[t]}</option>)}</select></label>
      <button type="button" disabled={!source || !!visual.bindings?.[target]} onClick={() => {
        if (!source) return;
        const output = target === "visible" ? true : target === "icon" ? "check" : target === "backgroundColor" || target === "color" ? "#16a34a" : undefined;
        setBinding(target, { source, ...(output !== undefined ? { rules: [{ op: "gt", value: 0, output }], fallback: target === "visible" ? false : target === "icon" ? "warning" : "#dc2626" } : {}) });
      }}>+ Veri bağı ekle</button>
      {Object.entries(visual.bindings ?? {}).map(([key, binding]) => binding && <details className="runtime-binding" key={key} open data-binding-target={key}><summary>{targets[key as BindingTarget]}</summary>
        <SourcePicker source={binding.source} tables={tables} onChange={(source) => setBinding(key as BindingTarget, { source })} />
        {(key === "text" || key === "value") && <label>Değer şablonu<input aria-label="Bağ metin şablonu" value={binding.template ?? ""} placeholder="Bakiye: {value}" onChange={(e) => setBinding(key as BindingTarget, { template: e.target.value || undefined })} /></label>}
        {(binding.rules ?? []).map((rule, i) => <div className="runtime-rule" key={i}>
          <label>Koşul<select value={rule.op} onChange={(e) => setBinding(key as BindingTarget, { rules: binding.rules!.map((r, n) => n === i ? { ...r, op: e.target.value as typeof rule.op } : r) })}>{Object.entries(operators).map(([k, text]) => <option key={k} value={k}>{text}</option>)}</select></label>
          {!['blank','notBlank'].includes(rule.op) && <><label>Karşılaştırma türü<select aria-label="Karşılaştırma türü" value={typeof rule.value} onChange={(e) => setBinding(key as BindingTarget, { rules: binding.rules!.map((r,n) => n === i ? { ...r, value: e.target.value === "number" ? 0 : e.target.value === "boolean" ? true : "" } : r) })}><option value="number">Sayı</option><option value="string">Metin</option><option value="boolean">Doğru / yanlış</option></select></label><label>Karşılaştırılacak değer{typeof rule.value === "boolean" ? <select value={String(rule.value)} onChange={(e) => setBinding(key as BindingTarget, { rules: binding.rules!.map((r,n) => n === i ? { ...r, value: e.target.value === "true" } : r) })}><option value="true">Doğru</option><option value="false">Yanlış</option></select> : <input type={typeof rule.value === "number" ? "number" : "text"} value={String(rule.value ?? "")} onChange={(e) => { const value = typeof rule.value === "number" ? Number(e.target.value) : e.target.value; if (typeof value !== "number" || Number.isFinite(value)) setBinding(key as BindingTarget, { rules: binding.rules!.map((r,n) => n === i ? { ...r, value } : r) }); }} />}</label></>}
          <label>Sonuç<Output target={key as BindingTarget} value={rule.output} onChange={(output) => setBinding(key as BindingTarget, { rules: binding.rules!.map((r,n)=>n===i?{...r,output}:r) })} /></label>
          <button type="button" onClick={() => setBinding(key as BindingTarget, { rules: binding.rules!.filter((_,n)=>n!==i) })}>Koşulu kaldır</button>
        </div>)}
        <button type="button" disabled={(binding.rules?.length ?? 0) >= 32} onClick={() => setBinding(key as BindingTarget, { rules: [...(binding.rules ?? []), { op: "gt", value: 0, output: key === "visible" ? true : key === "icon" ? "check" : key === "color" || key === "backgroundColor" ? "#16a34a" : "" }] })}>+ Koşul ekle</button>
        <label>Boş / eşleşmeyen değer<Output target={key as BindingTarget} value={binding.fallback} onChange={(fallback) => setBinding(key as BindingTarget, { fallback })} /></label>
        <button type="button" onClick={() => setBinding(key as BindingTarget)}>Veri bağını kaldır</button>
      </details>)}
    </details>
    <details className="runtime-panel"><summary>Nesne durumları</summary>
      <label>Düzenlenecek durum<select aria-label="Düzenlenecek nesne durumu" value={state} onChange={(e) => setState(e.target.value as DesignState)}>{Object.entries(states).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>Durum metni<input aria-label="Nesne durum metni" value={visual.states?.[state]?.text ?? ""} onChange={(e) => setAppearance({ text:e.target.value })} /></label>
      {(["backgroundColor","color","borderColor"] as const).map((key) => <label key={key}>{key === "backgroundColor" ? "Zemin" : key === "color" ? "Yazı" : "Kenar"}<input type="color" value={visual.states?.[state]?.[key] ?? "#0866e8"} onChange={(e) => setAppearance({[key]:e.target.value})}/></label>)}
      <label>Simge<select value={visual.states?.[state]?.icon ?? "none"} onChange={(e)=>setAppearance({icon:e.target.value as StateAppearance['icon']})}>{DATA_ICONS.map((i)=><option key={i}>{i}</option>)}</select></label>
      <label>Opaklık<input type="range" min={0} max={100} value={(visual.states?.[state]?.opacity ?? 1)*100} onChange={(e)=>setAppearance({opacity:Number(e.target.value)/100})}/></label>
      <button type="button" onClick={()=>setAppearance()}>Bu durumun özel ayarlarını kaldır</button>
      <label>Tasarımda dene<select aria-label="Nesne durumunu dene" value={preview} onChange={(e)=>{setPreview(e.target.value);window.dispatchEvent(new CustomEvent('floem-preview-state',{detail:{id:visual.id,state:e.target.value}}));}}><option value="actual">Gerçek durum</option>{Object.entries(states).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    </details>
    {visual.type === "repeater" && <RepeaterSettings {...{ visual, tables, components, pages, page, onChange }} />}
    {visual.type === "icon" && <label>Simge<select aria-label="Nesne simgesi" value={visual.format.buttonIcon??"arrow"} onChange={(e)=>onChange({...visual,format:{...visual.format,buttonIcon:e.target.value as StateAppearance['icon']}})}>{DATA_ICONS.map(i=><option key={i}>{i}</option>)}</select></label>}
  </>;
}

function RepeaterSettings({ visual, tables, components, pages, page, onChange }: { visual: Visual; tables: ModelTable[]; components: ComponentDefinition[]; pages: ReportPage[]; page: ReportPage; onChange: (v: Visual) => void }) {
  const [draft, setDraft] = useState<Visual["repeater"]>();
  const config = draft ?? visual.repeater;
  const definition = components.find((d) => d.id === config?.definitionId && d.version === config.version);
  const eligible = components.filter((d) => d.visuals.every((v) => ["container", "text", "card", "ticker", "shape", "image", "button", "icon"].includes(v.type) && Object.values(v.bindings ?? {}).every((b) => b?.source.kind === "row")));
  const choices = latestDefinitions(eligible);
  if (definition && !choices.some((d) => d.id === definition.id && d.version === definition.version)) choices.push(definition);
  const change = (next: NonNullable<Visual["repeater"]>) => draft ? setDraft(next) : onChange({ ...visual, repeater: next });
  const complete = !!definition && definition.slots.every((s) => config?.bindings[s.id]);
  return <details className="runtime-panel" open><summary>Satır tekrarlayıcı</summary>
    <p className="hint">Kapsayıcı tasarımını bileşen kitaplığına kaydedin. Şablon bağlarının kaynağı “mevcut satır” olmalı. Her gruplama birleşimi bir karttır. Şablonda kullanılan alanları Satırlar, ölçüleri Değerler kutusuna da ekleyin.</p>
    <label>Bileşen<select aria-label="Tekrarlayıcı bileşeni" value={config ? `${config.definitionId}:${config.version}` : ""} onChange={(e) => {
      const def = components.find((d) => `${d.id}:${d.version}` === e.target.value);
      if (def) setDraft({ definitionId: def.id, version: def.version, bindings: defaultBindings(def, tables, pages, page), itemHeight: config?.itemHeight ?? 180, actionSourceIndex: 0 });
    }}><option value="">Bileşen seçin</option>{choices.map((d) => <option key={`${d.id}:${d.version}`} value={`${d.id}:${d.version}`}>{d.name} · v{d.version}</option>)}</select></label>
    {!eligible.length && <p className="hint">Uygun bileşen yok. Grafik/tablo içermeyen ve satır bağları kullanan bir tasarım kaydedin.</p>}
    {config && <>
      <label>Kart yüksekliği<input aria-label="Tekrarlayıcı kart yüksekliği" type="number" min={64} max={1200} value={config.itemHeight} onChange={(e) => { const n = e.currentTarget.valueAsNumber; if (n>=64 && n<=1200) change({ ...config, itemHeight: n }); }} /></label>
      <label>Eyleme taşınan alan<select value={config.actionSourceIndex ?? 0} onChange={(e) => change({ ...config, actionSourceIndex: Number(e.target.value) })}>{[...visual.group.map((g) => g.column), ...visual.values.map((v) => 'measure' in v ? v.measure : v.column)].map((name,i) => <option key={i} value={i}>{name}</option>)}</select></label>
      {definition?.slots.map((slot) => <label key={slot.id}>{slot.label}<select aria-label={`Satır bileşeni ${slot.label}`} value={JSON.stringify(config.bindings[slot.id] ?? {})} onChange={(e) => change({ ...config, bindings: { ...config.bindings, [slot.id]: JSON.parse(e.target.value) } })}><option value="{}" disabled>Alan eşleyin</option>{bindingChoices(slot,tables,pages,page).map((c,i) => <option key={i} value={JSON.stringify(c.binding)}>{c.label}</option>)}</select></label>)}
      {draft && <><button type="button" disabled={!complete} onClick={() => { onChange({ ...visual, repeater: draft }); setDraft(undefined); }}>Şablon eşlemesini uygula</button><button type="button" onClick={() => setDraft(undefined)}>Vazgeç</button></>}
    </>}
    <label>Sayfa boyutu<select aria-label="Tekrarlayıcı sayfa boyutu" value={visual.format.gridPageSize ?? 100} onChange={(e) => onChange({ ...visual, format: { ...visual.format, gridPageSize: Number(e.target.value) } })}>{[25,50,100,250,500].map((n) => <option key={n}>{n}</option>)}</select></label>
    <label><input type="checkbox" checked={visual.format.gridSearch !== false} onChange={(e) => onChange({ ...visual, format: { ...visual.format, gridSearch: e.target.checked } })} />Satırlarda ara</label>
  </details>;
}
