import { defaultPrintTemplate, detailLabels, type DetailColumn, type FormKind, type PrintRecord, type PrintTemplate } from "@floem/client";
import { createPrintFormPdf } from "@floem/report";
import { useEffect, useMemo, useState } from "react";
import { useClient } from "../api";
import { useDocument } from "../document";
import "./printDesigner.css";

const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const labels = Object.keys(detailLabels) as DetailColumn[];
const money = (v: number) => v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function useLoad<T>(load: () => Promise<T>) {
  const [result, setResult] = useState<{ load: typeof load; value?: T; error?: string }>();
  useEffect(() => {
    let active = true;
    load().then(value => { if (active) setResult({ load, value }); },
      err => { if (active) setResult({ load, error: message(err) }); });
    return () => { active = false; };
  }, [load]);
  return result?.load === load ? result : undefined;
}

export function PrintDesigner() {
  const { doc } = useDocument();
  const [kind, setKind] = useState<FormKind>(() =>
    doc?.documentTemplates?.[0]?.kind ?? (doc?.model.tablolar.some(t => t.ad.toUpperCase() === "OQUT") &&
      !doc?.model.tablolar.some(t => t.ad.toUpperCase() === "OINV") ? "quote" : "invoice"));
  return <section className="print-studio" aria-label="Belge Tasarımcısı">
    <header className="print-top"><h2>Belge Tasarımcısı</h2>
      <div className="print-tabs" aria-label="Şablon türü">
        {(["invoice", "quote"] as const).map(k => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
          {k === "invoice" ? "Fatura" : "Teklif"}</button>)}
      </div>
    </header>
    {doc && <FormEditor key={doc.id + kind} kind={kind} />}
  </section>;
}

function FormEditor({ kind }: { kind: FormKind }) {
  const client = useClient();
  const { doc: document, editPrintTemplate } = useDocument();
  const doc = document!;
  const defaultTemplate = useMemo(() => defaultPrintTemplate(kind), [kind]);
  const template = doc.documentTemplates?.find(t => t.kind === kind) ?? defaultTemplate;
  const edit = (change: Partial<PrintTemplate>) => editPrintTemplate(doc.id, kind, change);
  const [mode, setMode] = useState<"design" | "preview">("design");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(template.sampleKey);
  const [imageError, setImageError] = useState("");
  const [drag, setDrag] = useState<DetailColumn | null>(null);
  const { id, revision } = doc;
  const choices = useLoad(useMemo(() => () => client.printChoices(id, kind, search.trim()), [client, id, kind, search, revision]));
  useEffect(() => {
    if (!selected && choices?.value?.items.length) setSelected(choices.value.items[0].key);
  }, [choices, selected]);
  const record = useLoad(useMemo(() => () => selected ? client.printRecord(id, kind, selected) : Promise.resolve(null), [client, id, kind, selected, revision]));
  const data = record?.value;
  const [pdf, setPdf] = useState<{ template: PrintTemplate; data: PrintRecord; url?: string; error?: string }>();
  useEffect(() => {
    if (mode !== "preview" || !data) return;
    let active = true;
    let url: string | undefined;
    const timer = window.setTimeout(() => { createPrintFormPdf(template, data).then(blob => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setPdf({ template, data, url });
    }).catch(err => { if (active) setPdf({ template, data, error: message(err) }); }); }, 180);
    return () => { active = false; window.clearTimeout(timer); if (url) URL.revokeObjectURL(url); setPdf(undefined); };
  }, [template, data, mode]);
  const currentPdf = mode === "preview" && pdf?.template === template && pdf.data === data ? pdf : undefined;
  const move = (column: DetailColumn, target: DetailColumn) => {
    const ordered = [...template.columns];
    ordered.splice(ordered.indexOf(column), 1);
    ordered.splice(template.columns.indexOf(target), 0, column);
    edit({ columns: ordered });
  };
  const choose = (key: string) => { setSelected(key); edit({ sampleKey: key }); };
  const problem = choices?.error || record?.error || currentPdf?.error || imageError;
  return <div className="print-body">
    <aside className="print-settings">
      <fieldset><legend>Örnek belge</legend>
        <label>Belge numarası ara<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={kind === "invoice" ? "Fatura numarası" : "Teklif numarası"} /></label>
        <label>Belge<select value={selected} onChange={e => choose(e.target.value)}>
          {!selected && <option value="">Belge seçin</option>}
          {selected && !choices?.value?.items.some(x => x.key === selected) && <option value={selected}>{data?.header.DocNum ?? selected}</option>}
          {choices?.value?.items.map(x => <option key={x.key} value={x.key}>{x.number}</option>)}
        </select></label>
        {choices?.value?.more && <small>İlk 100 belge listelendi. Diğerleri için numara arayın.</small>}
        {choices?.value && !choices.value.items.length && <small>Eşleşen belge bulunamadı.</small>}
      </fieldset>
      <fieldset><legend>Başlık ve antet</legend>
        <label>Belge başlığı<input value={template.title} maxLength={100} onChange={e => edit({ title: e.target.value })} onBlur={() => { if (!template.title.trim()) edit({ title: defaultTemplate.title }); }} /></label>
        <label>Firma adı<input value={template.issuer} maxLength={160} onChange={e => edit({ issuer: e.target.value })} /></label>
        <label>Vurgu rengi<input type="color" value={template.accent} onChange={e => edit({ accent: e.target.value })} /></label>
        <label>Logo<input type="file" accept="image/png,image/jpeg" onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
          try {
            if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 1_000_000) throw Error("En fazla 1 MB boyutunda bir PNG veya JPEG seçin.");
            const reader = new FileReader();
            const src = await new Promise<string>((resolve, reject) => { reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(Error("Logo okunamadı.")); reader.readAsDataURL(file); });
            const test = new Image(); test.src = src; await test.decode();
            edit({ logo: src }); setImageError("");
          } catch (e) { setImageError(message(e)); }
        }} /></label>
        {template.logo && <button onClick={() => edit({ logo: "" })}>Logoyu kaldır</button>}
      </fieldset>
      <fieldset><legend>Kalemler ve gruplama</legend>
        <label>Grupla<select value={template.groupBy} onChange={e => edit({ groupBy: e.target.value as PrintTemplate["groupBy"] })}>
          <option value="WhsCode">Depo</option><option value="ItemCode">Ürün kodu</option><option value="none">Gruplama yok</option>
        </select></label>
        <label className="print-check"><input type="checkbox" checked={template.subtotals} disabled={template.groupBy === "none"} onChange={e => edit({ subtotals: e.target.checked })} />Grup ara toplamlarını göster</label>
        {[...template.columns, ...labels.filter(c => !template.columns.includes(c))].map((c, i) => {
          const shown = template.columns.includes(c);
          return <div key={c} className="print-field" draggable={shown} onDragStart={() => setDrag(c)} onDragEnd={() => setDrag(null)}
            onDragOver={e => { if (shown) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (drag && shown) move(drag, c); setDrag(null); }}>
            <label className="print-check"><input type="checkbox" checked={shown} disabled={shown && template.columns.length === 1}
              onChange={() => edit({ columns: shown ? template.columns.filter(k => k !== c) : [...template.columns, c] })} />{detailLabels[c]}</label>
            {shown && <span><button disabled={!i} aria-label={detailLabels[c] + " sola"} onClick={() => move(c, template.columns[i - 1])}>←</button>
              <button disabled={i === template.columns.length - 1} aria-label={detailLabels[c] + " sağa"} onClick={() => move(c, template.columns[i + 1])}>→</button></span>}
          </div>;
        })}
      </fieldset>
      <fieldset><legend>Belge alt bilgisi</legend><label>{kind === "quote" ? "Teklif koşulları" : "Belge notu"}<textarea maxLength={2000} rows={3} value={template.note} onChange={e => edit({ note: e.target.value })} /></label></fieldset>
    </aside>
    <section className="print-stage">
      <nav className="print-stage-tools"><div className="print-tabs">
        <button aria-pressed={mode === "design"} onClick={() => setMode("design")}>Tasarım</button>
        <button disabled={!data} aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>A4 önizleme</button>
      </div>
      {data && <span>{data.header.DocNum} · {data.lines.length} kalem</span>}
      {currentPdf?.url && <a className="print-download" href={currentPdf.url} download={String(data?.header.DocNum).replace(/[\\/:*?"<>|]/g, "_") + ".pdf"}>PDF indir</a>}</nav>
      {problem && <p className="print-error" role="alert">{problem}</p>}
      {mode === "preview" && (currentPdf?.url
        ? <iframe className="print-frame" title="A4 belge önizlemesi" src={currentPdf.url} />
        : !problem && <p role="status">A4 sayfaları hazırlanıyor…</p>)}
      {mode === "design" && (data ? <div className="print-paper-scroll"><article className="print-paper" style={{ borderTopColor: template.accent }}>
        <div className="print-band">Belge başlığı</div>
        {template.logo && <img className="print-logo" src={template.logo} alt="Firma logosu" />}
        {template.issuer && <strong>{template.issuer}</strong>}
        <h1 style={{ color: template.accent }}>{template.title}</h1>
        <div className="print-parties"><section><b>{data.header.CardName}</b><div>{data.header.Address}</div></section>
          <section><b>{data.header.DocNum}</b><div>{data.header.DocDate}</div></section></div>
        <div className="print-band">Detay · ilk kalem</div>
        <table><thead style={{ background: template.accent }}><tr>{template.columns.map(c => <th key={c}>{detailLabels[c]}</th>)}</tr></thead>
          <tbody><tr>{template.columns.map(c => <td key={c}>{data.lines[0] ? c === "LineNum" ? data.lines[0].LineNum + 1 : data.lines[0][c] ?? "—" : "—"}</td>)}</tr></tbody></table>
        <div className="print-band">Belge alt bilgisi</div>
        <p className="print-total">Genel toplam <b>{money(data.header.DocTotal)} {data.header.DocCur === "TRY" ? "TL" : data.header.DocCur}</b></p>
        <p>{data.header.Comments}</p><p>{template.note}</p>
      </article></div> : !problem && <p role="status">{selected ? "Belge okunuyor…" : "Önizleme için bir belge seçin."}</p>)}
    </section>
  </div>;
}
