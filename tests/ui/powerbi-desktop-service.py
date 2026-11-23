"""Desktop aç/kaydet UI testi için kullanıcı servislerinden bağımsız yerel köprü."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import sys
import zipfile

from fastapi.testclient import TestClient
from floem_bi.desktop_service import create_app
from floem_bi.desktop_service.connections import ConnectionStore

ROOT = Path(__file__).resolve().parents[2]


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


with tempfile.TemporaryDirectory(prefix="floem-powerbi-ui-", dir=sys.argv[1] if len(sys.argv) > 1 else None) as folder:
    area = Path(folder)
    project = area / "Project.pbip"
    write(project, {"artifacts": [{"report": {"path": "Project.Report"}}]})
    report = area / "Project.Report"
    write(report / "definition.pbir", {"datasetReference": {"byPath": {"path": "../Project.SemanticModel"}}})
    write(report / "definition/pages/pages.json", {"pageOrder": ["p1"]})
    write(report / "definition/pages/p1/page.json", {"displayName": "Özet", "width": 1280, "height": 720})
    write(report / "definition/pages/p1/visuals/v1/visual.json", {"name": "v1", "position": {"x": 20, "y": 20, "width": 300, "height": 150}, "visual": {"visualType": "card", "query": {"queryState": {"Values": {"projections": [{"field": {"Measure": {"Expression": {"SourceRef": {"Entity": "Satis"}}, "Property": "Net"}}}]}}}}})
    write(area / "Project.SemanticModel/model.bim", {"model": {"tables": [{"name": "Satis", "columns": [{"name": "Tutar", "dataType": "double"}], "measures": [{"name": "Net", "expression": "SUM(Satis[Tutar])"}]}]}})
    broken = area / "Broken.pbix"; broken.write_bytes(b"invalid")
    text = area / "Text.pbix"
    layout = {"sections": [{"name": "p1", "displayName": "Metin", "width": 1280, "height": 720, "visualContainers": [{"config": json.dumps({"name": "text", "layouts": [{"position": {"x": 10, "y": 10, "width": 500, "height": 120}}], "singleVisual": {"visualType": "textbox", "objects": {"general": [{"properties": {"paragraphs": [{"textRuns": [{"value": "Verisiz rapor da açılır"}]}]}}]}}})}]}]}
    with zipfile.ZipFile(text, "w") as z: z.writestr("Report/Layout", json.dumps(layout).encode("utf-16-le"))
    native = ROOT / "research/repos/pbixray/data/abc.pbix"
    pbix = None
    if native.is_file():
        pbix = area / "Native.pbix"
        card = {"name": "card", "layouts": [{"position": {"x": 20, "y": 20, "width": 300, "height": 160}}], "singleVisual": {"visualType": "card", "prototypeQuery": {"From": [{"Name": "a", "Entity": "ABC"}], "Select": [{"Name": "Sum", "Aggregation": {"Expression": {"Column": {"Expression": {"SourceRef": {"Source": "a"}}, "Property": "Col2"}}, "Function": 0}}]}, "projections": {"Values": [{"queryRef": "Sum"}]}}}
        layout["sections"][0]["visualContainers"] = [{"config": json.dumps(card)}]
        with zipfile.ZipFile(native) as original, zipfile.ZipFile(pbix, "w") as z:
            for item in original.infolist():
                z.writestr(item, json.dumps(layout).encode("utf-16-le") if item.filename == "Report/Layout" else original.read(item))
    paths = {"project": str(project), "broken": str(broken), "text": str(text), "pbix": str(pbix) if pbix else None, "saved": str(area / "Saved.floem")}
    before = {p: hashlib.sha256(Path(p).read_bytes()).hexdigest() for k, p in paths.items() if p and k != "saved"}
    app = create_app("powerbi-ui-fixture", store=ConnectionStore(area / "store", use_keyring=False), work_dir=area / "work")
    with TestClient(app) as client:
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self): self.proxy()
            def do_POST(self): self.proxy()
            def do_PUT(self): self.proxy()
            def do_DELETE(self): self.proxy()
            def log_message(self, *args): pass
            def proxy(self):
                if self.path == "/fixture":
                    data = json.dumps(paths).encode(); self.send_response(200)
                    self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(data); return
                if self.path == "/verify":
                    assert all(hashlib.sha256(Path(p).read_bytes()).hexdigest() == digest for p, digest in before.items())
                    data = json.dumps({"sourceUnchanged": True, "saved": Path(paths["saved"]).is_file()}).encode()
                    self.send_response(200); self.end_headers(); self.wfile.write(data); return
                response = client.request(self.command, self.path, content=self.rfile.read(int(self.headers.get("Content-Length", 0))), headers={"X-Floem-Token": self.headers.get("X-Floem-Token", ""), "Content-Type": "application/json"})
                self.send_response(response.status_code); self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
                self.end_headers(); self.wfile.write(response.content)
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        print(json.dumps({"port": server.server_port}), flush=True)
        server.serve_forever()
