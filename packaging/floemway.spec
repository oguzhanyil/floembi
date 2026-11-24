from PyInstaller.utils.hooks import collect_submodules, copy_metadata

notices = []
for package in ("pyarrow", "sqlglot", "keyring", "pynacl", "pyodbc", "websockets"):
    notices.extend(copy_metadata(package, recursive=True))
a = Analysis(["floemway_entry.py"], pathex=["../src"],
             hiddenimports=["keyring.backends.Windows"] + collect_submodules("sqlglot.dialects"),
             datas=notices, excludes=["numpy", "pandas", "pbixray", "duckdb", "matplotlib", "tkinter", "pytest"])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="floemway", console=True, upx=False)
coll = COLLECT(exe, a.binaries, a.datas, name="worker", upx=False)
