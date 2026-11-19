import type { ReportPage, Visual } from "@floem/client";
import { ancestors, containerOptions, descendants, lockedInLayout, selectionRoots } from "@floem/report";
import { alignSelection, canGroup, reparent, type Alignment } from "./layoutEditing";

export function LayoutControls({ page, resolved, selection, onSelect, onChange, onVisual, onGroup, onUngroup, allowStructure = true }: {
  allowStructure?: boolean;
  resolved: Visual[];
  page: ReportPage; selection: string[]; onSelect: (ids: string[]) => void; onChange: (page: ReportPage) => void;
  onVisual: (visual: Visual) => void; onGroup: (frame?: boolean) => void; onUngroup: (id: string) => void;
}) {
  const roots = selectionRoots(page, selection), v = page.visuals.find((node) => node.id === selection.at(-1));
  const excluded = descendants(page, selection);
  const placed = resolved.find((node) => node.id === v?.id);
  const overflows = placed && resolved.some((node) => node.parentId === placed.id && (node.x < placed.x || node.y < placed.y || node.x + node.w > placed.x + placed.w + .5 || node.y + node.h > placed.y + placed.h + .5));
  const o = v ? containerOptions(v) : null;
  const parent = page.visuals.find((node) => node.id === v?.parentId);
  const flow = parent ? containerOptions(parent).mode !== "free" : page.rootLayout && page.rootLayout.mode !== "free";
  const setContainer = (patch: Partial<NonNullable<Visual["container"]>>) => v && onVisual({ ...v, container: { ...o!, ...patch } });
  return <details className="layout-controls" open>
    <summary>Düzen ve katmanlar</summary>
    <div className="layout-actions">
      <button type="button" disabled={!allowStructure || !canGroup(page, selection)} onClick={() => onGroup()}>Grupla</button>
      <button type="button" disabled={!allowStructure || !canGroup(page, selection)} onClick={() => onGroup(true)}>Kapsayıcıya al</button>
      <button type="button" disabled={!allowStructure || roots.length !== 1 || v?.type !== "container" || lockedInLayout(page, v.id)} onClick={() => v && onUngroup(v.id)}>Grubu çöz</button>
    </div>
    {roots.length > 1 && <label className="layout-align">Seçimi hizala<select aria-label="Seçimi hizala" disabled={!!page.rootLayout && page.rootLayout.mode !== "free" && roots.some((v) => !v.parentId)} value="" onChange={(e) => onChange(alignSelection(page, selection, e.target.value as Alignment, resolved))}>
      <option value="" disabled>Hizalama seçin</option><option value="left">Sola</option><option value="center">Yatay ortala</option><option value="right">Sağa</option>
      <option value="top">Üste</option><option value="middle">Dikey ortala</option><option value="bottom">Alta</option>
      {roots.length > 2 && <><option value="horizontal">Yatay eşit aralık</option><option value="vertical">Dikey eşit aralık</option></>}
    </select></label>}
    <p className="layout-hint">Shift+tık: çoklu seçim · Ctrl+G: grupla · Ctrl+tık: iç nesne. Ctrl+Alt ile sürükleyerek kapsayıcı değiştirin.</p>
    {v && <fieldset className="layout-settings" disabled={lockedInLayout(page, v.id)}>
      <legend>{selection.length > 1 ? `${selection.length} nesne seçili · son nesne` : "Seçili nesne"}</legend>
      <label>Ad<input aria-label="Nesne adı" value={v.title ?? ""} placeholder={v.id} onChange={(e) => onVisual({ ...v, title: e.target.value })} /></label>
      <label>Üst kapsayıcı<select disabled={!allowStructure} aria-label="Üst kapsayıcı" value={v.parentId ?? ""} onChange={(e) => onChange(reparent(page, [v.id], e.target.value || null, resolved))}>
        <option value="">Sayfa</option>{page.visuals.filter((p) => p.type === "container" && !excluded.has(p.id) && !lockedInLayout(page, p.id)).map((p) => <option key={p.id} value={p.id}>{p.title || p.id}</option>)}
      </select></label>
      <div className="layout-numbers">{(["x", "y", "w", "h"] as const).map((key) => <label key={key}>{({ x: "X", y: "Y", w: "Genişlik", h: "Yükseklik" })[key]}
        <input type="number" aria-label={`Nesne ${key}`} value={Math.round(v[key] * 100) / 100} disabled={!!flow && (key === "x" || key === "y")} min={key === "w" || key === "h" ? 1 : undefined} max={20000}
          onChange={(e) => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) onVisual({ ...v, [key]: key === "w" || key === "h" ? Math.max(1, Math.min(20000, n)) : n }); }} />
      </label>)}</div>
      {v.type === "container" && o && <>
        <label>Tür<select aria-label="Kapsayıcı türü" value={o.kind} onChange={(e) => setContainer({ kind: e.target.value as "group" | "frame", ...(e.target.value === "group" ? { mode: "free" } : {}) })}><option value="frame">Kapsayıcı</option><option value="group">Grup</option></select></label>
        <label>Yerleşim<select aria-label="Kapsayıcı yerleşimi" value={o.mode} onChange={(e) => setContainer({ mode: e.target.value as typeof o.mode, ...(e.target.value !== "free" ? { kind: "frame" } : {}) })}>
          <option value="free">Serbest</option><option value="horizontal">Yatay</option><option value="vertical">Dikey</option><option value="grid">Izgara</option>
        </select></label>
        {o.mode !== "free" && <>
          <div className="layout-numbers">{(["gap", "padding"] as const).map((key) => <label key={key}>{key === "gap" ? "Nesne aralığı" : "İç boşluk"}<input aria-label={key === "gap" ? "Nesne aralığı" : "Kapsayıcı iç boşluğu"} type="number" min={0} max={128} value={o[key]} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setContainer({ [key]: Math.max(0, Math.min(128, e.target.valueAsNumber)) })} /></label>)}</div>
          {o.mode === "grid" && <label>Sütun sayısı<input aria-label="Izgara sütun sayısı" type="number" min={1} max={12} value={o.columns} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setContainer({ columns: Math.max(1, Math.min(12, Math.round(e.target.valueAsNumber))) })} /></label>}
          <label>Çapraz hizalama<select value={o.align} onChange={(e) => setContainer({ align: e.target.value as typeof o.align })}><option value="stretch">Uzat</option><option value="start">Başlangıç</option><option value="center">Orta</option><option value="end">Son</option></select></label>
          {o.mode !== "grid" && <label>Dağılım<select value={o.justify} onChange={(e) => setContainer({ justify: e.target.value as typeof o.justify })}><option value="start">Başlangıç</option><option value="center">Orta</option><option value="end">Son</option><option value="space-between">Aralıklı</option></select></label>}
          {o.mode === "horizontal" && <label className="inline"><input type="checkbox" checked={o.wrap} onChange={(e) => setContainer({ wrap: e.target.checked })} />Satıra kaydır</label>}
        </>}
        <label className="inline"><input type="checkbox" checked={o.autoHeight} onChange={(e) => setContainer({ autoHeight: e.target.checked })} />İçeriğe göre yüksekliği büyüt</label>
        <label>Taşan içerik<select aria-label="Taşan içerik" value={o.overflow} onChange={(e) => setContainer({ overflow: e.target.value as typeof o.overflow })}><option value="visible">Göster</option><option value="clip">Kırp</option></select></label>
        {overflows && <p className="layout-warning" role="status">İçerik kapsayıcı sınırını aşıyor. Boyutu artırın, satıra kaydırın veya otomatik yüksekliği açın.</p>}
      </>}
      {v.parentId && <details><summary>Esnek boyut sınırları</summary>
        {(["grow", "minWidth", "maxWidth", "minHeight", "maxHeight"] as const).map((key) => {
          const defaults = { grow: 0, minWidth: 40, maxWidth: 20000, minHeight: 28, maxHeight: 20000 };
          const labels = { grow: "Büyüme payı", minWidth: "En az genişlik", maxWidth: "En fazla genişlik", minHeight: "En az yükseklik", maxHeight: "En fazla yükseklik" };
          return <label key={key}>{labels[key]}<input type="number" min={key === "grow" ? 0 : 1} max={key === "grow" ? 100 : 20000} value={v.layoutItem?.[key] ?? defaults[key]} onChange={(e) => {
            if (!Number.isFinite(e.target.valueAsNumber)) return;
            const item = { ...defaults, ...v.layoutItem, [key]: Math.max(key === "grow" ? 0 : 1, Math.min(key === "grow" ? 100 : 20000, e.target.valueAsNumber)) };
            if (key === "minWidth") item.maxWidth = Math.max(item.maxWidth, item.minWidth);
            if (key === "maxWidth") item.minWidth = Math.min(item.minWidth, item.maxWidth);
            if (key === "minHeight") item.maxHeight = Math.max(item.maxHeight, item.minHeight);
            if (key === "maxHeight") item.minHeight = Math.min(item.minHeight, item.maxHeight);
            onVisual({ ...v, layoutItem: item });
          }} /></label>;
        })}
      </details>}
    </fieldset>}
    <div role="tree" aria-label="Nesne katmanları" aria-multiselectable="true" className="layout-tree">
      {resolved.map((node) => <button type="button" role="treeitem" key={node.id} aria-selected={selection.includes(node.id)} aria-level={ancestors(page, node.id).length + 1}
        style={{ paddingLeft: 8 + ancestors(page, node.id).length * 14 }} title={node.title || node.id}
        onClick={(e) => onSelect(e.shiftKey ? selection.includes(node.id) ? selection.filter((id) => id !== node.id) : [...selection, node.id] : [node.id])}>
        <span aria-hidden="true">{node.type === "container" ? "▣" : "◇"}</span><span>{node.title || node.id}</span>{lockedInLayout(page, node.id) && <small>Kilitli</small>}
      </button>)}
      {!page.visuals.length && <p className="layout-hint">Henüz nesne yok.</p>}
    </div>
  </details>;
}
