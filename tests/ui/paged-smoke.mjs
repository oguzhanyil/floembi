import assert from "node:assert/strict";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

export async function testPaged({ call, evaluate, waitFor, open, dir, source, output }) {
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const path = join(dir, "Sayfali.floem"),
    target = join(dir, "sayfali-cikti");
  await copyFile(source, path);
  await mkdir(target);
  await call("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: target });
  await evaluate(`window.fixture.paged=${JSON.stringify(path)}`);
  await open("paged");
  const btn = (s) =>
    `[...document.querySelectorAll('.pg-studio button')].find(b=>b.textContent.trim()===${JSON.stringify(s)})`;
  const click = async (s) => {
    await waitFor(btn(s));
    await evaluate(`${btn(s)}.click()`);
  };
  await click("Baskı önizleme");
  await waitFor("document.querySelector('.paged-paper')?.textContent.includes('FAT-0200')");
  assert.match(await evaluate("document.querySelector('.paged-paper').textContent"), /Açıklama/);
  const n = await evaluate(
    "Number(document.querySelector('.paged-controls span').textContent.split('/')[1].split('·')[0])",
  );
  assert(n > 1);
  for (let i = 1; i < n; i++)
    await evaluate("document.querySelector('[aria-label=\"Sonraki sayfa\"]').click()");
  await waitFor("document.querySelector('.paged-paper').textContent.includes('33.061,80 TL')");
  for (const [label, ext] of [
    ["PDF", "pdf"],
    ["Word", "docx"],
    ["Excel", "xlsx"],
    ["CSV", "csv"],
    ["HTML", "html"],
  ]) {
    await click(label);
    const name = join(target, "Fatura dökümü." + ext);
    for (let i = 0; i < 200 && !(await stat(name).catch(() => null))?.size; i++)
      await new Promise((r) => setTimeout(r, 100));
    assert((await stat(name)).size > 20, label + " indirmesi");
    if (output) {
      await mkdir(output, { recursive: true });
      await copyFile(name, join(output, "Sayfali-FAT-0200." + ext));
    }
  }
  await click("Tasarım");
  await click("Kopyala");
  await click("Yeni sürüm başlat");
  const pointOf = (selector) =>
    evaluate(
      `(async()=>{const el=document.querySelector(${JSON.stringify(selector)});await document.fonts.ready;const frame=()=>new Promise(r=>requestAnimationFrame(r));await frame();await frame();el.scrollIntoView({block:"center"});await frame();await frame();const r=el.getBoundingClientRect();return {x:r.x+Math.min(12,r.width/3),y:r.y+Math.min(8,r.height/2)};})()`,
    );
  async function drag(a, b) {
    await call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...a,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await call("Input.dispatchMouseEvent", { type: "mouseMoved", ...b, buttons: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...b, button: "left", clickCount: 1 });
  }
  const title = ".pg-object[aria-label='Satış faturası']",
    a = await pointOf(title);
  await drag(a, { x: a.x + 26, y: a.y + 5 });
  await waitFor(`parseFloat(document.querySelector(${JSON.stringify(title)}).style.left)>10`);
  await click("Metin kutusu");
  const box = ".pg-text.selected",
    at = await pointOf(box);
  for (let i = 1; i <= 2; i++) {
    await call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...at,
      button: "left",
      buttons: 1,
      clickCount: i,
    });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", clickCount: i });
  }
  await waitFor("document.querySelector('.pg-object textarea')");
  await evaluate(
    `(()=>{const e=document.querySelector('.pg-object textarea');e.value='Kutu denemesi';e.blur();})()`,
  );
  await waitFor("document.querySelector('.pg-text.selected')?.textContent.includes('Kutu denemesi')");
  await click("Çoğalt");
  const originalCount = await evaluate(
    "document.querySelectorAll('.pg-object[aria-label=\"Kutu denemesi\"]').length",
  );
  assert.equal(originalCount, 2);
  await click("Geri al");
  await waitFor("document.querySelectorAll('.pg-object[aria-label=\"Kutu denemesi\"]').length===1");
  const lockInput = `[...document.querySelectorAll('.pg-panel label')].find(l=>l.textContent.trim()==='Nesneyi kilitle').querySelector('input')`;
  await evaluate("document.querySelector('.pg-object[aria-label=\"Kutu denemesi\"]').focus()");
  await evaluate(lockInput + ".click()");
  await waitFor("document.querySelector('.pg-object.selected.locked')");
  await evaluate(lockInput + ".click()");
  const moving = ".pg-object[aria-label='Kutu denemesi']",
    destination = "[aria-label='Rapor toplamı tasarım alanı']";
  await waitFor("document.querySelector('.pg-object.selected:not(.locked)')");
  const from = await pointOf(moving);
  await call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...from,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  const dp = await pointOf(destination);
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", ...dp, buttons: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...dp, button: "left", clickCount: 1 });
  await waitFor(`document.querySelector(${JSON.stringify(destination + " " + moving)})`);
  await click("Çizgiyi sürükleyerek çiz");
  const point = await evaluate(
    `(()=>{const e=document.querySelector('[aria-label="Sayfa başlığı tasarım alanı"]');e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.x+8,y:r.y+r.height-3};})()`,
  );
  await call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...point,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 110, y: point.y, buttons: 1 });
  await call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x + 110,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await waitFor("document.querySelector('.pg-line.selected')");
  await evaluate("document.querySelector('.ribbon-btn[title=\"Ctrl+S\"]').click()");
  await waitFor('!document.querySelector(".dirty")');
  await open("paged");
  await waitFor("document.querySelector('.pg-toolbar').innerText.includes('kopyası')");
  const tab = `[...document.querySelectorAll('.print-top button')].find(b=>b.textContent==='Fatura')`;
  await evaluate(tab + ".click()");
  await waitFor("document.querySelector('[aria-label=\"Taşınabilir belge başlığı\"]')");
  const h = "[aria-label='Taşınabilir belge başlığı']",
    hPos = await pointOf(h);
  await drag(hPos, { x: hPos.x + 42, y: hPos.y + 14 });
  await waitFor(`parseFloat(document.querySelector(${JSON.stringify(h)}).style.left)>0`);
  const legacy = (s) =>
    `[...document.querySelectorAll('.print-studio button')].find(b=>b.textContent.trim()===${JSON.stringify(s)})`;
  await evaluate(legacy("Metin kutusu ekle") + ".click()");
  await waitFor("document.querySelector('[aria-label^=\"Metin kutusu Metin\"]')");
  const free = ".free-form-box.selected",
    freePos = await pointOf(free);
  for (let i = 1; i <= 2; i++) {
    await call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...freePos,
      button: "left",
      buttons: 1,
      clickCount: i,
    });
    await call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...freePos,
      button: "left",
      clickCount: i,
    });
  }
  await waitFor("document.querySelector('.free-form-box textarea')");
  await evaluate(
    "(()=>{const e=document.querySelector('.free-form-box textarea');e.value='Teslim alan: {CardName}';e.blur()})()",
  );
  await waitFor("document.querySelector('.free-form-box.selected')?.textContent.includes('Teslim alan:')");
  await evaluate(legacy("A4 önizleme") + ".click()");
  await waitFor("document.querySelector('.print-download')");
  await evaluate("document.querySelector('.print-download').click()");
  const pdf = join(target, "FAT-0200.pdf");
  for (let i = 0; i < 160 && !(await stat(pdf).catch(() => null))?.size; i++)
    await new Promise((r) => setTimeout(r, 100));
  assert((await stat(pdf)).size > 2000);
  if (output) await copyFile(pdf, join(output, "Serbest-FAT-0200.pdf"));
  await evaluate("document.querySelector('.print-top button:last-child').click()");
  await waitFor("document.querySelector('.pg-toolbar')");
  await evaluate(
    `(()=>{const s=[...document.querySelectorAll('.pg-toolbar label')].find(l=>l.textContent.startsWith('Yeni rapor kaynağı')).querySelector('select');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}))})()`,
  );
  await click("Yeni rapor");
  await click("Baskı önizleme");
  await waitFor("document.querySelector('.paged-paper')?.textContent.includes('Belge başlığı')");
  assert.match(await evaluate("document.querySelector('.paged-controls span').textContent"), /1 \/ 1/);
  if (process.env.FLOEM_UI_FREE_FORM) {
    const receipt = join(dir, "Teslim-Ornegi.floem");
    await copyFile(process.env.FLOEM_UI_FREE_FORM, receipt);
    await evaluate(`window.fixture.receipt=${JSON.stringify(receipt)}`);
    await open("receipt");
    await click("Baskı önizleme");
    await waitFor("document.querySelector('.paged-paper')?.textContent.includes('Teslim tutanağı')");
    await click("PDF");
    const pdf = join(target, "Teslim tutanağı.pdf");
    for (let i = 0; i < 150 && !(await stat(pdf).catch(() => null))?.size; i++)
      await new Promise((r) => setTimeout(r, 100));
    assert((await stat(pdf)).size > 1000);
    if (output) await copyFile(pdf, join(output, "Teslim-Tutanagi.pdf"));
  }
  console.log(
    `PASS: 182 kalem, ${n} sayfa, beş çıktı; her iki editörde başlık taşıma, metne çift tıklama, kutu çoğaltma/kilitleme ve kaydetme.`,
  );
}
