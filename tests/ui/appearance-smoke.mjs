import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function testAppearance({ call, evaluate, waitFor, input }) {
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate('window.setTestMode("appearance")');
  await waitFor('document.querySelector(".appearance-fixture .page")');
  const click = (text) => evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)}).click()`);
  const change = (label, value) => evaluate(`(()=>{const e=document.querySelector('[aria-label="${label}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const colors = () => evaluate(`(()=>{const css=s=>getComputedStyle(document.querySelector(s));return {page:css('.page').backgroundColor,base:css('.report-page-backdrop').backgroundColor,outer:css('.report-scroll-space').backgroundColor,under:css('.report-scroll').backgroundColor,opacity:css('.page').opacity,text:css('.v-text').opacity}})()`);
  const fits = '(()=>{const e=document.querySelector(".report-scroll");return e.scrollWidth<=e.clientWidth+1 && e.scrollHeight>e.clientHeight+20})()';
  await waitFor(fits);
  const before = await colors(); assert.equal(before.page,'rgba(255, 0, 0, 0.5)'); assert.equal(before.outer,'rgba(0, 0, 255, 0.5)'); assert.equal(before.base,'rgb(11, 22, 40)'); assert.equal(before.opacity,'1'); assert.equal(before.text,'1');
  await evaluate('window.appearanceAppDark(true)'); const after = await colors(); assert.notEqual(before.under,after.under); assert.equal(after.page,before.page); assert.equal(after.base,before.base);
  await change('Tuval ölçeği','actual'); await click('Gerçek boyut'); await waitFor('document.querySelector(".canvas-zoom output").textContent === "%100"');
  assert.equal((await colors()).page,'rgba(255, 255, 255, 0)'); assert.equal((await colors()).outer,'rgba(0, 0, 0, 0)');
  await click('Sayfaya sığdır'); await waitFor('document.querySelector(".canvas-zoom select").value === "fit"');
  await click('Genişlik'); await waitFor('document.querySelector(".canvas-zoom select").value === "actual"');
  await evaluate('document.querySelector(".page").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');
  await change('Sayfanın başlangıç görünümü','FitToPage');
  await waitFor('window.savedAppearance?.pages[0].displayOption === "FitToPage"');
  assert.equal(await evaluate('document.querySelector(".canvas-zoom select").value'),'fit');
  await input('[aria-label="Dış alan saydamlığı"]','0'); await waitFor('window.savedAppearance.pages[0].outspaceTransparency === 0'); assert.equal((await colors()).outer,'rgb(0, 0, 255)');
  await input('[aria-label="Dış alan saydamlığı"]','100'); await waitFor('window.savedAppearance.pages[0].outspaceTransparency === 100'); assert.equal((await colors()).outer,'rgba(0, 0, 255, 0)');
  await input('[aria-label="Dış alan saydamlığı"]','50');
  await input('[aria-label="Tuval saydamlığı"]','100');
  await waitFor('window.savedAppearance.pages[0].backgroundTransparency === 100');
  assert.equal((await colors()).page,'rgba(255, 0, 0, 0)');
  await click('Tuval rengini temadan al'); await waitFor('!window.savedAppearance.pages[0].backgroundColor');
  assert.equal((await colors()).page,'rgb(11, 22, 40)');
  assert.equal(await evaluate('window.savedAppearance.pages[0].visuals[0].x'),80);
  await evaluate('window.appearanceViewer(true)'); await waitFor('document.querySelector(".viewer .page")');
  assert.equal((await colors()).base,'rgb(11, 22, 40)');
  await click('Gerçek boyut'); await waitFor('document.querySelector(".canvas-zoom output").textContent === "%100"');
  await click('Genişlik');
  for (const [w,h,dpr] of [[1440,1000,1],[1024,768,1.25],[480,800,2]]) {
    await call('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:dpr,mobile:false});
    await change('Tuval ölçeği','width'); await waitFor(fits);
    assert.equal((await colors()).outer,'rgba(0, 0, 255, 0.5)');
  }
  if(process.env.FLOEM_UI_ARTIFACT_DIR) await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR),'f10a-gorunum.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  console.log('PASS: F10A başlangıç görünümü, sayfaya özel oturum zoom, koordinat koruma, %0/50/100 zemin alfaları, uygulama/rapor teması ayrımı, sayfa geçişi ve üç viewport/DPR.');
}
