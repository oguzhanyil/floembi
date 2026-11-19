import type { PageLayoutVariant, ReportPage, Visual } from "@floem/client";
import { createPageLayout } from "@floem/report";

export function PageLayoutControls({ page, activeId, onSelect, onChange, resolved, contentHeight, selection, overflow }: {
  page: ReportPage; activeId: string | null; onSelect: (id: string | null) => void;
  onChange: (page: ReportPage) => void; resolved: Visual[]; contentHeight: number;
  selection: string[]; overflow: Set<string>;
}) {
  const variant = page.layouts?.find((v) => v.id === activeId);
  const patch = (delta: Partial<PageLayoutVariant>) => variant && onChange({ ...page, layouts: page.layouts!.map((v) => v.id === activeId ? { ...v, ...delta } : v) });
  const outside = resolved.filter((v) => v.x < 0 || v.x + v.w > (variant?.width ?? page.width) + .5 || v.y < 0 || v.y + v.h > contentHeight + .5);
  return <details className="page-layout-controls" open>
    <summary>Ekran düzenleri</summary>
    <label>Düzen<select aria-label="Tasarım düzeni" value={variant?.id ?? "base"} onChange={(e) => onSelect(e.target.value === "base" ? null : e.target.value)}>
      <option value="base">Ana düzen</option>{page.layouts?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
    </select></label>
    <div className="layout-actions">{(["laptop", "tablet", "phone"] as const).map((preset) => {
      const label = { laptop: "Laptop", tablet: "Tablet", phone: "Telefon" }[preset];
      const threshold = { laptop: 1440, tablet: 1024, phone: 600 }[preset];
      return <button key={preset} type="button" aria-label={`${label} düzeni ekle`} disabled={(page.layouts?.length ?? 0) >= 12 || page.layouts?.some((v) => v.maxWidth === threshold)} onClick={() => {
        const added = createPageLayout(page, preset); onChange({ ...page, layouts: [...page.layouts ?? [], added] }); onSelect(added.id);
      }}>+ {label}</button>;
    })}</div>
    {variant ? <>
      <p className="layout-hint">Konum, boyut, akış ve yazı boyutu bu düzene özeldir. Alanlar, renkler, eylemler ile nesne ekleme/silme tüm düzenlerde ortaktır. Gruplama ve üst kapsayıcı Ana düzende değiştirilir.</p>
      <label>Düzen adı<input aria-label="Düzen adı" maxLength={120} value={variant.name} onChange={(e) => e.target.value.trim() && patch({ name: e.target.value })} /></label>
      <div className="layout-numbers">{(["width", "height", "maxWidth"] as const).map((key) => <label key={key}>{({ width: "Tuval genişliği", height: "En az yükseklik", maxWidth: "Geçiş genişliği ≤" })[key]}
        <input aria-label={`Düzen ${key}`} type="number" min={key === "height" ? 200 : 240} max={key === "height" ? 20000 : 7680} value={variant[key]} onChange={(e) => {
          const n = e.target.valueAsNumber;
          if (Number.isInteger(n) && n >= (key === "height" ? 200 : 240) && n <= (key === "height" ? 20000 : 7680)
            && (key !== "maxWidth" || !page.layouts!.some((v) => v.id !== activeId && v.maxWidth === n))) patch({ [key]: n });
        }} />
      </label>)}</div>
      <label>Sayfa akışı<select aria-label="Düzen sayfa akışı" value={variant.rootLayout?.mode ?? "free"} onChange={(e) => {
        const mode = e.target.value as "free" | "vertical" | "grid";
        const overrides = { ...variant.overrides };
        if (mode === "free") for (const v of resolved.filter((v) => !v.parentId)) overrides[v.id] = { ...overrides[v.id], x: v.x, y: v.y, w: v.w, h: v.h };
        patch({ overrides, height: Math.min(20000, Math.max(variant.height, Math.ceil(contentHeight))), rootLayout: { ...variant.rootLayout, mode, padding: 16, gap: 16, columns: 2, align: "stretch", autoHeight: true } });
      }}><option value="free">Serbest</option><option value="vertical">Dikey</option><option value="grid">İki sütun</option></select></label>
      <p className="layout-hint">Web, rapor alanı {variant.maxWidth} CSS piksel veya daha dar olduğunda bu düzeni seçer. Birden fazla eşleşmede en dar eşik kullanılır. Tüm nesneler korunur; uzun sayfa aşağı kayar.</p>
      <div className="layout-actions">
        <button type="button" disabled={!selection.some((id) => variant.overrides[id])} onClick={() => patch({ overrides: Object.fromEntries(Object.entries(variant.overrides).filter(([id]) => !selection.includes(id))) })}>Seçimi Ana düzenden al</button>
        <button type="button" onClick={() => { onChange({ ...page, layouts: page.layouts!.filter((v) => v.id !== activeId) }); onSelect(null); }}>Bu düzeni kaldır</button>
      </div>
    </> : <p className="layout-hint">Ana düzen eski sabit tuvaldir. Diğer düzenler aynı nesneleri ve veriyi kullanır. Yeni düzen dikey bir başlangıç oluşturur; yayımlamadan önce metinleri, tabloları ve eylemleri önizleyin.</p>}
    {(outside.length > 0 || overflow.size > 0) && <p className="layout-warning" role="status">Yerleşimde taşma var: {outside.length} nesne sayfa sınırını aşıyor, {overflow.size} akış alanı taşıyor. Boyutları veya esnek boyut sınırlarını düzenleyin.</p>}
  </details>;
}
