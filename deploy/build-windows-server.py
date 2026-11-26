"""Paketlenmiş Windows yayın sunucusu, derlenmiş web ve temiz proje kopyası."""

import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build" / "windows-publish" / "native"


def run(*args):
    subprocess.run(args, cwd=ROOT, check=True)


def main():
    if os.name != "nt":
        raise SystemExit("Windows x64 paketi Windows üzerinde derlenir.")
    version = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    web = BUILD / "web"
    run(shutil.which("npm.cmd") or "npm.cmd", "run", "build", "-w", "@floem/web", "--", "--outDir", web)
    run(sys.executable, "-m", "PyInstaller", "--noconfirm", "--onedir", "--noupx",
        "--name", "FloemBI-Sunucu", "--paths", "src", "--collect-submodules", "uvicorn",
        "--collect-submodules", "sqlglot.dialects", "--hidden-import", "keyring.backends.Windows",
        "--recursive-copy-metadata", "floem-bi", "--copy-metadata", "sqlalchemy",
        "--copy-metadata", "argon2-cffi", "--copy-metadata", "cryptography",
        "--exclude-module", "PyInstaller", "--exclude-module", "IPython", "--exclude-module", "matplotlib",
        "--exclude-module", "tkinter", "--exclude-module", "pytest", "--exclude-module", "numpy.tests",
        "--specpath", BUILD, "--distpath", BUILD / "dist", "--workpath", BUILD / "work", "deploy/windows_server.py")
    service = BUILD / "dist" / "FloemBI-Sunucu"
    shutil.copytree(web, service / "web", dirs_exist_ok=True)
    run(service / "FloemBI-Sunucu.exe", "kontrol")
    output = ROOT / "output" / "yayin"
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output) as tmp:
        tmp = Path(tmp)
        project = tmp / "FloemBI-Proje.zip"
        run("git", "archive", "--format=zip", "--output", project, "HEAD")
        archive = tmp / f"FloemBI-Windows-Sunucu-{version}.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=3) as z:
            for file in service.rglob("*"):
                if file.is_file():
                    z.write(file, file.relative_to(service))
            z.write(ROOT / "deploy" / "windows-yayin.md", "KURULUM.md")
            z.write(ROOT / "packages/report/src/fonts/LICENSE.txt", "web/FONT-LICENSE.txt")
            z.write(project, project.name)
            z.writestr("01-KONTROL.cmd", "@echo off\r\ncd /d \"%~dp0\"\r\n\"%~dp0FloemBI-Sunucu.exe\" kontrol\r\nif errorlevel 1 echo KONTROL BASARISIZ\r\npause\r\n")
        with zipfile.ZipFile(archive) as z:
            if bad := z.testzip():
                raise RuntimeError(f"Arşiv doğrulanamadı: {bad}")
        archive.replace(output / archive.name)
    print(output / archive.name)


if __name__ == "__main__":
    main()
