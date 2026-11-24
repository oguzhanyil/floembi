import { bands, detailLabels, formTableColumns, formWidthMm, headerLabels, type FormBlock, type FormColumn, type FormTable, type PrintLayout, type RowRule } from "@floem/client";

export const limit = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n * 10) / 10));

function NumberField({ label, value, min, max, change }: {
  label: string; value: number; min: number; max: number; change: (value: number) => void;
}) {
  return <label>{label}<input key={value} type="number" step=".1" min={min} max={max} defaultValue={value}
    onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
    onBlur={e => {
      const next = Number.isFinite(e.target.valueAsNumber) ? limit(e.target.valueAsNumber, min, max) : value;
      e.target.value = String(next); if (next !== value) change(next);
    }} /></label>;
}

export function DetailPaint({ layout, change }: { layout: PrintLayout; change: (patch: Partial<PrintLayout>) => void }) {
  const rule = layout.rule;
  return <fieldset><legend>Satır boyama</legend>
    <label className="print-check"><input type="checkbox" checked={!!layout.stripe} onChange={e => change({ stripe: e.target.checked ? "#edf4f7" : null })} />Dönüşümlü satır rengi</label>
    {layout.stripe && <label>İkinci satır rengi<input type="color" value={layout.stripe} onChange={e => change({ stripe: e.target.value })} /></label>}
    <label className="print-check"><input type="checkbox" checked={!!rule} onChange={e => change({ rule: e.target.checked ?
      { field: "LineTotal", op: "gt", value: 100, color: "#ffe6ac" } : null })} />Koşula göre boya</label>
    {rule && <><div className="form-pair">
      <label>Koşul alanı<select value={rule.field} onChange={e => change({ rule: { ...rule, field: e.target.value as RowRule["field"] } })}>
        {(["Quantity", "Price", "LineTotal"] as const).map(k => <option key={k} value={k}>{detailLabels[k]}</option>)}</select></label>
      <label>Karşılaştırma<select value={rule.op} onChange={e => change({ rule: { ...rule, op: e.target.value as RowRule["op"] } })}>
        <option value="gt">Büyüktür</option><option value="lt">Küçüktür</option><option value="eq">Eşittir</option></select></label></div>
      <label>Eşik değeri<input type="number" step="any" key={rule.field + rule.op} defaultValue={rule.value} onBlur={e => {
        if (Number.isFinite(e.target.valueAsNumber)) change({ rule: { ...rule, value: e.target.valueAsNumber } });
        else e.target.value = String(rule.value);
      }} /></label>
      <label>Koşul rengi<input type="color" value={rule.color} onChange={e => change({ rule: { ...rule, color: e.target.value } })} /></label>
    </>}
  </fieldset>;
}

type Cell = { r: number; c: number };
export function FormObjectProperties({ block, guides, update, cell, selectCell, remove, reorder, first, last }: {
  guides: number[];
  block: FormBlock; update: (b: FormBlock) => void; cell: Cell; selectCell: (cell: Cell) => void;
  remove: () => void; reorder: (direction: number) => void; first: boolean; last: boolean;
}) {
  return <fieldset className="form-inspector"><legend>{block.type === "line" ? "Çizgi özellikleri" : "Tablo özellikleri"}</legend>
    <label>Nesnenin bölümü<select value={block.band} onChange={e => update({ ...block, band: e.target.value as FormBlock["band"] })}>
      {Object.entries(bands).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
    {block.type === "line" ? <>
      <div className="form-pair">{(["x1", "y1", "x2", "y2"] as const).map(k => <NumberField key={k}
        label={k.toUpperCase() + " (mm)"} value={block[k]} min={0} max={k[0] === "x" ? formWidthMm : 60}
        change={v => update({ ...block, [k]: v })} />)}</div>
      <div className="form-pair"><label>Çizgi biçimi<select value={block.style} onChange={e => update({ ...block, style: e.target.value as typeof block.style })}>
        <option value="solid">Düz</option><option value="dashed">Kesikli</option><option value="dotted">Noktalı</option></select></label>
        <NumberField label="Kalınlık (mm)" value={block.thickness} min={.1} max={3} change={v => update({ ...block, thickness: v })} /></div>
      <label>Çizgi rengi<input type="color" value={block.color} onChange={e => update({ ...block, color: e.target.value })} /></label>
    </> : <><TableProperties table={block} update={update} cell={cell} selectCell={selectCell} />
      {guides.length > 0 && <label>Sol kenarı kılavuza hizala<select value="" onChange={e => {
        if (e.target.value !== "") update({ ...block, x: Number(e.target.value) });
      }}><option value="">Kılavuz seçin</option>{guides.map(g => <option key={g} value={g}
        disabled={g + block.width > formWidthMm}>{g} mm</option>)}</select></label>}</>}
    <div className="form-actions"><button disabled={first} onClick={() => reorder(-1)}>Yukarı taşı</button>
      <button disabled={last} onClick={() => reorder(1)}>Aşağı taşı</button><button onClick={remove}>Nesneyi sil</button></div>
  </fieldset>;
}

function TableProperties({ table, update, cell, selectCell }: { table: FormTable; update: (b: FormTable) => void; cell: Cell; selectCell: (p: Cell) => void }) {
  const rows = table.rows, count = rows[0].cells.length;
  const r = Math.min(cell.r, rows.length - 1), c = Math.min(cell.c, count - 1), row = rows[r];
  const measured = formTableColumns(table);
  const formats = measured.map(({ align, weight }) => ({ align, weight }));
  const setColumn = (patch: Partial<FormColumn>) => update({ ...table, columnFormat: formats.map((col, j) => j === c ? { ...col, ...patch } : col) });
  const setRow = (patch: Partial<typeof row>) => update({ ...table, rows: rows.map((item, i) => i === r ? { ...item, ...patch } : item) });
  const setText = (v: string) => setRow({ cells: row.cells.map((text, j) => j === c ? v : text) });
  return <>
    <div className="form-pair"><NumberField label="Soldan (mm)" min={0} max={formWidthMm - table.width} value={table.x} change={v => update({ ...table, x: v })} />
      <NumberField label="Genişlik (mm)" value={table.width} min={Math.max(25, count * 10)} max={formWidthMm - table.x} change={v => update({ ...table, width: v })} /></div>
    <label className="print-check"><input type="checkbox" checked={table.header} onChange={e => update({ ...table, header: e.target.checked,
      repeatRow: e.target.checked && table.repeatRow === 0 ? null : table.repeatRow })} />İlk satır başlık</label>
    <label className="print-check"><input type="checkbox" disabled={table.header && r === 0} checked={table.repeatRow === r}
      onChange={e => update({ ...table, repeatRow: e.target.checked ? r : null })} />Seçili satırı her kalemde tekrarla</label>
    <div className="form-pair"><label>Sütun hizası<select value={formats[c].align} onChange={e => setColumn({ align: e.target.value as FormColumn["align"] })}>
      <option value="left">Sola</option><option value="center">Ortaya</option><option value="right">Sağa</option></select></label>
      <NumberField label="Sütun genişlik payı" min={1} max={8} value={formats[c].weight} change={weight => setColumn({ weight })} /></div>
    <small>{c + 1}. sütun genişliği {measured[c].width.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} mm</small>
    <label>Hücre metni ({r + 1}, {c + 1})<textarea aria-label="Hücre metni" maxLength={500} rows={2} value={row.cells[c]} onChange={e => setText(e.target.value)} /></label>
    <label>Hücreye veri alanı ekle<select value="" onChange={e => { if (e.target.value) setText((row.cells[c] + "{" + e.target.value + "}").slice(0, 500)); }}>
      <option value="">Alan seçin</option><optgroup label="Belge">{Object.entries(headerLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</optgroup>
      {table.repeatRow === r && <optgroup label="Kalem">{Object.entries(detailLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</optgroup>}</select></label>
    <div className="form-pair"><label>Seçili satırın rengi<input type="color" value={row.color || "#ffffff"} onChange={e => setRow({ color: e.target.value })} /></label>
      <button disabled={!row.color} onClick={() => setRow({ color: null })}>Rengi kaldır</button></div>
    <div className="form-actions"><button disabled={rows.length >= 30} onClick={() => {
      const next = [...rows]; next.splice(r + 1, 0, { cells: Array(count).fill("") });
      update({ ...table, rows: next, repeatRow: table.repeatRow != null && table.repeatRow > r ? table.repeatRow + 1 : table.repeatRow }); selectCell({ r: r + 1, c });
    }}>Satır ekle</button><button disabled={rows.length === 1} onClick={() => {
      const repeat = table.repeatRow;
      const next = repeat == null || repeat === r ? null : repeat - Number(repeat > r);
      update({ ...table, rows: rows.filter((_, i) => i !== r), repeatRow: table.header && next === 0 ? null : next }); selectCell({ r: Math.max(0, r - 1), c });
    }}>Satırı sil</button>
      <button disabled={count === 8 || (count + 1) * 10 > table.width} onClick={() => {
        formats.splice(c + 1, 0, { align: "left", weight: 1 });
        update({ ...table, columnFormat: formats, rows: rows.map(item => { const cells = [...item.cells]; cells.splice(c + 1, 0, ""); return { ...item, cells }; }) });
        selectCell({ r, c: c + 1 });
      }}>Sütun ekle</button><button disabled={count === 1} onClick={() => {
        update({ ...table, columnFormat: formats.filter((_, j) => j !== c), rows: rows.map(item => ({ ...item, cells: item.cells.filter((_, j) => j !== c) })) });
        selectCell({ r, c: Math.max(0, c - 1) });
      }}>Sütunu sil</button></div>
  </>;
}
