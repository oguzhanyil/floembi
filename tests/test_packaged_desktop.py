import ctypes
import os
import subprocess
import time
from ctypes import wintypes
from pathlib import Path

import pytest

from floem_bi.document import Document


@pytest.mark.skipif(not os.environ.get("FLOEM_TEST_PACKAGED_DESKTOP"), reason="Paketli Desktop seçilmedi")
def test_windows_file_open_and_second_instance(tmp_path):
    app = Path(os.environ["FLOEM_TEST_PACKAGED_DESKTOP"]).resolve()
    files = []
    for name in ("Birinci rapor", "İkinci rapor"):
        path = tmp_path / (name + ".floem")
        doc = Document.new(tmp_path / "docs", name)
        try:
            doc.save(path)
        finally:
            doc.close()
        files.append(path)
    profile = tmp_path / "profile"
    profile.mkdir()
    env = {**os.environ, "APPDATA": str(profile), "LOCALAPPDATA": str(profile)}
    env.pop("ELECTRON_RUN_AS_NODE", None)
    env.pop("FLOEM_DEV_URL", None)
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    args = [str(app), "--user-data-dir=" + str(profile / "electron")]
    process = subprocess.Popen([*args, files[0]], env=env, startupinfo=startup)
    windows = ctypes.windll.user32
    def find_title(name):
        matches = []
        @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def visit(hwnd, _):
            pid = wintypes.DWORD()
            windows.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if pid.value == process.pid:
                title = ctypes.create_unicode_buffer(1024)
                windows.GetWindowTextW(hwnd, title, len(title))
                if name in title.value:
                    matches.append(hwnd)
            return True
        until = time.monotonic() + 50
        while time.monotonic() < until and process.poll() is None:
            windows.EnumWindows(visit, 0)
            if matches:
                return matches[0]
            time.sleep(.1)
        pytest.fail(f"Paketli Desktop '{name}' başlığını açmadı (çıkış {process.poll()})")
    window = None
    try:
        window = find_title(files[0].stem)
        subprocess.run([*args, files[1]], env=env, startupinfo=startup, check=True, timeout=20)
        window = find_title(files[1].stem)
    finally:
        if window:
            windows.PostMessageW(window, 0x10, 0, 0)
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(10)
