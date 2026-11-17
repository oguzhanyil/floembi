// floembi.app sunucusunu yerelde başlatır (depo kökündeki .venv kullanılır).
//   npm run server            → http://127.0.0.1:8800
// Web arayüzü apps/web/dist'ten sunulur; önce: npm run web:build
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.FLOEM_PYTHON || path.join(root, ".venv", "Scripts", "python.exe");
const child = spawn(python, ["-m", "floem_bi.server", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PYTHONIOENCODING: "utf-8" },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill());
