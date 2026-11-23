import { themedVisual, useReportTheme } from "./theme";
import type { ColumnType, FilterRef, ReportPage, Visual, VisualAction, VisualResult, VisualState } from "@floem/client";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActionGlyph } from "./ActionGlyph";
import { safeActionIcon } from "./visualActions";
import { AgDataGrid } from "./AgDataGrid";
import { ServerTable, ServerTree } from "./ServerGrid";
import { CategoryChart, PieChartVisual } from "./charts";
import { GaugeVisual, HeatmapVisual, ScatterVisual, TreemapVisual, WaterfallVisual } from "./charts2";
import { MatrixVisual, ProgressVisual } from "./matrix";
import { VISUAL_DEFS, formatValue, groupFields, valueLabel } from "./reportUtils";
import {
  buildQuery, currentAxis, drillOf, supportsDrill, trendQuery, useMatrixData, useQueryData, useVisualData, type QueryFn,
} from "./useVisualData";
import { CardVisual, ImageVisual, KpiVisual, MultiCard, ShapeVisual, Slicer, TextVisual, TickerVisual } from "./visuals";
import { VisualErrorBoundary } from "./VisualErrorBoundary";
import { useVisualExports, useVisualMenuSource } from "./VisualContextMenu";
import { BoundVisualContext, useRowData } from "./BindingRuntime";
import { sourceResult } from "./dataBindings";
import { RepeaterVisual } from "./RepeaterVisual";
import { LineageVisual } from "./LineageVisual";
import { ToleranceVisual } from "./ToleranceVisual";
import { SignalVisual } from "./SignalVisual";
import { ScenarioVisual } from "./ScenarioVisual";

type Scalar = string | number | boolean | null;

export interface CrossFilter {
  visualId: string;
  table: string;
  column: string;
  value: Scalar;
  /** Tablo satırı seçimi (ana-ayrıntı): satırın diğer gruplama alanları */
  and?: { table: string; column: string; value: Scalar }[];
  /** Seçili satırın anahtarı (gruplama değerlerinin JSON'u) */
  key?: string;
}

export function visualTitle(v: Visual): string {
  if (v.format.showTitle === false) return "";
  if (v.title) return v.title;
  const vals = v.values.map(valueLabel);
  // Drill-down'da başlık o an görünen düzeyi gösterir (Power BI'daki gibi)
  const axis = supportsDrill(v) && v.group.length > 1 ? currentAxis(v) : undefined;
  const grp = axis ? [axis.column, ...(v.legend ?? []).map((g) => g.column)] : groupFields(v).map((g) => g.column);
  if (v.type === "card" || v.type === "kpi" || v.type === "text" || v.type === "shape" || v.type === "image" || v.type === "button" || v.type === "ticker") return "";
  if (v.type === "slicer") return grp[0] ?? VISUAL_DEFS.slicer.label;
  if (!vals.length && !grp.length) return VISUAL_DEFS[v.type].label;
  if (!vals.length) return grp.join(", ");
  return grp.length ? `${vals.join(", ")} - ${grp.join(", ")}` : vals.join(", ");
}

/** Çapraz filtre: seçimi yapan görsel dışındaki görsellere uygulanır. */
export function crossFiltersFor(v: Visual, cross: CrossFilter | null): FilterRef[] {
  return cross && cross.visualId !== v.id ? selectionFilters(cross) : [];
}

/** Seçimin tüm alanları → filtreler */
export function selectionFilters(cross: CrossFilter): FilterRef[] {
  return [cross, ...(cross.and ?? [])].map((x) => ({ table: x.table, column: x.column, op: "in" as const, values: [x.value] }));
}

/** Tablo satırına tıklama: satırın tüm gruplama alanlarıyla filtre (OINV satırı → INV1 kalemleri). */
export function toggleCrossRow(v: Visual, cross: CrossFilter | null, row: unknown[]): CrossFilter | null {
  const key = JSON.stringify(row.slice(0, v.group.length));
  if (cross && cross.visualId === v.id && cross.key === key) return null;
  const pairs = v.group
    .map((g, i) => ({ table: g.table, column: g.column, value: row[i] }))
    .filter((x): x is { table: string; column: string; value: Scalar } =>
      v.type === "repeater" && x.value === null || x.value !== null && x.value !== undefined && typeof x.value !== "object");
  if (!pairs.length) return cross;
  return { visualId: v.id, ...pairs[0], and: pairs.slice(1), key };
}

// ------------------------------------------------------------------ detaya git (drill-through)
export interface DrillTarget {
  page: ReportPage;
  filters: FilterRef[];
  /** Hedef sayfanın alanları ve seçilen değerleri: "CardName = Anadolu Gıda" */
  label: string;
}

/** Görselde yapılan seçimle açılabilecek detay sayfaları (sayfanın tüm detay alanları seçimde olmalı). */
export function drillTargets(pages: ReportPage[], currentPage: string, v: Visual, cross: CrossFilter | null): DrillTarget[] {
  if (!cross || cross.visualId !== v.id) return [];
  const sel = [cross, ...(cross.and ?? [])];
  const out: DrillTarget[] = [];
  for (const p of pages) {
    const fields = p.drillthrough ?? [];
    if (p.id === currentPage || !fields.length) continue;
    const hits = fields.map((f) => sel.find((x) => x.table === f.table && x.column === f.column));
    if (hits.some((h) => !h)) continue;
    out.push({
      page: p,
      filters: selectionFilters(cross),
      label: hits.map((h) => `${h!.column} = ${formatValue(h!.value, undefined) || "(Boş)"}`).join(", "),
    });
  }
  return out;
}

/** Görsel başlığındaki "Detaya git" düğmesi (birden çok hedef varsa menü). */
export function DrillThroughButton({ targets, onGo }: { targets: DrillTarget[]; onGo: (t: DrillTarget) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  if (!targets.length) return null;
  return (
    <span className="v-drillthrough" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <button
        title={targets.length === 1 ? `Detaya git: ${targets[0].page.name} (${targets[0].label})` : "Detaya git"}
        onClick={() => (targets.length === 1 ? onGo(targets[0]) : setOpen(!open))}
      >
        ↪ Detaya git{targets.length === 1 ? `: ${targets[0].page.name}` : " ▾"}
      </button>
      {open && (
        <div className="v-drillthrough-menu">
          {targets.map((t) => (
            <button key={t.page.id} onClick={() => (setOpen(false), onGo(t))}>
              {t.page.name}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** Detay sayfasındayken sayfanın üstündeki şerit: hangi değerle gelindiği + geri. */
export function DrillBanner({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="drill-banner" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <button onClick={onBack} title="Önceki sayfaya dön">
        ← Geri
      </button>
      <span>
        Detay: <strong>{label}</strong>
      </span>
    </div>
  );
}

/** Çapraz filtre seçimini değiştirir (aynı değere ikinci tıklama seçimi kaldırır). */
export function toggleCross(v: Visual, cross: CrossFilter | null, value: unknown): CrossFilter | null {
  // Drill-down'da çapraz filtre o an görünen düzeyin alanıyla yapılır
  const g = supportsDrill(v) ? currentAxis(v) : v.group[0];
  if (!g || value === null || value === undefined || typeof value === "object") return cross;
  const same = cross && cross.visualId === v.id && cross.value === value;
  return same ? null : { visualId: v.id, table: g.table, column: g.column, value: value as string | number | boolean };
}

function ErrorView({ message, detail, onRetry }: { message: string; detail?: string; onRetry: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="v-error" role="alert">
      <strong>{message}</strong>
      <button type="button" onClick={(e) => { e.stopPropagation(); onRetry(); }}>Tekrar dene</button>
      {detail && (
        <>
          <button className="v-error-more" onClick={() => setOpen(!open)}>
            {open ? "Ayrıntıları gizle" : "Ayrıntılar"}
          </button>
          {open && <pre>{detail}</pre>}
        </>
      )}
    </div>
  );
}

/** Boş verili PBIP taslaklarında alan eşlemesini gerçek veriymiş gibi göstermeden önizler. */
function TemplateVisual({ v }: { v: Visual }) {
  const fields = [...v.group.map((field) => field.column), ...v.values.map(valueLabel)];
  const label = v.title || fields[0] || VISUAL_DEFS[v.type].label;
  const hex = /^#[0-9a-f]{6}$/i.test(v.format.backgroundColor ?? "") ? v.format.backgroundColor! : "#ffffff";
  const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  const dark = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 < 135;
  const theme = dark ? " dark" : "";
  const badge = <span className="v-template-badge">TASLAK · VERİ BEKLENİYOR</span>;
  if (["card", "multicard", "kpi", "gauge", "progress", "ticker"].includes(v.type)) {
    if (v.h < 80) return <div className={`v-template-compact${theme}`} title={`${label}: veri bekleniyor`}><span>{label}</span><b>—</b></div>;
    return <div className={`v-template v-template-card${theme}`}>{badge}<span className="v-template-label">{label}</span><span className="v-template-value">—</span></div>;
  }
  if (v.type === "table" || v.type === "matrix" || v.type === "treegrid") {
    const names = fields.slice(0, 4);
    return <div className={`v-template${theme}`}>{badge}<div className="v-template-row v-template-label">{(names.length ? names : ["Alanlar"]).map((name, i) => <span key={i}>{name}</span>)}</div><div className="v-template-line" /><div className="v-template-line short" /><div className="v-template-line" /></div>;
  }
  if (v.type === "slicer") return <div className={`v-template${theme}`}>{badge}<span className="v-template-label">{label}</span><span className="v-template-chip">Seçim için veri bekleniyor</span></div>;
  const graphic = v.type === "pie" || v.type === "donut" ?
    <div className={`v-template-pie ${v.type}`} aria-hidden="true" /> :
    v.type === "line" || v.type === "area" ?
      <svg className="v-template-lineplot" viewBox="0 0 320 130" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 110 L52 78 L104 92 L160 46 L214 64 L265 26 L320 42" fill="none" stroke="#649ef0" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {v.type === "area" && <path d="M0 110 L52 78 L104 92 L160 46 L214 64 L265 26 L320 42 L320 130 L0 130Z" fill="#dbeafe" opacity=".7" />}
      </svg> :
      v.type === "bar" || v.type === "stackedbar" ?
        <div className="v-template-bars" aria-hidden="true"><i /><i /><i /><i /></div> :
        v.type === "treemap" ? <div className="v-template-treemap" aria-hidden="true"><i /><i /><i /><i /></div> :
        <div className="v-template-chart" aria-hidden="true"><i /><i /><i /><i /><i /></div>;
  return <div className={`v-template${theme}`}>{badge}{graphic}<span className="v-template-label">{typeof v.format.previewLabel === "string" ? v.format.previewLabel : fields.slice(0, 2).join(" · ") || label}</span></div>;
}

/** Bir görselin içeriği: veriyi getirir ve türüne göre çizer. */
export function VisualBody(props: Parameters<typeof VisualBodyContent>[0]) {
  const theme = useReportTheme();
  const resolved = themedVisual(props.v, theme);
  return <VisualErrorBoundary resetKey={JSON.stringify([props.v, props.extra, props.dataRev, props.state])}>
    <VisualBodyContent {...props} v={resolved} />
    {typeof props.v.format.importWarning === "string" && <div className="v-import-warning" role="note">Power BI görseli desteklenmiyor · Aktarım raporunu inceleyin</div>}
  </VisualErrorBoundary>;
}

function VisualBodyContent({
  v, extra, dataRev, cross, onCross, onCrossRow, onRowAction, onAction, pageWidth, pageHeight, detailReady, run, state, onState, fieldType,
}: {
  v: Visual;
  extra: FilterRef[];
  dataRev: string;
  cross: CrossFilter | null;
  onCross: (value: string | number | boolean | null) => void;
  /** Tablo satırı seçimi (verilirse satırın tüm alanlarıyla filtreler) */
  onCrossRow?: (row: unknown[]) => void;
  onRowAction?: (value: string | number | boolean | null) => void;
  onAction?: (action: VisualAction, source?: import("./visualActions").ActionValue, filters?: FilterRef[]) => void;
  pageWidth?: number;
  pageHeight?: number;
  /** Ana-ayrıntı: dışarıdan bir seçim (başka görsel ya da detaya git) var mı */
  detailReady?: boolean;
  run: QueryFn;
  /** Etkileşim durumu (dilimleyici seçimi, sıralama); verilmezse görselin kayıtlı durumu */
  state?: VisualState;
  onState?: (s: VisualState) => void;
  /** Dilimleyici alanının model tipi (aralık dilimleyicisinde tarih/sayı girişi için) */
  fieldType?: ColumnType;
}) {
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt((value) => value + 1);
  const revision = `${dataRev}:${attempt}`;
  const st = state ?? v.state ?? {};
  const vq = st !== v.state ? { ...v, state: st } : v;
  const isMatrix = v.type === "matrix" || v.type === "treegrid";
  const serverGrid = v.format.gridDataMode === "server" && (v.type === "table" || v.type === "treegrid");
  const bound = useContext(BoundVisualContext), row = useRowData();
  const rowResult = useMemo(() => {
    if (!row || !v.values.length) return undefined;
    const parts = v.values.map((value) => sourceResult({ kind: "row", value }, undefined, row));
    return { columns: parts.map((r) => r.columns[0]), rows: [parts.map((r) => r.rows[0]?.[0] ?? null)], total: null, truncated: false };
  }, [row, v.values]);
  const override = bound?.value ?? rowResult;
  const previousBoundValue = useRef<VisualResult | undefined>(undefined);
  if (bound?.value) previousBoundValue.current = bound.value;
  const queried = useVisualData(vq, extra, revision, run, !isMatrix && !serverGrid && !override && !row && !v.bindings?.value);
  const data = override ? { state: "ready" as const, result: override } : queried;
  const mdata = useMatrixData(vq, extra, revision, run, isMatrix && !serverGrid);
  const tq = useMemo(() => row ? null : trendQuery(vq, extra), [vq, extra, row]);
  const tdata = useQueryData(tq, revision, run);
  const ownStatus = isMatrix ? mdata.state : ["container", "shape", "image", "button", "icon", "repeater", "lineage", "signal", "scenario"].includes(v.type) || v.type === "text" && !v.values.length ? "ready" : data.state;
  const reportStatus = bound?.report;
  const contentStatus = ownStatus === "ready" && !isMatrix && data.state === "ready" && (!data.result.rows.length || ["card", "ticker", "kpi"].includes(v.type) && data.result.rows[0]?.[0] == null) ? "empty" : ownStatus;
  const contentSignature = data.state === "ready" && ["card", "ticker", "kpi"].includes(v.type) ? JSON.stringify(data.result.rows) : "";
  useEffect(() => { if (!serverGrid && !["repeater", "lineage", "signal", "scenario"].includes(v.type)) reportStatus?.(contentStatus, contentSignature); }, [contentStatus, contentSignature, reportStatus, serverGrid, v.type]);
  const trend = tdata.state === "ready" ? tdata.result : tdata.state === "loading" ? tdata.previous : undefined;
  const [drillMode, setDrillMode] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuOpen]);
  const drillable = supportsDrill(v) && v.group.length > 1;
  const drill = drillOf(vq);
  const handleClick = (value: string | number | boolean | null) => {
    if (drillable && drillMode && drill.level < v.group.length - 1 && value !== null) {
      onState?.({ ...st, drill: { level: drill.level + 1, path: [...drill.path, value] } });
    } else {
      onCross(value);
    }
  };
  const toolbar = drillable && (
    <div className="v-drill" onPointerDown={(e) => e.stopPropagation()}>
      {drill.path.length > 0 && (
        <span className="v-drill-path" title="Bulunduğunuz düzey">
          {drill.path.map((p) => formatValue(p, undefined) || "(Boş)").join(" › ")} ›
        </span>
      )}
      <button
        disabled={drill.level === 0}
        title="Yukarı çık"
        aria-label="Yukarı çık"
        onClick={() => onState?.({ ...st, drill: { level: drill.level - 1, path: drill.path.slice(0, -1) } })}
      >
        ⬆
      </button>
      <button
        className={drillMode ? "on" : ""}
        title={drillMode ? "Detaya inme modu açık: bir değere tıklayınca içine inilir" : "Detaya inme modunu aç"}
        aria-label="Detaya inme modu"
        aria-pressed={drillMode}
        onClick={() => setDrillMode(!drillMode)}
      >
        ⬇
      </button>
      <button
        disabled={drill.level >= v.group.length - 1}
        title={"Sonraki düzey: " + (v.group[Math.min(drill.level + 1, v.group.length - 1)]?.column ?? "")}
        aria-label="Sonraki düzeye geç"
        onClick={() => onState?.({ ...st, drill: { level: drill.level + 1, path: drill.path } })}
      >
        ⇊
      </button>
    </div>
  );
  const selected = cross && cross.visualId === v.id ? cross.value : undefined;
  const outerSelection = detailReady ?? (!!cross && cross.visualId !== v.id);
  useVisualMenuSource("body", () => [
    ...(!["container", "shape", "image", "button"].includes(v.type) ? [{ label: "Veriyi yeniden sorgula", action: retry }] : []),
    ...(v.type === "slicer" && onState ? [{ label: "Dilimleyici seçimini temizle", action: () => onState({ ...st, selected: [], range: [null, null] }) }] : []),
    ...(drillable && drill.level > 0 && onState ? [{ label: "En üst düzeye dön", action: () => onState({ ...st, drill: { level: 0, path: [] } }) }] : []),
  ]);
  useVisualExports("data-export", v.format, () => {
    if (v.type === "table" || isMatrix || data.state !== "ready" || (v.format.detailOnly && !outerSelection)) return null;
    return { ...data.result, title: v.title || VISUAL_DEFS[v.type].label };
  });

  const hasRuntimeFeedback = bound && (bound.status !== "ready" || contentStatus !== "ready") && (bound.controlled || bound.custom) && (bound.controlled || !serverGrid && !["repeater", "lineage", "signal", "scenario"].includes(v.type));
  let runtimeFeedback = null;
  if (hasRuntimeFeedback) {
    const status = bound.status !== "ready" ? bound.status : contentStatus;
    runtimeFeedback = <div className={`v-runtime-state v-runtime-${status}`} role={status === "error" ? "alert" : "status"} aria-busy={status === "loading"}>
      <span title={bound.message}>{bound.icon && <ActionGlyph icon={bound.icon} />}{bound.custom ?? (status === "loading" ? "Yükleniyor…" : status === "error" ? "Veri bağı çalıştırılamadı" : "Bu seçim için veri yok")}</span>
      {status === "error" && <><span className="v-runtime-detail" title={bound.message ?? (data.state === "error" ? data.error.detail : undefined)}>{bound.message ?? (data.state === "error" ? data.error.detail : undefined)}</span><button type="button" onClick={(e) => { e.stopPropagation(); bound.retry(); retry(); }}>Tekrar dene</button></>}
    </div>;
  }
  // Yüklenirken görünümü sakla, sayaç bileşenini kaldırma: yeni değer aynı hareketi sürdürür.
  if ((v.type === "card" || v.type === "ticker") && v.bindings?.value) {
    const result = bound?.value ?? previousBoundValue.current;
    return <>{runtimeFeedback}{result && <div style={{ height: "100%", display: runtimeFeedback ? "none" : undefined }}>
      {v.type === "card" ? <CardVisual result={result} format={v.format} trend={trend} /> : <TickerVisual result={result} format={v.format} />}
    </div>}</>;
  }
  if (runtimeFeedback) return runtimeFeedback;
  if (v.type === "scenario") return <ScenarioVisual {...{ v, extra, revision, run }} />;
  if (v.type === "signal") return <SignalVisual {...{ v, extra, revision, run }} />;
  if (v.type === "lineage") return <LineageVisual {...{ v, extra, revision, run }} />;
  if (v.type === "repeater") return <RepeaterVisual {...{ v, extra, revision, run, onSelectRow: onCrossRow, onAction }} selectedKey={cross?.visualId === v.id ? cross.key : undefined} />;
  if (v.type === "container") return null;
  if (v.type === "icon") return <span className="v-data-icon" style={{ color: v.format.color }}><ActionGlyph icon={v.format.buttonIcon ?? "arrow"} /></span>;
  if (v.type === "shape") return <ShapeVisual format={v.format} />;
  if (v.type === "image") return <ImageVisual format={v.format} />;
  if (v.type === "button") {
    const label = typeof v.format.text === "string" ? v.format.text : "Düğme";
    const action = v.format.action;
    const buttonStyle = v.format.buttonStyle ?? "solid";
    const icon = safeActionIcon(v.format.buttonIconData);
    return <div className={`v-button-wrap ${pageHeight && v.y + v.h > pageHeight - 280 ? "menu-up" : ""} ${pageWidth && v.x + v.w > pageWidth - 180 ? "menu-left" : ""}`} ref={menuRef}>
      <button type="button" aria-label={label} aria-expanded={action?.type === "menu" ? menuOpen : undefined}
        className={`v-action-button ${v.format.buttonInvisible ? "hotspot" : v.format.buttonStyle ?? "solid"} ${icon && v.format.buttonIconPosition === "top" ? "icon-top" : ""}`}
        style={{ backgroundColor: buttonStyle === "solid" && !v.format.buttonInvisible ? v.format.buttonColor || "#2563eb" : undefined,
          color: v.format.buttonTextColor || (buttonStyle === "solid" ? "#ffffff" : v.format.buttonColor || "#2563eb"), fontSize: v.format.fontSize,
          borderColor: v.format.buttonColor || "#2563eb", borderWidth: v.format.borderWidth, fontFamily: v.format.fontFamily }}
        onClick={(e) => { e.stopPropagation(); if (!onAction || !action) return;
          if (action.type === "menu") setMenuOpen((open) => !open); else onAction(action); }}>
        {!v.format.buttonInvisible && <>{icon && <img className="v-button-icon" src={icon} alt="" style={{ width: Math.max(12, Math.min(200, v.format.buttonIconSize ?? 24)), height: Math.max(12, Math.min(200, v.format.buttonIconSize ?? 24)) }} />}<span>{label}</span>{!icon && <ActionGlyph icon={v.format.buttonIcon ?? (action?.type === "menu" ? "menu" : "arrow")} />}</>}
      </button>
      {menuOpen && action?.type === "menu" && onAction && <div className="v-action-menu-list" role="menu">
        {!action.items?.length && <span className="v-action-menu-empty">Menü öğesi eklenmedi</span>}
        {(action.items ?? []).map((item) => <button type="button" key={item.id} role="menuitem"
          onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onAction(item.action); }}>
          <ActionGlyph icon={item.icon ?? "arrow"} /><span>{item.label}</span>
        </button>)}
      </div>}
    </div>;
  }
  if (v.type === "text") {
    if (data.state === "error") return <ErrorView {...data.error} onRetry={retry} />;
    const r = data.state === "ready" ? data.result : data.state === "loading" ? data.previous : undefined;
    return <TextVisual v={v} result={r} loading={data.state === "loading"} />;
  }
  if (v.format.detailOnly && !outerSelection) {
    return <div className="v-detail-wait">Ayrıntıları görmek için başka bir görselde bir değer ya da satır seçin</div>;
  }

  if (serverGrid) {
    if (!v.values.length && !v.group.length || v.type === "treegrid" && (!v.group.length || !v.values.length)) return <div className="v-empty">Alan ekleyin</div>;
    return v.type === "treegrid" ? <ServerTree {...{ v, extra, revision, run, onState, onRowAction }} state={st} onSelect={onCross} onSelectRow={onCrossRow} /> :
      <ServerTable {...{ v, revision, run, onState, onRowAction, selected }} state={st} query={buildQuery(vq, extra)!}
        onSelect={onCross} onSelectRow={onCrossRow} selectedKey={cross?.visualId === v.id ? cross.key : undefined} />;
  }
  if (isMatrix) {
    if (mdata.state === "empty") {
      return (
        <div className="v-empty">
          {VISUAL_DEFS[v.type].icon}
          <span>Alan ekleyin</span>
        </div>
      );
    }
    if (mdata.state === "error") return <ErrorView {...mdata.error} onRetry={retry} />;
    const parts = mdata.state === "ready" ? mdata.parts : mdata.previous;
    if (v.format.templatePreview && (!parts || parts.every((part) => part.result.rows.length === 0))) return <TemplateVisual v={v} />;
    if (!parts) return <div className="v-empty v-loading">Yükleniyor…</div>;
    if (mdata.state === "ready" && parts.every((part) => part.result.rows.length === 0))
      return <div className="v-empty v-no-data" role="status"><span>Bu seçim için veri yok</span></div>;
    return (
      <div aria-busy={mdata.state === "loading"} className={"v-body " + (mdata.state === "loading" ? "loading" : "")}>
        {mdata.state === "loading" && <span className="v-refreshing" role="status">Güncelleniyor…</span>}
        <MatrixVisual v={v} parts={parts} state={st} onState={onState} selected={selected} onSelect={onCross}
          onRowAction={onRowAction} loading={mdata.state === "loading"} />
      </div>
    );
  }

  if (data.state === "empty") {
    return (
      <div className="v-empty">
        {VISUAL_DEFS[v.type].icon}
        <span>Alan ekleyin</span>
      </div>
    );
  }
  if (data.state === "error") return <ErrorView {...data.error} onRetry={retry} />;
  const result = data.state === "ready" ? data.result : data.previous;
  if (v.format.templatePreview && (!result || result.rows.length === 0)) return <TemplateVisual v={v} />;
  if (!result) return <div className="v-empty v-loading">Yükleniyor…</div>;
  if (data.state === "ready" && (result.rows.length === 0 ||
      (["card", "kpi", "ticker"].includes(v.type) && result.rows[0]?.[0] == null)))
    return <div className="v-empty v-no-data" role="status"><span>Bu seçim için veri yok</span></div>;
  const def = VISUAL_DEFS[v.type];
  return (
    <div aria-busy={data.state === "loading"} className={`v-body ${data.state === "loading" ? "loading" : ""}`}>
      {data.state === "loading" && <span className="v-refreshing" role="status">Güncelleniyor…</span>}
      {toolbar}
      {def.category && (
        <CategoryChart result={result} def={def} format={v.format} hasLegend={!!v.legend?.length} selected={selected} onSelect={handleClick} />
      )}
      {(v.type === "pie" || v.type === "donut") && (
        <PieChartVisual result={result} donut={v.type === "donut"} format={v.format} selected={selected} onSelect={handleClick} />
      )}
      {v.type === "treemap" && <TreemapVisual result={result} format={v.format} selected={selected} onSelect={handleClick} />}
      {v.type === "scatter" && (
        <ScatterVisual result={result} format={v.format} hasLegend={!!v.legend?.length} selected={selected} onSelect={onCross} />
      )}
      {v.type === "heatmap" && <HeatmapVisual result={result} selected={selected} onSelect={onCross} />}
      {v.type === "waterfall" && <WaterfallVisual result={result} format={v.format} selected={selected} onSelect={onCross} />}
      {v.type === "gauge" && (
        <GaugeVisual result={result} format={v.format} hasMax={v.values.length > 1} hasTarget={!!v.target?.length} />
      )}
      {v.type === "progress" && <ProgressVisual result={result} />}
      {v.type === "table" && (
        <AgDataGrid
          result={result} selected={selected} onSelect={onCross} format={v.format}
          loading={data.state === "loading"}
          selectedKey={cross && cross.visualId === v.id ? cross.key : undefined}
          onSelectRow={onCrossRow}
          onRowAction={onRowAction}
          sort={st.sort} onSort={onState ? (sort) => onState({ ...st, sort }) : undefined}
        />
      )}
      {v.type === "card" && <CardVisual result={result} format={v.format} trend={trend} />}
      {v.type === "ticker" && <TickerVisual result={result} format={v.format} />}
      {v.type === "multicard" && <MultiCard result={result} selected={selected} onSelect={onCross} />}
      {v.type === "kpi" && <KpiVisual result={result} format={v.format} trend={trend} />}
      {v.type === "tolerance" && <ToleranceVisual result={result} format={v.format} />}
      {v.type === "slicer" && (
        <Slicer result={result} format={v.format} state={st} onState={(s) => onState?.(s)} fieldType={fieldType} />
      )}
    </div>
  );
}
