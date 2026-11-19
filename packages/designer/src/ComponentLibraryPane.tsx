import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ComponentDefinition, ComponentInstance, ComponentLibrary, ComponentLibraryStore, ModelTable, ReportDefinition, ReportPage, Visual } from "@floem/client";
import { bindingChoices, bindingIssues, captureComponent, componentOwner, defaultBindings, insertComponent, latestDefinitions, linkSource, mergeDefinitions, parseComponentFile, updateInstances } from "./components";
import { COMPONENT_PRESETS } from "./componentPresets";
import { BrandLibrary } from "./BrandLibrary";

const emptyLibrary = (): ComponentLibrary => ({ version: 1, revision: 0, components: [] });
const fallbackStore: ComponentLibraryStore = {
  async load() { const raw = localStorage.getItem("floem.components.v1"); if (!raw) return emptyLibrary(); const data = JSON.parse(raw); return { version: 1, revision: data.revision ?? 0, components: parseComponentFile(raw) }; },
  async save(components, revision) {
    const old = await this.load(); if (old.revision !== revision) throw new Error("Kitaplık değişti; listeyi yenileyin.");
    mergeDefinitions(old.components, components);
    const next: ComponentLibrary = { version: 1, revision: revision + 1, components }; const payload = JSON.stringify(next);
    if (new TextEncoder().encode(payload).length > 10 * 1024 * 1024) throw new Error("Kitaplık 10 MB sınırını aşıyor.");
    localStorage.setItem("floem.components.v1", payload); return next;
  },
};
export function downloadDesign(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function LibraryDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="component-dialog" aria-label={title} onCancel={onClose} onClose={onClose} onKeyDown={(e) => e.stopPropagation()}>
    <header><h2>{title}</h2><button type="button" aria-label="Kitaplık penceresini kapat" onClick={onClose}>✕</button></header>{children}
  </dialog>;
}
function BindingForm({ definition, bindings, tables, report, page, onChange }: {
  definition: ComponentDefinition; bindings: ComponentInstance["bindings"]; tables: ModelTable[]; report: ReportDefinition; page: ReportPage;
  onChange: (bindings: ComponentInstance["bindings"], changed: string) => void;
}) {
  return <div className="component-bindings">{definition.slots.map((slot) => {
    const choices = bindingChoices(slot, tables, report.pages, page), binding = bindings[slot.id];
    const index = choices.findIndex((c) => {
      const compare = binding?.table && slot.kind === "value" ? { ...binding, agg: c.binding.agg } : binding;
      return compare && Object.keys(c.binding).length === Object.keys(compare).length && Object.entries(c.binding).every(([k, v]) => compare[k as keyof typeof compare] === v);
    });
    return <div key={slot.id}><label>{slot.label}<small>{({ field: "Alan", value: "Değer / ölçü", measure: "FDX ölçüsü", page: "Sayfa", visual: "Nesne" })[slot.kind]} · {slot.sites.length} kullanım</small>
      <select aria-label={`Bileşen alanı: ${slot.label}`} value={index < 0 ? "" : String(index)} onChange={(e) => onChange({ ...bindings, [slot.id]: choices[Number(e.target.value)].binding }, slot.id)}>
        <option value="" disabled>Eşleme seçin</option>{choices.map((c, i) => <option key={i} value={String(i)}>{c.label}</option>)}
      </select></label>
      {binding?.table && slot.kind === "value" && <label>Toplama<select aria-label={`Bileşen toplaması: ${slot.label}`} value={binding.agg ?? "sum"} onChange={(e) => onChange({ ...bindings, [slot.id]: { ...binding, agg: e.target.value as typeof binding.agg } }, slot.id)}>
        {([ ["sum","Toplam"],["avg","Ortalama"],["min","En küçük"],["max","En büyük"],["count","Say"],["distinctcount","Farklı say"] ]).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>}
    </div>;
  })}</div>;
}

export function ComponentLibraryPane({ report, page, selection, resolved, tables, store = fallbackStore, onChange, onSelect, onImage }: {
  report: ReportDefinition; page: ReportPage; selection: string[]; resolved: Visual[]; tables: ModelTable[]; store?: ComponentLibraryStore;
  onChange: (report: ReportDefinition) => void; onSelect: (ids: string[]) => void;
  onImage: (data: string, width: number, height: number, title: string) => void;
}) {
  const [library, setLibrary] = useState<ComponentLibrary>(emptyLibrary), [notice, setNotice] = useState(""), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [active, setActive] = useState(""), [search, setSearch] = useState("");
  const [draft, setDraft] = useState<ComponentDefinition | null>(null), [using, setUsing] = useState<ComponentDefinition | null>(null);
  const [bindings, setBindings] = useState<ComponentInstance["bindings"]>({}), [updating, setUpdating] = useState<ComponentDefinition | null>(null), [all, setAll] = useState(false), [brand, setBrand] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const selected = selection.length === 1 ? componentOwner(page, selection[0]) ?? page.visuals.find((v) => v.id === selection[0]) : undefined;
  const linked = selected?.component;
  const catalog = useMemo(() => [...new Map([...COMPONENT_PRESETS, ...library.components, ...(report.components ?? [])].map((c) => [`${c.id}:${c.version}`, c])).values()], [library.components, report.components]);
  const items = latestDefinitions(catalog), chosen = items.find((c) => c.id === active) ?? items[0];
  const own = linked && catalog.find((c) => c.id === linked.definitionId && c.version === linked.version);
  const latest = linked && items.find((c) => c.id === linked.definitionId);
  useEffect(() => { let live = true; setReady(false); void store.load().then((next) => { if (live) { setLibrary(next); setReady(true); } }).catch((e) => { if (live) setNotice(`Kitaplık yüklenemedi: ${String(e)}`); }); return () => { live = false; }; }, [store]);
  const perform = async (fn: () => Promise<void>) => { setBusy(true); setNotice(""); try { await fn(); } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const persist = async (components: ComponentDefinition[]) => { const next = await store.save(components, library.revision); setLibrary(next); return next; };
  const reload = () => perform(async () => { setLibrary(await store.load()); setReady(true); });
  function prepareDraft(publish: boolean) {
    if (!selected) return;
    try {
      const identity = publish && linked ? { id: linked.definitionId, version: Math.max(...catalog.filter((c) => c.id === linked.definitionId).map((c) => c.version)) + 1 } : { id: crypto.randomUUID(), version: 1 };
      setDraft(captureComponent(page, selected.id, own?.name ?? selected.title ?? "Yeni bileşen", own?.description ?? "", identity, publish ? own || undefined : undefined, resolved));
    } catch (e) { setNotice(String(e)); }
  }
  function startUsing(def: ComponentDefinition) { setBindings(defaultBindings(def, tables, report.pages, page)); setUsing(def); setNotice(""); }
  function startUpdate(def: ComponentDefinition) { setBindings({}); setAll(false); setUpdating(def); setNotice(""); }
  const uses = (id: string) => report.pages.flatMap((p) => p.visuals.filter((v) => v.component?.definitionId === id).map((v) => ({ page: p.name, visual: v })));
  const targets = updating ? uses(updating.id).filter((use) => all || use.visual.id === selected?.id) : [];
  let preview: ReturnType<typeof updateInstances> | null = null, previewError = "";
  if (updating) { try { preview = updateInstances(report, updating, targets.map((t) => t.visual.id), tables, bindings); } catch (e) { previewError = e instanceof Error ? e.message : String(e); } }
  const missingSlots = updating ? updating.slots.filter((s) => targets.some((t) => bindingIssues({ ...updating, slots: [s] }, { [s.id]: bindings[s.id] ?? t.visual.component!.bindings[s.id] ?? s.defaultBinding! }, tables, report.pages, page).length)) : [];
  return <details className="component-library" open={undefined}>
    <summary>Bileşen kitaplığı <small>{items.length}</small></summary>
    <p>Bir tasarımı kaydedin; başka sayfa ve raporlarda alanlarını eşleyerek kullanın.</p>
    <div className="component-tools">
      <button type="button" disabled={!selected || !ready || busy} onClick={() => prepareDraft(false)}>Seçimi kitaplığa kaydet</button>
      <button type="button" onClick={() => setBrand(true)}>Marka ve ikonlar</button>
    </div>
    {linked && <div className="component-linked"><strong>{own?.name ?? "Bileşen"} · v{linked.version}</strong>
      <span>Bu raporda {uses(linked.definitionId).length} kullanım</span>
      <div className="component-tools">
        <button type="button" disabled={busy || !ready} onClick={() => prepareDraft(true)}>Yeni sürüm hazırla</button>
        <button type="button" disabled={!own} onClick={() => own && startUpdate(own)}>Alanları yeniden eşle</button>
        <button type="button" onClick={() => onChange({ ...report, pages: report.pages.map((p) => ({ ...p, visuals: p.visuals.map((v) => { if (v.id !== selected!.id) return v; const node = { ...v }; delete node.component; return node; }) })) })}>Bağı kopar</button>
      </div>
      {latest && latest.version > linked.version && <button type="button" onClick={() => startUpdate(latest)}>v{latest.version} güncellemesini incele</button>}
    </div>}
    <label>Kitaplıkta ara<input aria-label="Bileşen kitaplığında ara" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
    <div className="component-list" role="listbox" aria-label="Kayıtlı bileşenler">{items.filter((c) => `${c.name} ${c.description}`.toLocaleLowerCase("tr").includes(search.toLocaleLowerCase("tr"))).map((c) => <button type="button" role="option" aria-selected={chosen?.id === c.id} key={c.id} onClick={() => setActive(c.id)}><strong>{c.name}</strong><small>v{c.version} · {c.visuals.length} nesne · {c.slots.length} yuva</small></button>)}</div>
    {chosen && <div className="component-chosen"><p>{chosen.description}</p><div className="component-tools">
      <button type="button" onClick={() => startUsing(chosen)}>Sayfaya ekle</button>
      <button type="button" onClick={() => downloadDesign(new Blob([JSON.stringify({ version: 1, components: catalog.filter((c) => c.id === chosen.id) }, null, 2)], { type: "application/json" }), "floem-bilesen.json")}>JSON indir</button>
      <button type="button" disabled={busy || !ready || library.components.some((c) => c.id === chosen.id && c.version === chosen.version)} onClick={() => void perform(async () => { await persist(mergeDefinitions(library.components, [chosen])); setNotice("Bileşen yerel kitaplığa alındı."); })}>Yerel kitaplığa al</button>
      {library.components.some((c) => c.id === chosen.id) && <button type="button" disabled={busy || !ready} onClick={() => void perform(async () => { await persist(library.components.filter((c) => c.id !== chosen.id)); setNotice("Yerel kopya kaldırıldı. Rapor içindeki kullanımlar korunur."); })}>Yerelden kaldır</button>}
    </div></div>}
    <div className="component-tools"><button type="button" disabled={!ready || busy} onClick={() => importRef.current?.click()}>JSON içe aktar</button><button type="button" disabled={busy} onClick={() => void reload()}>Listeyi yenile</button></div>
    <input ref={importRef} type="file" accept="application/json,.json" hidden aria-label="Bileşen JSON dosyası" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void perform(async () => { if (file.size > 10 * 1024 * 1024) throw new Error("Dosya 10 MB sınırını aşıyor."); const defs = parseComponentFile(await file.text()); await persist(mergeDefinitions(library.components, defs)); setNotice(`${defs.length} bileşen sürümü içe aktarıldı.`); }); }} />
    {notice && <p role="status" className="component-notice">{notice}</p>}
    {draft && <LibraryDialog title="Bileşen sürümünü kaydet" onClose={() => !busy && setDraft(null)}>
      <label>Bileşen adı<input aria-label="Bileşen adı" maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label>Açıklama<textarea aria-label="Bileşen açıklaması" maxLength={1000} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
      <p>v{draft.version} · {draft.visuals.length} nesne · Tema değerleri miras alınır; nesneye özel biçimler korunur.</p>
      <h3>Alan yuvaları</h3>{draft.slots.length ? draft.slots.map((s, i) => <label key={s.id}>Yuva adı · {s.sites.length} kullanım<input aria-label={`Yuva adı ${i+1}`} maxLength={120} value={s.label} onChange={(e) => setDraft({ ...draft, slots: draft.slots.map((slot) => slot.id === s.id ? { ...slot, label: e.target.value } : slot) })} /></label>) : <p>Bu tasarımın alan eşlemesi gerekmiyor.</p>}
      <p>{uses(draft.id).length} mevcut kullanım var. Bu seçim yeni sürüme bağlanır; diğer kullanımlar güncellemeyi siz uyguladığınızda değişir.</p>
      {notice && <p role="alert">{notice}</p>}
      <footer><button type="button" disabled={busy} onClick={() => setDraft(null)}>Vazgeç</button><button type="button" disabled={busy || !draft.name.trim() || draft.slots.some((s) => !s.label.trim())} onClick={() => void perform(async () => {
        parseComponentFile(JSON.stringify({ version: 1, components: [draft] }));
        const next = linkSource(report, page.id, selected!.id, draft);
        await persist(mergeDefinitions(library.components, [draft])); onChange(next); setActive(draft.id); setDraft(null); setNotice(`“${draft.name}” v${draft.version} kaydedildi.`);
      })}>Sürümü kaydet</button></footer>
    </LibraryDialog>}
    {using && <LibraryDialog title="Bileşeni sayfaya ekle" onClose={() => setUsing(null)}>
      <h3>{using.name} · v{using.version}</h3><p>Alan eşlemelerini bu raporun modelinden seçin.</p>
      <BindingForm definition={using} bindings={bindings} onChange={setBindings} tables={tables} report={report} page={page} />
      {bindingIssues(using, bindings, tables, report.pages, page).map((issue) => <p key={issue} className="component-warning">{issue}</p>)}
      <footer><button type="button" onClick={() => setUsing(null)}>Vazgeç</button><button type="button" disabled={!!bindingIssues(using, bindings, tables, report.pages, page).length} onClick={() => {
        try { const result = insertComponent(report, page.id, using, bindings, tables, 48, 48); onChange(result.report); onSelect([result.rootId]); setUsing(null); } catch (e) { setNotice(String(e)); }
      }}>Bileşeni ekle</button></footer>
    </LibraryDialog>}
    {updating && <LibraryDialog title="Bileşen güncellemesini incele" onClose={() => setUpdating(null)}>
      <h3>{updating.name} · v{updating.version}</h3>
      <label className="inline"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Bu rapordaki tüm kullanımlara uygula</label>
      <ul>{targets.map((t) => <li key={t.visual.id}>{t.page} · {t.visual.title || t.visual.id} · v{t.visual.component!.version} → v{updating.version}</li>)}</ul>
      <p>{targets.length} kullanım etkilenecek. Konumlar, alan eşlemeleri ve yerel olarak değiştirdiğiniz özellikler korunur.</p>
      <BindingForm definition={{ ...updating, slots: updating.version === linked?.version ? updating.slots : missingSlots }} bindings={{ ...linked?.bindings, ...bindings }} onChange={(next, key) => setBindings((old) => ({ ...old, [key]: next[key] }))} tables={tables} report={report} page={page} />
      {previewError ? <p role="alert">{previewError}</p> : <p>{preview?.localProperties ?? 0} özelleştirilmiş nesnenin yerel ayarları korunacak.</p>}
      <footer><button type="button" onClick={() => setUpdating(null)}>Vazgeç</button><button type="button" disabled={!preview || !targets.length} onClick={() => { if (preview) { onChange(preview.report); setUpdating(null); setNotice(`${preview.changed} kullanım güncellendi.`); } }}>Güncellemeyi uygula</button></footer>
    </LibraryDialog>}
    {brand && <BrandLibrary onClose={() => setBrand(false)} onInsert={(...args) => { onImage(...args); setBrand(false); }} />}
  </details>;
}
