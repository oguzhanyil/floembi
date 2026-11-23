"""Yerel Power BI okuyucusunu ayrı süreçte çalıştırır; zaman/disk sınırı uygular."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from .document.document import Document
from .document.floemfile import FloemFileError


def _windows_job(process):
    """Servis kapanırsa okuyucu da kapanır; yerel okuyucuya 2 GB RAM sınırı."""
    if os.name != "nt": return lambda: None
    import ctypes as c
    from ctypes import wintypes as w
    class Basic(c.Structure):
        _fields_ = [("process_time", c.c_longlong), ("job_time", c.c_longlong), ("flags", w.DWORD),
            ("min_working", c.c_size_t), ("max_working", c.c_size_t), ("active", w.DWORD),
            ("affinity", c.c_size_t), ("priority", w.DWORD), ("scheduling", w.DWORD)]
    class Counters(c.Structure):
        _fields_ = [(name, c.c_ulonglong) for name in ["read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes"]]
    class Extended(c.Structure):
        _fields_ = [("basic", Basic), ("io", Counters), ("process_memory", c.c_size_t), ("job_memory", c.c_size_t), ("peak_process", c.c_size_t), ("peak_job", c.c_size_t)]
    api = c.WinDLL("kernel32", use_last_error=True)
    api.CreateJobObjectW.argtypes, api.CreateJobObjectW.restype = [c.c_void_p, w.LPCWSTR], w.HANDLE
    api.SetInformationJobObject.argtypes, api.SetInformationJobObject.restype = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD], w.BOOL
    api.AssignProcessToJobObject.argtypes, api.AssignProcessToJobObject.restype = [w.HANDLE, w.HANDLE], w.BOOL
    api.CloseHandle.argtypes, api.CloseHandle.restype = [w.HANDLE], w.BOOL
    handle = api.CreateJobObjectW(None, None)
    limits = Extended(); limits.basic.flags = 0x2000 | 0x100; limits.process_memory = 2 * 1024 ** 3
    if not handle or not api.SetInformationJobObject(handle, 9, c.byref(limits), c.sizeof(limits)) or not api.AssignProcessToJobObject(handle, int(process._handle)):
        if handle: api.CloseHandle(handle)
        raise FloemFileError("Power BI okuyucusu için süreç sınırı kurulamadı")
    return lambda: api.CloseHandle(handle)


def import_isolated(root: Path, source: str, *, timeout: float = 240) -> Document:
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="powerbi-job-", dir=root) as scratch:
        directory = Path(scratch)
        result = directory / "result.floem"
        command = [sys.executable, "--powerbi-worker"] if getattr(sys, "frozen", False) else [sys.executable, "-m", "floem_bi.powerbi_worker"]
        env = {k: v for k, v in os.environ.items() if k not in {"FLOEM_TOKEN", "FLOEM_PARENT_PID", "FLOEM_ALLOW_ORIGIN"}}
        process = subprocess.Popen([*command, "--source", str(Path(source).resolve()), "--output", str(result)], env=env,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        close_job = lambda: None
        try:
            close_job = _windows_job(process)
            deadline = time.monotonic() + timeout
            while process.poll() is None:
                if time.monotonic() > deadline:
                    raise FloemFileError("Power BI aktarımı zaman sınırını aştı", "Dosyayı küçültüp yeniden deneyin; açık raporunuz korundu.")
                # Çocuk süreç geçici dosyaları tarama sırasında silebilir.
                total = 0
                for path in directory.rglob("*"):
                    try:
                        if path.is_file(): total += path.stat().st_size
                    except FileNotFoundError:
                        continue
                if total > 4 * 1024 ** 3:
                    raise FloemFileError("Power BI aktarımı 4 GB geçici alan sınırını aştı")
                time.sleep(.1)
            error_file = directory / "error.json"
            if error_file.is_file():
                error = json.loads(error_file.read_text(encoding="utf-8"))
                raise FloemFileError(error["message"], error.get("detail", ""))
            if process.returncode or not result.is_file():
                raise FloemFileError("Power BI okuyucusu dosyayı açamadı", "Dosya bozuk, korumalı veya desteklenmeyen bir sürümde olabilir.")
            doc = Document.open(root, result)
            doc.path = None
            doc.content.tanim.model.ad = Path(source).stem
            doc._touch()
            return doc
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
            close_job()


def main():
    import argparse
    from .powerbi_open import open_powerbi
    parser = argparse.ArgumentParser()
    parser.add_argument("--powerbi-worker", action="store_true")
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    try:
        doc = open_powerbi(args.output.parent, args.source)
        try: doc.save(args.output)
        finally: doc.close()
    except Exception as error:
        detail = {"message": error.message, "detail": error.detail} if isinstance(error, FloemFileError) else {"message": "Power BI aktarımı tamamlanamadı", "detail": "Dosya biçimi doğrulanamadı"}
        (args.output.parent / "error.json").write_text(json.dumps(detail, ensure_ascii=False), encoding="utf-8")
        raise SystemExit(1)


if __name__ == "__main__": main()
