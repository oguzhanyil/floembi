import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

export async function testResponsive({ call, evaluate, waitFor, input }) {
  const metrics = (width, height=1000, deviceScaleFactor=1) => call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor,mobile:false});
  await metrics(1600);
  await evaluate('window.setTestMode("responsive")');
  await waitFor('document.querySelector("[data-visual-id=amount] .v-card-value")?.textContent === "126"');
  const change = (label, value) => evaluate(`(()=>{const e=document.querySelector('[aria-label="${label}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const chosen = (id) => evaluate(`(()=>{const e=document.querySelector('[data-visual-id="${id}"]');e.focus();e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,ctrlKey:true}))})()`);
  const shortcut = (key) => evaluate(`(()=>{const e=document.querySelector('.page [data-visual-id]');e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,ctrlKey:true,key:${JSON.stringify(key)}}))})()`);
  const clickAdd = (name) => evaluate(`document.querySelector('[aria-label="${name} düzeni ekle"]').click()`);
  await clickAdd('Telefon');
  await waitFor('document.querySelector(".report-view").dataset.layoutId === "phone" && window.savedResponsive.pages[0].layouts?.length === 1');
  await chosen('amount');
  await input('[aria-label="Nesne h"]','180');
  await waitFor('window.savedResponsive.pages[0].layouts[0].overrides.amount.h === 180');
  assert.equal(await evaluate('window.savedResponsive.pages[0].visuals.find(v=>v.id==="amount").h'),110);
  await shortcut('z'); await waitFor('window.savedResponsive.pages[0].layouts[0].overrides.amount.h !== 180');
  await shortcut('y'); await waitFor('window.savedResponsive.pages[0].layouts[0].overrides.amount.h === 180');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Üst kapsayıcı"]').disabled`),true);
  // En az sayfa yüksekliğinin altında kalan tablo, gerçek akış yüksekliğinde boyutlandırılır.
  await chosen('table');
  await evaluate('document.querySelector("[data-visual-id=table]").scrollIntoView({block:"center"})');
  const handle = await evaluate('(()=>{const r=document.querySelector("[data-visual-id=table] > .visual-resize").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',...handle});
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...handle,button:'left',clickCount:1,modifiers:1});
  for(let n=1;n<=5;n++) await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:handle.x,y:handle.y+30*n/5,buttons:1,modifiers:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:handle.x,y:handle.y+30,button:'left',clickCount:1,modifiers:1});
  try { await waitFor('window.savedResponsive.pages[0].layouts[0].overrides.table.h > 240'); }
  catch (error) { console.error('Uzun sayfa boyutlandırma', { handle, saved: await evaluate('window.savedResponsive.pages[0].layouts[0].overrides.table'), hit: await evaluate(`document.elementFromPoint(${handle.x},${handle.y})?.outerHTML.slice(0,400)`) }); throw error; }
  await input('[aria-label="Nesne h"]','240');
  await waitFor('window.savedResponsive.pages[0].layouts[0].overrides.table.h === undefined');
  // Akıştan serbest düzene geçmek görünür konumları saklar; gerçek fareyle yerel taşıma.
  await change('Düzen sayfa akışı','free');
  await waitFor('window.savedResponsive.pages[0].layouts[0].rootLayout.mode === "free"');
  await chosen('amount');
  await evaluate('document.querySelector("[data-visual-id=amount]").scrollIntoView({block:"center"})');
  // Kaydırma/zoom yerleşimi ve hover durumu tamamlanmadan eski koordinata basma.
  await evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
  const point = await evaluate('(()=>{const r=document.querySelector("[data-visual-id=amount] .visual-head").getBoundingClientRect();return {x:r.x+30,y:r.y+r.height/2}})()');
  const beforeX = await evaluate('window.savedResponsive.pages[0].layouts[0].overrides.amount.x');
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1,modifiers:1});
  for(let n=1;n<=5;n++) await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+12*n/5,y:point.y+20*n/5,buttons:1,modifiers:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+12,y:point.y+20,button:'left',clickCount:1,modifiers:1});
  await waitFor(`window.savedResponsive.pages[0].layouts[0].overrides.amount.x !== ${beforeX}`);
  assert.equal(await evaluate('window.savedResponsive.pages[0].visuals.find(v=>v.id==="amount").x'),340);
  // Web testi için tekrar dikey akış: dar ekranda hiçbir nesne sınır dışına düşmez.
  await change('Düzen sayfa akışı','vertical');
  await clickAdd('Tablet'); await waitFor('window.savedResponsive.pages[0].layouts.length === 2');
  await clickAdd('Laptop'); await waitFor('window.savedResponsive.pages[0].layouts.length === 3');
  await change('Tasarım düzeni','base'); await waitFor('document.querySelector(".report-view").dataset.layoutId === "base"');
  assert.equal(await evaluate(`Number(document.querySelector('[aria-label="Nesne h"]').value)`),110);
  await evaluate('window.responsiveViewer(true)');
  await waitFor('document.querySelector(".viewer[data-layout-id=base] [data-visual-id=amount] .v-card-value")?.textContent === "126"');
  // Dilimleyici seçimi, görünürlük ve sorgu sayısı ekran değişiminde korunur.
  await waitFor('[...document.querySelectorAll("[data-visual-id=region] label")].some(e=>e.textContent.includes("Kuzey"))');
  await evaluate('[...document.querySelectorAll("[data-visual-id=region] label")].find(e=>e.textContent.includes("Kuzey")).querySelector("input").click()');
  await waitFor('document.querySelector("[data-visual-id=amount] .v-card-value")?.textContent === "42"');
  await evaluate('document.querySelector("[data-visual-id=toggle] button").click()');
  await waitFor('document.querySelector("[data-visual-id=note]")');
  const queries = await evaluate('window.responsiveQueries');
  for (const [width,height,dpr,id] of [[1400,900,1,'laptop'],[900,800,1.25,'tablet'],[390,844,2,'phone']]) {
    await metrics(width,height,dpr);
    await waitFor(`document.querySelector('.viewer').dataset.layoutId === '${id}'`);
    await waitFor('document.querySelector("[data-visual-id=amount] .v-card-value")?.textContent === "42"');
    await waitFor('(()=>{const e=document.querySelector(".report-scroll");return e.scrollWidth<=e.clientWidth+1})()');
    assert(await evaluate('document.querySelector("[data-visual-id=note]") !== null'));
    assert.equal(await evaluate('document.querySelectorAll(".viewer [data-visual-id]").length'),7);
    assert(await evaluate('(()=>{const p=document.querySelector(".page").getBoundingClientRect();return [...document.querySelectorAll(".viewer [data-visual-id]")].every(e=>{const r=e.getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1})})()'));
  }
  assert.equal(await evaluate('window.responsiveQueries'),queries,'Salt yerleşim değişikliği yeni veri sorgusu üretmemeli');
  assert(await evaluate('(()=>{const e=document.querySelector(".report-scroll");return e.scrollHeight>e.clientHeight})()'));
  // Pencere geniş kalsa da dar rapor bölmesi telefon düzenini seçer.
  await metrics(1600); await evaluate('window.responsiveWidth("500px")');
  await waitFor('document.querySelector(".viewer").dataset.layoutId === "phone"');
  await change('Görüntüleme düzeni','base'); await waitFor('document.querySelector(".viewer").dataset.layoutId === "base"');
  await change('Görüntüleme düzeni','auto'); await waitFor('document.querySelector(".viewer").dataset.layoutId === "phone"');
  await evaluate('document.querySelector("[data-visual-id=go] button").click()');
  await waitFor('document.querySelector("[data-visual-id=back] button")');
  await evaluate('document.querySelector("[data-visual-id=back] button").click()');
  await waitFor('document.querySelector(".viewer").dataset.layoutId === "phone" && document.querySelector("[data-visual-id=amount] .v-card-value")?.textContent === "42"');
  // Gerçek web stil dosyası ve uzun rapor başlığıyla kabuk da daralabilmeli.
  const webCss = await readFile(resolve(import.meta.dirname,'../../apps/web/src/styles.css'),'utf8');
  await evaluate(`(()=>{const s=document.createElement('style');s.id='responsive-web-css';s.textContent=${JSON.stringify(webCss)};document.head.append(s);window.responsiveWidth('100%');window.responsiveChrome(true)})()`);
  await metrics(1600); await waitFor('document.querySelector(".viewer").dataset.layoutId === "laptop"');
  await metrics(390,844,2); await waitFor('document.querySelector(".viewer").dataset.layoutId === "phone"');
  await waitFor('document.documentElement.scrollWidth <= document.documentElement.clientWidth+1');
  assert(await evaluate('document.querySelector(".report-body").clientHeight > 200'));
  if(process.env.FLOEM_UI_ARTIFACT_DIR) {
    const shot = await call('Page.captureScreenshot',{format:'png'});
    await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR),'f08-phone.png'),Buffer.from(shot.data,'base64'));
  }
  console.log('PASS: F08 üç düzen oluşturma, ayrı geometri, gerçek fareyle taşıma, undo/redo, üç viewport/DPR, rapor bölmesi genişliği, ortak dilimleyici/görünürlük/eylem ve sorgusuz yerleşim geçişi.');
  if (process.env.FLOEM_UI_RESPONSIVE_REPORT) {
    const report = JSON.parse(await readFile(resolve(process.env.FLOEM_UI_RESPONSIVE_REPORT),'utf8'));
    const results = process.env.FLOEM_UI_RESPONSIVE_RESULTS ? JSON.parse(await readFile(resolve(process.env.FLOEM_UI_RESPONSIVE_RESULTS),'utf8')) : undefined;
    await metrics(390,844,2);
    await evaluate(`window.responsiveResults=${JSON.stringify(results) ?? 'undefined'};window.responsiveWidth('100%');window.responsiveReport(${JSON.stringify(report)})`);
    await waitFor('document.querySelector(".viewer").dataset.layoutId === "phone" && document.querySelector("[data-visual-id=f05-kpi-0-value] .v-card-value")');
    await waitFor('(()=>{const e=document.querySelector(".report-scroll");return e.scrollWidth<=e.clientWidth+1})()');
    const outside = await evaluate(`(()=>{const p=document.querySelector('.page').getBoundingClientRect();return [...document.querySelectorAll('.viewer [data-visual-id]')].filter(e=>{const r=e.getBoundingClientRect();return r.left<p.left-1||r.right>p.right+1||r.bottom>p.bottom+1}).map(e=>e.dataset.visualId)})()`);
    assert.deepEqual(outside,[],'Gerçek F08 demo sayfasında sınır dışı nesne');
    assert.equal(await evaluate('document.querySelectorAll(".viewer [data-visual-id]").length'),report.pages[0].visuals.filter((v)=>!v.format.initiallyHidden).length);
    if(process.env.FLOEM_UI_ARTIFACT_DIR) {
      const shot = await call('Page.captureScreenshot',{format:'png'});
      await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR),'f08-demo-phone.png'),Buffer.from(shot.data,'base64'));
    }
    assert.equal(await evaluate('document.querySelectorAll(".viewer .v-error").length'),0);
    console.log(`PASS: F08 yerel demo sayfasındaki tüm nesneler telefon düzeninde sayfa sınırında; sorgular ${results ? 'yerel DuckDB sonuçlarıdır' : 'sentetiktir'}.`);
  }
  await evaluate('window.responsiveChrome(false);document.getElementById("responsive-web-css").remove()');
}
