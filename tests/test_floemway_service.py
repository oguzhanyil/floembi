import base64
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path

import pytest
from nacl.public import PrivateKey, SealedBox

from floem_bi.gateway.service_identity import read_identity, store_identity


@pytest.mark.skipif(sys.platform != "win32", reason="Windows DPAPI gerekir")
def test_service_identity_roundtrip(tmp_path):
    path, key = tmp_path / "identity.json", PrivateKey.generate()
    store_identity(path, "https://bi.example.test", 7, key)
    assert base64.b64encode(bytes(key)) not in path.read_bytes()
    url, gid, loaded = read_identity(path)
    assert gid == 7 and url == "https://bi.example.test" and bytes(loaded) == bytes(key)


@pytest.mark.skipif(not os.environ.get("FLOEM_TEST_PACKAGED_GATEWAY"), reason="Derlenmiş Floemway seçilmedi")
def test_installed_worker_reconnects(tmp_path):
    """Gerçek paket ve WebSocket ile hizmet kimliği, kopma ve yeniden doğrulama."""
    import json
    import secrets
    from websockets.sync.server import serve
    source = Path(os.environ["FLOEM_TEST_PACKAGED_GATEWAY"]).resolve()
    worker = tmp_path / "worker"
    shutil.copytree(source.parent, worker)
    private = tmp_path / "Private"
    private.mkdir()
    key = PrivateKey.generate()
    count = 0
    done = threading.Event()
    def accept(ws):
        nonlocal count
        challenge = secrets.token_hex(24)
        encrypted = SealedBox(key.public_key).encrypt(challenge.encode()).hex()
        ws.send(json.dumps({"type": "challenge", "value": encrypted}))
        response = json.loads(ws.recv(timeout=10))
        assert response == {"type": "challenge_response", "value": challenge}
        assert json.loads(ws.recv(timeout=10))["type"] == "heartbeat"
        count += 1
        if count == 2:
            done.set()
        ws.close(1001)
    with serve(accept, "127.0.0.1", 0) as endpoint:
        port = endpoint.socket.getsockname()[1]
        store_identity(private / "identity.json", f"http://127.0.0.1:{port}", 1, key)
        responder = threading.Thread(target=endpoint.serve_forever)
        responder.start()
        process = subprocess.Popen([worker / source.name, "--service"], creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            assert done.wait(35) and process.poll() is None
        finally:
            process.terminate()
            process.wait(10)
            endpoint.shutdown()
            responder.join(10)
