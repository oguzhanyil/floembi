import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { unzipSync, strFromU8 } from "fflate";

export async function testMatrix({ call, evaluate, waitFor, openMenu, choose, input, dir }) {
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate('window.setTestMode("matrix")');
  const count = 'document.querySelectorAll(".matrix-fixture tbody tr").length';
  const plus = 'document.querySelector(".v-matrix-tools [aria-label=\\"Bir düzey genişlet\\"]")';
  const minus = 'document.querySelector(".v-matrix-tools [aria-label=\\"Bir düzey daralt\\"]")';
  await waitFor(`${count} === 2`);
  assert.equal(await evaluate('document.querySelectorAll(".v-matrix thead tr").length'), 3);
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".v-matrix th.rowhead")].map(e=>e.textContent)'), ['Bölge', 'Şehir', 'Müşteri']);
  assert(await evaluate(`${minus}.disabled`));
  let index = 0;
  const download = async (name) => {
    const folder = join(dir, `hierarchy-${index++}`); await mkdir(folder);
    await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: folder });
    await openMenu('.matrix-fixture .visual'); await choose('Excel (.xlsx) indir');
    const file = join(folder, 'floem-nesne.xlsx');
    for (let i = 0; i < 150 && !existsSync(file); i++) await new Promise((done) => setTimeout(done, 100));
    assert(existsSync(file), `Matris Excel inmedi: ${await evaluate('document.querySelector(".v-action-notice")?.textContent')}`);
    const bytes = await readFile(file);
    if (process.env.FLOEM_UI_ARTIFACT_DIR) await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR), `${name}.xlsx`), bytes);
    const zip = unzipSync(bytes);
    const xml = strFromU8(zip['xl/worksheets/sheet1.xml']);
    const strings = strFromU8(zip['xl/sharedStrings.xml']);
    return evaluate(`(()=>{
      const parser = new DOMParser();
      const doc = parser.parseFromString(${JSON.stringify(xml)},'application/xml');
      if(doc.querySelector('parsererror')) throw Error('Geçersiz XLSX XML');
      const shared = [...parser.parseFromString(${JSON.stringify(strings)},'application/xml').querySelectorAll('si')].map(e=>e.textContent);
      const attrs=e=>Object.fromEntries([...e.attributes].map(a=>[a.name,a.value]));
      const cells=Object.fromEntries([...doc.querySelectorAll('c')].map(e=>[e.getAttribute('r'),e.getAttribute('t')==='s'?shared[Number(e.querySelector('v')?.textContent)]:e.querySelector('v')?Number(e.querySelector('v').textContent):null]));
      return {cells,rows:[...doc.querySelectorAll('row')].map(attrs), merges:[...doc.querySelectorAll('mergeCell')].map(e=>e.getAttribute('ref')),
        outline:attrs(doc.querySelector('outlinePr')),format:attrs(doc.querySelector('sheetFormatPr')),pane:attrs(doc.querySelector('pane')),
        formulas:doc.querySelectorAll('f').length};
    })()`);
  };
  const closed = await download('matrix-collapsed');
  assert.equal(closed.rows.length, 13, 'Kapalı detaylar dosyada tutulmalı');
  assert.deepEqual([closed.cells.A1, closed.cells.B1, closed.cells.C1], ['Bölge', 'Şehir', 'Müşteri']);
  assert.deepEqual([closed.cells.A4, closed.cells.B5, closed.cells.C6, closed.cells.C7, closed.cells.B8, closed.cells.C9, closed.cells.A10, closed.cells.B11, closed.cells.C12],
    ['Marmara', 'İstanbul', 'A', 'B', 'Bursa', '(Boş)', 'Ege', 'İzmir', 'A']);
  assert.equal(closed.cells.B4, null); assert.equal(closed.cells.A5, null);
  assert.equal(closed.cells.J7, -3.5); assert.equal(closed.cells.K7, 0); assert.equal(closed.cells.J9, 0);
  assert.equal(closed.cells.J13, 19.25); assert.equal(closed.cells.K13, 3, 'Ortalama ara toplamlar toplanarak hesaplanmamalı');
  assert.equal(closed.cells.A13, 'Genel toplam'); assert.equal(closed.formulas, 0);
  for (const merge of ['A1:A3', 'B1:B3', 'C1:C3', 'D1:G1', 'J1:K2', 'D2:E2', 'F2:G2']) assert(closed.merges.includes(merge), merge);
  assert.equal(closed.outline.summaryBelow, '0'); assert.equal(closed.format.outlineLevelRow, '2');
  assert.equal(closed.pane.xSplit, '3'); assert.equal(closed.pane.ySplit, '3');
  for (const [rowNumber, level, hidden, collapsed] of [[4,0,0,1], [5,1,1,1], [6,2,1,0], [10,0,0,1], [13,0,0,0]]) {
    const row = closed.rows.find((r) => r.r === String(rowNumber));
    assert.deepEqual([row.outlineLevel,row.hidden,row.collapsed], [level,hidden,collapsed].map(String));
  }
  await evaluate(`${plus}.click()`); await waitFor(`${count} === 5`);
  assert.equal(await evaluate('document.querySelectorAll("tbody tr.lvl3").length'), 0);
  await openMenu('.matrix-fixture .visual'); await choose('Bir düzey genişlet'); await waitFor(`${count} === 9`);
  assert(await evaluate(`${plus}.disabled`));
  const opened = await download('matrix-expanded');
  assert(opened.rows.slice(3).every((r) => r.hidden === '0' && r.collapsed === '0'));
  assert.equal(opened.cells.K13, 3);
  if (process.env.FLOEM_UI_ARTIFACT_DIR) {
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR), 'matrix-hierarchy.png'), Buffer.from(shot.data, 'base64'));
  }
  await evaluate(`${minus}.click()`); await waitFor(`${count} === 5`);
  await openMenu('.matrix-fixture .visual'); await choose('Bir düzey daralt'); await waitFor(`${count} === 2`);
  assert(await evaluate(`${minus}.disabled`));
  await openMenu('.matrix-fixture .visual'); await choose('Tümünü genişlet'); await waitFor(`${count} === 9`);
  await evaluate('document.querySelector("tbody .v-matrix-toggle").click()'); await waitFor(`${count} === 4`);
  await evaluate('document.querySelector("tbody .v-matrix-toggle").click()'); await waitFor(`${count} === 6`);
  assert.equal(await evaluate('document.querySelectorAll("tbody tr.lvl3").length'), 1, 'Kardeş dal korunmalı; yeniden açılan dal bir basamak ilerlemeli');
  await evaluate('window.setMatrixOptions({matrixRowLayout:"compact"})');
  await waitFor('document.querySelectorAll(".v-matrix th.rowhead").length === 1');
  assert.equal(await evaluate('document.querySelector("tbody tr").cells.length'), 9);
  const compact = await download('matrix-compact');
  assert.equal(compact.cells.C1, 'Müşteri', 'Excel, girintili görünümde de ayrı düzey sütunlarını korumalı');
  await evaluate('window.setMatrixTree(true)');
  await waitFor('document.querySelector(".v-tree-tools input")');
  await input('.v-tree-tools input', 'İstanbul');
  await waitFor(`${count} === 2`);
  assert(await evaluate(`${plus}.disabled && ${minus}.disabled`));
  const filtered = await download('tree-filtered');
  assert.equal(filtered.rows.length, 4); // Tek başlık + iki eşleşen yol + genel toplam.
  assert.equal(filtered.cells.A2, 'Marmara'); assert.equal(filtered.cells.B3, 'İstanbul');
  assert(!Object.values(filtered.cells).includes('İzmir'));
  assert(filtered.rows.slice(1).every((r) => r.hidden === '0'));
  console.log('PASS: Matris 3 düzey +/−, dal açma, ayrı sütunlar, 2 düzey birleşik başlık; gerçek XLSX outline/gizli detaylar/donmuş bölmeler/sayısal toplamlar ve ağaç araması.');
}
