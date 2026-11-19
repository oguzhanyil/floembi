import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function testThemes({ call, evaluate, waitFor, openMenu, choose, dir }) {
  const select = async (label, value) => {
    await evaluate(`(()=>{const e=document.querySelector('select[aria-label="${label}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  };
  const click = (text) => evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)}).click()`);
  await evaluate('window.setTestMode("theme")');
  await waitFor('document.querySelector(".theme-fixture .page[data-report-theme=electric]")');
  const pageColor = () => evaluate('getComputedStyle(document.querySelector(".theme-fixture .page")).backgroundColor');
  const before = await pageColor();
  await evaluate('document.querySelector(".app-theme-control > button").click()');
  await select('Uygulama renk ailesi', 'indigo');
  await select('Uygulama renk ailesi görünümü', 'dark');
  await waitFor('document.documentElement.style.colorScheme === "dark"');
  assert.equal(await pageColor(), before, 'Uygulama teması raporu değiştirmemeli');
  assert.equal(await evaluate('JSON.parse(localStorage.getItem("floem.application-theme.v1")).id'), 'indigo');
  await evaluate('document.querySelector(".app-theme-popover button:last-child").click();document.querySelector(".report-theme-controls summary").click()');
  await select('Rapor renk ailesi', 'emerald');
  await select('Rapor renk ailesi görünümü', 'dark');
  await select('Rapor renk ailesi yoğunluğu', 'comfortable');
  await evaluate('document.querySelector(".report-theme-controls input[type=checkbox]").click()');
  await waitFor('window.savedReport?.theme?.id === "emerald" && window.savedReport.theme.mode === "dark" && window.savedReport.theme.density === "comfortable"');
  assert.notEqual(await pageColor(), before);
  assert.equal(await evaluate('window.savedReport.pages[0].visuals[0].format.fontSize'), 24);
  assert.equal(await evaluate('window.savedReport.pages[0].visuals[1].format.backgroundColor'), '#0866e8', 'Yerel renk korunmalı');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-visual-id=full-width]")).backgroundColor'), 'rgb(8, 102, 232)');
  assert(await evaluate('document.querySelector(".page").dataset.reducedMotion === "true"'));
  await click('10 temayı karşılaştır');
  await waitFor('document.querySelector(".theme-comparison[open]") && document.querySelectorAll(".theme-comparison .ag-row").length >= 6');
  const contrast = (a, b) => {
    const lum = (hex) => hex.match(/\w\w/g).map((v) => parseInt(v,16)/255).map((v) => v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const x=lum(a.slice(1)),y=lum(b.slice(1)); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
  };
  for (const id of ['electric','indigo','emerald','arctic','graphite']) {
    await evaluate(`[...document.querySelectorAll('.theme-comparison nav button')][${['electric','indigo','emerald','arctic','graphite'].indexOf(id)}].click()`);
    await waitFor(`document.querySelector('.theme-comparison [data-report-theme=${id}]')`);
    await waitFor('document.querySelectorAll(".theme-comparison .v-echart canvas").length === 2');
    const tokens = await evaluate(`[...document.querySelectorAll('.theme-comparison-grid > section')].map(e=>{const s=getComputedStyle(e);return Object.fromEntries(['surface','text','muted','accent','accent-text','success','warning','danger','info'].map(k=>[k,s.getPropertyValue('--'+k).trim()]))})`);
    for (const t of tokens) {
      for (const role of ['text','muted','success','warning','danger','info']) assert(contrast(t[role],t.surface)>=4.5, `${id} ${role} kontrastı`);
      assert(contrast(t.accent,t['accent-text'])>=4.5, `${id} düğme kontrastı`);
    }
    if (process.env.FLOEM_UI_ARTIFACT_DIR) {
      const shot = await call('Page.captureScreenshot',{format:'png'});
      await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR), `theme-${id}.png`), Buffer.from(shot.data,'base64'));
    }
  }
  await evaluate('document.querySelector(".theme-comparison header button").click()');
  await waitFor('!document.querySelector(".theme-comparison")');
  await openMenu('[data-visual-id=move]'); await choose('Biçim / özellikler');
  await waitFor('[...document.querySelectorAll("button")].some(e=>e.textContent === "Temadan al")');
  await click('Temadan al');
  await waitFor('window.savedReport.pages[0].visuals[0].format.fontSize === undefined');
  assert.equal(await evaluate('window.savedReport.pages[0].visuals[0].format.text'), 'Floem BI · Tasarım denemesi');
  const snapshot = await evaluate('window.savedReport');
  await writeFile(join(dir,'theme-roundtrip.json'),JSON.stringify(snapshot));
  await evaluate(`window.setAllReport(${JSON.stringify(snapshot)});window.setTestMode('all-viewer')`);
  await waitFor('document.querySelector(".viewer [data-report-theme=emerald][data-theme-mode=dark]")');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".viewer .page")).getPropertyValue("--row-height").trim()'), '38px');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-visual-id=full-width]")).backgroundColor'), 'rgb(8, 102, 232)');
  console.log('PASS: 10 gerçek tema önizlemesi; metin/durum/düğme kontrastı; uygulama-rapor ayrımı, yerel istisna, kayıt ve web görünümü.');
}
