import assert from "node:assert/strict";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { testPrintLayout } from "./print-layout-smoke.mjs";

export async function testPrintForms({ call, evaluate, waitFor, open, dir, source, outputs }) {
  const path = join(dir, "Belge-UI.floem");
  await copyFile(source, path);
  const downloads = join(dir, "indirilen");
  await mkdir(downloads);
  await call("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await evaluate(`window.fixture.printForm=${JSON.stringify(path)}`);
  await open("printForm");
  const button = text => `[...document.querySelectorAll('.print-studio button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const click = async text => { await waitFor(button(text)); await evaluate(`${button(text)}.click()`); };
  const info = ".print-stage-tools span";
  async function preview(number, count) {
    await waitFor(`document.querySelector('${info}')?.textContent === '${number} · ${count} kalem'`);
    await click("A4 önizleme");
    await waitFor(`document.querySelector('.print-download')?.download === '${number}.pdf'`);
    assert(await evaluate(`document.querySelector('.print-frame').src === document.querySelector('.print-download').href`));
    const file = join(downloads, number + ".pdf");
    await evaluate("document.querySelector('.print-download').click()");
    for (let i = 0; i < 100 && !(await stat(file).catch(() => null))?.size; i++) {
      await new Promise(done => setTimeout(done, 100));
    }
    assert((await stat(file)).size > 1000);
    if (outputs) {
      await mkdir(outputs, { recursive: true });
      await copyFile(file, join(outputs, number + ".pdf"));
    }
    await click("Tasarım");
  }
  await preview("FAT-0200", 182);
  await click("Teklif");
  await preview("TEK-0002", 40);
  const choose = async n => {
    await evaluate(`(()=>{const s=document.querySelector('.print-settings select');s.value='${n}';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  };
  await choose(1); await preview("TEK-0001", 1);
  await choose(3); await preview("TEK-0003", 200);
  await evaluate(`document.querySelector('.print-field button[aria-label="Sıra sağa"]').click()`);
  await evaluate(`document.querySelector('.ribbon-btn[title="Ctrl+S"]').click()`);
  await waitFor(`!document.querySelector(".dirty")`);
  await open("printForm");
  await click("Teklif");
  await waitFor(`document.querySelector('${info}')?.textContent.includes('TEK-0003')`);
  assert.equal(await evaluate(`document.querySelector('.print-paper th').textContent`), "Ürün kodu");
  console.log("PASS: Belge Tasarımcısı, 4 A4 önizleme, sütun sırası, kaydet/aç ve örnek belge seçimi.");
  await testPrintLayout({ call, evaluate, waitFor, open, click, dir, path, outputs });
}
