import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function testRuntime({ call, evaluate, waitFor, input }) {
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await evaluate('window.setTestMode("runtime")');
  const el = (id) => `document.querySelector('[data-visual-id="${id}"]')`;
  const content = (id) => `${el(id)}?.textContent`;
  const page = 'document.querySelector(".v-repeater .v-server-pages")?.textContent';
  await waitFor(`${content('label')}?.includes("Toplam: 42") && document.querySelectorAll('.v-repeater-item').length > 1`);
  assert.match(await evaluate(content('unique')), /birden fazla/);
  await waitFor(`document.querySelector('[data-template-id=name]')?.textContent.includes('Örnek / A&B')`);
  assert.equal(await evaluate('document.querySelector("[data-template-id=balance] .v-card-value")?.textContent'), '0');
  assert((await evaluate('document.querySelectorAll(".v-repeater-item").length')) < 12, '500 satır için 500 DOM kartı oluşturulmamalı');
  assert(await evaluate(`${page}?.includes('12.050')`));
  assert((await evaluate('window.runtimeQueries.length')) < 15, 'Şablonlar kayıt başına sorgu göndermemeli');
  await evaluate(`${el('label')}.focus();${el('label')}.dispatchEvent(new FocusEvent('focusin',{bubbles:true}))`);
  await waitFor(`${el('label')}?.getAttribute('data-design-state')==='hover'`);
  assert.equal(await evaluate(`getComputedStyle(${el('label')}).backgroundColor`), 'rgb(229, 238, 250)');
  await evaluate(`${el('label')}.blur();${el('label')}.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));document.querySelector('[data-template-id=toggle] button').click()`);
  await waitFor(`!document.querySelector('.v-repeater-item:first-child [data-template-id=balance]')`);
  assert(await evaluate('document.querySelectorAll(".v-repeater-item")[1].querySelector("[data-template-id=balance]") !== null'), 'Satırın gizleme eylemi diğer satırı etkilememeli');
  await evaluate(`document.querySelector('[data-template-id=toggle] button').click()`);
  await waitFor('document.querySelector("[data-template-id=balance] .v-card-value")');

  const before = await evaluate('window.runtimeQueries.length');
  await evaluate('document.querySelector(".v-repeater-viewport").scrollTop=2600');
  await waitFor(`document.querySelector('.v-repeater-item')?.getAttribute('aria-posinset') === '19'`);
  assert.equal(await evaluate('window.runtimeQueries.length'), before);
  await evaluate('document.querySelector(".v-repeater-viewport").scrollTop=0');
  await waitFor(`document.querySelector('[data-template-id=name]')?.textContent.includes('Örnek / A&B')`);
  await evaluate('document.querySelector(".v-row-template").click()');
  await waitFor(`${content('label')}?.includes('Toplam: 0') && document.querySelector('.v-repeater-item.is-selected')`);
  assert(await evaluate('window.runtimeQueries.some(q=>!q.page&&q.filters?.some(f=>f.column==="Id"&&f.values[0]===0)&&q.filters.some(f=>f.column==="Name"&&f.values[0]==="Örnek / A&B"))'));
  await waitFor(`getComputedStyle(${el('frame')}).display==='none' && getComputedStyle(${el('child')}).display==='none'`);
  await evaluate('document.querySelector(".v-row-template").click()');
  await waitFor(`${content('label')}?.includes('Toplam: 42')`);
  assert.notEqual(await evaluate(`getComputedStyle(${el('child')}).display`), 'none');

  // Yanıt sırası ters dönünce eski değer dönmemeli.
  await evaluate('window.runtimeDelay=350;window.runtimeAmount(77)');
  await waitFor(`${content('label')}?.includes('Hesaplanıyor')`);
  await evaluate('window.runtimeDelay=0;window.runtimeAmount(9)');
  await waitFor(`${content('label')}?.includes('Toplam: 9')`);
  await new Promise((r) => setTimeout(r, 450));
  assert.match(await evaluate(content('label')), /Toplam: 9/);
  await evaluate('window.runtimeError=true;window.runtimeRefresh()');
  await waitFor(`${content('label')}?.includes('Veri alınamadı')`);
  assert.match(await evaluate(content('label')), /Sentetik bağlantı hatası/);
  await evaluate(`window.runtimeError=false;${el('label')}.querySelector('button').click()`);
  await waitFor(`${content('label')}?.includes('Toplam: 9')`);
  await evaluate('window.runtimeAmount(null)'); await waitFor(`${content('label')}?.includes('Kayıt yok')`);
  await evaluate('window.runtimeAmount(42)'); await waitFor(`${content('label')}?.includes('Toplam: 42')`);

  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate('window.runtimeAmount(200)');
  await waitFor(`${el('counter')}?.querySelector('.v-ticker-value')?.textContent==='200'`);
  assert.equal(await evaluate(`getComputedStyle(${el('pulse')}).animationName`), 'none');
  await call('Emulation.setEmulatedMedia', { features: [] });
  await evaluate('window.runtimeAmount(120)');
  await waitFor(`${el('counter')}?.querySelector('.v-ticker')?.getAttribute('aria-label')?.includes('120')`);
  assert.notEqual(await evaluate(`${el('counter')}?.querySelector('.v-ticker-value')?.textContent`), '120', 'Sayaç yeni değere ara değerlerle ilerlemeli');
  await evaluate('window.runtimeAmount(180)');
  await waitFor(`${el('counter')}?.querySelector('.v-ticker-value')?.textContent==='180'`);
  await waitFor(`!${el('pulse')}.classList.contains('motion-value-change')`);
  await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));window.runtimeAmount(300)`);
  await waitFor(`${el('counter')}?.querySelector('.v-ticker-value')?.textContent==='300'`);
  assert.equal(await evaluate(`${el('pulse')}.classList.contains('motion-value-change')`), false);
  await evaluate(`delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))`);
  await evaluate('window.runtimeTheme(true,true);window.runtimeAmount(250)');
  await waitFor(`${el('counter')}?.querySelector('.v-ticker-value')?.textContent==='250'`);
  assert.equal(await evaluate(`getComputedStyle(${el('pulse')}).animationName`), 'none');

  await input('.v-repeater input[type=search]', '12049');
  await waitFor(`${page}?.includes('1–1 / 1 grup')`);
  await waitFor(`document.querySelector('[data-template-id=name]')?.textContent.includes('12049')`);
  assert(await evaluate('window.runtimeQueries.some(q=>q.page?.search==="12049")'));
  await input('.v-repeater input[type=search]', ''); await waitFor(`${page}?.includes('12.050')`);
  await waitFor(`document.querySelector('[data-template-id=name]')?.textContent.includes('Örnek / A&B')`);
  await evaluate(`window.runtimeBlobs=[];window.runtimeOldURL=URL.createObjectURL;URL.createObjectURL=b=>{if(b.type.startsWith('text/csv'))window.runtimeBlobs.push(b);return window.runtimeOldURL(b)};${el('repeater')}.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:350}))`);
  await waitFor(`document.querySelector('.v-context-menu')?.textContent.includes('Tüm eşleşen satır verisi · CSV')`);
  await evaluate(`[...document.querySelectorAll('.v-context-menu button')].find(e=>e.textContent==='Tüm eşleşen satır verisi · CSV').click()`);
  await waitFor('window.runtimeBlobs.length===1');
  assert.equal(await evaluate('window.runtimeBlobs[0].text().then(s=>s.trim().split(/\\r?\\n/).length)'), 12051);
  await evaluate('URL.createObjectURL=window.runtimeOldURL');
  await evaluate('window.runtimeOpened=[];window.runtimeOldOpen=window.open;window.open=(...args)=>window.runtimeOpened.push(args);document.querySelector("[data-template-id=url] button").click()');
  assert.equal(await evaluate('window.runtimeOpened[0][0]'), 'https://example.com/customer/%C3%96rnek%20%2F%20A%26B');
  await evaluate('window.open=window.runtimeOldOpen;document.querySelector("[data-template-id=detail] button").click()');
  await waitFor(`${content('detail-name')}?.includes('Örnek / A&B')`);
  assert(await evaluate('window.runtimeQueries.some(q=>q.filters?.some(f=>f.column==="Id"&&f.values[0]===0)&&q.filters.some(f=>f.column==="Name"&&f.values[0]==="Örnek / A&B"))'));
  await evaluate('[...document.querySelectorAll(".page-tab")].find(e=>e.textContent.includes("Canlı tasarım")).click();window.runtimeTheme(false)');
  await waitFor('document.querySelector(".v-repeater-item")');
  if (process.env.FLOEM_UI_ARTIFACT_DIR) {
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR), 'f11-customer-cards.png'), Buffer.from(shot.data,'base64'));
  }

  // Tasarımda koşulla gizli nesne düzenlenebilir; durum önizlemesi kayda yazılmaz.
  await evaluate('window.runtimeAmount(0);window.runtimeViewer(false)');
  await waitFor(`${el('frame')}?.getAttribute('data-rule-hidden') === 'true'`);
  assert.notEqual(await evaluate(`getComputedStyle(${el('frame')}).display`), 'none');
  await evaluate(`${el('label')}.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,button:0}));${el('label')}.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,button:0}))`);
  await waitFor('document.querySelector(".viz-pane")');
  await evaluate(`[...document.querySelectorAll('.viz-tabs button')].find(e=>e.textContent==='Biçim').click()`);
  await waitFor('document.querySelector("[aria-label=\\"Nesne durumunu dene\\"]")');
  await evaluate(`(()=>{const e=document.querySelector('[aria-label="Nesne durumunu dene"]');e.value='error';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await waitFor(`${el('label')}?.getAttribute('data-design-state')==='error'`);
  assert.match(await evaluate(content('label')), /Veri alınamadı/);
  assert.equal(await evaluate('window.runtimeReport.pages[0].visuals.find(v=>v.id==="label").state?.previewState'), undefined);
  await evaluate(`window.dispatchEvent(new CustomEvent('floem-preview-state',{detail:{id:'label',state:'actual'}}))`);
  await input('[aria-label="Bağ metin şablonu"]', 'Canlı: {value}');
  await waitFor(`${content('label')}?.includes('Canlı: 0')`);
  await waitFor(`window.runtimeReport.pages[0].visuals.find(v=>v.id==='label').bindings.text.template === 'Canlı: {value}'`);
  await input('[aria-label="Bağ metin şablonu"]', 'Toplam: {value}');
  await waitFor(`window.runtimeReport.pages[0].visuals.find(v=>v.id==='label').bindings.text.template === 'Toplam: {value}'`);
  await evaluate('window.runtimeViewer(true);window.runtimeAmount(42)');
  await waitFor(`${content('label')}?.includes('Toplam: 42')`);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  await waitFor('document.querySelector(".v-repeater-item")');
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'), 'Dar ekranda sayfanın dışına taşma olmamalı');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  console.log('PASS: F11 filtreli bağlar, sıfır/boş/hata/tekrar dene, eski yanıt koruması, kapsayıcı görünürlüğü, 12.050 grupta sanallaştırma ve arama, satır URL/detay eylemi, tasarım durumları, sonlu hareket ve azaltılmış hareket, dar ekran.');
}
