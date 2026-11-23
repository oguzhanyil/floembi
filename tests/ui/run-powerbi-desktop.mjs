// node tests/ui/run-powerbi-desktop.mjs; gerçek servis/worker ve üretim App.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import assert from "node:assert/strict";
import { testRibbon } from "./ribbon-smoke.mjs";
import { testPowerBiAppearance } from "./powerbi-appearance-smoke.mjs";

const root = resolve(import.meta.dirname, "../..");
const dir = await mkdtemp(join(tmpdir(), "floem-powerbi-test-"));
const browser = process.env.FLOEM_TEST_BROWSER || ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
assert(browser, "Chromium bulunamadı");
const delay = (ms) => new Promise(done => setTimeout(done, ms));
let service, child, server, ws;
try {
  service = spawn(join(root, ".venv/Scripts/python.exe"), [join(root, "tests/ui/powerbi-desktop-service.py"), dir], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  let lines = "", errors = "";
  service.stdout.on("data", b => { lines += b; }); service.stderr.on("data", b => { errors += b; });
  for (let i = 0; i < 150 && !lines.includes("\n") && service.exitCode === null; i++) await delay(100);
  assert(lines.includes("\n"), `Test servisi açılmadı: ${errors}`);
  const port = JSON.parse(lines.split("\n")[0]).port;
  await build({ root, configFile: false, plugins: [react()], logLevel: "warn", define: { "process.env.NODE_ENV": '"development"' }, build: { target: "esnext", outDir: dir, emptyOutDir: false, minify: false, lib: { entry: join(root, "tests/ui/powerbi-desktop.tsx"), formats: ["es"], fileName: () => "app.js", cssFileName: "app" } } });
  await writeFile(join(dir, "index.html"), '<!doctype html><html lang="tr"><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');
  server = createServer(async (req, res) => {
    if (req.url.startsWith("/api/") || req.headers["x-floem-token"]) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const response = await fetch(`http://127.0.0.1:${port}${req.url.startsWith("/api/") ? req.url.slice(4) : req.url}`, { method: req.method, headers: { "X-Floem-Token": req.headers["x-floem-token"] || "", "Content-Type": "application/json" }, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
      res.writeHead(response.status, { "Content-Type": response.headers.get("Content-Type") || "application/json" }); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    const name = req.url === "/" ? "index.html" : req.url.slice(1);
    if (!/^[\w.-]+\.(html|m?js|css|ttf|woff2?)$/.test(name) || !existsSync(join(dir, name))) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", name.endsWith("js") ? "text/javascript" : name.endsWith("css") ? "text/css" : "text/html"); res.end(await readFile(join(dir, name)));
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${join(dir, "profile")}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  const activePort = join(dir, "profile/DevToolsActivePort");
  for (let i = 0; i < 150 && !existsSync(activePort); i++) await delay(100);
  const browserPort = (await readFile(activePort, "utf8")).split("\n")[0];
  const targets = await (await fetch(`http://127.0.0.1:${browserPort}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(done => ws.addEventListener("open", done, { once: true }));
  let id = 0; const pending = new Map(), browserErrors = [];
  ws.addEventListener("message", ({ data }) => { const m = JSON.parse(data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") browserErrors.push(m.params.exceptionDetails.exception?.description); if (m.method === "Log.entryAdded" && m.params.entry.level === "error" && !/\/(api\/|document\/open)/.test(m.params.entry.url || "")) browserErrors.push(m.params.entry.text + " " + m.params.entry.url); });
  const call = (method, params = {}) => new Promise((done, reject) => { const key = ++id; const timer = setTimeout(() => reject(Error(`CDP ${method} zaman aşımı`)), 15000); pending.set(key, m => { clearTimeout(timer); m.error ? reject(Error(JSON.stringify(m.error))) : done(m.result); }); ws.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async expression => { const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description); return r.result.value; };
  const waitFor = async expression => { for (let i = 0; i < 200; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(100); } throw Error(`Koşul sağlanmadı: ${expression}\n${browserErrors.join("\n")}\n${await evaluate('document.body?.innerText.slice(0,1200)')}`); };
  await call("Runtime.enable"); await call("Log.enable"); await call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
  await waitFor(`document.querySelector('.ribbon-btn[title="Ctrl+O"]') && window.fixture`);
  const open = async key => { await evaluate(`window.nextPath=window.fixture[${JSON.stringify(key)}]; document.querySelector('.ribbon-btn[title="Ctrl+O"]').click()`); await waitFor(`document.querySelector('[aria-label="Dosya açılıyor"]')`); await waitFor(`!document.querySelector('[aria-label="Dosya açılıyor"]')`); };
  if (await evaluate("!!window.fixture.pbix")) {
    await open("pbix"); await waitFor('document.querySelector(".v-card-value")?.textContent === "45"');
    assert.match(await evaluate('document.querySelector(".import-audit-control").textContent'), /9 satır/);
    await evaluate(`document.querySelector('button[title="Tablo görünümü"]').click()`);
    await waitFor('document.querySelector(".dv-status")?.textContent.includes("6 satır") && document.querySelectorAll(".dv-row").length === 6');
    await evaluate(`document.querySelector('.ribbon-btn[title="Ctrl+S"]').click()`);
    await waitFor('document.querySelector(".doc-path")?.textContent.endsWith("Saved.floem") && !document.querySelector(".dirty")');
    console.log("PASS: Gerçek PBIX gömülü veri → kart 45, tablo 6 satır, toplam 9 satır, .floem kaydı.");
  } else console.log("SKIP: Açık PBIX korpusu yok; gerçek veri UI kontrolü atlandı.");
  const title = await evaluate('document.querySelector(".doc").textContent');
  await open("broken"); await waitFor('document.querySelector(".error-box")');
  assert.equal(await evaluate('document.querySelector(".doc").textContent'), title);
  await evaluate(`document.querySelector('button[title="Rapor görünümü"]').click()`);
  await open("project"); await waitFor('document.querySelector(".doc").textContent.includes("Project")');
  assert.match(await evaluate('document.querySelector(".import-audit-control").textContent'), /Veri kopyası alınamadı/);
  await evaluate('document.querySelector(".import-audit-control button").click()');
  await waitFor('document.querySelector(".import-audit-dialog[open]")');
  assert.match(await evaluate('document.querySelector(".import-audit-dialog").textContent'), /1 özgün ölçü.*0 satır alındı.*Yerel veri kopyası yok/s);
  await evaluate('document.querySelector(".import-audit-dialog header button").click()');
  await open("text"); await waitFor('document.querySelector(".v-text")?.textContent.includes("Verisiz rapor da açılır")');
  assert.equal(await evaluate('(async()=> (await (await fetch("/api/verify")).json()).sourceUnchanged)()'), true);
  await testRibbon({ call, evaluate, waitFor, open });
  await testPowerBiAppearance({ evaluate, waitFor, open });
  assert.deepEqual(browserErrors, []);
  console.log("PASS: Hatalı dosyada eski rapor korundu; PBIP özgün model/boş veri bildirimi; tablosuz metin raporu; kaynaklar değişmedi, tarayıcı çökmedi.");
  await call("Browser.close");
} finally {
  ws?.close(); child?.kill(); service?.kill(); server?.close();
  const rel = relative(resolve(tmpdir()), resolve(dir));
  if (rel.startsWith("floem-powerbi-test-") && !rel.includes("..") && !isAbsolute(rel)) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {});
}
