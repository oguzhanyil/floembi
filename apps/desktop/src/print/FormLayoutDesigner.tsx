import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { bands, detailLabels, emptyPrintLayout, formCellText, formRowColor, formTableColumns, formTableRows, formWidthMm, groupFormLines,
  type FormBand, type FormBlock, type FormLine, type PrintLayout, type PrintRecord, type PrintTemplate } from "@floem/client";
import { FormSheet } from "./FormSheet";
import { FormObjectProperties } from "./FormObjectProperties";
import { LineSurface } from "./LineSurface";

const amount = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const newLine = (band: FormBand, color: string): FormLine => ({
  id: crypto.randomUUID(), type: "line", band, color, x1: 0, y1: 2, x2: formWidthMm, y2: 2, thickness: .5, style: "solid",
});

export function FormLayoutDesigner({ template, data, inspector, change }: {
  template: PrintTemplate; data: PrintRecord; inspector: HTMLElement | null; change: (layout: PrintLayout) => void;
}) {
  const layout = template.layout ?? emptyPrintLayout;
  const [band, setBand] = useState<FormBand>("header"), [selectedId, select] = useState(""), [drawing, setDrawing] = useState<FormLine | null>(null);
  const [rulers, setRulers] = useState(true), [snap, setSnap] = useState(true), [cell, selectCell] = useState({ r: 0, c: 0 });
  const selected = layout.blocks.find(b => b.id === selectedId);
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (drawing || selectedId) surface.current?.querySelector(drawing ? ".form-line-surface.drawing" : ".form-block.selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId, drawing]);
  const setBlocks = (blocks: FormBlock[]) => change({ ...layout, blocks });
  const add = (block: FormBlock) => { setBlocks([...layout.blocks, block]); select(block.id); selectCell({ r: 0, c: 0 }); setDrawing(null); };
  const update = (block: FormBlock) => setBlocks(layout.blocks.map(b => b.id === block.id ? block : b));
  const siblings = selected ? layout.blocks.filter(b => b.band === selected.band) : [];
  function reorder(by: number) {
    const other = siblings[siblings.findIndex(b => b.id === selectedId) + by];
    if (selected && other) setBlocks(layout.blocks.map(b => b.id === selected.id ? other : b.id === other.id ? selected : b));
  }
  function objects(section: FormBand) {
    return <div className="form-objects" data-band={section}>
      {layout.blocks.filter(b => b.band === section).map(b => {
        const active = b.id === selectedId;
        const columns = b.type === "table" ? formTableColumns(b) : [];
        return <div key={b.id} className={"form-block" + (active ? " selected" : "")}>
          {b.type === "line" ? <LineSurface line={b} selected={active} guides={rulers ? layout.guides : []} snap={snap}
            select={() => select(b.id)} commit={update} /> :
            <table className="form-custom-table" style={{ marginLeft: b.x + "mm", width: b.width + "mm" }} aria-label="Eklenen tablo">
              {b.repeatRow != null && data.lines.length > 4 && <caption>Tasarımda ilk 4 kalem · A4 önizlemede {data.lines.length} kalem</caption>}
              <colgroup>{columns.map((col, i) => <col key={i} style={{ width: col.width / b.width * 100 + "%" }} />)}</colgroup>
              <tbody>{formTableRows(b, data, layout, true).map(({ source: r, ...row }, i) => <tr key={i} style={{ background: row.color, fontWeight: row.header ? 700 : undefined }}>
                {row.cells.map((txt, c) => <td key={c}><button style={{ textAlign: columns[c].align }} className={active && cell.r === r && cell.c === c ? "active-cell" : ""}
                  aria-label={`Hücre ${r + 1}, ${c + 1}`} onClick={() => { select(b.id); selectCell({ r, c }); }}>{txt || " "}</button></td>)}
              </tr>)}</tbody></table>}
        </div>;
      })}
      {drawing?.band === section && <LineSurface key={drawing.id} line={drawing} drawing guides={rulers ? layout.guides : []} snap={snap} select={() => {}} commit={add} />}
    </div>;
  }
  const sample = groupFormLines(data.lines, template.groupBy).flatMap(([, rows]) => rows).slice(0, 4);
  return <>
    <div className="form-object-tools">
      <label>Bölüm <select value={band} onChange={e => { setBand(e.target.value as FormBand); setDrawing(null); }}>
        {Object.entries(bands).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <button disabled={layout.blocks.length >= 80} aria-pressed={!!drawing} onClick={() => {
        if (drawing) setDrawing(null); else { select(""); setDrawing(newLine(band, template.accent)); }
      }}>{drawing ? "Çizimi iptal et" : "Çizgi çiz"}</button>
      {drawing && <button onClick={() => add(drawing)}>Yatay çizgi ekle</button>}
      <button disabled={layout.blocks.length >= 80} onClick={() => add({ id: crypto.randomUUID(), type: "table", band, x: 0,
        width: 120, header: true, rows: [{ cells: ["Alan", "Değer"] }, { cells: ["Belge numarası", "{DocNum}"] }] })}>Tablo ekle</button>
      <button aria-pressed={rulers} onClick={() => setRulers(!rulers)}>Cetvel</button>
      <label><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} /> Hizalamaya yakala</label>
      {layout.guides.length > 0 && <button onClick={() => change({ ...layout, guides: [] })}>Kılavuzları temizle</button>}
      {layout.blocks.length > 0 && <label>Nesne <select value={selectedId} onChange={e => { select(e.target.value); selectCell({ r: 0, c: 0 }); }}>
        <option value="">Seçin</option>{layout.blocks.map((b, i) => <option key={b.id} value={b.id}>{i + 1}. {b.type === "line" ? "Çizgi" : "Tablo"} · {bands[b.band]}</option>)}</select></label>}
    </div>
    {selected && inspector && createPortal(<FormObjectProperties key={selected.id} block={selected} guides={layout.guides} cell={cell} selectCell={selectCell}
      update={update} remove={() => { setBlocks(layout.blocks.filter(b => b.id !== selected.id)); select(""); }}
      reorder={reorder} first={siblings[0] === selected} last={siblings.at(-1) === selected} />, inspector)}
    <div className="form-sheet-host" ref={surface}><FormSheet rulers={rulers} guides={layout.guides} onGuides={guides => change({ ...layout, guides })}>
      <div className="print-band">Belge başlığı</div>
      {template.logo && <img className="print-logo" src={template.logo} alt="Firma logosu" />}
      {template.issuer && <strong>{template.issuer}</strong>}
      <h1 style={{ color: template.accent }}>{template.title}</h1>
      {objects("header")}
      <div className="print-parties"><section><b>{data.header.CardName}</b><div>{data.header.Address}</div></section>
        <section><b>{data.header.DocNum}</b><div>{formCellText("{DocDate}", data.header)}</div></section></div>
      {objects("beforeDetail")}
      {!layout.hideMainDetail && <><div className="print-band">Detay · {sample.length} örnek kalem</div>
      <table className="form-detail-table"><thead style={{ background: template.accent }}><tr>{template.columns.map(c => <th key={c}>{detailLabels[c]}</th>)}</tr></thead>
        <tbody>{sample.map((row, i) => <tr key={row.LineNum} style={{ background: formRowColor(layout, row, i) }}>
          {template.columns.map(c => <td key={c}>{formCellText("{" + c + "}", data.header, row)}</td>)}</tr>)}</tbody></table></>}
      <div className="print-band">Belge alt bilgisi</div>
      {objects("footer")}
      <p>{data.header.Comments}</p><p>{template.note}</p>
      <p className="print-total">Genel toplam <b>{amount(data.header.DocTotal)} {data.header.DocCur === "TRY" ? "TL" : data.header.DocCur}</b></p>
    </FormSheet></div>
  </>;
}
