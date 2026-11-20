// Bağımlılık eklemeden gerçek Chromium'da ortak rapor bileşenlerini doğrular.
// Kullanıcının tarayıcısı/profili kullanılmaz; yalnız bu testin süreci kapatılır.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, relative, isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { testMatrix } from "./matrix-smoke.mjs";
import { testThemes } from "./theme-smoke.mjs";
import { testImportAudit } from "./import-audit-smoke.mjs";
import { testLayouts } from "./layout-smoke.mjs";
import { testComponents } from "./component-smoke.mjs";
import { testAppearance } from "./appearance-smoke.mjs";
import { testResponsive } from "./responsive-smoke.mjs";
import { testServerGrid } from "./server-grid-smoke.mjs";
import { testRuntime } from "./runtime-smoke.mjs";

const root = resolve(import.meta.dirname, "../..");
const dir = await mkdtemp(join(tmpdir(), "floem-ui-test-"));
const browser = process.env.FLOEM_TEST_BROWSER || [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find(existsSync);
assert(browser, "Chromium bulunamadı; FLOEM_TEST_BROWSER ayarlayın.");
let child, server, ws;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
try {
  await build({ root, configFile: false, plugins: [react()], logLevel: "warn",
    build: { outDir: dir, emptyOutDir: false, minify: false,
      lib: { entry: join(root, "tests/ui/report-smoke.tsx"), formats: ["es"], fileName: () => "app.js", cssFileName: "app" } },
    define: { "process.env.NODE_ENV": '"development"' } });
  const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; worker-src 'self' blob:; connect-src http://127.0.0.1:*";
  await writeFile(join(dir, "index.html"), `<!doctype html><html lang="tr"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="stylesheet" href="/app.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Segoe UI,sans-serif;--surface:#fff;--text:#172033;--muted:#64748b;--border:#cbd5e1}.fixtures{display:flex;flex-wrap:wrap;gap:20px;padding:20px}section{padding:5px}</style><div id="root"></div><script type="module" src="/app.js"></script></html>`);
  const served = new Set((await readdir(dir)).filter((name) => /\.(html|m?js|css)$/.test(name)));
  server = createServer(async (req, res) => {
    const path = req.url === "/" ? "index.html" : req.url?.slice(1);
    if (!served.has(path)) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", path.endsWith("js") ? "text/javascript" : path.endsWith("css") ? "text/css" : "text/html");
    res.end(await readFile(join(dir, path)));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${join(dir, "profile")}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  const activePort = join(dir, "profile/DevToolsActivePort");
  for (let i = 0; i < 150 && !existsSync(activePort); i++) await delay(100);
  const port = (await readFile(activePort, "utf8")).split("\n")[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((done) => ws.addEventListener("open", done, { once: true }));
  let nextId = 0;
  const pending = new Map();
  const browserErrors = [];
  ws.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
    if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails.exception?.description?.slice(0, 700));
  });
  const call = (method, params = {}) => new Promise((done, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP zaman aşımı: ${method}`)); }, 15000);
    pending.set(id, (r) => { clearTimeout(timeout); r.error ? reject(new Error(JSON.stringify(r.error))) : done(r.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ": " + r.exceptionDetails.exception?.description);
    return r.result.value;
  };
  const waitFor = async (expression) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(100); }
    throw new Error(`Koşul sağlanmadı: ${expression}\n${browserErrors.join('\n')}`);
  };
  await call('Runtime.enable');
  await call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
  if (process.env.FLOEM_UI_RUNTIME_ONLY) {
    await waitFor('window.setTestMode');
    await testRuntime({ call, evaluate, waitFor, input: (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event("input",{bubbles:true}))})()`) });
  } else if (process.env.FLOEM_UI_SERVER_GRID_ONLY) {
    await waitFor('window.setTestMode');
    await testServerGrid({ call, evaluate, waitFor, input: (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event("input",{bubbles:true}))})()`) });
  } else if (process.env.FLOEM_UI_RESPONSIVE_ONLY) {
    await waitFor('window.setTestMode');
    await testResponsive({ call, evaluate, waitFor, input: (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event("input",{bubbles:true}))})()`) });
  } else if (process.env.FLOEM_UI_LAYOUT_ONLY) {
    await waitFor('window.setTestMode');
    await testLayouts({ call, evaluate, waitFor, input: (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event("input",{bubbles:true}))})()`) });
  } else if (process.env.FLOEM_UI_APPEARANCE_ONLY) {
    await waitFor('window.setTestMode');
    await testAppearance({ call, evaluate, waitFor, input: (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event("input",{bubbles:true}))})()`) });
  } else if (process.env.FLOEM_UI_COMPONENTS_ONLY) {
    await waitFor('window.setTestMode');
    await testComponents({ call, evaluate, waitFor, input: (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event("input",{bubbles:true}))})()`), dir });
  } else {
  await waitFor('document.querySelector("[data-fixture=broken] .v-error") && document.querySelector("[data-fixture=zero] .v-card-value")');
  assert.equal(await evaluate('document.querySelector("[data-fixture=zero] .v-card-value").textContent'), "0");
  assert.match(await evaluate('document.querySelector("[data-fixture=null]").textContent'), /veri yok/);
  assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-fixture=heading] .v-text")).overflowY'), "hidden");
  assert(await evaluate('(()=>{const e=document.querySelector("[data-fixture=heading] .v-text");return e.scrollHeight<=e.clientHeight})()'));
  assert(await evaluate('document.querySelector("[data-fixture=grow] .visual").getBoundingClientRect().height > 50'));
  await waitFor('document.querySelector("[data-fixture=ellipsis] .v-text-more")');
  await evaluate('document.querySelector("[data-fixture=ellipsis] .v-text-more").click()');
  assert(await evaluate('document.querySelector("dialog[open]") !== null'));
  await evaluate('document.querySelector("dialog[open]").close(); window.repairVisual(); document.querySelector("[data-fixture=broken] .v-error button").click(); document.querySelector("[data-fixture=rejected] .v-error button").click()');
  await waitFor('document.querySelector("[data-fixture=broken] .v-card-value")?.textContent === "42" && document.querySelector("[data-fixture=rejected] .v-card-value")?.textContent === "42"');
  await evaluate('window.setTestMode("grid")');
  await waitFor('document.querySelector(".v-ag-count")?.textContent === "3 satır" && document.querySelector(".ag-floating-filter input")');
  const input = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event("input",{bubbles:true}))})()`);
  await input('.v-ag-tools input[type=search]', 'Alpha');
  await waitFor('document.querySelector(".v-ag-count")?.textContent === "1 / 3 satır"');
  await evaluate('window.setGridOptions({gridSearch:false})');
  await waitFor('document.querySelector(".v-ag-count")?.textContent === "3 satır" && !document.querySelector(".v-ag-tools input[type=search]")');
  await input('.ag-floating-filter input', 'Beta');
  await waitFor('document.querySelector(".v-ag-count")?.textContent === "1 / 3 satır"');
  await evaluate('window.setGridOptions({gridFilters:false})');
  await waitFor('document.querySelector(".v-ag-count")?.textContent === "3 satır" && !document.querySelector(".ag-floating-filter input")');
  await evaluate('document.querySelector(".v-ag-column-menu > button").click()');
  await waitFor('document.querySelector(".v-ag-column-list input")');
  await evaluate('document.querySelector(".v-ag-column-list input").click()');
  await waitFor('!document.querySelector(".ag-header-cell[col-id=c0]")');
  await evaluate('window.setGridOptions({gridColumnChooser:false,gridExport:false,gridRowCount:false})');
  await waitFor('!document.querySelector(".v-ag-tools") && document.querySelector(".ag-header-cell[col-id=c0]")');
  await evaluate('window.setGridOptions({gridSearch:true,gridFilters:true,gridColumnChooser:true,gridExport:true,gridRowCount:true})');
  await waitFor('document.querySelector(".v-ag-count")?.textContent === "3 satır" && document.querySelector(".ag-floating-filter input")');
  assert.equal(await evaluate('document.querySelector(".v-ag-tools input[type=search]").value'), "");
  assert.equal(await evaluate('document.querySelector(".ag-floating-filter input").value'), "");
  const openMenu = async (selector = '.ag-row[row-index="0"] .ag-cell[col-id="c0"]') => {
    await waitFor(`document.querySelector(${JSON.stringify(selector)})`);
    await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:r.x+10,clientY:r.y+10}))})()`);
    await waitFor('document.querySelector(".v-context-menu")');
  };
  const choose = (label) => evaluate(`([...document.querySelectorAll('.v-context-menu button')].find(e=>e.textContent===${JSON.stringify(label)})).click()`);
  await openMenu();
  assert.match(await evaluate('document.querySelector(".v-context-menu").textContent'), /Hücreyi kopyala.*Satırı kopyala.*PDF indir.*Excel \(.xlsx\) indir.*CSV indir/);
  await evaluate('Object.defineProperty(navigator.clipboard,"writeText",{configurable:true,value:async text=>{window.copiedText=text}})');
  await choose('Hücreyi kopyala');
  assert.equal(await evaluate('window.copiedText'), 'Alpha');
  await openMenu();
  await choose('Azalan sırala');
  await waitFor(`document.querySelector('.ag-row[row-index="0"] .ag-cell[col-id=c0]')?.textContent === 'Gamma'`);
  await input('.v-ag-tools input[type=search]', 'Beta');
  await waitFor('document.querySelector(".v-ag-count")?.textContent === "1 / 3 satır"');
  await openMenu(); await choose('Arama ve filtreleri temizle');
  await waitFor('document.querySelector(".v-ag-count")?.textContent === "3 satır"');
  await openMenu(); await choose('Bu sütunu gizle');
  await waitFor('!document.querySelector(".ag-header-cell[col-id=c0]")');
  await openMenu('.ag-header-cell[col-id=c1]'); await choose('Tüm sütunları göster');
  await waitFor('document.querySelector(".ag-header-cell[col-id=c0]")');
  await evaluate('window.setGridOptions({gridExport:false,gridFilters:false,gridSearch:false,gridColumnChooser:false})');
  await openMenu();
  assert.doesNotMatch(await evaluate('document.querySelector(".v-context-menu").textContent'), /indir|filtreleri|sütunu gizle|sütunları göster/);
  await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitFor('!document.querySelector(".v-context-menu")');
  await evaluate('window.setGridOptions({gridContextMenu:false})');
  assert(await evaluate('document.querySelector(".v-ag-wrap").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}))'));
  await evaluate('window.setGridOptions({gridContextMenu:true,gridExport:true,gridFilters:true,gridSearch:true,gridColumnChooser:true})');
  await evaluate('document.querySelector(".ag-cell[col-id=c0]").dispatchEvent(new KeyboardEvent("keydown",{key:"F10",shiftKey:true,bubbles:true,cancelable:true}))');
  await waitFor('document.activeElement?.getAttribute("role") === "menuitem"');
  await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true}))');
  assert.equal(await evaluate('document.activeElement.textContent'), 'CSV indir');
  await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitFor('!document.querySelector(".v-context-menu")');
  await evaluate('window.setGridOptions({gridExportPdf:false,gridExportExcel:false})');
  await openMenu();
  assert.doesNotMatch(await evaluate('document.querySelector(".v-context-menu").textContent'), /PDF|Excel/);
  await evaluate('document.body.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');
  await waitFor('!document.querySelector(".v-context-menu")');
  await evaluate('window.setGridOptions({gridExportPdf:true,gridExportExcel:true})');
  const downloads = join(dir, 'downloads'); await mkdir(downloads);
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await evaluate(`window.setGridResult({columns:[{name:'Müşteri',kind:'group',type:'string'},{name:'Tutar',kind:'value',type:'double'}], rows:[['İstanbul Şubesi',-3.5],['=1+1',0],['İzmir',12.75]],truncated:false})`);
  await input('.v-ag-tools input[type=search]', 'İstanbul');
  await waitFor('document.querySelector(".v-ag-count")?.textContent === "1 / 3 satır"');
  for (const [kind, label] of [['csv','CSV indir'],['xlsx','Excel (.xlsx) indir'],['pdf','PDF indir']]) {
    await evaluate('document.querySelector(".v-ag-tools button[aria-haspopup=menu]").click()');
    await waitFor('document.querySelector(".v-context-menu")');
    await choose(label);
    const path = join(downloads, `floem-tablo.${kind}`);
    for (let i=0; i<150 && !existsSync(path); i++) await delay(100);
    assert(existsSync(path), `${kind} dosyası inmedi: ${await evaluate('document.querySelector("[role=alert]")?.textContent')}`);
    const bytes = await readFile(path);
    if (kind === 'csv') { assert.match(bytes.toString('utf8'), /İstanbul Şubesi/); assert.doesNotMatch(bytes.toString('utf8'), /İzmir/); assert.match(bytes.toString('utf8'), /-3.5/); }
    else assert(bytes.subarray(0, 4).toString() === (kind === 'pdf' ? '%PDF' : 'PK\x03\x04'));
    if (kind === 'xlsx') {
      const zip = unzipSync(bytes);
      const sheet = strFromU8(zip['xl/worksheets/sheet1.xml']);
      const strings = strFromU8(zip['xl/sharedStrings.xml']);
      assert.match(sheet, /<v>-3.5<\/v>/); assert.match(strings, /İstanbul Şubesi/); assert.doesNotMatch(strings, /İzmir/);
    }
    await waitFor('!document.querySelector(".v-ag-tools button[aria-haspopup=menu]").disabled');
  }
  await input('.v-ag-tools input[type=search]', '');
  await waitFor('document.querySelector(".v-ag-count")?.textContent === "3 satır"');
  await openMenu('.ag-header-cell[col-id=c1]'); await choose('Azalan sırala');
  await openMenu(); await choose('Bu sütunu gizle');
  await evaluate('window.setGridOptions({gridPagination:true,gridPageSize:1})');
  await waitFor('document.querySelector(".ag-paging-panel") && !document.querySelector(".ag-header-cell[col-id=c0]")');
  // Farklı klasör: önceki indirmelerin varlığı başarı sayılmasın.
  const sortedDownloads = join(dir, 'sorted-downloads'); await mkdir(sortedDownloads);
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: sortedDownloads });
  await openMenu('.ag-header-cell[col-id=c1]'); await choose('CSV indir');
  const sortedCsv = join(sortedDownloads, 'floem-tablo.csv');
  for (let i=0; i<100 && !existsSync(sortedCsv); i++) await delay(100);
  assert.equal((await readFile(sortedCsv,'utf8')).replace(/^\uFEFF/,''), '"Tutar"\r\n"12.75"\r\n"0"\r\n"-3.5"');
  await openMenu('.ag-header-cell[col-id=c1]'); await choose('Tüm sütunları göster');
  await waitFor('document.querySelector(".ag-header-cell[col-id=c0]")');
  await openMenu(); await choose('Excel (.xlsx) indir');
  const fullXlsx = join(sortedDownloads, 'floem-tablo.xlsx');
  for (let i=0; i<100 && !existsSync(fullXlsx); i++) await delay(100);
  const fullZip = unzipSync(await readFile(fullXlsx));
  assert.match(strFromU8(fullZip['xl/sharedStrings.xml']), /=1\+1/);
  assert.doesNotMatch(strFromU8(fullZip['xl/worksheets/sheet1.xml']), /<f[ >]/);
  await waitFor('!document.querySelector(".v-ag-tools button[aria-haspopup=menu]").disabled');
  await rm(sortedCsv);
  await openMenu(); await choose('CSV indir');
  for (let i=0; i<100 && !existsSync(sortedCsv); i++) await delay(100);
  assert.match(await readFile(sortedCsv,'utf8'), /"'=1\+1"/);
  await openMenu();
  await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await evaluate('document.querySelector(".ag-cell[col-id=c0]").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:innerWidth-1,clientY:innerHeight-1}))');
  await waitFor('document.querySelector(".v-context-menu")');
  assert(await evaluate('(()=>{const r=document.querySelector(".v-context-menu").getBoundingClientRect();return r.right<=innerWidth && r.bottom<=innerHeight && r.left>=0 && r.top>=0})()'));
  await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  if (process.env.FLOEM_UI_ARTIFACT_DIR) {
    const output = resolve(process.env.FLOEM_UI_ARTIFACT_DIR); await mkdir(output, { recursive: true });
    for (const name of await readdir(downloads)) await writeFile(join(output, name), await readFile(join(downloads, name)));
    const pdf = await evaluate('window.exportSample("pdf")');
    await writeFile(join(output, 'table-multipage.pdf'), Buffer.from(pdf.split(',')[1], 'base64'));
    await openMenu();
    const screenshot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(output, 'table-menu.png'), Buffer.from(screenshot.data, 'base64'));
  }
  await evaluate('window.setTestMode("viewer")');
  await waitFor('document.querySelector(".viewer .canvas-zoom")');
  for (const [width, height, deviceScaleFactor] of [[1366,768,1], [1920,1080,1.25], [2560,1440,1.5], [1024,768,1.25], [768,1024,1.5], [390,844,2]]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor, mobile: false });
    await delay(150);
    assert(await evaluate('(()=>{const e=document.querySelector(".report-scroll");return e.scrollWidth<=e.clientWidth+1 && e.scrollHeight<=e.clientHeight+1})()'), `Sayfaya sığdır: ${width}`);
  }
  await call("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await evaluate('document.querySelector(".canvas-zoom button[title]").click()');
  await waitFor('Math.abs(document.querySelector(".page").getBoundingClientRect().width-1280)<1');
  assert(await evaluate('(()=>{const e=document.querySelector(".report-scroll");return e.scrollHeight>e.clientHeight})()'));
  await evaluate('(()=>{const e=document.querySelector(".canvas-zoom select");e.value="width";e.dispatchEvent(new Event("change",{bubbles:true}))})()');
  await waitFor('Math.abs(document.querySelector(".page").getBoundingClientRect().width-(document.querySelector(".report-scroll").clientWidth-32))<2');
  await evaluate('window.setTestMode("designer")');
  await waitFor('document.querySelector(".designer-panes [role=separator]")');
  const oldWidth = await evaluate('document.querySelector(".designer-panes").getBoundingClientRect().width');
  await evaluate('document.querySelector(".pane-resizer.total").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}))');
  await waitFor(`document.querySelector(".designer-panes").getBoundingClientRect().width > ${oldWidth}`);
  await call("Emulation.setDeviceMetricsOverride", { width: 768, height: 768, deviceScaleFactor: 1.25, mobile: false });
  await waitFor('getComputedStyle(document.querySelector(".designer-panes")).position === "absolute"');
  assert(await evaluate('document.querySelector(".report-main").getBoundingClientRect().width >= 760'));
  await evaluate('document.querySelectorAll(".panel-toggle")[0].click()');
  await waitFor('document.querySelectorAll(".designer-panel-slot")[0].hidden && !document.querySelectorAll(".designer-panel-slot")[1].hidden');
  await evaluate('document.querySelectorAll(".panel-toggle")[1].click();document.querySelector(".canvas-zoom button[title]").click()');
  await waitFor('getComputedStyle(document.querySelector(".designer-panes")).display === "none"');
  await evaluate('document.querySelector(".report-scroll").scrollTo(0,0)');
  const handle = await evaluate('(()=>{const r=document.querySelector(".visual-head").getBoundingClientRect();return {x:r.x+30,y:r.y+10}})()');
  await call("Input.dispatchMouseEvent", { type: "mousePressed", ...handle, button: "left", clickCount: 1, modifiers: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: handle.x+40, y: handle.y+20, button: "left", buttons: 1, modifiers: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: handle.x+40, y: handle.y+20, button: "left", clickCount: 1, modifiers: 1 });
  await waitFor('window.savedReport?.pages[0].visuals[0].x === 140 && window.savedReport?.pages[0].visuals[0].y === 120');
  // Her nesne aynı menü altyapısını kullanır; izleyicide tasarım işlemleri bulunmaz.
  await evaluate('window.setTestMode("all-viewer")');
  await waitFor('document.querySelectorAll(".viewer .visual").length === window.menuTypes.length && document.querySelector("[data-visual-id=object-table] .ag-cell") && document.querySelector("[data-visual-id=object-column] canvas")');
  const types = await evaluate('window.menuTypes');
  const dismissMenu = async () => {
    await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await waitFor('!document.querySelector(".v-context-menu")');
  };
  for (const type of types) {
    const selector = `[data-visual-id="object-${type}"] .visual-content ${type === 'table' ? '.ag-cell' : type === 'container' ? '' : '*'} `;
    await openMenu(selector);
    const text = await evaluate('document.querySelector(".v-context-menu").textContent');
    assert.match(text, /Nesne bilgileri/, type);
    assert.doesNotMatch(text, /Çoğalt|Kilitle|Bir katman|Biçim \/ özellikler/, type);
    if (!['container', 'shape', 'image', 'button', 'icon', 'repeater'].includes(type)) assert.match(text, /PDF indir.*Excel \(.xlsx\) indir.*CSV indir/, type);
    else assert.doesNotMatch(text, /indir/, type);
    await dismissMenu();
  }
  for (const type of ['card', 'table', 'matrix']) {
    await evaluate('window.pauseMenuQueries()');
    await openMenu(`[data-visual-id=object-${type}]`); await choose('Veriyi yeniden sorgula');
    await waitFor(`document.querySelector('[data-visual-id=object-${type}] .v-body.loading')`);
    await openMenu(`[data-visual-id=object-${type}]`);
    assert(await evaluate('[...document.querySelectorAll(".v-context-menu button")].filter(e=>e.textContent.includes("indir")).every(e=>e.disabled)'));
    await dismissMenu(); await evaluate('window.resumeMenuQueries()');
    await waitFor(`!document.querySelector('[data-visual-id=object-${type}] .v-body.loading')`);
  }
  await openMenu('[data-visual-id=object-button] button'); await choose('Nesne bilgileri');
  await waitFor('document.querySelector(".v-object-details[open]")');
  assert.equal(await evaluate('document.querySelector(".page-tab.active").textContent'), 'Nesneler');
  await evaluate('document.querySelector(".v-object-details button").click()');
  await waitFor('!document.querySelector(".v-object-details")');
  await evaluate('document.querySelector("[data-visual-id=object-text]").focus(); document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"F10",shiftKey:true,bubbles:true,cancelable:true}))');
  await waitFor('document.querySelector(".v-context-menu")');
  await choose('Görünen metni kopyala');
  assert.match(await evaluate('window.copiedText'), /Nesne metni/);
  for (const type of ['matrix', 'treegrid']) {
    const before = await evaluate(`document.querySelectorAll('[data-visual-id=object-${type}] tbody tr').length`);
    await openMenu(`[data-visual-id=object-${type}]`); await choose('Tümünü genişlet');
    await waitFor(`document.querySelectorAll('[data-visual-id=object-${type}] tbody tr').length > ${before}`);
    await openMenu(`[data-visual-id=object-${type}]`); await choose('Tümünü daralt');
    await waitFor(`document.querySelectorAll('[data-visual-id=object-${type}] tbody tr').length === ${before}`);
  }
  const objectDownloads = join(dir, 'object-downloads'); await mkdir(objectDownloads);
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: objectDownloads });
  await openMenu('[data-visual-id=object-column] canvas'); await choose('CSV indir');
  const chartCsv = join(objectDownloads, 'floem-nesne.csv');
  for (let i=0; i<100 && !existsSync(chartCsv); i++) await delay(100);
  assert.match(await readFile(chartCsv,'utf8'), /Bölge 1.*10/);
  const matrixDownloads = join(dir, 'matrix-downloads'); await mkdir(matrixDownloads);
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: matrixDownloads });
  await input('[data-visual-id=object-treegrid] input[type=search]', 'Şehir 1');
  await waitFor('document.querySelectorAll("[data-visual-id=object-treegrid] tbody tr").length === 2');
  await openMenu('[data-visual-id=object-treegrid]'); await choose('CSV indir');
  const matrixCsv = join(matrixDownloads, 'floem-nesne.csv');
  for (let i=0; i<100 && !existsSync(matrixCsv); i++) await delay(100);
  const matrixText = await readFile(matrixCsv,'utf8');
  assert.match(matrixText, /Bölge 1 \/ Şehir 1/); assert.doesNotMatch(matrixText, /Şehir 2/);
  await evaluate('window.setAllReport(r=>({...r,pages:r.pages.map(p=>({...p,visuals:p.visuals.map(v=>v.id==="object-column"?{...v,format:{...v.format,exportData:false}}:v)}))}))');
  await openMenu('[data-visual-id=object-column]');
  assert.doesNotMatch(await evaluate('document.querySelector(".v-context-menu").textContent'), /indir/);
  await dismissMenu();
  await evaluate('window.setAllReport(r=>({...r,pages:r.pages.map(p=>({...p,visuals:p.visuals.map(v=>v.id==="object-shape"?{...v,format:{...v.format,contextMenu:false}}:v)}))}))');
  assert(await evaluate('document.querySelector("[data-visual-id=object-shape]").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}))'));
  await evaluate('window.setAllReport(r=>({...r,pages:r.pages.map(p=>({...p,visuals:p.visuals.map(v=>({...v,format:{...v.format,contextMenu:true}}))}))})); window.setTestMode("all-designer")');
  await waitFor('document.querySelector(".canvas-mode-toggle") && document.querySelector("[data-visual-id=object-text]")');
  for (const type of types) {
    await openMenu(`[data-visual-id="object-${type}"] ${type === 'table' ? '.ag-cell' : '.visual-content'}`);
    assert.match(await evaluate('document.querySelector(".v-context-menu").textContent'), /Biçim \/ özellikler.*Çoğalt.*Kilitle.*Bir katman öne.*Sil/, type);
    await dismissMenu();
  }
  await openMenu('[data-visual-id=object-text]'); await choose('Biçim / özellikler');
  await waitFor('document.querySelector(".viz-tabs .active")?.textContent.includes("Biçim")');
  if (process.env.FLOEM_UI_ARTIFACT_DIR) {
    await openMenu('[data-visual-id=object-text]');
    const screenshot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR), 'object-context-menu.png'), Buffer.from(screenshot.data, 'base64'));
    await dismissMenu();
  }
  await openMenu('[data-visual-id=object-text]'); await choose('Kilitle');
  await waitFor('document.querySelector("[data-visual-id=object-text].locked")');
  await openMenu('[data-visual-id=object-text]');
  assert(await evaluate('[...document.querySelectorAll(".v-context-menu button")].find(e=>e.textContent==="Sil").disabled'));
  await choose('Kilidi aç');
  await openMenu('[data-visual-id=object-text]'); await choose('Çoğalt');
  await waitFor(`window.savedReport?.pages[0].visuals.length === ${types.length+1}`);
  const cloneId = await evaluate('window.savedReport.pages[0].visuals.at(-1).id');
  assert.notEqual(cloneId, 'object-text');
  await openMenu(`[data-visual-id="${cloneId}"]`); await choose('Bir katman geriye');
  await waitFor(`window.savedReport?.pages[0].visuals.at(-2)?.id === ${JSON.stringify(cloneId)}`);
  await openMenu(`[data-visual-id="${cloneId}"]`); await choose('Sil');
  await waitFor(`!document.querySelector('[data-visual-id="${cloneId}"]') && window.savedReport?.pages[0].visuals.length === ${types.length}`);
  await evaluate('document.querySelector(".canvas-mode-toggle").click()');
  await openMenu('[data-visual-id=object-text]');
  assert.doesNotMatch(await evaluate('document.querySelector(".v-context-menu").textContent'), /Çoğalt|Kilitle|Bir katman/);
  await dismissMenu();
  console.log(`PASS: ${types.length} nesnede tasarım/web sağ tık menüsü; çoğaltma, kilit, katman, silme, biçim, klavye, metin kopyalama; grafik/ağaç veri aktarımı; tablo PDF-XLSX-CSV; 6 viewport/DPR ve nesne taşıma.`);
  await testMatrix({ call, evaluate, waitFor, openMenu, choose, input, dir });
  await testThemes({ call, evaluate, waitFor, openMenu, choose, dir });
  await testImportAudit({ call, evaluate, waitFor, input, dir });
  await testLayouts({ call, evaluate, waitFor, input });
  await testComponents({ call, evaluate, waitFor, input, dir });
  await testAppearance({ call, evaluate, waitFor, input });
  await testResponsive({ call, evaluate, waitFor, input });
  await testServerGrid({ call, evaluate, waitFor, input });
  await testRuntime({ call, evaluate, waitFor, input });
  if (process.env.FLOEM_UI_LAYOUT_REPORT) {
    const definition = JSON.parse(await readFile(resolve(process.env.FLOEM_UI_LAYOUT_REPORT), 'utf8'));
    await evaluate(`window.setAllReport(${JSON.stringify(definition)});window.setTestMode('all-viewer')`);
    await waitFor('document.querySelector("[data-visual-id=f05-kpi-0-value] .v-card-value") && document.querySelector("[data-visual-id=f05-detail-table] .ag-cell")');
    assert(await evaluate(`(()=>{const box=id=>document.querySelector('[data-visual-id="'+id+'"]').getBoundingClientRect();const a=box('f05-notes'),b=box('f05-detail'),k=box('f05-kpis');return a.x+a.width<b.x && a.y>=k.y+k.height && b.y>=k.y+k.height})()`));
    if (process.env.FLOEM_UI_ARTIFACT_DIR) {
      const shot = await call('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR), 'f05-atolye.png'), Buffer.from(shot.data,'base64'));
    }
    console.log('PASS: Yerel F05 dosyasının gerçek atölye düzeninde birleşik KPI, açıklama/eylem ve tablo sınırları (sentetik ekran verisi).');
  }
  // İsteğe bağlı gerçek rapor düzeni: kayıtlar yerine fixture değerleri kullanılır.
  // Alan/ölçü adları korunur; uzun başlıklar ve sayfa düğmeleri böylece denenir.
  if (process.env.FLOEM_UI_REPORT) {
    const localReport = JSON.parse(await readFile(resolve(process.env.FLOEM_UI_REPORT), 'utf8'));
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.setAllReport(${JSON.stringify(localReport)}); window.setTestMode('all-viewer')`);
    const target = localReport.pages.find((page) => page.id === 'ortak-model');
    assert(target, 'Ortak Model sayfası bulunamadı');
    const navigationId = `${localReport.pages[0].id}-nav-ortak`;
    await waitFor(`document.querySelector('[data-visual-id="${navigationId}"] button')`);
    await evaluate(`document.querySelector('[data-visual-id="${navigationId}"] button').click()`);
    await waitFor('document.querySelector("[data-visual-id=ortak-karsilastirma] .ag-cell")');
    assert.equal(await evaluate('document.querySelectorAll(".visual-error").length'), 0);
    const layout = await evaluate(`(() => {
      const box = (id) => document.querySelector('[data-visual-id="'+id+'"]').getBoundingClientRect();
      const card = box('ortak-model-card-0'), table = box('ortak-karsilastirma');
      const viewport = document.querySelector('[data-visual-id="ortak-karsilastirma"] .ag-grid-viewport');
      return { separated: card.bottom <= table.top, fits: viewport.scrollWidth <= viewport.clientWidth + 2,
        columns: document.querySelectorAll('[data-visual-id="ortak-karsilastirma"] [role="columnheader"]').length };
    })()`);
    assert(layout.separated, 'Kart ve tablo üst üste geldi');
    assert.equal(layout.columns, 6, 'Ortak tablo alanları eksik');
    assert(layout.fits, 'Ortak tablonun sütunları nesne genişliğine sığmadı');
    const withoutFit = structuredClone(localReport);
    withoutFit.pages.find((page) => page.id === 'ortak-model').visuals.find((v) => v.id === 'ortak-karsilastirma').format.gridFitColumns = false;
    await evaluate(`window.setAllReport(${JSON.stringify(withoutFit)})`);
    await waitFor(`(() => { const v = document.querySelector('[data-visual-id="ortak-karsilastirma"] .ag-grid-viewport'); return v && v.scrollWidth > v.clientWidth + 5; })()`);
    await evaluate(`window.setAllReport(${JSON.stringify(localReport)})`);
    await waitFor(`(() => { const v = document.querySelector('[data-visual-id="ortak-karsilastirma"] .ag-grid-viewport'); return v && v.scrollWidth <= v.clientWidth + 2; })()`);
    if (process.env.FLOEM_UI_ARTIFACT_DIR) {
      const shot = await call('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR), 'f06-ortak-model.png'), Buffer.from(shot.data, 'base64'));
    }
    console.log('PASS: F06 gerçek rapor düzeninde Ortak Model düğmesi, 6 sütunlu grid ve kart/tablo yerleşimi (sentetik ekran verisi).');
  }
  }
  await call("Browser.close");
} finally {
  ws?.close();
  child?.kill();
  server?.close();
  const rel = relative(resolve(tmpdir()), resolve(dir));
  if (rel.startsWith("floem-ui-test-") && !rel.includes("..") && !isAbsolute(rel))
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {});
}
