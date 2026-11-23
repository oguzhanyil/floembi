import assert from "node:assert/strict";

export async function testPowerBiAppearance({ evaluate, waitFor, open }) {
  await open("appearance");
  await waitFor('document.querySelector(".v-button-icon")');
  assert.equal(await evaluate('document.querySelectorAll(".page .visual").length'), 4, "Kaynakta gizli grup ve altındaki tam sayfa maske çizilmemeli");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".page")).backgroundColor'), "rgba(160, 209, 255, 0.85)");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".page"),"::before").opacity'), "0.85");
  assert.match(await evaluate('getComputedStyle(document.querySelector(".page"),"::before").backgroundImage'), /^url\("?data:image\/png;base64,/);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".v-action-button")).opacity'), "1");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".v-action-button")).backgroundColor'), "rgba(0, 0, 0, 0)");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".v-action-button")).flexDirection'), "column");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".v-shape")).borderRadius'), "30px");
  const rect = await evaluate(`(()=>{const p=document.querySelector('.page').getBoundingClientRect();const v=document.querySelector('[data-visual-id^="icon-button_"]').getBoundingClientRect();const s=p.width/1000;return [(v.x-p.x)/s,(v.y-p.y)/s,v.width/s,v.height/s]})()`);
  rect.forEach((n, i) => assert(Math.abs(n - [100, 100, 160, 210][i]) < 1, `Kaynak dikdörtgen değişti: ${rect}`));
  await evaluate(`document.querySelector('.ribbon button[aria-label="İzleyici modu"]').click()`);
  await waitFor('document.querySelector(".visual.preview")');
  assert.equal(await evaluate('document.querySelectorAll(".page .visual").length'), 4);
  await evaluate(`document.querySelector('.ribbon button[aria-label="İzleyici modu"]').click()`);
  assert.equal(await evaluate('document.querySelectorAll(".page .visual").length'), 4);
  await evaluate(`document.querySelector('[role="treeitem"][title^="mask_"]').click()`);
  await waitFor('document.querySelector(".visual.initially-hidden")');
  await evaluate(`document.querySelector('[role="treeitem"][title^="background_"]').click()`);
  await waitFor('document.querySelectorAll(".page .visual").length === 4');
  console.log("PASS: PBIX iç içe iki grup mutlak konumu korudu; gizli grup/alt maske tasarım ve izleyicide gizlendi, katman seçimiyle düzenlendi; tema/ikon/köşe korundu.");
}
