import type { ActionIcon, BindingTarget, ComponentDefinition, DesignState, FilterRef, Visual, VisualResult } from "@floem/client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { appearancePatch, bindingOutput, outputPatch, sourceQuery, sourceResult, type DataStatus, type RowData } from "./dataBindings";
import type { QueryFn } from "./useVisualData";
import { themedVisual, useReportTheme } from "./theme";
import { visualStyle } from "./visualStyle";
import { ActionGlyph } from "./ActionGlyph";

type Presence = { visible: boolean; opacity: number };
const PageBindings = createContext<{ visuals: Visual[]; presence: Record<string, Presence>; publish: (id: string, value?: Presence) => void } | null>(null);
const Definitions = createContext<ComponentDefinition[]>([]);
export const useRuntimeComponents = () => useContext(Definitions);
export function BindingProvider({ visuals, children, row, definitions }: { visuals: Visual[]; children: ReactNode; row?: RowData; definitions?: ComponentDefinition[] }) {
  const inherited = useContext(Definitions);
  const [presence, setPresence] = useState<Record<string, Presence>>({});
  const publish = useCallback((id: string, value?: Presence) => setPresence((before) => {
    if (before[id]?.visible === value?.visible && before[id]?.opacity === value?.opacity) return before;
    const next = { ...before }; if (value) next[id] = value; else delete next[id]; return next;
  }), []);
  const ctx = useMemo(() => ({ visuals, presence, publish }), [visuals, presence, publish]);
  return <Definitions.Provider value={definitions ?? inherited}><PageBindings.Provider value={ctx}><RowContext.Provider value={row}>{children}</RowContext.Provider></PageBindings.Provider></Definitions.Provider>;
}
const RowContext = createContext<RowData | undefined>(undefined);
export const useRowData = () => useContext(RowContext);
interface BoundState { status: DataStatus; controlled: boolean; message?: string; value?: VisualResult; retry: () => void; report: (status: DataStatus, signature?: string) => void; custom?: string; icon?: ActionIcon }
export const BoundVisualContext = createContext<BoundState | null>(null);

/** İç sorgusu olan nesne bileşeni, sorgu kancasını kaldırmadan durumunu çizer. */
export function useRuntimeFeedback(status: DataStatus, message?: string, retry?: () => void, enabled = true) {
  const ctx = useContext(BoundVisualContext), report = ctx?.report;
  useEffect(() => { if (enabled) report?.(status); }, [enabled, status, report]);
  if (!enabled || status === "ready" || !ctx?.custom) return null;
  return <div className={`v-runtime-state v-runtime-${status}`} role={status === "error" ? "alert" : "status"} aria-busy={status === "loading"}>
    <span title={message}>{ctx.icon && <ActionGlyph icon={ctx.icon} />}{ctx.custom}</span>{status === "error" && <><span className="v-runtime-detail" title={message}>{message}</span><button type="button" onClick={(e) => { e.stopPropagation(); retry?.(); }}>Tekrar dene</button></>}
  </div>;
}

function useBindings(v: Visual, extra: FilterRef[], revision: string, run: QueryFn, row?: RowData) {
  const [attempt, setAttempt] = useState(0);
  const entries = Object.entries(v.bindings ?? {}).filter(([, binding]) => binding != null) as [BindingTarget, NonNullable<Visual["bindings"]>[BindingTarget]][];
  const key = JSON.stringify([v.bindings, v.filters, extra, revision, attempt, row?.row, row?.query]);
  type Result = { format: Visual["format"]; value?: VisualResult; visible: boolean; status: DataStatus; signature: string; message?: string };
  const [response, setResponse] = useState<{ key: string; run: QueryFn; result: Result }>();
  useEffect(() => {
    if (!entries.length) return;
    let alive = true;
    const queries = new Map<string, Promise<VisualResult>>();
    const work = async (): Promise<Result> => {
      const all = await Promise.all(entries.map(async ([target, binding]) => {
        if (!binding) throw new Error("Veri bağı eksik.");
        const q = sourceQuery(binding.source, [...v.filters, ...extra]);
        const id = JSON.stringify(q);
        if (q && !queries.has(id)) queries.set(id, Promise.resolve().then(() => run(q)));
        const result = sourceResult(binding.source, q ? await queries.get(id) : undefined, row);
        const raw = result.rows[0]?.[0] ?? null;
        const output = bindingOutput(binding, raw);
        const col = result.columns[0] ?? { name: "Değer", kind: "value" as const, type: "string" as const };
        return { ...outputPatch(target, output, binding, col), target, empty: raw === null && output == null, raw };
      }));
      const content = all.filter((x) => x.target === "text" || x.target === "value");
      return { format: Object.assign({}, ...all.map((x) => x.format)), value: all.find((x) => x.result)?.result,
        visible: all.every((x) => x.visible !== false), status: (content.length ? content : all).every((x) => x.empty) ? "empty" : "ready", signature: JSON.stringify(all.map((x) => x.raw)) };
    };
    void work().then((result) => { if (alive) setResponse({ key, run, result }); }).catch((e) => { if (alive) setResponse({ key, run, result: {
      format: {}, visible: true, signature: "", status: "error", message: e instanceof Error ? `${e.message}${"detail" in e && e.detail ? `: ${e.detail}` : ""}` : String(e),
    } }); });
    return () => { alive = false; };
  }, [key, run]);
  const empty: Result = { format: {}, visible: true, status: "ready", signature: "" };
  return { ...(entries.length ? response?.key === key && response.run === run ? response.result : { ...empty, status: "loading" as const } : empty),
    active: entries.length > 0, retry: () => setAttempt((x) => x + 1) };
}

/** Geometri/olaylar mevcut tuvalde kalır; bu çerçeve yalnız çalışma zamanı sunumunu çözer. */
export function RuntimeFrame({ visual, extra, revision, run, design = false, selected = false, children, ...props }: {
  visual: Visual; extra: FilterRef[]; revision: string; run: QueryFn; design?: boolean; selected?: boolean;
  children: (visual: Visual) => ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
  const theme = useReportTheme(), row = useRowData(), page = useContext(PageBindings);
  const binding = useBindings(visual, extra, revision, run, row);
  const [contentStatus, setContentStatus] = useState<DataStatus>("ready"), [hover, setHover] = useState(false);
  const [contentSignature, setContentSignature] = useState(""), [previewState, setPreviewState] = useState<DesignState>();
  const report = useCallback((status: DataStatus, signature?: string) => { setContentStatus(status); setContentSignature(signature ?? ""); }, []);
  useEffect(() => {
    if (!design) return;
    const preview = (event: Event) => { const d = (event as CustomEvent).detail; if (d.id === visual.id) setPreviewState(d.state === "actual" ? undefined : d.state); };
    window.addEventListener("floem-preview-state", preview); return () => window.removeEventListener("floem-preview-state", preview);
  }, [design, visual.id]);
  const status = binding.active ? binding.status : contentStatus;
  const state: DesignState = design && previewState ? previewState : status === "error" || status === "loading" || status === "empty" ? status : selected || row?.selected ? "selected" : hover ? "hover" : "normal";
  const format = { ...visual.format, ...appearancePatch(visual.states?.normal), ...binding.format, ...appearancePatch(visual.states?.[state]) };
  if (visual.type === "text" && binding.value && !visual.bindings?.text && !visual.states?.[state]?.text) {
    const column = binding.value.columns[0];
    format.text = outputPatch("text", binding.value.rows[0]?.[0] ?? null, { source: { kind: "value", value: { measure: "" } } }, column).format.text;
  }
  const resolved = themedVisual({ ...visual, format }, theme);
  let visible = binding.visible, opacity = typeof format.opacity === "number" && Number.isFinite(format.opacity) ? Math.max(0, Math.min(1, format.opacity)) : 1, parentId = visual.parentId;
  const ownOpacity = opacity;
  for (let i = 0; parentId && i < 16; i++) {
    const parent = page?.visuals.find((v) => v.id === parentId);
    if (!parent) break;
    visible &&= page?.presence[parentId]?.visible !== false;
    opacity *= page?.presence[parentId]?.opacity ?? Number(parent.format.opacity ?? 1);
    parentId = parent.parentId;
  }
  const publish = page?.publish;
  useLayoutEffect(() => { publish?.(visual.id, { visible: binding.visible, opacity: ownOpacity }); }, [publish, visual.id, binding.visible, ownOpacity]);
  useLayoutEffect(() => () => publish?.(visual.id), [publish, visual.id]);
  const previous = useRef(""), [changing, setChanging] = useState(false);
  const signature = binding.active ? binding.signature : contentSignature;
  useEffect(() => {
    if (status !== "ready") return;
    const changed = previous.current !== "" && previous.current !== signature;
    previous.current = signature;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!changed || visual.format.animation !== "pulse" || theme?.reducedMotion || document.hidden || media.matches) return;
    setChanging(false);
    const frame = requestAnimationFrame(() => setChanging(true));
    const duration = typeof visual.format.animationDuration === "number" && Number.isFinite(visual.format.animationDuration) ? Math.max(150, Math.min(3000, visual.format.animationDuration)) : 500;
    const timer = setTimeout(() => setChanging(false), duration*2);
    const stop = () => { if (document.hidden || media.matches) { cancelAnimationFrame(frame); clearTimeout(timer); setChanging(false); } };
    document.addEventListener("visibilitychange", stop); media.addEventListener("change", stop);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); document.removeEventListener("visibilitychange", stop); media.removeEventListener("change", stop); setChanging(false); };
  }, [signature, status, visual.format.animation, visual.format.animationDuration, theme?.reducedMotion]);
  const previewStatus = design && previewState && ["loading", "empty", "error"].includes(previewState) ? previewState as DataStatus : undefined;
  const ctx: BoundState = { status: previewStatus ?? binding.status, controlled: binding.active || !!previewStatus, message: binding.message, value: binding.value, retry: binding.retry, report,
    custom: visual.states?.[state]?.text ?? (status === "ready" && typeof format.text === "string" ? format.text : undefined), icon: visual.states?.[state]?.icon };
  const style = { ...props.style, ...visualStyle(resolved), opacity: visible ? opacity : design ? .35 : opacity,
    ...(!visible && !design ? { display: "none" } : {}), ...(format.color ? { color: format.color, "--text": format.color } : {}) } as CSSProperties;
  return <BoundVisualContext.Provider value={ctx}><div {...props} style={style} data-design-state={state} data-rule-hidden={!visible || undefined}
    className={`${props.className ?? ""} ${changing ? "motion-value-change" : ""}`}
    onPointerEnter={(e) => { setHover(true); props.onPointerEnter?.(e); }} onPointerLeave={(e) => { setHover(false); props.onPointerLeave?.(e); }}
    onFocus={(e) => { setHover(true); props.onFocus?.(e); }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHover(false); props.onBlur?.(e); }}>
    {children(resolved)}{!visible && design && <span className="v-binding-hidden">Veri kuralıyla gizli</span>}
  </div></BoundVisualContext.Provider>;
}
