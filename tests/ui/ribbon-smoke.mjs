import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

export async function testRibbon({ call, evaluate, waitFor, open }) {
  const button = label => `.ribbon button[aria-label="${label}"]`;
  const click = label => evaluate(`document.querySelector(${JSON.stringify(button(label))}).click()`);
  const disabled = label => evaluate(`document.querySelector(${JSON.stringify(button(label))}).disabled`);
  const pages = n => waitFor(`document.querySelectorAll('.page-tabs .page-tab:not(.add)').length === ${n}`);
  await waitFor('document.querySelector(".ribbon-report-tools")');
  assert.equal(await evaluate('document.querySelectorAll(".ribbon-report-tools button").length'), 3);
  assert(!await evaluate('document.querySelector(".canvas-shell .canvas-mode-toggle, .canvas-shell .design-history")'));
  assert(await disabled("Geri al")); assert(await disabled("İleri al"));
  await evaluate('document.querySelector(".page-tab.add").click()'); await pages(2);
  assert(!await disabled("Geri al")); assert(await disabled("İleri al"));
  await click("Geri al"); await pages(1);
  assert(!await disabled("İleri al"));
  await click("İzleyici modu");
  await waitFor(`document.querySelector('${button("İzleyici modu")}').getAttribute('aria-pressed') === 'true'`);
  assert(await disabled("Geri al")); assert(await disabled("İleri al"));
  await click("İzleyici modu");
  await waitFor(`document.querySelector('${button("İzleyici modu")}').getAttribute('aria-pressed') === 'false'`);
  assert(!await disabled("İleri al"));
  await click("İleri al"); await pages(2);
  const key = async (name, code, modifiers = 2) => {
    await evaluate(`document.querySelector(${JSON.stringify(button("İzleyici modu"))}).focus()`);
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: name, code, modifiers, windowsVirtualKeyCode: name.toUpperCase().charCodeAt(0) });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, modifiers, windowsVirtualKeyCode: name.toUpperCase().charCodeAt(0) });
  };
  await key("z", "KeyZ"); await pages(1);
  await key("y", "KeyY"); await pages(2);
  await key("z", "KeyZ"); await pages(1);
  await key("Z", "KeyZ", 10); await pages(2);
  await evaluate('document.querySelector(".page-tab:not(.add)").click()');
  await waitFor('document.querySelector(".v-text")?.textContent.includes("Verisiz rapor da açılır")');
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  assert(await evaluate(`(()=>{const b=document.querySelector('.ribbon-report-tools').getBoundingClientRect();const r=document.querySelector('.ribbon').getBoundingClientRect();return b.left>=r.left && b.right<=r.right && b.top>=r.top && b.bottom<=r.bottom})()`));
  if (process.env.FLOEM_RIBBON_QA_DIR) {
    const dir = resolve(process.env.FLOEM_RIBBON_QA_DIR); await mkdir(dir, { recursive: true });
    const shot = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(join(dir, "ribbon.png"), Buffer.from(shot.data, "base64"));
  }
  // Bekleyen kaydı tamamla, yeni belgede eski araç/komutların kalmadığını dene.
  await evaluate(`document.querySelector('.ribbon-btn[title="Ctrl+S"]').click()`);
  await waitFor('!document.querySelector(".dirty")');
  await evaluate(`document.querySelector('.ribbon-btn[title="Ctrl+N"]').click()`);
  await waitFor('document.querySelector(".empty-state") && !document.querySelector(".ribbon-report-tools")');
  await open("text");
  await waitFor('document.querySelector(".ribbon-report-tools")');
  assert(await disabled("Geri al")); assert(await disabled("İleri al"));
  assert.equal(await evaluate(`document.querySelector('${button("İzleyici modu")}').getAttribute('aria-pressed')`), "false");
  console.log("PASS: Desktop ribbon izleyici/geri al/ileri al; sayfa değişikliği, önizlemede pasif geçmiş, Ctrl+Z/Y/Shift+Z, yeni belge ve dosya açmada temiz komutlar.");
}
