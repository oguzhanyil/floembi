"""Elle başlatıcının tekrar çalıştırıldığında bileşen çoğaltmaması."""

from __future__ import annotations

from pathlib import Path

from floem_bi import start_all


def test_running_processes_are_recognized() -> None:
    config = Path(r"C:\Users\Test\AppData\Roaming\FloemBI\gateway-4.json")
    processes = [
        {"Name": "python.exe", "CommandLine": "python -m floem_bi.gateway --id 4 --token [gizli]"},
        {"Name": "electron.exe", "CommandLine": f"electron.exe {start_all.REPO_ROOT / 'apps' / 'desktop'}"},
    ]
    assert start_all._gateway_running(processes, 4, config)
    assert not start_all._gateway_running(processes, 40, config)
    assert start_all._desktop_running(processes)
    assert not start_all._desktop_running([
        {"Name": "electron.exe", "CommandLine": processes[1]["CommandLine"] + " --type=renderer"},
    ])


def test_main_starts_missing_components_without_tokens(monkeypatch, tmp_path: Path) -> None:
    config_dir = tmp_path / "FloemBI"
    config_dir.mkdir()
    config = config_dir / "gateway-4.json"
    config.write_text("{}", encoding="utf-8")
    monkeypatch.setenv("APPDATA", str(tmp_path))
    monkeypatch.setattr(start_all, "_processes", lambda: [])
    monkeypatch.setattr(start_all, "_health", lambda _url: False)
    monkeypatch.setattr(start_all, "_wait_health", lambda _url: True)
    monkeypatch.setattr(start_all, "_port_busy", lambda _port: False)
    monkeypatch.setattr(start_all.pilot_config, "server_secret", lambda _directory: "gizli-sunucu")
    monkeypatch.setattr(start_all.pilot_config, "tunnel_token", lambda: "gizli-tunel")
    monkeypatch.setattr(start_all.shutil, "which", lambda name: name)
    from floem_bi.gateway import __main__ as gateway_main
    monkeypatch.setattr(gateway_main, "load", lambda _config: ("http://127.0.0.1:8800", 4, object()))
    started: list[tuple[str, ...]] = []
    monkeypatch.setattr(start_all, "_start", lambda *args: started.append(args))

    assert start_all.main() == 0
    assert len(started) == 5
    assert any("--pilot" in command for command in started)
    assert any("floem_bi.gateway" in command for command in started)
    assert all("gizli" not in " ".join(command) for command in started)


def test_main_skips_components_that_are_open(monkeypatch, tmp_path: Path) -> None:
    config_dir = tmp_path / "FloemBI"
    config_dir.mkdir()
    config = config_dir / "gateway-4.json"
    config.write_text("{}", encoding="utf-8")
    monkeypatch.setenv("APPDATA", str(tmp_path))
    monkeypatch.setattr(start_all, "_health", lambda _url: True)
    monkeypatch.setattr(start_all, "_processes", lambda: [
        {"Name": "python.exe", "CommandLine": f"python -m floem_bi.gateway --config {config}"},
        {"Name": "electron.exe", "CommandLine": f"electron.exe {start_all.REPO_ROOT / 'apps' / 'desktop'}"},
    ])
    monkeypatch.setattr(start_all.pilot_config, "server_secret", lambda _directory: "gizli")
    monkeypatch.setattr(start_all.pilot_config, "tunnel_token", lambda: "gizli")
    from floem_bi.gateway import __main__ as gateway_main
    monkeypatch.setattr(gateway_main, "load", lambda _config: ("http://127.0.0.1:8800", 4, object()))
    started: list[tuple[str, ...]] = []
    monkeypatch.setattr(start_all, "_start", lambda *args: started.append(args))

    assert start_all.main() == 0
    assert started == []
