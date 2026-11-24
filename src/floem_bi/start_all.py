"""Windows'ta Floem BI bileşenlerini elle ve tekrar çalıştırılabilir biçimde başlatır."""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from floem_bi.server import pilot_config


REPO_ROOT = Path(__file__).resolve().parents[2]
LOCAL_URL = "http://127.0.0.1:8800"
PILOT_LOCAL_URL = "http://127.0.0.1:8811"


def _health(url: str, timeout: float = 2) -> bool:
    try:
        request = urllib.request.Request(
            f"{url}/api/health", headers={"User-Agent": "FloemBI/0.1"},
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status == 200 and json.load(response).get("ok") is True
    except (OSError, ValueError, urllib.error.URLError):
        return False


def _wait_health(url: str, seconds: float = 20) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if _health(url):
            return True
        time.sleep(0.5)
    return _health(url)


def _port_busy(port: int) -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def _processes() -> list[dict[str, str]]:
    # Komut satırları yalnızca bellekte kullanılır; tek kullanımlık kayıt anahtarları
    # eski Floemway süreçlerinde bulunabileceği için asla yazdırılmaz veya günlüğe alınmaz.
    script = (
        "Get-CimInstance Win32_Process | "
        "Where-Object { $_.Name -in @('python.exe','electron.exe') -and "
        "$_.CommandLine -match 'floem_bi\\.|apps[\\\\/]desktop' } | "
        "Select-Object Name,CommandLine | ConvertTo-Json -Compress"
    )
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-Command", script],
        capture_output=True, text=True, timeout=15, check=True,
    )
    if not result.stdout.strip():
        return []
    value = json.loads(result.stdout)
    return value if isinstance(value, list) else [value]


def _has_process(processes: list[dict[str, str]], module: str) -> bool:
    return any(f"-m {module}" in (p.get("CommandLine") or "") for p in processes)


def _gateway_running(processes: list[dict[str, str]], gateway_id: int, config: Path) -> bool:
    for process in processes:
        cmd = process.get("CommandLine") or ""
        if "-m floem_bi.gateway" not in cmd:
            continue
        if re.search(rf"--id\s+{gateway_id}(?:\s|$)", cmd):
            return True
        if str(config).lower() in cmd.lower():
            return True
    return False


def _desktop_running(processes: list[dict[str, str]]) -> bool:
    desktop_path = str(REPO_ROOT / "apps" / "desktop").lower()
    return any(
        (p.get("Name") or "").lower() == "electron.exe"
        and desktop_path in (p.get("CommandLine") or "").lower()
        and "--type=" not in (p.get("CommandLine") or "")
        for p in processes
    )


def _start(*args: str) -> subprocess.Popen:
    return subprocess.Popen(
        args, cwd=REPO_ROOT, stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )


def _start_server(label: str, url: str, port: int, *extra: str) -> bool:
    if _health(url):
        print(f"{label}: zaten açık")
        return True
    if _port_busy(port):
        print(f"Hata: {port} portu dolu, ancak {label} sağlık yanıtı vermiyor.")
        return False
    _start(sys.executable, "-m", "floem_bi.server", *extra)
    if not _wait_health(url):
        print(f"Hata: {label} 20 saniye içinde açılmadı.")
        return False
    print(f"{label}: başlatıldı")
    return True


def running_service_registration() -> dict:
    folder = Path(os.environ.get("ProgramW6432") or os.environ.get("ProgramFiles", "")) / "Floemway"
    marker = folder / "registration.json"
    if not marker.is_file():
        return {}
    try:
        state = subprocess.run(["powershell", "-NoProfile", "-Command",
            "(Get-Service -Name Floemway -ErrorAction SilentlyContinue).Status -eq 'Running'"],
            capture_output=True, timeout=8, creationflags=subprocess.CREATE_NO_WINDOW)
        return json.loads(marker.read_text(encoding="utf-8")) if state.stdout.strip() == b"True" else {}
    except (ValueError, OSError, subprocess.TimeoutExpired):
        return {}


def main() -> int:
    if os.name != "nt":
        print("Bu başlatıcı yalnızca Windows için hazırlanmıştır.")
        return 1
    if not (REPO_ROOT / "apps" / "web" / "dist" / "index.html").is_file():
        print("Hata: web arayüzü bulunamadı. Önce 'npm run web:build' çalıştırın.")
        return 1
    try:
        processes = _processes()
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        print(f"Hata: çalışan süreçler kontrol edilemedi: {exc}")
        return 1

    print("Floem BI bileşenleri kontrol ediliyor...")
    ok = _start_server("Yerel floembi.app", LOCAL_URL, 8800)

    try:
        pilot_ready = bool(pilot_config.server_secret(pilot_config.data_dir()))
        tunnel_ready = bool(pilot_config.tunnel_token())
    except Exception as exc:
        print(f"Hata: Windows Kimlik Bilgisi Yöneticisi okunamadı ({type(exc).__name__}).")
        return 1
    if not pilot_ready:
        print("Hata: pilot sunucu anahtarı yok. README'deki pilot kurulumunu tamamlayın.")
        ok = False
    else:
        ok = _start_server("Yayın sunucusu", PILOT_LOCAL_URL, 8811, "--pilot") and ok

    if _has_process(processes, "floem_bi.server.pilot tunnel") or (
        _health(PILOT_LOCAL_URL) and _health(pilot_config.PILOT_URL)
    ):
        print("Cloudflare tüneli: zaten açık")
    elif not tunnel_ready:
        print("Hata: Cloudflare tünel belirteci yok. README'deki pilot kurulumunu tamamlayın.")
        ok = False
    elif not shutil.which("cloudflared"):
        print("Hata: cloudflared bulunamadı. Kurulumu veya PATH ayarını kontrol edin.")
        ok = False
    else:
        _start(sys.executable, "-m", "floem_bi.server.pilot", "tunnel")
        print("Cloudflare tüneli: başlatıldı (ağ bağlantısı kuruluyor)")

    from floem_bi.gateway.__main__ import load as load_gateway

    gateway_dir = Path(os.environ.get("APPDATA", str(Path.home()))) / "FloemBI"
    configs = sorted(gateway_dir.glob("gateway-*.json"))
    service = running_service_registration()
    if not configs:
        print("Floemway: kayıtlı yapılandırma bulunamadı")
    for config in configs:
        try:
            _server, gateway_id, _key = load_gateway(config)
        except Exception as exc:
            print(f"Hata: {config.name} okunamadı ({type(exc).__name__}).")
            ok = False
            continue
        if service.get("gateway_id") == gateway_id and service.get("server") == _server:
            print(f"Floemway {gateway_id}: Windows hizmeti açık")
        elif _gateway_running(processes, gateway_id, config):
            print(f"Floemway {gateway_id}: zaten açık")
        else:
            _start(sys.executable, "-m", "floem_bi.gateway", "--config", str(config))
            print(f"Floemway {gateway_id}: başlatıldı")

    if _desktop_running(processes):
        print("Floem BI Desktop: zaten açık")
    elif not shutil.which("node") or not (REPO_ROOT / "node_modules" / "electron" / "dist" / "electron.exe").is_file():
        print("Hata: Desktop bağımlılıkları bulunamadı. Önce 'npm install' çalıştırın.")
        ok = False
    else:
        _start("node", str(REPO_ROOT / "apps" / "desktop" / "scripts" / "dev.mjs"))
        print("Floem BI Desktop: başlatıldı")

    print(f"Yayın adresi: {pilot_config.PILOT_URL}")
    print("Bu bilgisayar açık ve uyanık kaldığı sürece web yayını erişilebilir.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
