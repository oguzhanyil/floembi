# -*- mode: python ; coding: utf-8 -*-
# Floem BI Desktop yerel servisi (floem-service.exe)
#
#   .venv/Scripts/pyinstaller packaging/floem-service.spec --noconfirm \
#       --distpath build/pyinstaller/dist --workpath build/pyinstaller/work
#
# onedir modu bilinçli seçildi: onefile her açılışta %TEMP%'e açılır (yavaş başlar)
# ve antivirüslerin yanlış alarmına daha sık takılır.
from PyInstaller.utils.hooks import collect_submodules

hiddenimports = (
    collect_submodules("sqlglot.dialects")      # lehçeler tembel (lazy) yükleniyor
    + collect_submodules("uvicorn")             # loop/protocol/lifespan dinamik seçiliyor
    + ["keyring.backends.Windows", "pyodbc"]
)

a = Analysis(
    ["floem_service_entry.py"],
    pathex=["../src"],
    hiddenimports=hiddenimports,
    excludes=["tkinter", "pytest", "IPython", "matplotlib", "PIL", "numpy.tests"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="floem-service",
    console=True,          # stdout'tan FLOEM_READY okunuyor; pencereyi Electron gizliyor (windowsHide)
    upx=False,             # UPX antivirüs yanlış alarmlarını artırır
)
coll = COLLECT(exe, a.binaries, a.datas, name="floem-service", upx=False)
