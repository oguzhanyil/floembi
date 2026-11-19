import type { ActionIcon, Agg, FieldRef, ModelTable, ReportPage, ValueRef, Visual, VisualAction, VisualFormat, VisualType } from "@floem/client";
import {
  AGG_LABEL, SERIES, VISUAL_DEFS, VISUAL_GROUPS, safeActionIcon, valueLabel, type WellDef, type WellKey,
} from "@floem/report";
import { useState, type ReactNode } from "react";
import { FIELD_MIME, isMeasure, readPayload, usesField, type FieldPayload } from "./fields";
import { CalcIcon, ColumnTypeIcon, DateTableIcon, TableIcon } from "./icons";
import { VisualTypeIcon } from "./VisualTypeIcon";
import { WELL_MIME, readWellDrag, setWell, wellItems, type WellDrag } from "./wells";

const readField = readPayload;

const isValueWell = (k: WellKey) => k === "values" || k === "target";

function Well({
  def, visual, onDrop, onMove, onChange,
}: {
  def: WellDef;
  visual: Visual;
  onDrop: (well: WellDef, field: FieldPayload) => void;
  onMove: (from: WellDrag, to: WellDef, index: number) => void;
  onChange: (v: Visual) => void;
}) {
  const [over, setOver] = useState(false);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const items = wellItems(visual, def);
  const remove = (i: number) => onChange(setWell(visual, def, items.filter((_, j) => j !== i)));
  const setAgg = (i: number, agg: Agg) =>
    onChange(setWell(visual, def, items.map((x, j) => (j === i && "agg" in x ? { ...x, agg } : x))));

  return (
    <div
      className={`well ${over ? "over" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(FIELD_MIME) && !e.dataTransfer.types.includes(WELL_MIME)) return;
        e.preventDefault();
        setOver(true);
        const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(".well-item")];
        const at = rows.findIndex((row) => e.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2);
        setDropIndex(at < 0 ? rows.length : at);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setOver(false);
        setDropIndex(null);
      }}
      onDrop={(e) => {
        setOver(false);
        const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(".well-item")];
        const before = rows.findIndex((row) => e.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2);
        const at = before < 0 ? rows.length : before;
        setDropIndex(null);
        const from = readWellDrag(e.dataTransfer.getData(WELL_MIME));
        if (from && from.visualId === visual.id) {
          e.preventDefault();
          onMove(from, def, at);
          return;
        }
        const f = readField(e);
        if (f) {
          e.preventDefault();
          onDrop(def, f);
        }
      }}
    >
      <div className="well-label">
        {def.label}
        {def.optional && <span className="well-opt"> (isteğe bağlı)</span>}
      </div>
      {items.length === 0 && <div className="well-empty">Veri alanlarını buraya ekleyin</div>}
      {items.map((it, i) => (
        <div
          key={i}
          className={`well-item ${dropIndex === i ? "drop-before" : ""}`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(WELL_MIME, JSON.stringify({ visualId: visual.id, key: def.key, slot: def.slot, index: i } satisfies WellDrag));
            e.dataTransfer.setData(FIELD_MIME, JSON.stringify("measure" in it ? { measure: it.measure } : { table: it.table, column: it.column }));
            e.dataTransfer.effectAllowed = "move";
          }}
        >
          <span className="well-name" title={"measure" in it ? it.measure : `${it.table}[${it.column}]`}>
            {isValueWell(def.key) ? valueLabel(it as ValueRef) : (it as FieldRef).column}
          </span>
          {isValueWell(def.key) && "agg" in it && (
            <select value={it.agg} onChange={(e) => setAgg(i, e.target.value as Agg)} aria-label="Toplama türü" title="Bu alanın nasıl özetleneceği">
              {(Object.keys(AGG_LABEL) as Agg[]).map((a) => (
                <option key={a} value={a}>
                  {AGG_LABEL[a]}
                </option>
              ))}
            </select>
          )}
          <button className="well-x" onClick={() => remove(i)} aria-label="Kaldır">
            ✕
          </button>
        </div>
      ))}
      {dropIndex === items.length && items.length > 0 && <div className="well-drop-end" aria-hidden="true" />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="well">
      <div className="well-label">{title}</div>
      <div className="fmt-body">{children}</div>
    </div>
  );
}

function AppearancePanel({ visual, onChange }: { visual: Visual; onChange: (v: Visual) => void }) {
  const f = visual.format;
  const set = (patch: Partial<VisualFormat>) => onChange({ ...visual, format: { ...f, ...patch } });
  const color = (value: string | undefined, fallback: string) => /^#[0-9a-f]{6}$/i.test(value ?? "") ? value! : fallback;
  const presets: { label: string; format: Partial<VisualFormat> }[] = [
    { label: "Sade", format: { backgroundColor: "#ffffff", borderColor: "#e4e9f1", borderWidth: 1, radius: 8, shadow: false } },
    { label: "Yumuşak", format: { backgroundColor: "#f4f8ff", borderColor: "#c9dcf6", borderWidth: 1, radius: 16, shadow: true } },
    { label: "Gece", format: { backgroundColor: "#10284c", borderColor: "#27496f", borderWidth: 1, radius: 14, shadow: true, titleColor: "#ffffff" } },
  ];
  return (
    <>
      <Section title="Hazır stiller">
        <div className="fmt-presets">
          {presets.map((preset) => <button key={preset.label} type="button" onClick={() => set(preset.format)}>{preset.label}</button>)}
        </div>
      </Section>
      <Section title="Görünüm">
        <div className="fmt-row">
          <label>Arka plan<input type="color" value={color(f.backgroundColor, "#ffffff")} onChange={(e) => set({ backgroundColor: e.target.value })} /></label>
          <label>Kenarlık<input type="color" value={color(f.borderColor, "#d6e0eb")} onChange={(e) => set({ borderColor: e.target.value })} /></label>
        </div>
        <div className="fmt-row">
          <label>Köşe yarıçapı<input type="number" min="0" max="40" value={f.radius ?? 8} onChange={(e) => set({ radius: Number(e.target.value) })} /></label>
          <label>İç boşluk<input type="number" min="0" max="32" value={f.padding ?? 8} onChange={(e) => set({ padding: Number(e.target.value) })} /></label>
        </div>
        <label className="inline"><input type="checkbox" checked={!!f.shadow} onChange={(e) => set({ shadow: e.target.checked })} /> Gölge</label>
        <label className="inline"><input type="checkbox" checked={!!f.initiallyHidden} onChange={(e) => set({ initiallyHidden: e.target.checked })} /> Başlangıçta gizle</label>
        <label>Başlık rengi<input type="color" value={color(f.titleColor, "#201f1e")} onChange={(e) => set({ titleColor: e.target.value })} /></label>
        <label>Başlık boyutu<input type="number" min="10" max="28" value={f.titleSize ?? 12} onChange={(e) => set({ titleSize: Number(e.target.value) })} /></label>
      </Section>
      <Section title="Hareket">
        <label>Animasyon
          <select value={f.animation ?? (visual.type === "ticker" ? "count" : "none")} onChange={(e) => set({ animation: e.target.value as VisualFormat["animation"] })}>
            <option value="none">Kapalı</option>
            <option value="fade">Yumuşak görün</option>
            <option value="rise">Yukarıdan gel</option>
            <option value="pulse">Hafif vurgu</option>
            {visual.type === "ticker" && <option value="count">Sayıyı canlandır</option>}
          </select>
        </label>
        <label>Süre (ms)<input type="number" min="150" max="3000" step="50" value={f.animationDuration ?? (visual.type === "ticker" ? 800 : 500)} onChange={(e) => set({ animationDuration: Number(e.target.value) })} /></label>
        <p className="hint">Sistem hareket azaltmayı seçtiyse animasyon gösterilmez.</p>
      </Section>
    </>
  );
}

const ACTION_ICONS: { value: ActionIcon; label: string }[] = [
  { value: "none", label: "Yok" }, { value: "arrow", label: "İleri" }, { value: "back", label: "Geri" },
  { value: "refresh", label: "Yenile" }, { value: "eye", label: "Göz" }, { value: "link", label: "Bağlantı" },
  { value: "play", label: "Çalıştır" }, { value: "file", label: "Dosya" }, { value: "menu", label: "Menü" },
];

function ActionOptions({ action, onChange, visual, page, pages, measures, allowMenu = false, row = false }: {
  action: VisualAction; onChange: (action: VisualAction) => void; visual: Visual; page: ReportPage;
  pages: ReportPage[]; measures: string[]; allowMenu?: boolean; row?: boolean;
}) {
  const targets = page.visuals.filter((item) => item.id !== visual.id);
  return <>
    <label>Eylem
      <select value={action.type} onChange={(e) => {
        const type = e.target.value as VisualAction["type"];
        onChange({ type,
          pageId: type === "page" ? pages.find((item) => item.id !== page.id)?.id ?? pages[0]?.id : undefined,
          visualId: type === "toggle" ? targets[0]?.id : undefined,
          functionName: type === "function" ? (row ? "filterByValue" : "refresh") : undefined,
          url: type === "url" ? "" : undefined,
          items: type === "menu" ? [] : undefined });
      }}>
        <option value="none">Yok</option>
        <option value="page">Sayfaya git</option>
        <option value="next">Sonraki sayfa</option>
        <option value="previous">Önceki sayfa</option>
        <option value="reset">Filtreleri sıfırla</option>
        <option value="toggle">Nesneyi göster / gizle</option>
        <option value="url">Web adresini aç</option>
        <option value="function">Fonksiyon çalıştır</option>
        {allowMenu && <option value="menu">Menü aç</option>}
      </select>
    </label>
    {action.type === "page" && <label>Hedef sayfa
      <select value={action.pageId ?? ""} onChange={(e) => onChange({ ...action, pageId: e.target.value })}>
        <option value="">Sayfa seçin</option>
        {pages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>}
    {action.type === "toggle" && <label>Hedef nesne
      <select value={action.visualId ?? ""} onChange={(e) => onChange({ ...action, visualId: e.target.value })}>
        <option value="">Nesne seçin</option>
        {targets.map((item) => <option key={item.id} value={item.id}>{item.title || (typeof item.format.text === "string" ? item.format.text : "") || `${VISUAL_DEFS[item.type].label} · ${item.id}`}</option>)}
      </select>
    </label>}
    {action.type === "url" && <><label>Web adresi
      <input type="text" value={action.url ?? ""} placeholder="https://..." onChange={(e) => onChange({ ...action, url: e.target.value })} />
    </label>{row && <p className="hint">Satır değerini adrese eklemek için <code>{"{value}"}</code> yazın. Değer URL için güvenli biçimde kodlanır.</p>}</>}
    {action.type === "function" && <label>Fonksiyon
      <select value={action.functionName ?? "refresh"} onChange={(e) => onChange({ ...action, functionName: e.target.value as VisualAction["functionName"] })}>
        <option value="refresh">Görünümü yeniden sorgula</option>
        <option value="clearSelection">Seçimi temizle</option>
        {row && <option value="filterByValue">Satır değeriyle filtrele</option>}
        <option value="measure">FDX ölçüsünü hesapla</option>
      </select>
    </label>}
    {action.type === "function" && action.functionName === "measure" && <label>FDX ölçüsü
      <select value={action.measure ?? ""} onChange={(e) => onChange({ ...action, measure: e.target.value })}>
        <option value="">Ölçü seçin</option>
        {measures.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      {!measures.length && <span className="hint">Önce Desktop'ta Yeni ölçü ile FDX ölçüsü oluşturun.</span>}
    </label>}
    {row && action.type === "page" && <p className="hint">Seçilen satır alanı hedef sayfaya filtre değeri olarak taşınır.</p>}
  </>;
}

function ActionPanel({ visual, page, pages, measures, onChange }: {
  visual: Visual; page: ReportPage; pages: ReportPage[]; measures: string[]; onChange: (v: Visual) => void;
}) {
  const action = visual.format.action ?? { type: "none" as const };
  const setAction = (next: VisualAction) => onChange({ ...visual, format: { ...visual.format, action: next } });
  const items = action.items ?? [];
  const updateItem = (index: number, patch: Partial<(typeof items)[number]>) =>
    setAction({ ...action, items: items.map((item, i) => i === index ? { ...item, ...patch } : item) });
  return <Section title="Tıklama olayı">
    <ActionOptions action={action} onChange={setAction} visual={visual} page={page} pages={pages} measures={measures} allowMenu={visual.type === "button"} />
    {action.type === "menu" && <div className="action-menu-editor">
      <div className="well-label">Menü öğeleri</div>
      {items.map((item, index) => <div className="action-menu-item" key={item.id}>
        <div className="action-menu-item-head"><strong>{index + 1}. öğe</strong>
          <div className="action-menu-item-controls">
            <button type="button" aria-label="Menü öğesini yukarı taşı" disabled={index === 0} onClick={() => {
              const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]];
              setAction({ ...action, items: next });
            }}>↑</button>
            <button type="button" aria-label="Menü öğesini aşağı taşı" disabled={index === items.length - 1} onClick={() => {
              const next = [...items]; [next[index + 1], next[index]] = [next[index], next[index + 1]];
              setAction({ ...action, items: next });
            }}>↓</button>
            <button type="button" aria-label="Menü öğesini kaldır" onClick={() => setAction({ ...action, items: items.filter((_, i) => i !== index) })}>✕</button>
          </div>
        </div>
        <label>Yazı<input type="text" value={item.label} onChange={(e) => updateItem(index, { label: e.target.value })} /></label>
        <label>Simge<select value={item.icon ?? "arrow"} onChange={(e) => updateItem(index, { icon: e.target.value as ActionIcon })}>
          {ACTION_ICONS.map((icon) => <option key={icon.value} value={icon.value}>{icon.label}</option>)}
        </select></label>
        <ActionOptions action={item.action} onChange={(next) => updateItem(index, { action: next })}
          visual={visual} page={page} pages={pages} measures={measures} />
      </div>)}
      <button type="button" className="action-add" onClick={() => setAction({ ...action, items: [...items, {
        id: `m${Date.now()}${Math.floor(Math.random() * 1000)}`, label: `Öğe ${items.length + 1}`, icon: "arrow",
        action: { type: "page", pageId: pages.find((item) => item.id !== page.id)?.id ?? pages[0]?.id },
      }] })}>+ Menü öğesi ekle</button>
    </div>}
    <p className="hint">Soldaki etkileşim ikonunu açarak sınayın. Web raporunda tıklama doğrudan çalışır.</p>
  </Section>;
}

function RowActionPanel({ visual, page, pages, measures, onChange }: {
  visual: Visual; page: ReportPage; pages: ReportPage[]; measures: string[]; onChange: (v: Visual) => void;
}) {
  const [iconError, setIconError] = useState<string | null>(null);
  const rowAction = visual.format.rowAction;
  const sources = [...visual.group.map((f) => `${f.table}[${f.column}]`),
    ...(visual.type === "table" || visual.type === "treegrid" ? visual.values.map(valueLabel) : [])];
  const setRowAction = (patch: Partial<NonNullable<VisualFormat["rowAction"]>>) => {
    if (!rowAction) return;
    onChange({ ...visual, format: { ...visual.format, rowAction: { ...rowAction, ...patch } } });
  };
  return <Section title="Satır eylemi (ikonlu öğe)">
    <label className="inline"><input type="checkbox" checked={!!rowAction} onChange={(e) => onChange({ ...visual,
      format: { ...visual.format, rowAction: e.target.checked ? { label: "Aç", icon: "link", sourceIndex: 0,
        action: { type: "url", url: "" } } : undefined } })} /> Her satıra eylem ekle</label>
    {rowAction && <>
      <label>İpucu<input type="text" value={rowAction.label} onChange={(e) => setRowAction({ label: e.target.value })} /></label>
      <label>Simge<select value={rowAction.icon} onChange={(e) => setRowAction({ icon: e.target.value as ActionIcon })}>
        {ACTION_ICONS.map((icon) => <option key={icon.value} value={icon.value}>{icon.label}</option>)}
      </select></label>
      <label>Özel ikon (isteğe bağlı)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 256 * 1024) {
          setIconError("PNG, JPG veya WebP dosyası seçin; en fazla 256 KB.");
          return;
        }
        const reader = new FileReader();
        reader.onload = () => { if (typeof reader.result === "string") { setRowAction({ iconData: reader.result }); setIconError(null); } };
        reader.onerror = () => setIconError("İkon okunamadı.");
        reader.readAsDataURL(file);
      }} /></label>
      {iconError && <p className="hint" role="alert">{iconError}</p>}
      {safeActionIcon(rowAction.iconData) && <div className="row-icon-preview"><img src={safeActionIcon(rowAction.iconData)} alt="Yüklenen ikon" />
        <button type="button" onClick={() => setRowAction({ iconData: undefined })}>Özel ikonu kaldır</button></div>}
      <label>Taşınacak satır alanı<select value={rowAction.sourceIndex} onChange={(e) => setRowAction({ sourceIndex: Number(e.target.value) })}>
        {sources.map((source, index) => <option key={index} value={index}>{source}</option>)}
      </select></label>
      {!sources.length && <p className="hint">Önce tabloya veya matrise alan ekleyin.</p>}
      <ActionOptions action={rowAction.action} onChange={(next) => setRowAction({ action: next })}
        visual={visual} page={page} pages={pages} measures={measures} row />
    </>}
  </Section>;
}

/** Power BI "Görseli biçimlendir": türün desteklediği seçenekler. */
function FormatPanel({ visual, page, pages, tables, onChange }: { visual: Visual; page: ReportPage; pages: ReportPage[]; tables: ModelTable[]; onChange: (v: Visual) => void }) {
  const f = visual.format;
  const measures = tables.flatMap((table) => table.olculer.map((measure) => measure.ad));
  const def = VISUAL_DEFS[visual.type];
  const set = (patch: Partial<VisualFormat>) => onChange({ ...visual, format: { ...f, ...patch } });
  const isPie = visual.type === "pie" || visual.type === "donut";
  const isChart = !!def.category || isPie || ["scatter", "treemap", "waterfall"].includes(visual.type);
  const colors = Array.isArray(f.colors) ? (f.colors as string[]) : [];
  const swatches = isPie || visual.legend?.length ? 8 : Math.max(1, Math.min(8, visual.values.length));

  if (visual.type === "text") {
    const labels = visual.values.map(valueLabel);
    return (
      <>
      <AppearancePanel visual={visual} onChange={onChange} />
      <Section title="Metin">
        <textarea
          rows={7}
          value={typeof f.text === "string" ? f.text : ""}
          placeholder={"# Satış özeti\nBu dönemin satışı: [Toplam Satış]"}
          onChange={(e) => set({ text: e.target.value })}
        />
        <p className="hint">
          "# " ile başlayan satır başlık, "## " ara başlık olur.
          {labels.length > 0 ? (
            <>
              {" "}Dinamik değerler: {labels.map((l) => <code key={l}>[{l}]</code>).reduce<ReactNode[]>((a, c, i) => (i ? [...a, ", ", c] : [c]), [])}
            </>
          ) : (
            " Ölçü değeri göstermek için Alanlar sekmesinde Dinamik değerler kutusuna ölçü ekleyip metne [Ölçü adı] yazın."
          )}
        </p>
        <label>
          Yazı boyutu
          <input type="number" min={8} max={144} value={Number(f.fontSize) || 14} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
        </label>
        <label>Metin yerleşimi
          <select value={f.textOverflow ?? "wrap"} onChange={(e) => set({ textOverflow: e.target.value as VisualFormat["textOverflow"] })}>
            <option value="wrap">Satıra böl</option><option value="grow">İçeriğe göre yüksekliği büyüt</option>
            <option value="ellipsis">Tek satır · üç nokta</option><option value="scroll">Kutuda kaydır</option>
          </select>
        </label>
        <label>Satır aralığı<input type="number" min={1} max={2.5} step={0.1} value={f.lineHeight ?? 1.4}
          onChange={(e) => set({ lineHeight: Number(e.target.value) })} /></label>
        <label>
          Hizalama
          <select value={(f.align as string) || "left"} onChange={(e) => set({ align: e.target.value })}>
            <option value="left">Sola</option>
            <option value="center">Ortaya</option>
            <option value="right">Sağa</option>
          </select>
        </label>
        <label className="inline">
          <input type="checkbox" checked={!!f.bold} onChange={(e) => set({ bold: e.target.checked })} />
          Kalın
        </label>
        <label className="inline">
          Renk
          <input type="color" value={typeof f.color === "string" ? f.color : "#201f1e"} onChange={(e) => set({ color: e.target.value })} />
        </label>
      </Section>
      <ActionPanel visual={visual} page={page} pages={pages} measures={measures} onChange={onChange} />
      </>
    );
  }

  if (visual.type === "shape") return (
    <>
      <AppearancePanel visual={visual} onChange={onChange} />
      <Section title="Şekil">
        <label>Tür
          <select value={f.shapeStyle ?? "rectangle"} onChange={(e) => set({ shapeStyle: e.target.value as VisualFormat["shapeStyle"] })}>
            <option value="rectangle">Dikdörtgen</option>
            <option value="pill">Kapsül</option>
            <option value="line">Ayırıcı çizgi</option>
          </select>
        </label>
        <label>Metin<input type="text" value={typeof f.text === "string" ? f.text : ""} onChange={(e) => set({ text: e.target.value })} /></label>
      </Section>
      <ActionPanel visual={visual} page={page} pages={pages} measures={measures} onChange={onChange} />
    </>
  );

  if (visual.type === "image") return (
    <>
      <AppearancePanel visual={visual} onChange={onChange} />
      <Section title="Görsel dosyası">
        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 2_000_000) { window.alert("Görsel dosyası en fazla 2 MB olabilir."); return; }
          const reader = new FileReader();
          reader.onload = () => { if (typeof reader.result === "string") set({ imageData: reader.result }); };
          reader.readAsDataURL(file);
        }} />
        <label>Yerleşim
          <select value={f.imageFit ?? "contain"} onChange={(e) => set({ imageFit: e.target.value as VisualFormat["imageFit"] })}>
            <option value="contain">Tamamını göster</option><option value="cover">Alanı doldur</option>
          </select>
        </label>
        <label>Alternatif metin<input type="text" value={f.altText ?? ""} onChange={(e) => set({ altText: e.target.value })} /></label>
      </Section>
      <ActionPanel visual={visual} page={page} pages={pages} measures={measures} onChange={onChange} />
    </>
  );

  if (visual.type === "button") return (
    <>
      <AppearancePanel visual={visual} onChange={onChange} />
      <Section title="Düğme">
        <label>Yazı<input type="text" value={typeof f.text === "string" ? f.text : ""} onChange={(e) => set({ text: e.target.value })} /></label>
        <label>Stil<select value={f.buttonStyle ?? "solid"} onChange={(e) => {
          const buttonStyle = e.target.value as VisualFormat["buttonStyle"];
          set({ buttonStyle, buttonTextColor: buttonStyle === "solid" ? "#ffffff" : f.buttonColor || "#2563eb" });
        }}>
          <option value="solid">Dolu</option><option value="outline">Çerçeveli</option><option value="ghost">Sade</option>
        </select></label>
        <label>Simge<select value={f.buttonIcon ?? "arrow"} onChange={(e) => set({ buttonIcon: e.target.value as VisualFormat["buttonIcon"] })}>
          {ACTION_ICONS.map((icon) => <option key={icon.value} value={icon.value}>{icon.label}</option>)}
        </select></label>
        <div className="fmt-row">
          <label>Düğme rengi<input type="color" value={/^#[0-9a-f]{6}$/i.test(f.buttonColor ?? "") ? f.buttonColor : "#2563eb"} onChange={(e) => set({ buttonColor: e.target.value })} /></label>
          <label>Yazı rengi<input type="color" value={/^#[0-9a-f]{6}$/i.test(f.buttonTextColor ?? "") ? f.buttonTextColor : "#ffffff"} onChange={(e) => set({ buttonTextColor: e.target.value })} /></label>
        </div>
      </Section>
      <ActionPanel visual={visual} page={page} pages={pages} measures={measures} onChange={onChange} />
    </>
  );

  return (
    <>
      <AppearancePanel visual={visual} onChange={onChange} />
      <Section title="Başlık">
        <label className="inline">
          <input type="checkbox" checked={f.showTitle !== false} onChange={(e) => set({ showTitle: e.target.checked })} />
          Başlığı göster
        </label>
        <input
          type="text"
          value={visual.title ?? ""}
          placeholder="Otomatik"
          onChange={(e) => onChange({ ...visual, title: e.target.value || undefined })}
        />
      </Section>
      {isChart && (
        <Section title="Grafik">
          <label className="inline">
            <input
              type="checkbox"
              checked={isPie ? f.dataLabels !== false : !!f.dataLabels}
              onChange={(e) => set({ dataLabels: e.target.checked })}
            />
            Veri etiketleri
          </label>
          <label>
            Gösterge
            <select value={f.legend ?? (isPie ? "right" : "top")} onChange={(e) => set({ legend: e.target.value as VisualFormat["legend"] })}>
              <option value="top">Üstte</option>
              <option value="bottom">Altta</option>
              <option value="right">Sağda</option>
              <option value="none">Gizli</option>
            </select>
          </label>
          {def.category && (
            <>
              <label className="inline">
                <input type="checkbox" checked={f.xAxisTitle !== false} onChange={(e) => set({ xAxisTitle: e.target.checked })} />
                Kategori ekseni başlığı
              </label>
              <label className="inline">
                <input type="checkbox" checked={!!f.yAxisTitle} onChange={(e) => set({ yAxisTitle: e.target.checked })} />
                Değer ekseni başlığı
              </label>
            </>
          )}
        </Section>
      )}
      {isChart && (
        <Section title="Renkler">
          <p className="hint">Seriler sabit sırayla renklenir; sırayı buradan değiştirebilirsiniz.</p>
          <div className="fmt-colors">
            {Array.from({ length: swatches }, (_, i) => (
              <label key={i} className="fmt-color" title={`${i + 1}. renk`}>
                <input
                  type="color"
                  value={colors[i] || SERIES[i]}
                  onChange={(e) => {
                    const next = SERIES.map((c, j) => colors[j] || c);
                    next[i] = e.target.value;
                    set({ colors: next });
                  }}
                />
              </label>
            ))}
            {colors.length > 0 && (
              <button className="link" onClick={() => set({ colors: undefined })}>
                Varsayılana dön
              </button>
            )}
          </div>
        </Section>
      )}
      {(visual.type === "table" || visual.type === "matrix" || visual.type === "treegrid") && (
        <><Section title={visual.type === "matrix" ? "Matris" : visual.type === "treegrid" ? "Ağaç tablo" : "AG Grid tablo"}>
          <label className="inline">
            <input type="checkbox" checked={f.banded !== false} onChange={(e) => set({ banded: e.target.checked })} />
            Satırları dönüşümlü renklendir
          </label>
          <p className="hint">Sıralamak için sütun başlığına tıklayın.</p>
          {visual.type === "table" && <>
            <label className="inline"><input type="checkbox" checked={f.gridFilters !== false}
              onChange={(e) => set({ gridFilters: e.target.checked })} />Sütun filtreleri</label>
            <label className="inline"><input type="checkbox" checked={f.gridPinFirstColumn === true}
              onChange={(e) => set({ gridPinFirstColumn: e.target.checked })} />İlk sütunu sabitle</label>
            <label className="inline"><input type="checkbox" checked={f.gridPagination === true}
              onChange={(e) => set({ gridPagination: e.target.checked })} />Sayfalama</label>
            {f.gridPagination === true && <label>Sayfa başına satır
              <select value={Number(f.gridPageSize) || 100} onChange={(e) => set({ gridPageSize: Number(e.target.value) })}>
                {[25, 50, 100, 250].map((n) => <option key={n} value={n}>{n}</option>)}
              </select></label>}
          </>}
          {visual.type === "table" && (
            <>
              <label className="inline">
                <input type="checkbox" checked={!!f.detailOnly} onChange={(e) => set({ detailOnly: e.target.checked })} />
                Ayrıntı tablosu: yalnızca seçim yapılınca göster
              </label>
              <p className="hint">
                Ana-ayrıntı: ana tablodaki bir satıra tıklamak, o satırın tüm alanlarıyla diğer görselleri filtreler
                (ör. fatura satırı → fatura kalemleri).
              </p>
            </>
          )}
        </Section>
        <RowActionPanel visual={visual} page={page} pages={pages} measures={measures} onChange={onChange} /></>
      )}
      {(visual.type === "card" || visual.type === "ticker") && (
        <Section title="Kart">
          <label className="inline">
            <input type="checkbox" checked={f.categoryLabel !== false} onChange={(e) => set({ categoryLabel: e.target.checked })} />
            Kategori etiketi
          </label>
          {visual.group.length > 0 && (
            <label>
              Trend yönü
              <select value={f.higherIsBetter === false ? "low" : "high"} onChange={(e) => set({ higherIsBetter: e.target.value === "high" })}>
                <option value="high">Artış iyi (yeşil)</option>
                <option value="low">Azalış iyi (yeşil)</option>
              </select>
            </label>
          )}
          <p className="hint">Trend ekseni (ör. Tarih[Ay]) eklenirse değerin altında eğilim çizgisi ve önceki döneme göre değişim görünür.</p>
        </Section>
      )}
      {visual.type === "kpi" && (
        <Section title="KPI">
          <label>
            Yön
            <select value={f.higherIsBetter === false ? "low" : "high"} onChange={(e) => set({ higherIsBetter: e.target.value === "high" })}>
              <option value="high">Yüksek olması iyi</option>
              <option value="low">Düşük olması iyi</option>
            </select>
          </label>
        </Section>
      )}
      {visual.type === "slicer" && (
        <Section title="Dilimleyici">
          <label>
            Stil
            <select
              value={f.slicerStyle ?? "list"}
              onChange={(e) => onChange({ ...visual, format: { ...f, slicerStyle: e.target.value as VisualFormat["slicerStyle"] }, state: {} })}
            >
              <option value="list">Liste</option>
              <option value="dropdown">Açılır liste</option>
              <option value="range">Aralık (tarih / sayı)</option>
            </select>
          </label>
        </Section>
      )}
      {(visual.type === "card" || visual.type === "multicard" || visual.type === "kpi") &&
        <ActionPanel visual={visual} page={page} pages={pages} measures={measures} onChange={onChange} />}
    </>
  );
}

/** Seçili görsel yokken: sayfa ayarları ve Detaya git (drill-through) alanları (Power BI'daki gibi). */
function PageSettings({ page, onChange }: { page: ReportPage; onChange: (p: ReportPage) => void }) {
  const [over, setOver] = useState(false);
  const fields = page.drillthrough ?? [];
  return (
    <>
      <div className="viz-selected">Sayfa: {page.name}</div>
      <Section title="Tuval">
        <label>Sayfa rengi<input type="color" value={page.backgroundColor && /^#[0-9a-f]{6}$/i.test(page.backgroundColor) ? page.backgroundColor : "#ffffff"}
          onChange={(e) => onChange({ ...page, backgroundColor: e.target.value })} /></label>
      </Section>
      <div
        className={`well ${over ? "over" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(FIELD_MIME)) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          const f = readField(e);
          if (!f || isMeasure(f)) return;
          e.preventDefault();
          if (!fields.some((x) => x.table === f.table && x.column === f.column)) {
            onChange({ ...page, drillthrough: [...fields, { table: f.table, column: f.column }] });
          }
        }}
      >
        <div className="well-label">Detaya git (drill-through)</div>
        {fields.length === 0 && <div className="well-empty">Detay alanlarını buraya sürükleyin</div>}
        {fields.map((f, i) => (
          <div key={`${f.table}.${f.column}`} className="well-item">
            <span className="well-name" title={`${f.table}[${f.column}]`}>
              {f.column}
            </span>
            <button
              className="well-x"
              onClick={() => onChange({ ...page, drillthrough: fields.filter((_, j) => j !== i) })}
              aria-label="Kaldır"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <p className="hint pad">
        Bu sayfayı bir detay sayfası yapar. Başka bir sayfadaki görselde bu alanın bir değerine tıklayınca görsel
        başlığında <strong>↪ Detaya git</strong> çıkar; bu sayfa o değere filtrelenmiş açılır, üstte <strong>← Geri</strong> düğmesi olur.
      </p>
    </>
  );
}

/** Power BI "Görselleştirmeler" bölmesi: görsel türleri + seçili görselin alanları ve biçimi. */
export function VisualizationsPane({
  page, pages, tables, onPageChange, visual, onDuplicate, onShiftLayer, onPickType, onChange, onDropToWell, onMoveWell,
}: {
  page: ReportPage;
  pages: ReportPage[];
  tables: ModelTable[];
  onPageChange: (p: ReportPage) => void;
  visual: Visual | null;
  onDuplicate: () => void;
  onShiftLayer: (step: -1 | 1) => void;
  onPickType: (t: VisualType) => void;
  onChange: (v: Visual) => void;
  onDropToWell: (well: WellDef, field: FieldPayload) => void;
  onMoveWell: (from: WellDrag, to: WellDef, index: number) => void;
}) {
  const [tab, setTab] = useState<"fields" | "format">("fields");
  return (
    <aside className="viz-pane">
      <h3>Görselleştirmeler</h3>
      {VISUAL_GROUPS.map((g) => (
        <div key={g} className="viz-group">
          <div className="viz-group-label">{g}</div>
          <div className="viz-types">
            {(Object.keys(VISUAL_DEFS) as VisualType[])
              .filter((t) => VISUAL_DEFS[t].group === g)
              .map((t) => (
                <button
                  key={t}
                  className={`viz-type ${visual?.type === t ? "active" : ""}`}
                  title={visual ? `${VISUAL_DEFS[t].label} olarak değiştir` : `Yeni ${VISUAL_DEFS[t].label.toLowerCase()}`}
                  aria-label={VISUAL_DEFS[t].label}
                  onClick={() => onPickType(t)}
                >
                  <VisualTypeIcon type={t} />
                </button>
              ))}
          </div>
        </div>
      ))}
      {visual ? (
        <>
          <div className="viz-tabs" role="tablist">
            <button role="tab" className={tab === "fields" ? "active" : ""} onClick={() => setTab("fields")}>
              Alanlar
            </button>
            <button role="tab" className={tab === "format" ? "active" : ""} onClick={() => setTab("format")}>
              Biçim
            </button>
          </div>
          <div className="viz-selected">{VISUAL_DEFS[visual.type].label}</div>
          {tab === "fields" ? (
            VISUAL_DEFS[visual.type].wells.map((w) => (
              <Well key={`${w.key}-${w.slot ?? ""}`} def={w} visual={visual} onDrop={onDropToWell} onMove={onMoveWell} onChange={onChange} />
            ))
          ) : (
            <>
              <Section title="Nesne düzeni">
                <div className="fmt-actions">
                  <button type="button" onClick={onDuplicate}>Çoğalt</button>
                  <button type="button" onClick={() => onShiftLayer(-1)} disabled={page.visuals[0]?.id === visual.id}>Geriye</button>
                  <button type="button" onClick={() => onShiftLayer(1)} disabled={page.visuals.at(-1)?.id === visual.id}>Öne</button>
                </div>
                <label className="inline"><input type="checkbox" checked={!!visual.format.locked}
                  onChange={(e) => onChange({ ...visual, format: { ...visual.format, locked: e.target.checked } })} /> Nesneyi kilitle</label>
                <label>Opaklık ({Math.round((visual.format.opacity ?? 1) * 100)}%)<input type="range" min="0" max="100"
                  value={Math.round((visual.format.opacity ?? 1) * 100)}
                  onChange={(e) => onChange({ ...visual, format: { ...visual.format, opacity: Number(e.target.value) / 100 } })} /></label>
              </Section>
              <FormatPanel visual={visual} page={page} pages={pages} tables={tables} onChange={onChange} />
            </>
          )}
        </>
      ) : (
        <>
          <p className="hint pad">Alanlarını görmek için sayfada bir görsel seçin ya da yukarıdan yeni görsel ekleyin.</p>
          <PageSettings page={page} onChange={onPageChange} />
        </>
      )}
    </aside>
  );
}

/** Rapor görünümündeki "Veri" bölmesi: alanı işaretle ya da sürükle. Gizli alanlar görünmez (Power BI). */
export function FieldsPane({
  tables, visual, onToggle, onEditMeasure,
}: {
  tables: ModelTable[];
  visual: Visual | null;
  onToggle: (field: FieldPayload, checked: boolean) => void;
  onEditMeasure?: (name: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const needle = q.trim().toLocaleLowerCase("tr");
  const visible = tables.filter((t) => !t.gizli).sort((a, b) => a.ad.localeCompare(b.ad, "tr"));
  return (
    <aside className="data-pane">
      <h3>Veri</h3>
      <input className="search" placeholder="Ara" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="tree-scroll">
        {visible.map((t) => {
          const cols = t.sutunlar.filter((c) => !c.gizli && (!needle || c.ad.toLocaleLowerCase("tr").includes(needle)));
          const measures = t.olculer.filter((m) => !needle || m.ad.toLocaleLowerCase("tr").includes(needle));
          if (needle && !cols.length && !measures.length && !t.ad.toLocaleLowerCase("tr").includes(needle)) return null;
          const expanded = needle ? true : !!open[t.ad];
          return (
            <div key={t.ad}>
              <div className="dp-table">
                <button className="chev-btn" onClick={() => setOpen((o) => ({ ...o, [t.ad]: !o[t.ad] }))} aria-label="Aç/kapat">
                  {expanded ? "▾" : "▸"}
                </button>
                <button className="dp-label" onClick={() => setOpen((o) => ({ ...o, [t.ad]: !o[t.ad] }))}>
                  {t.tarih_tablosu ? <DateTableIcon /> : <TableIcon />}
                  <span>{t.ad}</span>
                </button>
              </div>
              {expanded &&
                measures.map((m) => {
                  const field: FieldPayload = { measure: m.ad };
                  const checked = !!visual && usesField(visual, field);
                  return (
                    <label
                      key={`m:${m.ad}`}
                      className="dp-col field measure"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(FIELD_MIME, JSON.stringify(field));
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      title={`${m.ifade}\n\nGörsele eklemek için işaretleyin ya da sürükleyin; düzenlemek için ✎`}
                    >
                      <input type="checkbox" checked={checked} onChange={(e) => onToggle(field, e.target.checked)} />
                      <CalcIcon />
                      <span>{m.ad}</span>
                      {onEditMeasure && (
                        <button
                          className="dp-edit"
                          onClick={(e) => {
                            e.preventDefault();
                            onEditMeasure(m.ad);
                          }}
                          aria-label={`${m.ad} ölçüsünü düzenle`}
                          title="Formül çubuğunda düzenle"
                        >
                          ✎
                        </button>
                      )}
                    </label>
                  );
                })}
              {expanded &&
                cols.map((c) => {
                  const checked = !!visual && usesField(visual, { table: t.ad, column: c.ad });
                  return (
                    <label
                      key={c.ad}
                      className="dp-col field"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(FIELD_MIME, JSON.stringify({ table: t.ad, column: c.ad }));
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      title="Görsele eklemek için işaretleyin ya da sürükleyin"
                    >
                      <input type="checkbox" checked={checked} onChange={(e) => onToggle({ table: t.ad, column: c.ad }, e.target.checked)} />
                      <ColumnTypeIcon c={c} />
                      <span>{c.ad}</span>
                    </label>
                  );
                })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
