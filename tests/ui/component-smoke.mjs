import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export async function testComponents({ call, evaluate, waitFor, input, dir }) {
  await call('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate('window.setTestMode("components")');
  await waitFor('document.querySelector("[data-visual-id=amount] .v-card-value")?.textContent === "42"');
  const click = (text) => evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)}).click()`);
  const select = (id) => evaluate(`(()=>{const e=document.querySelector('[data-visual-id="${id}"]');e.focus();e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,ctrlKey:true}))})()`);
  const change = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const shortcut = (key, shiftKey = false) => evaluate(`(()=>{const e=document.querySelector('.page [data-visual-id]');e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,ctrlKey:true,key:${JSON.stringify(key)},shiftKey:${shiftKey}}))})()`);
  const formatInput = (label, type, value) => evaluate(`(()=>{const e=[...document.querySelectorAll('.fmt-body label')].find(e=>e.textContent.trim()===${JSON.stringify(label)}).querySelector('input[type="${type}"]');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.blur()})()`);
  await evaluate('document.querySelector(".component-library summary").click()');
  await select('frame'); await click('Seçimi kitaplığa kaydet');
  await waitFor(`document.querySelector('dialog[open] [aria-label="Bileşen adı"]')`);
  await input('[aria-label="Bileşen adı"]', 'Operasyon kartı'); await input('[aria-label="Yuva adı 1"]', 'Gösterge');
  await click('Sürümü kaydet');
  await waitFor('window.savedComponentReport?.components?.length === 1 && window.savedLibrary.components.length === 1');
  assert.equal(await evaluate('window.savedComponentReport.pages[0].visuals[0].component.version'), 1);
  await click('İkinci sayfa'); await click('Sayfaya ekle');
  await waitFor('document.querySelector("dialog[open] select")');
  const metricIndex = await evaluate('[...document.querySelector("dialog select").options].find(o=>o.textContent.includes("Sipariş")).value');
  await change('dialog select', metricIndex); await click('Bileşeni ekle');
  await waitFor('window.savedComponentReport.pages[1].visuals.length === 4');
  const second = await evaluate('window.savedComponentReport.pages[1].visuals');
  const root = second.find((v) => v.component), heading = second.find((v) => v.type === 'text'), card = second.find((v) => v.type === 'card');
  assert.equal(card.values[0].measure, 'Sipariş');
  await waitFor(`document.querySelector('[data-visual-id="${card.id}"] .v-card-value')?.textContent === '72'`);
  await select(heading.id); await click('Biçim'); await formatInput('Renk', 'color', '#ff9900');
  await waitFor(`window.savedComponentReport.pages[1].visuals.find(v=>v.id==='${heading.id}').format.color === '#ff9900'`);
  await click('Kaynak'); await select('heading'); await formatInput('Yazı boyutu', 'number', '30');
  await click('Yeni sürüm hazırla'); await waitFor('document.querySelector("dialog[open]")'); await click('Sürümü kaydet');
  await waitFor('window.savedLibrary.components.length === 2 && window.savedComponentReport.pages[0].visuals[0].component.version === 2');
  await click('İkinci sayfa'); await select(root.id); await click('v2 güncellemesini incele');
  await waitFor('document.querySelector("dialog[open]")');
  assert.match(await evaluate('document.querySelector(".component-dialog[open]").textContent'), /yerel/);
  await evaluate('document.querySelector(".component-dialog[open] input[type=checkbox]").click()');
  await waitFor('document.querySelectorAll(".component-dialog[open] li").length === 2'); await click('Güncellemeyi uygula');
  await waitFor(`window.savedComponentReport.pages[1].visuals.find(v=>v.id==='${heading.id}').format.fontSize === 30`);
  assert.equal(await evaluate(`window.savedComponentReport.pages[1].visuals.find(v=>v.id==='${heading.id}').format.color`), '#ff9900');
  assert.equal(await evaluate(`window.savedComponentReport.pages[1].visuals.find(v=>v.id==='${card.id}').values[0].measure`), 'Sipariş');
  await shortcut('z'); await waitFor(`window.savedComponentReport.pages[1].visuals.find(v=>v.id==='${root.id}').component.version === 1`);
  await shortcut('y'); await waitFor(`window.savedComponentReport.pages[1].visuals.find(v=>v.id==='${root.id}').component.version === 2`);
  const downloads = join(dir, 'component-downloads'); await mkdir(downloads);
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await click('JSON indir');
  const waitDownload = async (name) => { for (let i=0; i<100 && !existsSync(join(downloads,name)); i++) await new Promise(r=>setTimeout(r,100)); return readFile(join(downloads,name)); };
  const exported = JSON.parse((await waitDownload('floem-bilesen.json')).toString('utf8'));
  assert.equal(exported.components.length, 2);
  await evaluate(`(()=>{const f=new File([${JSON.stringify(JSON.stringify(exported))}],'kart.json',{type:'application/json'});const dt=new DataTransfer();dt.items.add(f);const e=document.querySelector('[aria-label="Bileşen JSON dosyası"]');e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await waitFor('document.querySelector(".component-notice")?.textContent.includes("içe aktarıldı")');
  await click('Marka ve ikonlar'); await waitFor('document.querySelectorAll(".brand-sizes img").length === 7');
  await evaluate('Promise.all([...document.querySelectorAll(".brand-variants img,.brand-sizes img")].map(i=>i.decode()))');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".brand-sizes img")].map(i=>({natural:i.naturalWidth,actual:i.getBoundingClientRect().width}))'), [16,32,48,64,128,256,512].map((size)=>({natural:size,actual:size})));
  if (process.env.FLOEM_UI_ARTIFACT_DIR) {
    await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR), 'f07b-marka-acik.png'), Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  await change('[aria-label="Marka zemini"]','dark');
  await evaluate('Promise.all([...document.querySelectorAll(".brand-variants img,.brand-sizes img")].map(i=>i.decode()))');
  if (process.env.FLOEM_UI_ARTIFACT_DIR) {
    await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR), 'f07b-marka-koyu.png'), Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  await click('SVG indir'); const svg = await waitDownload('floembi-horizontal-dark.svg'); assert.match(svg.toString(), /Floem BI/);
  await click('512 px PNG indir'); const png = await waitDownload('floembi-horizontal-dark.png'); assert.equal(png.readUInt32BE(20), 512);
  await click('Windows ICO indir'); const ico = await waitDownload('floembi-dark.ico'); assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 6);
  for (let i=0; i<6; i++) { const offset=ico.readUInt32LE(6+i*16+12); assert.equal(ico.subarray(offset+1,offset+4).toString(), 'PNG'); }
  await click('Logoyu sayfaya ekle');
  await waitFor('window.savedComponentReport.pages[1].visuals.some(v=>v.type === "image")');
  const snapshot = await evaluate('window.savedComponentReport');
  await writeFile(join(dir, 'component-roundtrip.json'), JSON.stringify(snapshot));
  await evaluate(`window.reloadComponentReport(${JSON.stringify(snapshot)});window.componentViewer(true)`);
  await waitFor('document.querySelector(".viewer .page")'); await click('İkinci sayfa');
  await waitFor(`document.querySelector('[data-visual-id="${card.id}"] .v-card-value')?.textContent === '72'`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-visual-id="${heading.id}"] .v-text')).color`), 'rgb(255, 153, 0)');
  await evaluate('Promise.all([...document.querySelectorAll(".viewer img")].map(i=>i.decode()))');
  const toggle = second.find((v)=>v.type==='button'); await evaluate(`document.querySelector('[data-visual-id="${toggle.id}"] button').click()`);
  await waitFor(`!document.querySelector('[data-visual-id="${card.id}"]')`);
  console.log('PASS: F07B kitaplığa kaydetme, başka sayfada ölçü eşleme, yerel renk + ortak sürüm, etki önizleme, tek adım undo/redo, JSON gidiş-dönüş, 16–512 px marka, SVG/PNG/6 çerçeveli ICO ve web iç eylem.');
}
