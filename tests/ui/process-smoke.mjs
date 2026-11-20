import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function testProcess({ call, evaluate, waitFor }) {
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await evaluate('window.setTestMode("process")');
  const el = (id) => `document.querySelector('[data-visual-id="${id}"]')`;
  const click = async (id, selector = '.v-action-button') => { await waitFor(`${el(id)}?.querySelector(${JSON.stringify(selector)})`); await evaluate(`${el(id)}.querySelector(${JSON.stringify(selector)}).click()`); };
  const choose = async (id, value) => {
    await click(id, '.v-slicer-dd-btn');
    await evaluate(`(()=>{const labels=[...${el(id)}.querySelectorAll('.v-slicer-item:not(.all)')];labels.filter(l=>l.querySelector('input').checked).forEach(l=>l.querySelector('input').click())})()`);
    await evaluate(`[...${el(id)}.querySelectorAll('.v-slicer-item:not(.all)')].find(l=>l.textContent.trim()===${JSON.stringify(value)}).querySelector('input').click()`);
    await click(id, '.v-slicer-dd-btn');
  };
  const queryHas = (column, value) => `window.processQueries.some(q=>q.filters?.some(f=>f.column===${JSON.stringify(column)}&&f.values.includes(${JSON.stringify(value)})))`;
  await waitFor(`${el('company')}?.querySelector('.v-slicer-dd-btn') && ${el('customers')}?.querySelector('.ag-cell')`);
  const original = await evaluate('JSON.stringify(window.processReport)');
  await choose('company', 'F2');
  await waitFor(`${el('customers')}?.textContent.includes('F2:C001')`);
  await evaluate('window.processQueries=[]');
  await click('customers', '.v-ag-action');
  await waitFor(`${el('customer-summary')}?.textContent.includes('1.800')`);
  assert(await evaluate(queryHas('Kod', 'F2'))); assert(await evaluate(queryHas('Donem', '2026-02'))); assert(await evaluate(queryHas('Key', 'F2:C001')));
  await click('events', '.v-ag-action');
  await waitFor(`${el('document-summary')}?.querySelector('.v-card-value')`);
  assert(await evaluate(queryHas('Key', 'F2:C001:FAT-02')));
  await click('document-back'); await waitFor(el('events'));
  await click('customer-back'); await waitFor(`${el('company')}?.querySelector('.v-slicer-dd-btn span')?.textContent==='F2'`);
  await click('to-batch');
  await waitFor(`${el('batch-company')}?.querySelector('.v-slicer-dd-btn span')?.textContent==='F2' && document.querySelectorAll('.v-trace-node').length===3`);
  assert.equal(await evaluate('document.querySelectorAll(".v-tolerance-pass").length'), 1);
  assert.equal(await evaluate('document.querySelectorAll(".v-tolerance-fail").length'), 1);
  assert.equal(await evaluate('document.querySelectorAll(".v-tolerance-unknown").length'), 1);
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Yeniden karşılaşıldı"]').length`), 3);
  await evaluate(`document.querySelector('[aria-label="Partiyi incele: Karışım"]').click()`);
  await waitFor('document.querySelector(".v-process-tools strong")?.textContent.includes("Karışım")');
  await evaluate('[...document.querySelectorAll(".v-process-tools button")].find(b=>b.textContent==="Parti geri").click()');
  await waitFor('document.querySelector(".v-process-tools strong")?.textContent.includes("Ana parti")');
  await evaluate(`${el('network')}.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:350}))`);
  await waitFor('document.querySelector(".v-context-menu")');
  assert.match(await evaluate('document.querySelector(".v-context-menu").textContent'), /PDF indir.*Excel.*CSV indir/);
  await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await evaluate('window.processManyRoots=true;window.refreshProcess()');
  await waitFor(`${el('network')}?.textContent.includes('Tek bir parti')`);
  await evaluate('window.processManyRoots=false;window.refreshProcess()');
  await waitFor('document.querySelectorAll(".v-trace-node").length===3');
  // Eski yanıt yeni kapsamın hata/başarılı durumunun üstüne yazmamalı.
  await evaluate('window.processDelay=350;window.processError=true;window.refreshProcess()');
  await waitFor(`${el('network')}?.textContent.includes('Yükleniyor') || ${el('network')}?.textContent.includes('alınıyor')`);
  await evaluate('window.processDelay=0;window.processError=false;window.refreshProcess()');
  await waitFor('document.querySelectorAll(".v-trace-node").length===3');
  await new Promise((done) => setTimeout(done, 450));
  assert.equal(await evaluate('document.querySelectorAll(".v-trace-node").length'), 3);
  await evaluate('window.processBadSnapshot=true;window.refreshProcess()');
  await waitFor(`${el('network')}?.textContent.includes('değişti')`);
  await evaluate(`window.processBadSnapshot=false;${el('network')}.querySelector('button').click()`);
  await waitFor('document.querySelectorAll(".v-trace-node").length===3');
  assert.equal(await evaluate('JSON.stringify(window.processReport)'), original, 'Gezinme raporu kaydetmemeli');
  await click('batch-back'); await waitFor(el('customers'));
  // Desktop etkileşim önizlemesi aynı iki adımlı yol ve geri geçmişini kullanır.
  await evaluate('window.processViewer(false)'); await waitFor('document.querySelector(".canvas-mode-toggle")');
  await evaluate('document.querySelector(".canvas-mode-toggle").click()');
  await waitFor(`${el('customers')}?.querySelector('.v-ag-action')`);
  await click('customers', '.v-ag-action'); await waitFor(el('events'));
  await click('events', '.v-ag-action'); await waitFor(el('document-summary'));
  await click('document-back'); await waitFor(el('events'));
  await click('customer-back'); await waitFor(el('customers'));
  assert.equal(await evaluate('window.processSaveCount??0'), 0);
  console.log('PASS: F12 web/Desktop firma+dönemli müşteri→belge→iki kez geri, hedef dilimleyici, yerel parti yürüyüşü, çevrim ve tolerans durumları, sürüm hatası ve tekrar deneme.');

  if (!process.env.FLOEM_UI_PROCESS_REPORT) return;
  const report = JSON.parse(await readFile(resolve(process.env.FLOEM_UI_PROCESS_REPORT), 'utf8'));
  await evaluate(`window.processEndpoint=${JSON.stringify(process.env.FLOEM_UI_PROCESS_ENDPOINT)};window.setProcessReport(${JSON.stringify(report)});window.processViewer(true)`);
  await waitFor(`${el('customer-list')}?.textContent.includes('F1:C001')`);
  await evaluate(`[...document.querySelectorAll('.page-tab')].find(b=>b.textContent.includes('Müşteri 360')).click()`);
  await waitFor(`${el('customer-sales')}?.textContent.includes('Ayrıntıları görmek için')`);
  assert.equal(await evaluate(`${el('customer-sales')}.querySelectorAll('.v-card-value').length`), 0);
  await evaluate(`[...document.querySelectorAll('.page-tab')].find(b=>b.textContent==='Müşteri çalışma alanı').click()`);
  await waitFor(`${el('customer-list')}?.querySelector('.v-ag-action')`);
  await click('customer-list', '.v-ag-action');
  await waitFor(`${el('customer-sales')}?.querySelector('.v-card-value')?.textContent.includes('180')`);
  assert.match(await evaluate(`${el('customer-close')}.querySelector('.v-card-value').textContent`), /350/);
  await click('customer-events', '.v-ag-action'); await waitFor(`${el('document-lines')}?.querySelector('.ag-cell')`);
  await click('document-back'); await waitFor(el('customer-events')); await click('customer-back'); await waitFor(el('customer-list'));
  await click('to-batches'); await waitFor(`${el('batch-list')}?.textContent.includes('F1:U1')`);
  // Satır sırası yerine eylemin anahtarı kullanılır; sabitlenen sütun ayrı DOM'dadır.
  await evaluate(`${el('batch-list')}.querySelector('[aria-label="İncele: F1:U1"]').click()`);
  await waitFor('document.querySelectorAll(".v-trace-node").length>=3');
  assert.match(await evaluate(`${el('batch-amount')}.querySelector('.v-card-value').textContent`), /700/);
  assert.equal(await evaluate('document.querySelectorAll(".v-tolerance-fail").length'), 1);
  assert.equal(await evaluate('document.querySelectorAll(".v-tolerance-unknown").length'), 1);
  if (process.env.FLOEM_UI_ARTIFACT_DIR) {
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR), 'f12-parti-desktop.png'), Buffer.from(shot.data, 'base64'));
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: false });
  await waitFor('document.querySelector(".viewer")?.getAttribute("data-layout-id")==="trace-phone"');
  assert(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+2'));
  assert.equal(await evaluate('document.querySelectorAll(".visual-error").length'), 0);
  console.log('PASS: F12 gerçek .floem rapor tanımı ve gerçek DuckDB sorguları: müşteri180/bakiye350, belge, parti700, kalite kusur/eksik; 430px DPR2 telefon düzeni.');
}
