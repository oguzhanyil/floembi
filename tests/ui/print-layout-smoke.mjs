import assert from "node:assert/strict";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

export async function testPrintLayout({ call, evaluate, waitFor, open, click, dir, path, outputs }) {
  await click("Fatura");
  await waitFor("document.querySelector('.form-ruler.horizontal')");
  assert(await evaluate("document.querySelector('.form-ruler.horizontal span:last-of-type').offsetHeight <= 10"), "180 mm etiketi tek satır olmalı");
  const label = name => `[...document.querySelectorAll('.print-studio label')].find(el=>el.firstChild?.textContent.trim()===${JSON.stringify(name)} || el.textContent.trim()===${JSON.stringify(name)})`;
  async function choose(name, value) {
    await evaluate(`(()=>{const el=${label(name)}.querySelector('select');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  }
  async function setInput(selector, value) {
    await evaluate(`(()=>{const el=${selector};el.focus();Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.blur()})()`);
  }
  const check = name => evaluate(`${label(name)}.querySelector('input').click()`);
  const point = (selector, x, y) => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const b=el.getBoundingClientRect();return {x:b.left+b.width*${x},y:b.top+b.height*${y}}})()`);
  async function drag(start, end) {
    await call("Input.dispatchMouseEvent", { type: "mousePressed", ...start, button: "left", buttons: 1, clickCount: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseMoved", ...end, button: "left", buttons: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...end, button: "left", clickCount: 1 });
  }
  const ruler = ".form-ruler.horizontal";
  await drag(await point(ruler, 5/181, .8), await point(ruler, 8/181, .8));
  await waitFor("document.querySelector('.form-guide-handle')");
  const guide = Number(await evaluate("parseFloat(document.querySelector('.form-guide-handle').style.left)"));
  assert(Math.abs(guide - 8) < .4);
  await click("Çizgi çiz");
  await waitFor("document.querySelector('.form-line-surface.drawing')");
  const canvas = ".form-line-surface.drawing";
  await drag(await point(canvas, 8.6/181, .05), await point(canvas, 170/181, .05));
  await waitFor("document.querySelector('.form-inspector legend')?.textContent === 'Çizgi özellikleri'");
  assert.equal(await evaluate(`${label("X1 (mm)")}.querySelector("input").valueAsNumber`), guide);
  await choose("Çizgi biçimi", "dashed");
  await setInput(`${label("Kalınlık (mm)")}.querySelector("input")`, ".7");
  await choose("Bölüm", "beforeDetail");
  await click("Tablo ekle");
  await waitFor("document.querySelector('.form-custom-table')");
  await setInput(`${label("Genişlik (mm)")}.querySelector("input")`, "164");
  await choose("Sol kenarı kılavuza hizala", String(guide));
  await click("Sütun ekle"); await click("Sütun ekle");
  async function cell(r, c) {
    await evaluate(`document.querySelector('.form-custom-table button[aria-label="Hücre ${r}, ${c}"]').click()`);
  }
  const textField = "document.querySelector('.form-inspector textarea')";
  for (const [c, text] of ["Kalem / Ürün", "Açıklama", "Miktar", "Net tutar"].entries()) {
    await cell(1, c + 1); await setInput(textField, text);
    if (c === 1) await setInput(`${label("Sütun genişlik payı")}.querySelector("input")`, "2");
    if (c >= 2) await choose("Sütun hizası", "right");
  }
  await setInput(`${label("Seçili satırın rengi")}.querySelector("input")`, "#c5e5e3");
  await cell(2, 1); await check("Seçili satırı her kalemde tekrarla");
  await setInput(textField, "Kalem {LineNum} · "); await choose("Hücreye veri alanı ekle", "ItemCode");
  for (const [i, key] of ["Dscription", "Quantity", "LineTotal"].entries()) {
    await cell(2, i + 2); await setInput(textField, ""); await choose("Hücreye veri alanı ekle", key);
  }
  await click("Satır ekle"); await click("Satırı sil");
  await check("Standart kalem tablosunu göster");
  await check("Dönüşümlü satır rengi"); await check("Koşula göre boya");
  await setInput(`${label("Koşul rengi")}.querySelector("input")`, "#d7edda");
  await setInput(`${label("Eşik değeri")}.querySelector("input")`, "200");
  await evaluate("document.querySelector('.ribbon-btn[title=\"Ctrl+S\"]').click()");
  await waitFor("!document.querySelector('.dirty')");
  await open("printForm");
  await waitFor("document.querySelectorAll('.form-custom-table tr').length === 5");
  assert.equal(await evaluate("document.querySelectorAll('.form-detail-table').length"), 0);
  assert.equal(await evaluate("document.querySelectorAll('.form-guide-handle').length"), 1);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.form-custom-table tr td:last-child button')).textAlign"), "right");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.form-custom-table tr')).backgroundColor"), "rgb(197, 229, 227)");
  assert.match(await evaluate("document.querySelectorAll('.form-custom-table tr')[1].innerText"), /Kalem 1 · U-/);
  assert(await evaluate("document.querySelector('.form-line-surface line').hasAttribute('stroke-dasharray')"));
  const downloads = join(dir, "tasarim-pdf");
  await mkdir(downloads);
  await call("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await click("A4 önizleme");
  await waitFor("document.querySelector('.print-download')?.download === 'FAT-0200.pdf'");
  await evaluate("document.querySelector('.print-download').click()");
  const pdf = join(downloads, "FAT-0200.pdf");
  for (let i = 0; i < 100 && !(await stat(pdf).catch(() => null))?.size; i++) await new Promise(done => setTimeout(done, 100));
  assert((await stat(pdf)).size > 1000);
  if (outputs) {
    await copyFile(path, join(outputs, "Belge-Tasarim-Ornegi.floem"));
    await copyFile(pdf, join(outputs, "FAT-0200-Tasarim.pdf"));
  }
  console.log("PASS: cetvel ve yakalama, fareyle çizgi, özel tekrar satırı, satır biçimleri, kaydet/aç ve A4 dışa aktarım.");
}
