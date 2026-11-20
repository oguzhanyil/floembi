import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { unzipSync, strFromU8 } from "fflate";

export async function testServerGrid({ call, evaluate, waitFor, input }) {
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate('window.setTestMode("server-grid")');
  const pages = 'document.querySelector(".v-server-pages")?.textContent';
  const ready = 'document.querySelector(".v-server-grid")?.getAttribute("aria-busy") === "false"';
  const search = '.v-ag-tools input[type=search]';
  const byLabel = (label) => `document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})`;
  await waitFor(`${ready} && ${pages}?.includes("12.050")`);
  assert(await evaluate('window.serverGridQueries.every(q=>q.page)'));
  await evaluate(`${byLabel("Son veri sayfası")}.click()`);
  await waitFor(`${ready} && ${pages}?.includes("12.026")`);
  await waitFor('[...document.querySelectorAll(".ag-cell[col-id=c0]")].some(e=>e.textContent==="12.049")');
  assert(await evaluate(`${byLabel("Sonraki veri sayfası")}.disabled`));
  await input(search, '12049');
  await waitFor(`${ready} && ${pages}?.includes("1–1 / 1 grup")`);
  assert(await evaluate('document.querySelector(".v-note").textContent.includes("sayfa toplamı değildir")'));
  await input(search, 'bulunmayan');
  await waitFor(`${ready} && ${pages}?.includes("0 / 0 grup")`);
  assert(await evaluate(`Boolean(document.querySelector(${JSON.stringify(search)}))`));
  await input(search, ''); await waitFor(`${ready} && ${pages}?.includes("12.050")`);
  await input('.ag-floating-filter input', '12049');
  await waitFor(`${ready} && ${pages}?.includes("1–1 / 1 grup")`);
  assert.equal(await evaluate('window.serverGridQueries.at(-1).page.column_filters[0].index'), 0);
  await input('.ag-floating-filter input', ''); await waitFor(`${ready} && ${pages}?.includes("12.050")`);
  await evaluate('document.querySelector(".ag-header-cell[col-id=c0] .ag-header-cell-label").click()');
  await waitFor(`${ready} && window.serverGridQueries.at(-1).order_by?.[0]?.index === 0`);
  await evaluate('document.querySelector(".ag-header-cell[col-id=c0] .ag-header-cell-label").click()');
  await waitFor(`${ready} && window.serverGridQueries.at(-1).order_by?.[0]?.desc === true`);
  await waitFor('document.querySelector(".ag-row[row-index=\\"0\\"] .ag-cell[col-id=c0]")?.textContent === "12.049"');
  await evaluate('document.querySelector(".ag-header-cell[col-id=c0] .ag-header-cell-label").click()');
  await waitFor(`${ready} && window.serverGridQueries.at(-1).order_by?.length === 0`);

  // ZIP sıkıştırıcısının worker betiği Blob'ları indirilmiş dosya sayılmaz.
  await evaluate('window.gridBlobs=[];window.oldGridURL=URL.createObjectURL;URL.createObjectURL=b=>{if(b.type.startsWith("text/csv")||b.type.includes("spreadsheetml")||b.type==="application/pdf")window.gridBlobs.push(b);return window.oldGridURL(b)}');
  const choose = async (label) => {
    await evaluate('document.querySelector(".v-ag-tools button[aria-haspopup=menu]").click()');
    await waitFor('document.querySelector("[role=menuitem]")');
    await evaluate(`(()=>{const e=[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent===${JSON.stringify(label)});if(!e)throw Error('Menü bulunamadı');e.click()})()`);
  };
  await choose('Bu sayfa · CSV indir'); await waitFor('window.gridBlobs.length===1');
  assert.equal(await evaluate('window.gridBlobs[0].text().then(s=>s.trim().split(/\\r?\\n/).length)'), 26);
  await choose('Tüm eşleşen gruplar · CSV'); await waitFor('window.gridBlobs.length===2');
  assert.equal(await evaluate('window.gridBlobs[1].text().then(s=>s.trim().split(/\\r?\\n/).length)'), 12051);
  await choose('Tüm eşleşen gruplar · Excel (.xlsx)'); await waitFor('window.gridBlobs.length===3');
  const excel = unzipSync(Uint8Array.from(await evaluate('window.gridBlobs[2].arrayBuffer().then(b=>Array.from(new Uint8Array(b)))')));
  const sheet = strFromU8(excel['xl/worksheets/sheet1.xml']);
  assert.equal((sheet.match(/<row\b/g) ?? []).length, 12051);
  assert(sheet.includes('12049'), 'Son grup Excel dosyasında bulunmalı');
  await choose('Tüm eşleşen gruplar · PDF');
  await waitFor('document.querySelector(".v-table-feedback.error")?.textContent.includes("2.000")');
  assert.equal(await evaluate('window.gridBlobs.length'), 3);
  await evaluate('window.serverGridDelay=100');
  await choose('Tüm eşleşen gruplar · Excel (.xlsx)');
  await waitFor('[...document.querySelectorAll("button")].some(e=>e.textContent==="İndirmeyi iptal et")');
  await evaluate('[...document.querySelectorAll("button")].find(e=>e.textContent==="İndirmeyi iptal et").click()');
  await waitFor('document.querySelector(".v-table-feedback.error")?.textContent.includes("iptal")');
  assert.equal(await evaluate('window.gridBlobs.length'), 3);
  await evaluate(`window.serverGridDelay=0;${byLabel("Sonraki veri sayfası")}.click()`);
  await waitFor(`${ready} && ${pages}?.includes("26–50")`).catch(async (e) => { throw new Error(e.message + JSON.stringify(await evaluate('({pages:document.querySelector(".v-server-pages")?.textContent,errors:[...document.querySelectorAll("[role=alert]")].map(e=>e.textContent),queries:window.serverGridQueries.slice(-3)})'))); });
  await evaluate('window.serverGridVersion(2)');
  await waitFor('document.querySelector(".v-server-grid [role=alert]")?.textContent.includes("değişti")');
  await evaluate('document.querySelector(".v-server-grid [role=alert] button").click()');
  await waitFor(`${ready} && ${pages}?.includes("1–25")`);

  await evaluate('window.serverGridViewer(true)');
  await waitFor(`${ready} && ${pages}?.includes("12.050")`);
  await input(search,'12049'); await waitFor(`${ready} && ${pages}?.includes("1–1 / 1 grup")`);
  await evaluate('window.serverGridTree()');
  await waitFor(byLabel("Dalı aç: Doğu"));
  const branch = '.v-server-branch .v-server-branch';
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(branch)})`), null);
  await evaluate(`${byLabel("Dalı aç: Doğu")}.click()`);
  await waitFor(`document.querySelector(${JSON.stringify(branch)})?.textContent.includes("12.050")`);
  assert(await evaluate('window.serverGridQueries.some(q=>q.group.length===2 && q.page.snapshot==="snapshot2" && q.filters.some(f=>f.column==="Region"&&f.values[0]==="Doğu"))'));
  await input(`${branch} input[type=search]`, '12049');
  await waitFor(`document.querySelector(${JSON.stringify(branch)})?.textContent.includes("1–1 / 1 grup")`);
  await evaluate(`document.querySelector(${JSON.stringify(branch + ' details summary')}).click();[...document.querySelector(${JSON.stringify(branch)}).querySelectorAll('details button')].find(e=>e.textContent==='Bu düzeyin tüm grupları · CSV').click()`);
  await waitFor('window.gridBlobs.length===4');
  assert(await evaluate('window.gridBlobs[3].text().then(s=>s.includes("Region") && s.includes("12049"))'));
  assert(await evaluate('document.querySelector(".v-server-tree").textContent.includes("alt düzeyleri kapsamaz")'));
  assert(await evaluate('(()=>{const t=document.querySelector(".v-server-tree"),b=t.querySelector(".v-server-branch"),n=t.querySelector(":scope > .v-note"),p=b.querySelector(":scope > .v-note"),nav=[...b.querySelectorAll(":scope > .v-server-pages")].at(-1);return n.getBoundingClientRect().bottom<=b.getBoundingClientRect().top && p.getBoundingClientRect().top>=nav.getBoundingClientRect().bottom})()'), 'Kapsam açıklamaları akışta ayrı durmalı');
  if (process.env.FLOEM_UI_ARTIFACT_DIR) {
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR), 'f09-tree-expanded.png'), Buffer.from(shot.data, 'base64'));
  }
  await evaluate('[...document.querySelectorAll("button")].find(e=>e.textContent==="Dalları kapat").click()');
  await waitFor(`!document.querySelector(${JSON.stringify(branch)})`);
  if (process.env.FLOEM_UI_ARTIFACT_DIR) {
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR), 'f09-tree.png'), Buffer.from(shot.data, 'base64'));
  }
  await call('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:2,mobile:false});
  await waitFor('document.querySelector(".v-server-tree")?.clientWidth > 0');
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'));
  await evaluate('URL.createObjectURL=window.oldGridURL');
  console.log('PASS: F09 · 12.050 grup, son sayfa/arama/filtre, kapsamlı CSV, PDF sınırı, iptal, sürüm yenileme, web ve tembel ağaç dalları');
}
