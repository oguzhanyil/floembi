import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

export async function testLayouts({ call, evaluate, waitFor, input }) {
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate('window.setTestMode("layout")');
  await waitFor('document.querySelector("[data-visual-id=amount] .v-card-value")?.textContent === "42"');
  const rect = async (id) => evaluate(`(()=>{const r=document.querySelector('[data-visual-id="${id}"]').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
  const select = (id, shiftKey = false) => evaluate(`(()=>{const e=document.querySelector('[data-visual-id="${id}"]');e.focus();e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,shiftKey:${shiftKey}}))})()`);
  const shortcut = (key, shiftKey = false) => evaluate(`(()=>{const e=document.querySelector('.page [data-visual-id]');e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,ctrlKey:true,key:${JSON.stringify(key)},shiftKey:${shiftKey}}))})()`);
  const drag = async (selector, dx, dy, modifiers = 1) => {
    const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+Math.min(30,r.width/2),y:r.y+r.height/2}})()`);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1, modifiers });
    for (let step = 1; step <= 8; step++) await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + dx * step / 8, y: point.y + dy * step / 8, buttons: 1, modifiers });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + dx, y: point.y + dy, button: 'left', clickCount: 1, modifiers });
  };
  await select('a'); await select('b', true);
  await waitFor('document.querySelectorAll(".visual.selected").length === 2 && document.querySelector(".multi-selection")');
  const originalA = await rect('a'), originalB = await rect('b');
  await shortcut('g');
  await waitFor('document.querySelectorAll(".container-frame").length === 2 && window.savedLayout?.pages[0].visuals.some(v=>v.container?.kind === "group")');
  const groupId = await evaluate('window.savedLayout.pages[0].visuals.find(v=>v.container?.kind==="group").id');
  assert.deepEqual(await rect('a'), originalA); assert.deepEqual(await rect('b'), originalB);
  // Başlık A grubun başlığıyla aynı konumda olduğundan iç başlıktan taşımak da grubu taşımalı.
  await drag('[data-visual-id=a] .visual-head', 40, 35);
  await waitFor(`window.savedLayout.pages[0].visuals.find(v=>v.id===${JSON.stringify(groupId)}).x > 80`);
  const movedA = await rect('a'); assert(Math.abs(movedA.x - originalA.x - 40) < 1); assert(Math.abs(movedA.y - originalA.y - 35) < 1);
  await shortcut('z');
  await waitFor(`Math.abs(document.querySelector('[data-visual-id=a]').getBoundingClientRect().x-${originalA.x})<.5`);
  assert(await evaluate(`document.querySelector('[data-visual-id="${groupId}"]') !== null`), 'Taşıma tek geri alma adımı olmalı');
  await shortcut('y'); await waitFor(`Math.abs(document.querySelector('[data-visual-id=a]').getBoundingClientRect().x-${movedA.x})<.5`);
  await select(groupId); const beforeResize = await rect('a');
  await drag(`[data-visual-id="${groupId}"] > .visual-resize`, 80, 30);
  await waitFor(`document.querySelector('[data-visual-id=a]').getBoundingClientRect().width > ${beforeResize.w + 10}`);
  await shortcut('z'); await waitFor(`Math.abs(document.querySelector('[data-visual-id=a]').getBoundingClientRect().width-${beforeResize.w})<.5`);
  const groupWidth = await evaluate('Number(document.querySelector(\'[aria-label="Nesne w"]\').value)');
  await input('[aria-label="Nesne w"]', String(groupWidth + 100));
  await waitFor(`document.querySelector('[data-visual-id=a]').getBoundingClientRect().width > ${beforeResize.w + 10}`);
  await shortcut('z'); await waitFor(`Math.abs(document.querySelector('[data-visual-id=a]').getBoundingClientRect().width-${beforeResize.w})<.5`);
  // Kapsayıcı düzeni: dikey → yatay → ızgara; gerçek özellik panelinden değiştirilir.
  await select('frame');
  await evaluate('document.querySelector(".layout-controls").scrollIntoView({block:"start"})');
  await evaluate(`(()=>{const s=document.querySelector('[aria-label="Kapsayıcı yerleşimi"]');s.value='horizontal';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await waitFor('window.savedLayout.pages[0].visuals.find(v=>v.id==="frame").container.mode === "horizontal"');
  await evaluate(`(()=>{const s=document.querySelector('[aria-label="Kapsayıcı yerleşimi"]');s.value='vertical';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await waitFor('window.savedLayout.pages[0].visuals.find(v=>v.id==="frame").container.mode === "vertical"');
  await select('explanation');
  await evaluate('[...document.querySelectorAll(".viz-tabs button")].find(e=>e.textContent==="Biçim").click()');
  await waitFor('document.querySelector(".fmt-body textarea")');
  const beforeGrow = await rect('amount');
  const long = Array.from({length: 10}, (_, i) => `Satır ${i+1}: Satış performansı ve operasyon açıklaması.`).join('\n');
  await evaluate(`(()=>{const e=document.querySelector('.fmt-body textarea');e.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(long)});e.dispatchEvent(new Event('input',{bubbles:true}));e.blur()})()`);
  await waitFor(`document.querySelector('[data-visual-id=amount]').getBoundingClientRect().y > ${beforeGrow.y + 50}`);
  assert(await evaluate('(()=>{const a=document.querySelector("[data-visual-id=explanation]").getBoundingClientRect(),b=document.querySelector("[data-visual-id=amount]").getBoundingClientRect();return a.bottom < b.top})()'));
  await select('frame');
  await drag('[data-visual-id=frame] .visual-head', 15, 20);
  await waitFor('window.savedLayout.pages[0].visuals.find(v=>v.id==="frame").x > 720');
  assert.equal(await evaluate('window.savedLayout.pages[0].visuals.find(v=>v.id==="frame").h'), 180, 'Taşıma hesaplanan yüksekliği sabitlememeli');
  await shortcut('z'); await waitFor('window.savedLayout.pages[0].visuals.find(v=>v.id==="frame").x === 720');
  await select('frame'); await shortcut('g', true);
  await waitFor('!document.querySelector("[data-visual-id=frame]")');
  assert(await evaluate('(()=>{const a=document.querySelector("[data-visual-id=explanation]").getBoundingClientRect(),b=document.querySelector("[data-visual-id=amount]").getBoundingClientRect();return a.bottom < b.top})()'), 'Grubu çözme ölçülen metin yüksekliğini korumalı');
  await shortcut('z'); await waitFor('document.querySelector("[data-visual-id=frame]")');
  await select('frame');
  await evaluate(`(()=>{const s=document.querySelector('[aria-label="Kapsayıcı yerleşimi"]');s.value='free';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await waitFor('window.savedLayout.pages[0].visuals.find(v=>v.id==="frame").container.mode === "free"');
  assert(await evaluate('(()=>{const a=document.querySelector("[data-visual-id=explanation]").getBoundingClientRect(),b=document.querySelector("[data-visual-id=amount]").getBoundingClientRect();return a.bottom < b.top})()'), 'Akıştan serbest düzene geçişte nesneler üst üste gelmemeli');
  await shortcut('z'); await waitFor('window.savedLayout.pages[0].visuals.find(v=>v.id==="frame").container.mode === "vertical"');
  await select('explanation');
  await waitFor('document.querySelector(".fmt-body textarea")');
  // Kısalma tekrar yer açar; min yükseklik çalışma zamanındaki yükseklik olamaz.
  await evaluate(`(()=>{const e=document.querySelector('.fmt-body textarea');e.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Kısa açıklama');e.dispatchEvent(new Event('input',{bubbles:true}));e.blur()})()`);
  await waitFor(`Math.abs(document.querySelector('[data-visual-id=amount]').getBoundingClientRect().y-${beforeGrow.y})<1`);
  // Geciken kayıt cevabı daha yeni yerel tasarımı/geri almayı ezmemeli.
  await evaluate('window.holdLayoutSaves()'); await select('frame'); await input('[aria-label="Nesne adı"]', 'Birinci ad');
  await new Promise((r) => setTimeout(r, 450));
  await input('[aria-label="Nesne adı"]', 'Son ad');
  await evaluate(`document.querySelector('[aria-label="Nesne adı"]').blur();window.releaseLayoutSaves()`);
  await waitFor('window.savedLayout.pages[0].visuals.find(v=>v.id==="frame").title === "Son ad"');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Nesne adı"]').value`), 'Son ad');
  await shortcut('z'); await waitFor(`document.querySelector('[aria-label="Nesne adı"]').value !== "Son ad"`);
  await shortcut('y'); await waitFor('window.savedLayout.pages[0].visuals.find(v=>v.id==="frame").title === "Son ad"');
  // Yerel tanım kayıtta korunur ve web'de aynı geometriyi üretir.
  const saved = await evaluate('window.savedLayout'), desktopFrame = await rect('frame');
  assert.equal(saved.pages[0].visuals.find((v) => v.id === 'explanation').parentId, 'frame');
  assert.equal(saved.pages[0].visuals.find((v) => v.id === 'explanation').x, 16);
  await evaluate('window.layoutViewer(true)');
  await waitFor('document.querySelector(".viewer [data-visual-id=amount] .v-card-value")');
  const relative = async () => evaluate('(()=>{const a=document.querySelector("[data-visual-id=frame]").getBoundingClientRect(),b=document.querySelector("[data-visual-id=amount]").getBoundingClientRect();return {x:(b.x-a.x)/a.width,y:(b.y-a.y)/a.width}})()');
  const proportions = await relative();
  for (const [width,height,dpr] of [[1440,1000,1],[1024,768,1.25],[390,844,2]]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false});
    await waitFor('document.querySelector(".viewer .page").clientWidth > 0');
    const next = await relative(); assert(Math.abs(next.x-proportions.x)<.002 && Math.abs(next.y-proportions.y)<.002, `Web yerleşimi ${width}`);
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate('document.querySelector("[data-visual-id=toggle] button").click()');
  await waitFor('!document.querySelector("[data-visual-id=frame]") && !document.querySelector("[data-visual-id=amount]")');
  await evaluate('document.querySelector("[data-visual-id=toggle] button").click()');
  await waitFor('document.querySelector("[data-visual-id=amount] .v-card-value")');
  if (process.env.FLOEM_UI_ARTIFACT_DIR) {
    const shot = await call('Page.captureScreenshot',{format:'png'});
    await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR),'f05-layout-web.png'),Buffer.from(shot.data,'base64'));
  }
  await evaluate('window.layoutViewer(false)');
  await waitFor('document.querySelector(".layout-tree")');
  await select('frame');
  if (process.env.FLOEM_UI_ARTIFACT_DIR) {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 30, y: 60 });
    const shot = await call('Page.captureScreenshot',{format:'png'});
    await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR),'f05-layout-desktop.png'),Buffer.from(shot.data,'base64'));
  }
  assert(desktopFrame.w>0);
  // Kontrol+Alt ile akış kapsayıcısına gerçek bırakma; tek adımda geri alınır.
  await select(groupId); await shortcut('g', true);
  await waitFor(`!document.querySelector('[data-visual-id="${groupId}"]')`);
  const a = await rect('a'), f = await rect('frame');
  await drag('[data-visual-id=a] .visual-head', f.x + f.w / 2 - a.x - a.w / 2, f.y + f.h / 2 - a.y - a.h / 2, 3);
  await waitFor('window.savedLayout.pages[0].visuals.find(v=>v.id==="a").parentId === "frame"');
  await shortcut('z');
  await waitFor('!window.savedLayout.pages[0].visuals.find(v=>v.id==="a").parentId');
  // Bir akış öğesini kardeşinin merkezine bırakarak sıralayın.
  await select('explanation'); const e = await rect('explanation'), amount = await rect('amount');
  await drag('[data-visual-id=explanation] .visual-head', 0, amount.y + amount.h / 2 - e.y - e.h / 2);
  await waitFor('window.savedLayout.pages[0].visuals.findIndex(v=>v.id==="explanation") > window.savedLayout.pages[0].visuals.findIndex(v=>v.id==="amount")');
  await shortcut('z');
  await waitFor('window.savedLayout.pages[0].visuals.findIndex(v=>v.id==="explanation") < window.savedLayout.pages[0].visuals.findIndex(v=>v.id==="amount")');
  console.log('PASS: F05 Shift çoklu seçim, Ctrl+G, gerçek fareyle grup taşıma/boyutlandırma, tek adım undo/redo, akış, metin büyüme/küçülme, geciken kayıt, yerel koordinatlar ve 3 web viewport/DPR; kapsayıcı görünürlük eylemi.');
}
