// Geliştirme: Vite dev sunucusunu başlatır, ardından Electron'u bu adresle açar.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(import.meta.url);
const electronPath = require("electron");

const server = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { host: "127.0.0.1" } });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`Vite: ${url}`);

// VS Code terminalleri ELECTRON_RUN_AS_NODE=1 bırakabiliyor; o zaman Electron düz Node gibi çalışır.
const env = { ...process.env, FLOEM_DEV_URL: url };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [root], { stdio: "inherit", env });
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
