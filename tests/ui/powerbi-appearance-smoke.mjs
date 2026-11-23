import assert from "node:assert/strict";

export async function testPowerBiAppearance({ evaluate, waitFor, open }) {
  await open("appearance");
  await waitFor('document.querySelector(".v-button-icon")');
  assert.equal(await evaluate('document.querySelectorAll(".page .visual").length'), 2, "Kaynakta gizli tam sayfa maske çizilmemeli");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".page")).backgroundColor'), "rgb(160, 209, 255)");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".v-action-button")).backgroundColor'), "rgba(0, 0, 0, 0)");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".v-action-button")).flexDirection'), "column");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".v-shape")).borderRadius'), "30px");
  const rect = await evaluate(`(()=>{const p=document.querySelector('.page').getBoundingClientRect();const v=document.querySelector('[data-visual-id^="icon-button_"]').getBoundingClientRect();const s=p.width/1000;return [(v.x-p.x)/s,(v.y-p.y)/s,v.width/s,v.height/s]})()`);
  rect.forEach((n, i) => assert(Math.abs(n - [100, 100, 160, 210][i]) < 1, `Kaynak dikdörtgen değişti: ${rect}`));
  await evaluate(`document.querySelector('.ribbon button[aria-label="İzleyici modu"]').click()`);
  await waitFor('document.querySelector(".visual.preview")');
  assert.equal(await evaluate('document.querySelectorAll(".page .visual").length'), 2);
  await evaluate(`document.querySelector('.ribbon button[aria-label="İzleyici modu"]').click()`);
  assert.equal(await evaluate('document.querySelectorAll(".page .visual").length'), 2);
  await evaluate(`document.querySelector('[role="treeitem"][title^="hidden_"]').click()`);
  await waitFor('document.querySelector(".visual.initially-hidden")');
  await evaluate(`document.querySelector('[role="treeitem"][title^="background_"]').click()`);
  await waitFor('document.querySelectorAll(".page .visual").length === 2');
  console.log("PASS: PBIX kaynakta gizli üst maske tasarım/izleyicide görünmez; tema tonu, ikonlu saydam düğme, yuvarlak köşe ve gerçek DOM geometri korundu.");
}
