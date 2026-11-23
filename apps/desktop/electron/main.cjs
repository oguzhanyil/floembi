// Floem BI Desktop — Electron ana süreci
//
// 1) Python yerel servisini (floem_bi.desktop_service) başlatır; rastgele port +
//    tek kullanımlık token. Token komut satırında değil ortam değişkeninde iletilir.
// 2) Servis "FLOEM_READY {port}" yazınca pencereyi açar.
// 3) Arayüz servise yalnızca preload'daki köprü üzerinden aldığı adres/token ile erişir.
// 4) Uygulama kapanınca servis de kapatılır.

const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");

const DEV_URL = process.env.FLOEM_DEV_URL || null;
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

let service = null;          // { child, port }
let docDirty = false;        // arayüzden: kaydedilmemiş değişiklik var mı
let forceClose = false;
let serviceLog = "";         // hata durumunda gösterilecek stderr
let rendererReady = false;
let pendingOpenPath = null;
const token = crypto.randomBytes(24).toString("hex");

// .floem dosyasına çift tıklanınca Windows dosya yolunu komut satırında verir
function argumentFileToOpen(argv = process.argv, cwd = process.cwd()) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  for (const arg of args) {
    if (![".floem", ".pbip", ".pbib", ".pbix", ".pbir"].includes(path.extname(arg).toLowerCase())) continue;
    const file = path.resolve(cwd, arg);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function fileToOpen() {
  return argumentFileToOpen() || process.env.FLOEM_OPEN || null;
}

function sendPendingOpen() {
  if (!rendererReady || !pendingOpenPath) return;
  const [win] = BrowserWindow.getAllWindows();
  if (!win || win.isDestroyed()) return;
  const file = pendingOpenPath;
  pendingOpenPath = null;
  win.webContents.send("floem:open-file", file);
}

function serviceCommand() {
  const open = fileToOpen();
  const extra = open ? ["--open", open] : [];
  if (app.isPackaged) {
    const exe = path.join(process.resourcesPath, "floem-service", "floem-service.exe");
    return { cmd: exe, args: ["--port", "0", ...extra], cwd: path.dirname(exe) };
  }
  const python = process.env.FLOEM_PYTHON || path.join(REPO_ROOT, ".venv", "Scripts", "python.exe");
  if (!fs.existsSync(python)) {
    throw new Error(`Python bulunamadı: ${python}\nDepo kökünde .venv oluşturun (README).`);
  }
  return { cmd: python, args: ["-m", "floem_bi.desktop_service", "--port", "0", ...extra], cwd: REPO_ROOT };
}

function startService() {
  return new Promise((resolve, reject) => {
    const { cmd, args, cwd } = serviceCommand();
    const child = spawn(cmd, args, {
      cwd,
      env: {
        ...process.env, FLOEM_TOKEN: token, FLOEM_PARENT_PID: String(process.pid),
        // Yalnızca geliştirmede: Vite adresine CORS izni (derlenmiş uygulamada boş)
        FLOEM_ALLOW_ORIGIN: DEV_URL ? new URL(DEV_URL).origin : "",
        PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1",
      },
      windowsHide: true,
    });
    let buf = "";
    const timer = setTimeout(() => reject(new Error("Floem servisi 30 saniyede başlamadı.\n\n" + serviceLog)), 30000);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line.startsWith("FLOEM_READY ")) {
          clearTimeout(timer);
          const { port } = JSON.parse(line.slice("FLOEM_READY ".length));
          resolve({ child, port });
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      serviceLog = (serviceLog + chunk).slice(-8000);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (!service) reject(new Error(`Floem servisi kapandı (kod ${code}).\n\n${serviceLog}`));
      else if (!app.isQuitting) {
        dialog.showErrorBox("Floem servisi durdu", `Arka plan servisi beklenmedik şekilde kapandı (kod ${code}).\n\n${serviceLog}`);
      }
    });
  });
}

function stopService() {
  if (service && !service.child.killed) service.child.kill();
}

function createWindow() {
  const icon = app.isPackaged
    ? path.join(process.resourcesPath, "floem-bi.png")
    : path.join(__dirname, "..", "build-resources", "floem-bi.png");
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "Floem BI Desktop",
    icon,
    backgroundColor: "#f3f2f1",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.webContents.on("did-start-loading", () => { rendererReady = false; });

  // Dış bağlantılar uygulama içinde açılmaz; varsayılan tarayıcıya gider.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith("file://");
    if (!allowed) e.preventDefault();
  });

  // Kaydedilmemiş değişiklik varsa Power BI Desktop'taki gibi sor
  win.on("close", (e) => {
    if (!docDirty || forceClose) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      title: "Floem BI Desktop",
      message: "Değişiklikleri kaydetmek istiyor musunuz?",
      detail: "Kaydedilmemiş değişiklikleriniz var.",
      buttons: ["Kaydet", "Kaydetme", "İptal"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (choice === 0) win.webContents.send("floem:save-and-close");
    else if (choice === 1) {
      forceClose = true;
      win.close();
    }
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
  win.once("ready-to-show", () => win.show());

  // Duman testi: FLOEM_SCREENSHOT=dosya.png verilirse ekran görüntüsü alıp kapanır.
  const shot = process.env.FLOEM_SCREENSHOT;
  if (shot) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        // Yalnızca geliştirmede: görüntüden önce arayüzde etkileşim adımı (tıklama vb.)
        const js = process.env.FLOEM_SCREENSHOT_JS;
        if (js && !app.isPackaged) {
          try {
            await win.webContents.executeJavaScript(js);
          } catch (err) {
            console.error("FLOEM_SCREENSHOT_JS:", err);
          }
          await new Promise((r) => setTimeout(r, 1200));
        }
        // Yalnızca geliştirmede: odaklı alana gerçek klavye girişi (editör testleri için)
        const typed = process.env.FLOEM_SCREENSHOT_TYPE;
        if (typed && !app.isPackaged) {
          await win.webContents.insertText(typed);
          await new Promise((r) => setTimeout(r, 1500));
        }
        const key = process.env.FLOEM_SCREENSHOT_KEY;
        if (key && !app.isPackaged) {
          win.webContents.sendInputEvent({ type: "keyDown", keyCode: key });
          win.webContents.sendInputEvent({ type: "keyUp", keyCode: key });
          await new Promise((r) => setTimeout(r, 1500));
          const js2 = process.env.FLOEM_SCREENSHOT_JS2;
          if (js2) {
            await win.webContents.executeJavaScript(js2).catch((err) => console.error("FLOEM_SCREENSHOT_JS2:", err));
            await new Promise((r) => setTimeout(r, 1200));
          }
        }
        const img = await win.webContents.capturePage();
        fs.writeFileSync(shot, img.toPNG());
        forceClose = true;                       // duman testinde "Kaydet?" sorusu sorulmaz
        app.quit();
      }, Number(process.env.FLOEM_SCREENSHOT_DELAY || 2500));
    });
  }
  return win;
}

ipcMain.handle("floem:config", () => ({
  baseUrl: `http://127.0.0.1:${service.port}`,
  token,
  version: app.getVersion(),
  dev: Boolean(DEV_URL),
  // Duman testleri için: açılışta gösterilecek görünüm (rapor | model | sql)
  startView: process.env.FLOEM_START_VIEW || null,
}));

const FLOEM_FILTER = [{ name: "Floem BI dosyası", extensions: ["floem"] }];

ipcMain.handle("floem:open-file-dialog", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { title: "Floem veya Power BI dosyası aç", filters: [{ name: "Floem ve Power BI", extensions: ["floem", "pbip", "pbib", "pbix", "pbir"] }, ...FLOEM_FILTER], properties: ["openFile"] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle("floem:save-file-dialog", async (e, defaultName) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win, {
    title: "Farklı kaydet",
    defaultPath: path.join(app.getPath("documents"), `${String(defaultName || "Adsız rapor")}.floem`),
    filters: FLOEM_FILTER,
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.on("floem:doc-state", (e, state) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  docDirty = Boolean(state && state.dirty);
  if (win && state && state.name) win.setTitle(`${state.dirty ? "● " : ""}${state.name} - Floem BI Desktop`);
});

ipcMain.on("floem:close-now", (e) => {
  forceClose = true;
  BrowserWindow.fromWebContents(e.sender)?.close();
});

ipcMain.on("floem:renderer-ready", () => {
  rendererReady = true;
  sendPendingOpen();
});

// Duman testleri (yalnızca geliştirme): ayrı kullanıcı klasörü; açık bir Floem BI ile çakışmaz
if (process.env.FLOEM_SCREENSHOT && !app.isPackaged) {
  app.setPath("userData", path.join(app.getPath("temp"), "floem-bi-smoke"));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine, workingDirectory) => {
    const file = argumentFileToOpen(commandLine, workingDirectory);
    if (file) pendingOpenPath = file;
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    sendPendingOpen();
  });

  app.whenReady().then(async () => {
    if (!DEV_URL) Menu.setApplicationMenu(null);
    try {
      service = await startService();
    } catch (e) {
      dialog.showErrorBox("Floem BI başlatılamadı", String(e.message || e));
      app.exit(1);
      return;
    }
    createWindow();
  });

  app.on("before-quit", () => {
    app.isQuitting = true;
    stopService();
  });
  app.on("window-all-closed", () => app.quit());
  process.on("exit", stopService);
}
