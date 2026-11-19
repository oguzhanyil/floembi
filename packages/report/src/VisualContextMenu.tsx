import type { Visual, VisualFormat } from "@floem/client";
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ContextMenu, type ContextMenuItem, type ContextMenuPosition } from "./ContextMenu";
import { VISUAL_DEFS } from "./reportUtils";
import { allowedExportKinds, downloadTableBlob, tableExportBlob, type ExportTable, type TableExportKind } from "./tableExport";

type Source = () => ContextMenuItem[];
interface VisualMenuRegistry {
  register(key: string, source: Source): () => void;
  itemsExcept(key?: string): ContextMenuItem[];
  notify(message: string): void;
}
const VisualMenuContext = createContext<VisualMenuRegistry | null>(null);
export const visualMenuEnabled = (format: VisualFormat) => format.contextMenu ?? format.gridContextMenu ?? true;

/** Her nesne kendi işlemlerini ortak menüye ekler; yeni nesne türleri de aynı sözleşmeyi kullanır. */
export function useVisualMenuSource(key: string, source: Source) {
  const registry = useContext(VisualMenuContext);
  const current = useRef(source);
  useLayoutEffect(() => { current.current = source; });
  useLayoutEffect(() => registry?.register(key, () => current.current()), [registry, key]);
  return registry;
}

/** Ekrandaki güncel sonucu dışa aktarır; menü açıkken veri değişirse eski sonucu kullanmaz. */
export function useVisualExports(key: string, format: VisualFormat, snapshot: () => ExportTable | null) {
  const active = useRef(false);
  const latest = useRef({ format, snapshot });
  useLayoutEffect(() => { latest.current = { format, snapshot }; });
  const registry = useVisualMenuSource(key, () => {
    if (!latest.current.snapshot()) return [];
    return allowedExportKinds(latest.current.format).map((kind, index) => ({
      label: kind === "xlsx" ? "Excel (.xlsx) indir" : `${kind.toUpperCase()} indir`,
      separator: index === 0, disabled: active.current, action: () => { void run(kind); },
    }));
  });
  async function run(kind: TableExportKind) {
    if (active.current || !allowedExportKinds(latest.current.format).includes(kind)) return;
    const table = latest.current.snapshot();
    if (!table) { registry?.notify("Veri güncelleniyor; işlem tamamlanınca yeniden deneyin."); return; }
    active.current = true;
    registry?.notify("Dosya hazırlanıyor…");
    try {
      downloadTableBlob(await tableExportBlob(table, kind), kind, "floem-nesne");
      registry?.notify("İndirme hazır.");
    } catch (error) { registry?.notify(error instanceof Error ? error.message : "Dosya oluşturulamadı."); }
    finally { active.current = false; }
  }
}

export function VisualContextMenu({ visual, editItems = [], onSelect, children }: {
  visual: Visual; editItems?: ContextMenuItem[]; onSelect?: () => void; children: ReactNode;
}) {
  const sources = useRef(new Map<string, Source>());
  const [position, setPosition] = useState<ContextMenuPosition | null>(null);
  const [details, setDetails] = useState(false);
  const detailsRef = useRef<HTMLDialogElement>(null);
  const scopeRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState("");
  const close = useCallback(() => setPosition(null), []);
  const common = useRef<ContextMenuItem[]>([]);
  common.current = [...editItems, { label: "Nesne bilgileri", separator: editItems.length > 0, action: () => setDetails(true) }];
  if (["text", "button", "card", "kpi", "ticker", "multicard"].includes(visual.type)) common.current.push({
    label: "Görünen metni kopyala", action: () => {
      const text = scopeRef.current?.querySelector<HTMLElement>(".visual-content")?.innerText ?? "";
      if (!navigator.clipboard?.writeText) { setNotice("Panoya kopyalama bu ortamda kullanılamıyor."); return; }
      void navigator.clipboard.writeText(text).then(() => setNotice("Panoya kopyalandı."), () => setNotice("Panoya kopyalanamadı; tarayıcı iznini kontrol edin."));
    },
  });
  const registry = useMemo<VisualMenuRegistry>(() => ({
    register(key, source) {
      sources.current.set(key, source);
      return () => { if (sources.current.get(key) === source) sources.current.delete(key); };
    },
    itemsExcept(key) { return [...common.current, ...[...sources.current].filter(([id]) => id !== key).flatMap(([, source]) => source())]; },
    notify: setNotice,
  }), []);
  const enabled = visualMenuEnabled(visual.format);
  useLayoutEffect(() => { if (!enabled) close(); }, [enabled, close]);
  useLayoutEffect(() => { if (details) detailsRef.current?.showModal(); }, [details]);
  const open = (target: HTMLElement, x: number, y: number) => {
    onSelect?.();
    setPosition({ x, y, origin: target.closest<HTMLElement>(".visual") ?? target });
  };
  return <VisualMenuContext.Provider value={registry}>
    <div ref={scopeRef} className="visual-menu-scope" style={{ display: "contents" }} onContextMenu={(event) => {
      if (!enabled || (event.target as HTMLElement).closest("input,textarea,[contenteditable=true]")) return;
      event.preventDefault(); event.stopPropagation(); open(event.target as HTMLElement, event.clientX, event.clientY);
    }} onKeyDownCapture={(event) => {
      if (!enabled || (event.target as HTMLElement).closest("input,textarea,[contenteditable=true],[role=menu]")) return;
      // Grid kendi hücre bağlamını işler; diğer nesnelerde ortak klavye girişi.
      if ((event.target as HTMLElement).closest(".v-ag-wrap")) return;
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault(); event.stopPropagation();
        const rect = (event.target as HTMLElement).getBoundingClientRect();
        open(event.target as HTMLElement, rect.left, rect.bottom);
      }
    }}>
      {children}
    </div>
    {enabled && position && <ContextMenu position={position} items={registry.itemsExcept()} onClose={close} />}
    {notice && createPortal(<div className="v-action-notice" role="status" onClick={(e) => e.stopPropagation()}>
      <span>{notice}</span><button type="button" aria-label="Mesajı kapat" onClick={() => setNotice("")}>✕</button>
    </div>, document.body)}
    {details && createPortal(<dialog ref={detailsRef} className="v-object-details" aria-label="Nesne bilgileri" onClose={() => setDetails(false)}
      onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <h3>{visual.title || VISUAL_DEFS[visual.type].label}</h3>
      <dl><dt>Nesne türü</dt><dd>{VISUAL_DEFS[visual.type].label}</dd>
        <dt>Konum</dt><dd>{Math.round(visual.x)}, {Math.round(visual.y)}</dd>
        <dt>Boyut</dt><dd>{Math.round(visual.w)} × {Math.round(visual.h)}</dd>
        <dt>Tasarım kilidi</dt><dd>{visual.format.locked ? "Kilitli" : "Açık"}</dd></dl>
      <button type="button" onClick={() => detailsRef.current?.close()}>Kapat</button>
    </dialog>, document.body)}
  </VisualMenuContext.Provider>;
}
