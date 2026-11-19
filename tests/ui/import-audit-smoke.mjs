import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export async function testImportAudit({ call, evaluate, waitFor, input, dir }) {
  await evaluate('window.setTestMode("audit")');
  await waitFor('document.querySelector(".import-audit-control button")');
  await evaluate('document.querySelector(".import-audit-control button").click()');
  await waitFor('document.querySelector(".import-audit-dialog[open]")');
  assert.equal(await evaluate('document.querySelectorAll(".import-audit-visual").length'), 2);
  assert.match(await evaluate('document.querySelector(".import-audit-dialog").textContent'), /Veri ve özgün ölçü formülleri aktarılmadı/);
  await evaluate('(()=>{const e=document.querySelector("select[aria-label=\\"Uyumluluk durumu\\"]");e.value="unsupported";e.dispatchEvent(new Event("change",{bubbles:true}))})()');
  await waitFor('document.querySelectorAll(".import-audit-visual").length === 1');
  await input('input[aria-label="Uyumluluk raporunda ara"]', 'bulunamayan');
  await waitFor('document.querySelector(".import-audit-dialog").textContent.includes("Eşleşen nesne yok")');
  await input('input[aria-label="Uyumluluk raporunda ara"]', 'funnel');
  await waitFor('document.querySelectorAll(".import-audit-visual").length === 1');
  const downloads = join(dir, 'audit-downloads'); await mkdir(downloads);
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await evaluate('[...document.querySelectorAll(".import-audit-dialog button")].find(e=>e.textContent==="JSON indir").click()');
  const file = join(downloads, 'floem-pbip-uyumluluk.json');
  for (let i=0;i<100&&!existsSync(file);i++) await new Promise((done)=>setTimeout(done,100));
  const audit = JSON.parse(await readFile(file,'utf8'));
  assert.equal(audit.summary.visuals, 2, 'Filtrelenmiş ekrandan indirilen rapor tam envanteri korumalı');
  await evaluate('document.querySelector(".import-audit-visual summary").click()');
  if (process.env.FLOEM_UI_ARTIFACT_DIR) {
    const shot=await call('Page.captureScreenshot',{format:'png'});
    await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR),'pbip-compatibility.png'),Buffer.from(shot.data,'base64'));
  }
  await evaluate('[...document.querySelectorAll(".import-audit-dialog button")].find(e=>e.textContent.startsWith("Nesneye git")).click()');
  await waitFor('!document.querySelector(".import-audit-dialog") && document.querySelector("[data-visual-id=unsupported].selected .v-import-warning")');
  assert.equal(await evaluate('document.querySelector(".page-tab.active").firstChild.textContent'), 'Detay');
  await evaluate('window.setAllReport(window.auditReport);window.setTestMode("all-viewer")');
  await waitFor('document.querySelector(".viewer .import-audit-control button")');
  await evaluate('document.querySelector(".import-audit-control button").click()');
  await waitFor('document.querySelector(".import-audit-dialog[open]")');
  assert(!await evaluate('[...document.querySelectorAll(".import-audit-dialog button")].some(e=>e.textContent.startsWith("Nesneye git"))'));
  await evaluate('document.querySelector(".import-audit-dialog").dispatchEvent(new Event("cancel"))');
  await waitFor('!document.querySelector(".import-audit-dialog")');
  console.log('PASS: PBIP aktarım raporu tasarım/web, arama/durum filtresi, tam JSON indirme, sayfa ve nesneye gitme, desteklenmeyen nesnede kalıcı uyarı.');
}
