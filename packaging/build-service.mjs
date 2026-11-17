// floem-service.exe'yi PyInstaller ile derler (depo kökündeki .venv kullanılır).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pyinstaller = process.env.FLOEM_PYINSTALLER || path.join(root, ".venv", "Scripts", "pyinstaller.exe");
const args = [
  path.join(root, "packaging", "floem-service.spec"),
  "--noconfirm",
  "--distpath", path.join(root, "build", "pyinstaller", "dist"),
  "--workpath", path.join(root, "build", "pyinstaller", "work"),
];
const r = spawnSync(pyinstaller, args, { stdio: "inherit", cwd: root });
if (r.error) {
  console.error(`PyInstaller çalıştırılamadı (${pyinstaller}): ${r.error.message}`);
  console.error('Kurulum: .venv/Scripts/python -m pip install -e ".[package]"');
}
process.exit(r.status ?? 1);
