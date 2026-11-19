// Bağımlılık eklemeden gerçek Chromium'da ortak rapor bileşenlerini doğrular.
// Kullanıcının tarayıcısı/profili kullanılmaz; yalnız bu testin süreci kapatılır.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, relative, isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import assert from "node:assert/strict";

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
  await writeFile(join(dir, "index.html"), '<!doctype html><html lang="tr"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Segoe UI,sans-serif;--surface:#fff;--text:#172033;--muted:#64748b;--border:#cbd5e1}.fixtures{display:flex;flex-wrap:wrap;gap:20px;padding:20px}section{padding:5px}</style><div id="root"></div><script type="module" src="/app.js"></script></html>');
  server = createServer(async (req, res) => {
    const path = req.url === "/" ? "index.html" : req.url?.slice(1);
    if (!["index.html", "app.js", "app.css"].includes(path)) { res.writeHead(404).end(); return; }
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
  ws.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
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
    throw new Error(`Koşul sağlanmadı: ${expression}`);
  };
  await call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
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
  await evaluate('document.querySelector(".panes-toggle").click();document.querySelector(".canvas-zoom button[title]").click()');
  await waitFor('getComputedStyle(document.querySelector(".designer-panes")).display === "none"');
  await evaluate('document.querySelector(".report-scroll").scrollTo(0,0)');
  const handle = await evaluate('(()=>{const r=document.querySelector(".visual-head").getBoundingClientRect();return {x:r.x+30,y:r.y+10}})()');
  await call("Input.dispatchMouseEvent", { type: "mousePressed", ...handle, button: "left", clickCount: 1, modifiers: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: handle.x+40, y: handle.y+20, button: "left", buttons: 1, modifiers: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: handle.x+40, y: handle.y+20, button: "left", clickCount: 1, modifiers: 1 });
  await waitFor('window.savedReport?.pages[0].visuals[0].x === 140 && window.savedReport?.pages[0].visuals[0].y === 120');
  console.log("PASS: metin/taşma, sıfır/boş, hata yalıtımı/yeniden deneme; 6 viewport/DPR, zoom, panel çekmecesi/boyutu ve gerçek pointer ile nesne taşıma.");
  await call("Browser.close");
} finally {
  ws?.close();
  child?.kill();
  server?.close();
  const rel = relative(resolve(tmpdir()), resolve(dir));
  if (rel.startsWith("floem-ui-test-") && !rel.includes("..") && !isAbsolute(rel))
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {});
}
