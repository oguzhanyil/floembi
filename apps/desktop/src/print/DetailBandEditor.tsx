import { Fragment, type ReactNode } from "react";
import { detailLabels, formCellText, headerLabels, scaleLineX, type DetailBand, type LineShape, type PrintRecord, type RowPart } from "@floem/client";
import { NumberField } from "./FormObjectProperties";
import { LineSurface } from "./LineSurface";

export interface PendingRowLine { at: number; line: LineShape }
export const rowPartKey = (part: RowPart) => part.type === "data" ? "data" : part.type + "." + part.id;
export const newRowLine = (): LineShape => ({ type: "line", id: crypto.randomUUID(), x1: 0, x2: 100, y1: .3, y2: .3, color: "#708991", thickness: .25, style: "solid" });
const partNames = { data: "Ana veri satırı", text: "Metin / veri alanı", line: "Çizgi" };

export function DetailBandEditor({ band, title, partKey, setPart, change, draw, pending, cancel, close, reset, hasDetail }: {
  band: DetailBand; title: string; partKey: string; setPart: (key: string) => void;
  change: (v: DetailBand) => void; draw: (at: number) => void; pending: PendingRowLine | null;
  cancel: () => void; close: () => void; reset: () => void; hasDetail: boolean;
}) {
  const i = Math.max(0, band.parts.findIndex(p => rowPartKey(p) === partKey)), part = band.parts[i];
  const full = band.parts.length >= 24;
  const replace = (p: RowPart) => change({ ...band, parts: band.parts.map((v, j) => j === i ? p : v) });
  function insert(p: RowPart, at = i + 1) {
    const parts = band.parts.slice(); parts.splice(at, 0, p); change({ ...band, parts }); setPart(rowPartKey(p)); cancel();
  }
  function move(by: number) {
    const parts = band.parts.slice(); [parts[i], parts[i + by]] = [parts[i + by], parts[i]]; change({ ...band, parts }); cancel();
  }
  return <fieldset className="form-inspector detail-inspector"><legend>{title}</legend>
    <label>Banttaki öğe<select value={rowPartKey(part)} onChange={e => { setPart(e.target.value); cancel(); }}>
      {band.parts.map((p, j) => <option key={rowPartKey(p)} value={rowPartKey(p)}>{j + 1}. {partNames[p.type]}</option>)}</select></label>
    {part.type === "data" && <>
      <NumberField label="En az satır yüksekliği (mm)" min={1} max={60} value={band.minHeight} change={minHeight => change({ ...band, minHeight })} />
      <NumberField label="Yazı boyutu (pt)" min={6} max={24} value={band.size} change={size => change({ ...band, size })} />
      <label>Yazı rengi<input type="color" value={band.color} onChange={e => change({ ...band, color: e.target.value })} /></label>
      <label className="print-check"><input type="checkbox" checked={band.bold} onChange={e => change({ ...band, bold: e.target.checked })} />Kalın yazı</label>
    </>}
    {part.type === "text" && <>
      <label>Satır metni<textarea maxLength={500} value={part.text} onChange={e => replace({ ...part, text: e.target.value })} /></label>
      <label>Metne alan ekle<select value="" onChange={e => { if (e.target.value) replace({ ...part, text: (part.text + "{" + e.target.value + "}").slice(0, 500) }); }}>
        <option value="">Alan seçin</option>{hasDetail && <optgroup label="Kalem">{Object.entries(detailLabels).map(([k, v]) => <option value={k} key={k}>{v}</option>)}</optgroup>}
        <optgroup label="Belge">{Object.entries(headerLabels).map(([k, v]) => <option value={k} key={k}>{v}</option>)}</optgroup></select></label>
      <div className="form-pair"><NumberField label="Soldan (%)" min={0} max={100 - part.width} value={part.x} change={x => replace({ ...part, x })} />
        <NumberField label="Alan genişliği (%)" min={1} max={100 - part.x} value={part.width} change={width => replace({ ...part, width })} /></div>
      <div className="form-pair"><label>Metin hizası<select value={part.align} onChange={e => replace({ ...part, align: e.target.value as typeof part.align })}>
        <option value="left">Sola</option><option value="center">Ortaya</option><option value="right">Sağa</option></select></label>
        <NumberField label="Metin boyutu (pt)" min={6} max={24} value={part.size} change={size => replace({ ...part, size })} /></div>
      <label>Metin rengi<input type="color" value={part.color} onChange={e => replace({ ...part, color: e.target.value })} /></label>
      <label className="print-check"><input type="checkbox" checked={part.bold} onChange={e => replace({ ...part, bold: e.target.checked })} />Kalın metin</label>
    </>}
    {part.type === "line" && <>
      <div className="form-pair">{(["x1", "y1", "x2", "y2"] as const).map(k => <NumberField key={k}
        label={k.toUpperCase() + (k.startsWith("x") ? " (%)" : " (mm)")} min={0} max={k.startsWith("x") ? 100 : 60} value={part[k]}
        change={v => replace({ ...part, [k]: v })} />)}</div>
      <label>Ayraç biçimi<select value={part.style} onChange={e => replace({ ...part, style: e.target.value as typeof part.style })}>
        <option value="solid">Düz</option><option value="dashed">Kesikli</option><option value="dotted">Noktalı</option></select></label>
      <NumberField label="Ayraç kalınlığı (mm)" min={.1} max={3} value={part.thickness} change={thickness => replace({ ...part, thickness })} />
      <label>Ayraç rengi<input type="color" value={part.color} onChange={e => replace({ ...part, color: e.target.value })} /></label>
    </>}
    <div className="form-actions"><button disabled={full} onClick={() => draw(i)}>Önüne çizgi çiz</button><button disabled={full} onClick={() => draw(i + 1)}>Arkasına çizgi çiz</button>
      <button disabled={full} onClick={() => insert(newRowLine(), pending?.at)}>Yatay ayraç ekle</button>
      <button disabled={full} onClick={() => insert({ type: "text", id: crypto.randomUUID(), text: hasDetail ? "{Dscription}" : "{DocNum}",
        x: 0, width: 100, align: "left", size: 9, bold: false, color: "#435864" })}>Alan / metin ekle</button>
      {pending && <button onClick={cancel}>Çizimi iptal et</button>}</div>
    <div className="form-actions"><button disabled={!i} onClick={() => move(-1)}>Öğeyi yukarı taşı</button>
      <button disabled={i === band.parts.length - 1} onClick={() => move(1)}>Öğeyi aşağı taşı</button>
      {part.type !== "data" && <button onClick={() => { change({ ...band, parts: band.parts.filter((_, j) => j !== i) }); setPart("data"); cancel(); }}>Öğeyi sil</button>}</div>
    <div className="form-actions"><button onClick={close}>Düzenlemeyi bitir</button><button onClick={reset}>Varsayılan satıra dön</button></div>
  </fieldset>;
}

export function DetailRowView({ band, columns, width, guideOffset, guides, snap, data, detail, background, children, active,
  partKey, pending, select, commitLine, commitNew }: {
  band?: DetailBand | null; columns: number; width: number; guideOffset: number; guides: number[]; snap: boolean;
  data: PrintRecord; detail?: PrintRecord["lines"][number]; background?: string; children: ReactNode; active: boolean;
  partKey: string; pending: PendingRowLine | null; select: (key: string) => void;
  commitLine: (line: LineShape) => void; commitNew: (line: LineShape) => void;
}) {
  const parts = band?.parts ?? [{ type: "data" } as const];
  const localGuides = guides.map(g => g - guideOffset);
  const toPercent = (line: LineShape) => {
    const p = scaleLineX(line, 100 / width);
    return { ...p, x1: Math.max(0, Math.min(100, +p.x1.toFixed(3))), x2: Math.max(0, Math.min(100, +p.x2.toFixed(3))) };
  };
  const slot = (at: number) => active && pending?.at === at && <tr className="band-part"><td colSpan={columns}>
    <LineSurface line={scaleLineX(pending.line, width / 100)} width={width} editHeight={14} drawing compact snap={snap}
      guides={localGuides} select={() => {}} commit={l => commitNew(toPercent(l))} /></td></tr>;
  return <>{parts.map((part, i) => <Fragment key={rowPartKey(part)}>{slot(i)}
    {part.type === "data" ? <tr className={(band ? "band-data " : "") + (active && partKey === "data" ? "band-active-data" : "")} style={{ background,
      height: band ? band.minHeight + "mm" : undefined, fontSize: band ? band.size + "pt" : undefined, fontWeight: band?.bold ? 700 : undefined, color: band?.color }}>{children}</tr> :
      <tr className={"band-part" + (active && partKey === rowPartKey(part) ? " active" : "")} style={{ background }}><td colSpan={columns}>
        {part.type === "line" ? <LineSurface width={width} editHeight={14} compact line={scaleLineX(part, width / 100)} snap={snap}
          guides={localGuides} selected={active && partKey === rowPartKey(part)} select={() => select(rowPartKey(part))} commit={l => commitLine(toPercent(l))} /> :
          <button className="band-text" style={{ marginLeft: part.x + "%", width: part.width + "%", fontSize: part.size + "pt",
            fontWeight: part.bold ? 700 : 400, textAlign: part.align, color: part.color }} onClick={() => select(rowPartKey(part))}>{formCellText(part.text, data.header, detail) || " "}</button>}
      </td></tr>}
  </Fragment>)}{slot(parts.length)}</>;
}
