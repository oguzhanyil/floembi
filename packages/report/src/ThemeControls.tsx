import type { ReportDefinition, ThemeSnapshot, VisualResult } from "@floem/client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_THEME, THEME_FAMILIES, createTheme, themeStyle } from "./theme";
import { ReportViewer } from "./ReportViewer";
import "./theme.css";

export function ThemePicker({ value, onChange, label }: { value: ThemeSnapshot; onChange: (v: ThemeSnapshot) => void; label: string }) {
  return <div className="theme-picker" aria-label={label}>
    <label>{label}<select aria-label={label} value={value.id} onChange={(e) => onChange({ ...createTheme(e.target.value, value.mode), density: value.density, reducedMotion: value.reducedMotion })}>
      {THEME_FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select></label>
    <label>Görünüm<select aria-label={`${label} görünümü`} value={value.mode} onChange={(e) => onChange({ ...createTheme(value.id, e.target.value as "light" | "dark"), density: value.density, reducedMotion: value.reducedMotion })}>
      <option value="light">Açık</option><option value="dark">Koyu</option></select></label>
    <label>Yoğunluk<select aria-label={`${label} yoğunluğu`} value={value.density} onChange={(e) => onChange({ ...value, density: e.target.value as ThemeSnapshot["density"] })}>
      <option value="compact">Yoğun</option><option value="comfortable">Rahat</option></select></label>
    <label className="theme-check"><input type="checkbox" checked={value.reducedMotion} onChange={(e) => onChange({ ...value, reducedMotion: e.target.checked })} />Hareketi azalt</label>
  </div>;
}

const previewReport: ReportDefinition = { version: 1, pages: [{ id: "theme-preview", name: "Satış özeti", width: 960, height: 430,
  visuals: [
    { id: "title", type: "text", x: 16, y: 12, w: 560, h: 48, group: [], values: [], filters: [], format: { text: "Türkiye satışları · Yönetici özeti", fontSize: 24, showTitle: false } },
    { id: "card", type: "card", title: "Toplam satış", x: 16, y: 76, w: 260, h: 125, group: [], values: [{ measure: "Satış" }], filters: [], format: {} },
    { id: "chart", type: "column", title: "Bölgelere göre satış", x: 292, y: 76, w: 650, h: 125, group: [{ table: "T", column: "Bölge" }], values: [{ measure: "Satış" }], filters: [], format: {} },
    { id: "grid", type: "table", title: "Uzun Türkçe müşteri başlığı ve satış detayları", x: 16, y: 217, w: 452, h: 196,
      group: [{ table: "T", column: "Müşteri" }], values: [{ measure: "Satış" }], filters: [], format: { gridFilters: false } },
    { id: "tree", type: "treegrid", title: "Bölge → Müşteri", x: 484, y: 217, w: 458, h: 196,
      group: [{ table: "T", column: "Bölge" }, { table: "T", column: "Müşteri" }], values: [{ measure: "Satış" }], filters: [], format: {} },
  ] }] };
const previewRun = async (q: { group: { column: string }[] }): Promise<VisualResult> => ({
  columns: [...q.group.map((g) => ({ name: g.column, type: "string" as const, kind: "group" as const })), { name: "Satış", type: "double", kind: "value" }],
  rows: q.group.length ? ["İstanbul Anadolu Şubesi", "İzmir", "Bursa"].map((name, i) => [...q.group.map(() => name), [1234567.89, 876543.21, 0][i]]) : [[2111111.1]], total: [2111111.1], truncated: false,
});

function ThemeComparison({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [family, setFamily] = useState("electric");
  useEffect(() => { dialog.current?.showModal(); }, []);
  return createPortal(<dialog className="theme-comparison" style={themeStyle(DEFAULT_THEME)} ref={dialog} onCancel={onClose} onClose={onClose} aria-label="Tema karşılaştırması">
    <header><div><strong>Tema karşılaştırması</strong><p>Aynı veri ve düzen · 5 aile × açık/koyu</p></div><button type="button" autoFocus onClick={onClose}>Kapat</button></header>
    <nav aria-label="Renk aileleri">{THEME_FAMILIES.map((f) => <button type="button" key={f.id} aria-pressed={f.id === family} onClick={() => setFamily(f.id)}>{f.name}</button>)}</nav>
    <div className="theme-comparison-grid">{(["light", "dark"] as const).map((mode) => {
      const theme = createTheme(family, mode);
      return <section key={mode} style={themeStyle(theme)}><h2>{mode === "light" ? "Açık görünüm" : "Koyu görünüm"}</h2>
        <div className="theme-preview-login"><strong>Floem BI · Oturum açın</strong><label>E-posta<input placeholder="ornek@sirket.com" /></label><button type="button" className="theme-primary">Oturum aç</button></div>
        <div className="theme-preview-toolbar"><button type="button" className="theme-primary">Veri al</button><button>Görselleştirmeler</button><button>Veri</button><span>Serbest tasarım</span></div>
        <div className="theme-preview-report"><ReportViewer report={{ ...previewReport, theme }} run={previewRun} /></div>
        <div className="theme-statuses"><span style={{ color: theme.colors.success }}>✓ Başarılı</span><span style={{ color: theme.colors.warning }}>△ Uyarı</span><span style={{ color: theme.colors.danger }}>! Hata</span><span style={{ color: theme.colors.info }}>ⓘ Bilgi</span></div>
        <p>Veri yok · Seçimi değiştirin</p>
      </section>;
    })}</div>
  </dialog>, document.body);
}

export function ReportThemeControls({ value, onChange }: { value?: ThemeSnapshot | null; onChange: (theme: ThemeSnapshot | null) => void }) {
  const [compare, setCompare] = useState(false);
  return <div className="report-theme-controls"><details><summary>Rapor teması</summary>
    <p>Bu tema raporla kaydedilir ve web'de korunur. Nesneye özel ayarlar önceliklidir.</p>
    {!value && <p>Mevcut nesne stilleri kullanılıyor.</p>}
    <ThemePicker value={value ?? DEFAULT_THEME} onChange={onChange} label="Rapor renk ailesi" />
    <button type="button" onClick={() => onChange(null)}>Rapor temasını kaldır</button>
    <button type="button" onClick={() => setCompare(true)}>10 temayı karşılaştır</button>
  </details>{compare && <ThemeComparison onClose={() => setCompare(false)} />}</div>;
}

const STORAGE = "floem.application-theme.v1";
export function ApplicationThemeControl() {
  const [theme, setTheme] = useState<ThemeSnapshot>(() => {
    try { const v = JSON.parse(localStorage.getItem(STORAGE) ?? "null");
      if (v && THEME_FAMILIES.some((f) => f.id === v.id) && ["light", "dark"].includes(v.mode)) return { ...createTheme(v.id, v.mode), density: v.density === "comfortable" ? "comfortable" : "compact", reducedMotion: v.reducedMotion === true };
    } catch { /* Depolama kapalıysa varsayılan tema kullanılır. */ }
    return DEFAULT_THEME;
  });
  const [open, setOpen] = useState(false);
  const [compare, setCompare] = useState(false);
  useEffect(() => {
    const style = themeStyle(theme);
    for (const [key, value] of Object.entries(style)) if (key.startsWith("--")) document.documentElement.style.setProperty(key, String(value));
    document.documentElement.style.colorScheme = theme.mode;
    document.documentElement.dataset.reducedMotion = String(theme.reducedMotion);
    try { localStorage.setItem(STORAGE, JSON.stringify(theme)); } catch { /* Tema bu oturumda kullanılabilir. */ }
  }, [theme]);
  return <div className="app-theme-control"><button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>◐ Tema</button>
    {open && <div className="app-theme-popover"><ThemePicker value={theme} onChange={setTheme} label="Uygulama renk ailesi" />
      <p>Uygulama görünümü bu cihazda saklanır. Raporların kendi temaları korunur.</p>
      <button type="button" onClick={() => setCompare(true)}>10 temayı karşılaştır</button><button type="button" onClick={() => setOpen(false)}>Kapat</button>
    </div>}{compare && <ThemeComparison onClose={() => setCompare(false)} />}</div>;
}
