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
  const detailPath = join(dir, "Belge-Detay-Bandi.floem");
  await copyFile(path, detailPath);
  await evaluate(`window.fixture.detailForm=${JSON.stringify(detailPath)}`);
  await open("detailForm");
  async function editDetailBand() {
    await click("Detay satırını düzenle");
    await waitFor("document.querySelector('.detail-inspector')");
    await setInput(`${label("En az satır yüksekliği (mm)")}.querySelector('input')`, "7");
    await setInput(`${label("Yazı boyutu (pt)")}.querySelector('input')`, "10");
    await click("Alan / metin ekle");
    await setInput(`${label("Satır metni")}.querySelector('textarea')`, "{WhsCode} · Kalem {LineNum}");
    await setInput(`${label("Alan genişliği (%)")}.querySelector('input')`, "93");
    await setInput(`${label("Soldan (%)")}.querySelector('input')`, "3");
    await setInput(`${label("Metin boyutu (pt)")}.querySelector('input')`, "8");
    await click("Arkasına çizgi çiz");
    const drawRow = "tr.band-part .form-line-surface.drawing";
    await waitFor(`document.querySelector(${JSON.stringify(drawRow)})`);
    await drag(await point(drawRow, .03, .12), await point(drawRow, .97, .12));
    await choose("Ayraç biçimi", "dotted");
    await setInput(`${label("Ayraç rengi")}.querySelector('input')`, "#167567");
    await choose("Banttaki öğe", "data");
    await click("Yatay ayraç ekle");
    await setInput(`${label("X2 (%)")}.querySelector('input')`, "12");
    await setInput(`${label("X1 (%)")}.querySelector('input')`, "3");
    await setInput(`${label("Ayraç rengi")}.querySelector('input')`, "#c48034");
    await click("Düzenlemeyi bitir");
  }
  await editDetailBand();
  await click("Teklif");
  await waitFor("document.querySelector('.form-detail-table')");
  await choose("Belge", "2");
  await waitFor("document.querySelector('.print-stage-tools span')?.textContent.includes('TEK-0002')");
  await editDetailBand();
  await evaluate("document.querySelector('.ribbon-btn[title=\"Ctrl+S\"]').click()");
  await waitFor("!document.querySelector('.dirty')");
  await open("detailForm");
  const bandDownloads = join(dir, "detay-bandi-pdf");
  await mkdir(bandDownloads);
  await call("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: bandDownloads });
  for (const [kind, number, grid] of [["Fatura", "FAT-0200", ".form-custom-table"], ["Teklif", "TEK-0002", ".form-detail-table"]]) {
    await click(kind);
    await waitFor(`document.querySelectorAll('${grid} tr.band-part').length === 12`);
    assert.match(await evaluate(`document.querySelector('${grid} .band-text').innerText`), /Depo .+ · Kalem \d+/);
    await click("A4 önizleme");
    await waitFor(`document.querySelector('.print-download')?.download === '${number}.pdf'`);
    await evaluate("document.querySelector('.print-download').click()");
    const file = join(bandDownloads, number + ".pdf");
    for (let i = 0; i < 100 && !(await stat(file).catch(() => null))?.size; i++) await new Promise(done => setTimeout(done, 100));
    assert((await stat(file)).size > 1000);
    if (outputs) await copyFile(file, join(outputs, number + "-Detay.pdf"));
  }
  if (outputs) await copyFile(detailPath, join(outputs, "Belge-Detay-Bandi.floem"));
  console.log("PASS: özel ve standart detay bandında veri alanı, iki satır arası çizgi, çok sayfalı baskı ve kaydet/aç.");
  const overflow = join(dir, "uzun-bant");
  await mkdir(overflow);
  await call("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: overflow });
  const notes = Array.from({ length: 95 }, (_, i) => "N" + String(i + 1).padStart(2, "0")).join("\n");
  for (const [kind, number] of [["Teklif", "TEK-0001"], ["Fatura", "FAT-0200"]]) {
    await click(kind); await click("Tasarım");
    if (kind === "Teklif") {
      await choose("Belge", "1");
      await waitFor("document.querySelector('.print-stage-tools span')?.textContent.includes('TEK-0001')");
      await click("Detay satırını düzenle");
    } else {
      await waitFor("document.querySelector('.form-custom-table button')");
      await cell(1, 1); await click("Seçili satır bandını düzenle");
    }
    await click("Alan / metin ekle");
    await setInput(`${label("Satır metni")}.querySelector('textarea')`, notes);
    await setInput(`${label("Metin boyutu (pt)")}.querySelector('input')`, "14");
    await click("A4 önizleme");
    await waitFor(`document.querySelector('.print-download')?.download === '${number}.pdf'`);
    await evaluate("document.querySelector('.print-download').click()");
    const file = join(overflow, number + ".pdf");
    for (let i = 0; i < 100 && !(await stat(file).catch(() => null))?.size; i++) await new Promise(done => setTimeout(done, 100));
    assert((await stat(file)).size > 1000);
    if (outputs) await copyFile(file, join(outputs, number + "-Uzun.pdf"));
  }
  await evaluate("document.querySelector('.ribbon-btn[title=\"Ctrl+S\"]').click()");
  await waitFor("!document.querySelector('.dirty')");
}
