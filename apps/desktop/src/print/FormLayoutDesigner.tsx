import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { bands, detailLabels, emptyPrintLayout, formCellText, formRowColor, formTableColumns, formTableRows, formWidthMm, groupFormLines, plainDetailBand,
  type DetailBand, type FormBand, type FormBlock, type FormLine, type FormTable, type LineShape, type PrintLayout, type PrintRecord, type PrintTemplate } from "@floem/client";
import { FormSheet } from "./FormSheet";
import { FormObjectProperties } from "./FormObjectProperties";
import { LineSurface } from "./LineSurface";
import { DetailBandEditor, DetailRowView, newRowLine, rowPartKey, type PendingRowLine } from "./DetailBandEditor";

const amount = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const newLine = (band: FormBand, color: string): FormLine => ({
  id: crypto.randomUUID(), type: "line", band, color, x1: 0, y1: 2, x2: formWidthMm, y2: 2, thickness: .5, style: "solid",
});
type RowTarget = { table: string; row: number; instance: number };
const headerBand: DetailBand = { ...plainDetailBand, bold: true };

export function FormLayoutDesigner({ template, data, inspector, change }: {
  template: PrintTemplate; data: PrintRecord; inspector: HTMLElement | null; change: (layout: PrintLayout) => void;
}) {
  const layout = template.layout ?? emptyPrintLayout;
  const [band, setBand] = useState<FormBand>("header"), [selectedId, select] = useState(""), [drawing, setDrawing] = useState<FormLine | null>(null);
  const [rulers, setRulers] = useState(true), [snap, setSnap] = useState(true), [cell, selectCell] = useState({ r: 0, c: 0 });
  const selected = layout.blocks.find(b => b.id === selectedId);
  const [target, setTarget] = useState<RowTarget | null>(null), [part, setPart] = useState("data");
  const [pending, setPending] = useState<PendingRowLine | null>(null);
  const targetTable = layout.blocks.find((b): b is FormTable => b.type === "table" && b.id === target?.table);
  const activeBand = (targetTable ? targetTable.rows[target!.row]?.detailBand : layout.detailBand)
    ?? (targetTable?.header && target?.row === 0 ? headerBand : plainDetailBand);
  const closeBand = () => { setTarget(null); setPending(null); };
  const chooseObject = (id: string) => { closeBand(); select(id); };
  const editBand = (at: RowTarget, key = "data") => {
    setTarget(at); setPart(key); setDrawing(null); select(""); setPending(null);
  };
  function editVisibleBand() {
    const table = layout.hideMainDetail && layout.blocks.find((b): b is FormTable => b.type === "table" && b.repeatRow != null);
    if (table) editBand({ table: table.id, row: table.repeatRow!, instance: table.repeatRow! });
    else editBand({ table: "", row: 0, instance: 0 });
  }
  function changeRow(at: RowTarget, value: DetailBand | null) {
    if (!at.table) change({ ...layout, detailBand: value });
    else setBlocks(layout.blocks.map(b => b.id === at.table && b.type === "table" ? { ...b, rows: b.rows.map((r, i) => i === at.row ? { ...r, detailBand: value } : r) } : b));
  }
  const canEditDefault = !layout.hideMainDetail || layout.blocks.some(b => b.type === "table" && b.repeatRow != null);
  useEffect(() => {
    if (layout.hideMainDetail && target?.table === "") { setTarget(null); setPending(null); }
  }, [layout.hideMainDetail, target]);
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (drawing || pending || selectedId) surface.current?.querySelector(drawing || pending ? ".form-line-surface.drawing" : ".form-block.selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId, drawing, pending]);
  const setBlocks = (blocks: FormBlock[]) => change({ ...layout, blocks });
  const add = (block: FormBlock) => { setBlocks([...layout.blocks, block]); chooseObject(block.id); selectCell({ r: 0, c: 0 }); setDrawing(null); };
  const update = (block: FormBlock) => setBlocks(layout.blocks.map(b => b.id === block.id ? block : b));
  const siblings = selected ? layout.blocks.filter(b => b.band === selected.band) : [];
  function reorder(by: number) {
    const other = siblings[siblings.findIndex(b => b.id === selectedId) + by];
    if (selected && other) setBlocks(layout.blocks.map(b => b.id === selected.id ? other : b.id === other.id ? selected : b));
  }
  function rowEvents(at: RowTarget, config?: DetailBand | null, header = false) {
    const current = config ?? (header ? headerBand : plainDetailBand);
    return { active: target?.table === at.table && target.row === at.row && target.instance === at.instance,
      partKey: part, pending, data, guides: rulers ? layout.guides : [], snap,
      select: (key: string) => editBand(at, key),
      commitLine: (line: LineShape) => changeRow(at, { ...current, parts: current.parts.map(p => p.type === "line" && p.id === line.id ? line : p) }),
      commitNew: (line: LineShape) => {
        if (!pending || current.parts.length >= 24) return;
        const parts = current.parts.slice(); parts.splice(pending.at, 0, line);
        changeRow(at, { ...current, parts }); setPart(rowPartKey(line)); setPending(null);
      } };
  }
  function objects(section: FormBand) {
    return <div className="form-objects" data-band={section}>
      {layout.blocks.filter(b => b.band === section).map(b => {
        const active = b.id === selectedId;
        const columns = b.type === "table" ? formTableColumns(b) : [];
        return <div key={b.id} className={"form-block" + (active ? " selected" : "")}>
          {b.type === "line" ? <LineSurface line={b} selected={active} guides={rulers ? layout.guides : []} snap={snap}
            select={() => chooseObject(b.id)} commit={update} /> :
            <table className="form-custom-table" style={{ marginLeft: b.x + "mm", width: b.width + "mm" }} aria-label="Eklenen tablo">
              {b.repeatRow != null && data.lines.length > 4 && <caption>Tasarımda ilk 4 kalem · A4 önizlemede {data.lines.length} kalem</caption>}
              <colgroup>{columns.map((col, i) => <col key={i} style={{ width: col.width / b.width * 100 + "%" }} />)}</colgroup>
              <tbody>{formTableRows(b, data, layout, true).map(({ source: r, ...row }, i) => {
                const at = { table: b.id, row: r, instance: i }, config = b.rows[r].detailBand;
                return <DetailRowView key={i} {...rowEvents(at, config, row.header)} band={config} detail={row.detail} background={row.color} columns={columns.length} width={b.width} guideOffset={b.x}>
                  {row.cells.map((txt, c) => <td key={c}><button style={{ textAlign: columns[c].align, fontWeight: row.header && !config ? 700 : undefined }}
                    className={active && cell.r === r && cell.c === c ? "active-cell" : ""} aria-label={`Hücre ${r + 1}, ${c + 1}`}
                    title="Hücreyi seçin. Satır bandını düzenlemek için çift tıklayın." onDoubleClick={() => editBand(at)} onClick={() => {
                      if (target) editBand(at); else { chooseObject(b.id); selectCell({ r, c }); }
                    }}>{txt || " "}</button></td>)}</DetailRowView>;
              })}</tbody></table>}
        </div>;
      })}
      {drawing?.band === section && <LineSurface key={drawing.id} line={drawing} drawing guides={rulers ? layout.guides : []} snap={snap} select={() => {}} commit={add} />}
    </div>;
  }
  const sample = groupFormLines(data.lines, template.groupBy).flatMap(([, rows]) => rows).slice(0, 4);
  return <>
    <div className="form-object-tools">
      <label>Bölüm <select value={target ? "detail" : band} onChange={e => {
        if (e.target.value === "detail") editVisibleBand(); else { closeBand(); setBand(e.target.value as FormBand); setDrawing(null); }
      }}>{Object.entries(bands).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="detail" disabled={!canEditDefault && !target}>Detay satırı</option></select></label>
      <button disabled={target ? activeBand.parts.length >= 24 : layout.blocks.length >= 80} aria-pressed={!!drawing || !!pending} onClick={() => {
        if (target) { setPending(pending ? null : { at: activeBand.parts.findIndex(p => rowPartKey(p) === part) + 1, line: newRowLine() }); }
        else if (drawing) setDrawing(null); else { select(""); setDrawing(newLine(band, template.accent)); }
      }}>{drawing || pending ? "Çizimi iptal et" : "Çizgi çiz"}</button>
      {drawing && <button onClick={() => add(drawing)}>Yatay çizgi ekle</button>}
      <button disabled={!!target || layout.blocks.length >= 80} onClick={() => add({ id: crypto.randomUUID(), type: "table", band, x: 0,
        width: 120, header: true, rows: [{ cells: ["Alan", "Değer"] }, { cells: ["Belge numarası", "{DocNum}"] }] })}>Tablo ekle</button>
      <button aria-pressed={!!target} disabled={!canEditDefault && !target} onClick={target ? closeBand : editVisibleBand}>Detay satırını düzenle</button>
      <button aria-pressed={rulers} onClick={() => setRulers(!rulers)}>Cetvel</button>
      <label><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} /> Hizalamaya yakala</label>
      {layout.guides.length > 0 && <button onClick={() => change({ ...layout, guides: [] })}>Kılavuzları temizle</button>}
      {layout.blocks.length > 0 && <label>Nesne <select value={selectedId} onChange={e => { chooseObject(e.target.value); selectCell({ r: 0, c: 0 }); }}>
        <option value="">Seçin</option>{layout.blocks.map((b, i) => <option key={b.id} value={b.id}>{i + 1}. {b.type === "line" ? "Çizgi" : "Tablo"} · {bands[b.band]}</option>)}</select></label>}
    </div>
    {selected && inspector && createPortal(<FormObjectProperties key={selected.id} block={selected} guides={layout.guides} cell={cell} selectCell={selectCell}
      editRow={selected.type === "table" ? drawImmediately => {
        const rows = formTableRows(selected, data, layout, true);
        editBand({ table: selected.id, row: cell.r, instance: rows.findIndex(r => r.source === cell.r) });
        if (drawImmediately) {
          const parts = selected.rows[cell.r].detailBand?.parts ?? plainDetailBand.parts;
          setPending({ at: parts.findIndex(p => p.type === "data") + 1, line: newRowLine() });
        }
      } : undefined} update={update} remove={() => { setBlocks(layout.blocks.filter(b => b.id !== selected.id)); select(""); }}
      reorder={reorder} first={siblings[0] === selected} last={siblings.at(-1) === selected} />, inspector)}
    {target && inspector && createPortal(<DetailBandEditor band={activeBand} title={targetTable ? `Tablo · ${target.row + 1}. satır bandı` : "Detay satırı bandı"}
      hasDetail={!targetTable || targetTable.repeatRow === target.row} partKey={part} setPart={setPart}
      change={v => changeRow(target, v)} draw={at => setPending({ at, line: newRowLine() })} pending={pending} cancel={() => setPending(null)}
      close={closeBand} reset={() => { changeRow(target, null); closeBand(); }} />, inspector)}
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
        <tbody>{(sample.length ? sample : [undefined]).map((row, i) => {
          const at = { table: "", row: 0, instance: i };
          return <DetailRowView key={i} {...rowEvents(at, layout.detailBand)} detail={row} band={layout.detailBand}
            background={row && formRowColor(layout, row, i)} columns={template.columns.length} width={formWidthMm} guideOffset={0}>
            {template.columns.map(c => <td key={c}><button className="form-detail-cell" onClick={() => editBand(at)}>{formCellText("{" + c + "}", data.header, row)}</button></td>)}</DetailRowView>;
        })}</tbody></table></>}
      <div className="print-band">Belge alt bilgisi</div>
      {objects("footer")}
      <p>{data.header.Comments}</p><p>{template.note}</p>
      <p className="print-total">Genel toplam <b>{amount(data.header.DocTotal)} {data.header.DocCur === "TRY" ? "TL" : data.header.DocCur}</b></p>
    </FormSheet></div>
  </>;
}
