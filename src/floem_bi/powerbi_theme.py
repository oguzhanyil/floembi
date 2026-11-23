"""Gömülü Power BI paletindeki sabit ThemeDataColor başvurularını çözer."""
from __future__ import annotations

import json
import math
from pathlib import Path
import re


def resolve_theme(layout: dict, report: Path) -> dict:
    config = layout.get("config") or {}
    if isinstance(config, str): config = json.loads(config)
    palette = {}
    for key, folder in [("baseTheme", "BaseThemes"), ("customTheme", "CustomThemes")]:
        theme = (config.get("themeCollection") or {}).get(key) or {}
        name = theme.get("name")
        if not isinstance(name, str) or Path(name).name != name: continue
        filename = name if name.endswith(".json") else name + ".json"
        path = report / "StaticResources/SharedResources" / folder / filename
        if not path.is_file() or path.stat().st_size > 64 * 1024 ** 2: continue
        palette.update(json.loads(path.read_text(encoding="utf-8-sig")))
    colors = [palette.get("background"), palette.get("foreground"), *(palette.get("dataColors") or [])]

    def convert(node):
        # Layout'ta görsel/sayfa config'leri iç içe JSON metni olarak saklanır.
        if isinstance(node, str):
            if node.lstrip().startswith(("{", "[")):
                try: return json.dumps(convert(json.loads(node)), ensure_ascii=False)
                except (ValueError, TypeError): pass
            return node
        if isinstance(node, list): return [convert(item) for item in node]
        if not isinstance(node, dict): return node
        color = node.get("ThemeDataColor")
        if isinstance(color, dict):
            index, percent = color.get("ColorId"), color.get("Percent", 0)
            if type(index) is int and 0 <= index < len(colors) and isinstance(colors[index], str) and re.fullmatch(r"#[0-9a-fA-F]{6}", colors[index]) and type(percent) in (int, float) and math.isfinite(percent) and -1 <= percent <= 1:
                rgb = [int(colors[index][i:i+2], 16) for i in (1, 3, 5)]
                rgb = [round(c + (255 - c) * percent if percent >= 0 else c * (1 + percent)) for c in rgb]
                return {"Literal": {"Value": "'#" + "".join(f"{c:02X}" for c in rgb) + "'"}}
        return {key: convert(value) for key, value in node.items()}
    return convert(layout)
