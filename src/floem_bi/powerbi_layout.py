"""Power BI dosya/proje çözümleme ve eski Layout → ortak PBIR yerleşimi.

Kaynak salt okunur; yalnız rapor JSON'u ve gömülü resimler geçici alana alınır.
Kaynak bağlantıları, M/SQL ve özel görsel kodu çalıştırılmaz.
"""
from __future__ import annotations

import hashlib
import json
import re
import zipfile
from pathlib import Path, PurePosixPath

MAX_JSON = 64 * 1024 * 1024
MAX_FILE = 2 * 1024 ** 3
MAX_ITEMS = 20000


def read_json(path: Path):
    if path.stat().st_size > MAX_JSON:
        raise ValueError("Power BI JSON dosyası boyut sınırını aşıyor")
    return decode_json(path.read_bytes())


def decode_json(data: bytes):
    if len(data) > MAX_JSON:
        raise ValueError("Power BI JSON dosyası boyut sınırını aşıyor")
    encoding = "utf-16" if data[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-16-le" if data[:100].count(b"\0") > 10 else "utf-8-sig"
    return json.loads(data.decode(encoding))


def contained(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError("Power BI proje başvurusu proje klasörünün dışına çıkıyor")
    return resolved


def project_paths(path: Path) -> tuple[Path, Path | None, Path]:
    path = path.resolve()
    if path.suffix.lower() in {".pbip", ".pbib"}:
        data, root = read_json(path), path.parent
        references = [a["report"]["path"] for a in data.get("artifacts", []) if isinstance(a, dict) and isinstance(a.get("report"), dict) and a["report"].get("path")]
        if len(references) != 1:
            raise ValueError("Projede tek rapor bekleniyor; ilgili .Report klasörünün definition.pbir dosyasını seçin")
        report = contained(root / references[0].replace("\\", "/"), root)
    elif path.name.lower() == "definition.pbir":
        report, root = path.parent, path.parent.parent
    elif path.is_dir() and path.name.lower().endswith(".report"):
        report, root = path, path.parent
    else:
        raise ValueError(".floem, .pbip, .pbib veya .pbix dosyası seçin")
    if not report.is_dir():
        raise ValueError("Projenin .Report klasörü bulunamadı; .pbip dosyasını yanındaki klasörlerle birlikte taşıyın")
    definition = contained(report / "definition.pbir", root)
    semantic = None
    if definition.is_file():
        reference = read_json(definition).get("datasetReference", {}).get("byPath", {}).get("path")
        if reference:
            semantic = contained(report / reference.replace("\\", "/"), root)
            if not semantic.is_dir():
                raise ValueError("Projenin SemanticModel klasörü bulunamadı")
    return report, semantic, root


def _write(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def _id(value, prefix):
    raw = str(value or prefix)
    return re.sub(r"[^a-zA-Z0-9_-]", "_", raw)[:44] + "_" + hashlib.sha256(raw.encode()).hexdigest()[:8]


def legacy_layout(layout: dict, target: Path):
    """Eski PBIX/rapor.json alan rollerini PBIR sorgu biçimine normalize eder."""
    from .powerbi_theme import resolve_theme
    layout = resolve_theme(layout, target)
    sections = sorted(layout.get("sections", []) or [{"name": "page1", "displayName": "Sayfa 1"}], key=lambda s: s.get("ordinal", 0))
    ids = {s.get("name"): _id(s.get("name"), f"page{i}") for i, s in enumerate(sections)}
    def aliases(node, sources):
        if isinstance(node, list): return [aliases(n, sources) for n in node]
        if not isinstance(node, dict): return node
        result = {k: aliases(v, sources) for k, v in node.items()}
        if "SourceRef" in result and result["SourceRef"].get("Source") in sources:
            result["SourceRef"] = {"Entity": sources[result["SourceRef"]["Source"]]}
        return result
    for i, section in enumerate(sections):
        page_id = ids[section.get("name")]
        page = target / "definition/pages" / page_id
        config = json.loads(section.get("config") or "{}") if isinstance(section.get("config"), str) else section.get("config") or {}
        info = {k: section[k] for k in ["displayName", "width", "height", "displayOption"] if k in section}
        info["objects"] = config.get("objects", {})
        if section.get("filters"): info["filters"] = section["filters"]
        _write(page / "page.json", info)
        for n, raw in enumerate(section.get("visualContainers", [])):
            config = json.loads(raw.get("config") or "{}") if isinstance(raw.get("config"), str) else raw.get("config") or {}
            visual = config.get("singleVisual") or {"visualType": "unknown"}
            query = visual.get("prototypeQuery") or {}
            sources = {f.get("Name"): f.get("Entity") for f in query.get("From", [])}
            selections = {f.get("Name"): {k: v for k, v in f.items() if k != "Name"} for f in query.get("Select", [])}
            state = {}
            for role, projections in visual.get("projections", {}).items():
                state["Values" if visual.get("visualType") == "cardVisual" and role == "Data" else role] = {"projections": [{"field": aliases(selections.get(p.get("queryRef"), {}), sources), **({"displayName": p["displayName"]} if p.get("displayName") else {})} for p in projections]}
            objects, containers = visual.get("objects", {}), visual.get("vcObjects", {})
            # Sayfa adları güvenli dosya kimliklerine dönüştürüldüğünden hedefi de taşı.
            def navigation(node):
                if isinstance(node, dict):
                    for key, value in node.items():
                        if key == "Value" and isinstance(value, str) and value.strip("'") in ids:
                            node[key] = "'" + ids[value.strip("'")] + "'"
                        else: navigation(value)
                elif isinstance(node, list):
                    for item in node: navigation(item)
            navigation(containers)
            desktop = next((p for p in config.get("layouts", []) if p.get("id", 0) == 0), {})
            position = desktop.get("position") or {k: raw.get(k, 0) for k in ["x", "y", "z", "width", "height"]}
            item = {"name": _id(config.get("name"), f"visual{n}"), "position": position,
                    "visual": {"visualType": visual.get("visualType", "unknown"), "objects": objects, "display": visual.get("display", {}), "visualContainerObjects": containers, "query": {"queryState": state}}}
            if config.get("singleVisualGroup") is not None:
                item["visualGroup"] = config["singleVisualGroup"]
                item.pop("visual")
            if config.get("parentGroupName"):
                item["parentGroupName"] = _id(config["parentGroupName"], "group")
            if raw.get("filters"): item["filters"] = raw["filters"]
            _write(page / f"visuals/v{n}/visual.json", item)
    _write(target / "definition/pages/pages.json", {"pageOrder": list(ids.values())})
    _write(target / "definition/report.json", {"legacyLayout": True})


def stage_project(report: Path, target: Path, root: Path):
    files = [p for p in report.rglob("*") if p.is_file() and (p.suffix.lower() == ".json" and ("definition" in p.relative_to(report).parts or "BaseThemes" in p.parts or "CustomThemes" in p.parts) or "StaticResources" in p.relative_to(report).parts and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".svg", ".webp"})]
    if len(files) > MAX_ITEMS: raise ValueError("Proje dosya sayısı sınırını aşıyor")
    total = 0
    for file in files:
        contained(file, root)
        size = file.stat().st_size
        total += size
        if size > MAX_JSON or total > 256 * 1024 ** 2: raise ValueError("Rapor yerleşimi boyut sınırını aşıyor")
        out = target / file.relative_to(report)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(file.read_bytes())
    if not (target / "definition/pages/pages.json").exists():
        old = contained(report / "report.json", root)
        if not old.is_file(): raise ValueError("Raporun PBIR tanımı veya report.json dosyası bulunamadı")
        legacy_layout(read_json(old), target)


def stage_pbix(path: Path, target: Path) -> bool:
    if path.stat().st_size > MAX_FILE: raise ValueError("Power BI dosyası 2 GB sınırını aşıyor")
    with zipfile.ZipFile(path) as archive:
        files = archive.infolist()
        if len(files) > MAX_ITEMS: raise ValueError("PBIX dosya sayısı sınırını aşıyor")
        names, canonical = set(), set()
        total = 0
        for item in files:
            name = item.filename.replace("\\", "/")
            parts = PurePosixPath(name)
            key = parts.as_posix().casefold()
            if parts.is_absolute() or any(p in {"..", "."} or p.rstrip(" .") != p for p in parts.parts) or ":" in name or item.flag_bits & 1 or key in canonical:
                raise ValueError("PBIX arşivinde geçersiz veya şifreli dosya girdisi var")
            names.add(name)
            canonical.add(key)
            if item.file_size > MAX_FILE: raise ValueError("PBIX bileşeni boyut sınırını aşıyor")
            relative = name.removeprefix("Report/")
            selected = name.startswith(("Report/definition/", "Report/StaticResources/SharedResources/BaseThemes/", "Report/StaticResources/SharedResources/CustomThemes/")) and name.endswith(".json") or name.startswith("Report/StaticResources/") and Path(name).suffix.lower() in {".png", ".jpg", ".jpeg", ".svg", ".webp"}
            if selected and not item.is_dir():
                total += item.file_size
                if item.file_size > MAX_JSON or total > 256 * 1024 ** 2: raise ValueError("PBIX yerleşimi boyut sınırını aşıyor")
                out = target / relative
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(archive.read(item))
        if not (target / "definition/pages/pages.json").is_file():
            if "Report/Layout" not in names: raise ValueError("PBIX içinde desteklenen rapor yerleşimi bulunamadı")
            member = archive.getinfo("Report/Layout")
            if member.file_size > MAX_JSON: raise ValueError("PBIX yerleşimi boyut sınırını aşıyor")
            legacy_layout(decode_json(archive.read(member)), target)
        return "DataModel" in names
