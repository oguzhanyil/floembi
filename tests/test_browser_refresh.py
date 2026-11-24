import os
import socket
import subprocess
import threading
import time
from contextlib import contextmanager
from pathlib import Path

import pytest
import uvicorn

from test_server import YON, floem_file, login, publish, server


@contextmanager
def local_http(app):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        url = f"http://127.0.0.1:{sock.getsockname()[1]}"
        runner = uvicorn.Server(uvicorn.Config(app, log_level="warning"))
        thread = threading.Thread(target=runner.run, kwargs={"sockets": [sock]}, daemon=True)
        thread.start()
        try:
            end = time.monotonic() + 10
            while not runner.started and thread.is_alive() and time.monotonic() < end:
                time.sleep(.05)
            assert runner.started
            yield url
        finally:
            runner.should_exit = True
            thread.join(15)


@pytest.mark.skipif(not os.environ.get("FLOEM_TEST_BROWSER"), reason="Playwright tarayıcısı seçilmedi")
def test_refresh_from_published_web_ui(tmp_path, floem_file):
    from fastapi.testclient import TestClient
    from floem_bi.server import ServerSettings, create_server
    root = Path(__file__).resolve().parents[1]
    dist = root / "apps/web/dist"
    assert (dist / "index.html").is_file(), "Önce web arayüzünü derleyin"
    app = create_server(ServerSettings(data_dir=tmp_path / "web", secret="s"*48, web_dist=dist))
    client = TestClient(app)
    content = publish(client, login(client, YON), floem_file.path).json()
    with local_http(app) as url:
        subprocess.run(["node", str(root / "tests/ui/refresh-e2e.mjs"), url, str(content["dataset_id"]),
                        str(content["report_id"])], check=True, timeout=90)
