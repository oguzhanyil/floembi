"""Yalnız görünürlüğü kaydeden Power BI yer işaretlerini yerel sayfa eylemine çevirir."""

from pathlib import Path
import json


def actions(bookmarks, pages, visual_id=lambda name: name):
    result = {}

    def visit(bookmark):
        for child in bookmark.get("children", []):
            visit(child)
        options = bookmark.get("options") or {}
        if options.get("suppressData") is not True or options.get("suppressDisplay"):
            return
        state = bookmark.get("explorationState") or {}
        page = state.get("activeSection")
        if page not in pages:
            return
        section = (state.get("sections") or {}).get(page, {})
        selected = (
            set(options.get("targetVisualNames") or [])
            if options.get("applyOnlyToTargetVisuals")
            else None
        )
        visible = {}

        def record(name, shown):
            if selected is None or name in selected:
                visible[visual_id(name)] = shown

        def groups(items):
            for name, item in items.items():
                if "isHidden" in item:
                    record(name, not item["isHidden"])
                groups(item.get("children") or {})

        groups(section.get("visualContainerGroups") or {})
        for name, item in (section.get("visualContainers") or {}).items():
            visual = item.get("singleVisual") or {}
            if visual:
                record(name, (visual.get("display") or {}).get("mode") != "hidden")
        if visible and isinstance(bookmark.get("name"), str):
            result[bookmark["name"]] = {
                "type": "page",
                "pageId": pages[page],
                "visibility": visible,
            }

    for bookmark in bookmarks:
        visit(bookmark)
    return result


def read_actions(report: Path, pages):
    definition = report / "definition"
    raw = (
        json.loads((definition / "report.json").read_text(encoding="utf-8-sig"))
        if (definition / "report.json").is_file()
        else {}
    )
    items = [
        json.loads(p.read_text(encoding="utf-8-sig"))
        for p in (definition / "bookmarks").glob("*.bookmark.json")
    ]
    result = actions(items, {p: p for p in pages})
    for name, action in (raw.get("floemDisplayBookmarks") or {}).items():
        if (
            not isinstance(action, dict)
            or action.get("pageId") not in pages
            or action.get("type") != "page"
        ):
            continue
        visible = action.get("visibility")
        if isinstance(visible, dict) and all(
            isinstance(v, bool) for v in visible.values()
        ):
            result[name] = {
                "type": "page",
                "pageId": action["pageId"],
                "visibility": visible,
            }
    return result
