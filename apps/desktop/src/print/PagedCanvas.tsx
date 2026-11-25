import { useRef, useState, type PointerEvent as RPointer } from "react";
import type { ItemKind, PagedReport, PrintBand, PrintItem } from "@floem/client";
import { bands, paperWidth, sortBands, tools } from "./pagedModel";

export function PagedCanvas({
  t,
  selected,
  select,
  band,
  selectBand,
  change,
  move,
  duplicate,
  remove,
  add,
  grid,
  zoom,
  draw,
}: {
  t: PagedReport;
  selected: string;
  select: (id: string) => void;
  band: PrintBand;
  selectBand: (b: PrintBand) => void;
  change: (b: PrintBand, id: string, patch: Partial<PrintItem>) => void;
  add: (b: PrintBand, kind: ItemKind, x: number, y: number, field?: string, w?: number, h?: number) => void;
  move: (from: PrintBand, to: PrintBand, o: PrintItem, x: number, y: number) => void;
  duplicate: (b: PrintBand, o: PrintItem) => void;
  remove: (b: PrintBand, o: PrintItem) => void;
  grid: number;
  zoom: number;
  draw: boolean;
}) {
  const scale = (96 / 25.4) * zoom,
    width = paperWidth(t);
  const snap = (n: number) => (grid ? Math.round(n / grid) * grid : Math.round(n * 10) / 10);
  const [draft, setDraft] = useState<{ id: string; patch: Partial<PrintItem> }>();
  const [editing, setEditing] = useState("");
  const start = useRef<{ x: number; y: number; band: PrintBand; item?: PrintItem; resize: boolean } | null>(
    null,
  );
  function point(e: RPointer<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  }
  function geometry(e: RPointer<HTMLDivElement>) {
    const origin = start.current;
    if (!origin) return;
    const p = point(e),
      o = origin.item,
      b = origin.band,
      dx = p.x - origin.x,
      dy = p.y - origin.y;
    const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
    if (!o) {
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const x = clamp(snap(horizontal ? Math.min(origin.x, p.x) : origin.x), 0, width - 0.4);
      const y = clamp(snap(horizontal ? origin.y : Math.min(origin.y, p.y)), 0, b.height - 0.4);
      return {
        x,
        y,
        w: clamp(horizontal ? Math.abs(dx) : 0.4, 0.4, width - x),
        h: clamp(horizontal ? 0.4 : Math.abs(dy), 0.4, b.height - y),
      };
    }
    return origin.resize
      ? { w: clamp(snap(o.w + dx), 0.3, width - o.x), h: clamp(snap(o.h + dy), 0.3, b.height - o.y) }
      : { x: clamp(snap(o.x + dx), 0, width - o.w), y: clamp(snap(o.y + dy), 0, b.height - o.h) };
  }
  return (
    <div className="pg-stage">
      <div className="pg-sheet" style={{ width: width * scale }}>
        <div className="pg-ruler">
          {Array.from({ length: Math.floor(width / 10) + 1 }, (_, i) => (
            <span key={i} style={{ left: i * 10 * scale }}>
              {i * 10}
            </span>
          ))}
        </div>
        {sortBands(t).map((b) => (
          <div key={b.kind + (b.group || "")}>
            <button
              className="pg-band-name"
              aria-pressed={b === band}
              onClick={() => {
                selectBand(b);
                select("");
              }}
            >
              {bands[b.kind]} {b.group} <small>{b.height} mm</small>
            </button>
            <div
              className="pg-band"
              data-section={t.bands.indexOf(b)}
              aria-label={bands[b.kind] + " tasarım alanı"}
              style={{
                height: Math.max(2, b.height * scale),
                backgroundSize: grid ? `${grid * scale}px ${grid * scale}px` : undefined,
                backgroundImage: grid ? undefined : "none",
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const field = e.dataTransfer.getData("floem-field"),
                  kind = e.dataTransfer.getData("floem-tool") as ItemKind;
                if (field || kind in tools)
                  add(
                    b,
                    field ? "field" : kind,
                    snap((e.clientX - r.left) / scale),
                    snap((e.clientY - r.top) / scale),
                    field,
                  );
              }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                const el = (e.target as HTMLElement).closest<HTMLElement>("[data-item]");
                const o = b.objects.find((x) => x.id === el?.dataset.item);
                selectBand(b);
                select(o?.id ?? "");
                if (!draw && (!o || o.locked || editing === o.id)) return;
                (el ?? e.currentTarget).setPointerCapture(e.pointerId);
                start.current = {
                  ...point(e),
                  band: b,
                  item: draw ? undefined : o,
                  resize: (e.target as HTMLElement).classList.contains("pg-handle"),
                };
              }}
              onPointerMove={(e) => {
                const patch = geometry(e);
                if (patch) setDraft({ id: start.current?.item?.id ?? "line", patch });
              }}
              onPointerCancel={() => {
                start.current = null;
                setDraft(undefined);
              }}
              onPointerUp={(e) => {
                const origin = start.current,
                  p = geometry(e);
                if (origin && p) {
                  if (origin.item) {
                    const drop = document
                      .elementFromPoint(e.clientX, e.clientY)
                      ?.closest<HTMLElement>("[data-section]");
                    const dest = drop ? t.bands[Number(drop.dataset.section)] : undefined;
                    if (drop && dest && dest !== origin.band && !origin.resize) {
                      const rect = drop.getBoundingClientRect();
                      move(
                        origin.band,
                        dest,
                        origin.item,
                        snap((e.clientX - rect.x) / scale - (origin.x - origin.item.x)),
                        Math.max(0, snap((e.clientY - rect.y) / scale - (origin.y - origin.item.y))),
                      );
                    } else if (Math.abs(point(e).x - origin.x) + Math.abs(point(e).y - origin.y) > 0.5)
                      change(origin.band, origin.item.id, p);
                  } else if ("x" in p && "w" in p) add(b, "line", p.x!, p.y!, "", p.w!, p.h!);
                }
                start.current = null;
                setDraft(undefined);
              }}
            >
              <div className="pg-y-ruler" aria-hidden>
                {Array.from({ length: Math.floor(b.height / 10) + 1 }, (_, i) => (
                  <small key={i} style={{ top: i * 10 * scale }}>
                    {i * 10}
                  </small>
                ))}
              </div>
              {[
                ...b.objects,
                ...(draft?.id === "line" && start.current?.band === b
                  ? [{ id: "line", kind: "line", ...draft.patch } as PrintItem]
                  : []),
              ].map((original) => {
                const o = original.id === draft?.id ? { ...original, ...draft.patch } : original;
                return (
                  <div
                    key={o.id}
                    data-item={o.id}
                    tabIndex={0}
                    role="button"
                    aria-label={o.text || o.field || tools[o.kind]}
                    onDoubleClick={() => {
                      if (o.kind === "text" && !o.locked) setEditing(o.id);
                    }}
                    onFocus={() => {
                      selectBand(b);
                      select(o.id);
                    }}
                    onKeyDown={(e) => {
                      if (editing === o.id || o.locked) return;
                      const step = e.shiftKey ? 5 : 1;
                      if (e.key === "Enter" && o.kind === "text") {
                        e.preventDefault();
                        setEditing(o.id);
                      }
                      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
                        e.preventDefault();
                        duplicate(b, o);
                      }
                      if (e.key === "Delete") {
                        e.preventDefault();
                        remove(b, o);
                      }
                      const i = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].indexOf(e.key);
                      if (i >= 0) {
                        e.preventDefault();
                        change(b, o.id, {
                          x: Math.min(width - o.w, Math.max(0, o.x + [-step, step, 0, 0][i])),
                          y: Math.min(b.height - o.h, Math.max(0, o.y + [0, 0, -step, step][i])),
                        });
                      }
                    }}
                    className={
                      "pg-object pg-" +
                      o.kind +
                      (selected === o.id ? " selected" : "") +
                      (o.locked ? " locked" : "")
                    }
                    style={{
                      left: o.x * scale,
                      top: o.y * scale,
                      width: o.w * scale,
                      height: o.h * scale,
                      color: o.color,
                      backgroundColor: o.background ?? undefined,
                      fontSize: (((o.font ?? 10) * 96) / 72) * zoom,
                      fontWeight: o.bold ? 700 : 400,
                      textAlign: o.align,
                      borderColor: o.kind === "box" ? o.color : undefined,
                    }}
                  >
                    {editing === o.id ? (
                      <textarea
                        autoFocus
                        defaultValue={o.text ?? ""}
                        aria-label="Kutudaki metin"
                        maxLength={4000}
                        onBlur={(e) => {
                          change(b, o.id, { text: e.target.value });
                          setEditing("");
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Escape") {
                            e.currentTarget.value = o.text ?? "";
                            e.currentTarget.blur();
                          }
                          if (e.ctrlKey && e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                    ) : o.kind === "line" ? (
                      <i
                        style={{
                          display: "block",
                          background: o.color || "#162f46",
                          width: o.w >= o.h ? "100%" : (o.border ?? 0.3) * scale,
                          height: o.w >= o.h ? (o.border ?? 0.3) * scale : "100%",
                        }}
                      />
                    ) : o.kind === "box" ? null : o.kind === "text" ? (
                      o.text
                    ) : o.kind === "field" ? (
                      o.field
                    ) : o.kind === "formula" ? (
                      o.formula?.op + " (" + (o.formula?.field ?? "") + ")"
                    ) : (
                      tools[o.kind]
                    )}
                    {selected === o.id && !o.locked && editing !== o.id && <i className="pg-handle" />}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
