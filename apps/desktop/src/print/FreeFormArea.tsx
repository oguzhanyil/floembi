import { useEffect, useRef, useState } from "react";
import {
  bands,
  formCellText,
  formTitleBox,
  freeTextLines,
  type FormBand,
  type FreeText,
  type PrintRecord,
  type PrintTemplate,
} from "@floem/client";

export function FreeFormArea({
  band,
  t,
  data,
  active,
  selected,
  select,
  write,
  rename,
  snap,
}: {
  band: FormBand;
  t: PrintTemplate;
  data: PrintRecord;
  active: boolean;
  selected: string;
  select: (v: string) => void;
  write: (v: FreeText) => void;
  rename: (v: string) => void;
  snap: boolean;
}) {
  const all = t.layout?.freeText ?? [],
    boxes = (all.some((v) => v.role === "title") ? all : [formTitleBox(t), ...all]).filter(
      (v) => v.band === band,
    );
  const [editing, setEditing] = useState(""),
    [draft, setDraft] = useState<FreeText | null>(null);
  const origin = useRef<{ o: FreeText; x: number; y: number; scale: number; resize: boolean } | null>(null);
  const listeners = useRef<AbortController | null>(null);
  useEffect(() => () => listeners.current?.abort(), []);
  function update(e: PointerEvent) {
    const s = origin.current;
    if (!s) return null;
    const dx = (e.clientX - s.x) / s.scale,
      dy = (e.clientY - s.y) / s.scale;
    const round = (n: number) => Math.round(n * (snap && !e.altKey ? 1 : 10)) / (snap && !e.altKey ? 1 : 10);
    const cap = (n: number, max: number, min = 0) => Math.max(min, Math.min(max, round(n)));
    const o = s.o;
    return s.resize
      ? { ...o, w: cap(o.w + dx, 181 - o.x, 4), h: cap(o.h + dy, 60 - o.y, 3) }
      : { ...o, x: cap(o.x + dx, 181 - o.w), y: cap(o.y + dy, 60 - o.h) };
  }
  if (!active && !boxes.length) return null;
  return (
    <div
      className={"free-form-area" + (active ? " active" : "")}
      data-free-band={band}
      aria-label={bands[band] + " serbest alanı"}
      style={{
        height:
          Math.max(active ? 36 : 0, ...boxes.map((b) => b.y + b.h), draft ? draft.y + draft.h : 0) + "mm",
      }}
    >
      {boxes.map((original) => {
        const o = draft?.id === original.id ? draft : original,
          raw = o.role === "title" ? t.title : o.text;
        const text = formCellText(raw, data.header),
          { size, lines } = freeTextLines(o, text);
        return (
          <div
            key={o.id}
            role="button"
            tabIndex={0}
            aria-label={o.role === "title" ? "Taşınabilir belge başlığı" : "Metin kutusu " + raw}
            data-free-id={o.id}
            className={"free-form-box" + (selected === o.id ? " selected" : "")}
            style={{
              left: o.x + "mm",
              top: o.y + "mm",
              width: o.w + "mm",
              height: o.h + "mm",
              color: o.color,
              fontWeight: o.bold ? 700 : 400,
              textAlign: o.align,
              fontSize: size + "mm",
              lineHeight: "1.18",
              cursor: o.locked ? "default" : "move",
            }}
            onFocus={() => select(o.id)}
            onDoubleClick={() => {
              if (!o.locked) setEditing(o.id);
            }}
            onPointerDown={(e) => {
              if (e.button !== 0 || editing === o.id) return;
              select(o.id);
              if (o.locked) return;
              const el = e.currentTarget;
              const r = el.parentElement!.getBoundingClientRect();
              origin.current = {
                o,
                x: e.clientX,
                y: e.clientY,
                scale: r.width / 181,
                resize: (e.target as HTMLElement).classList.contains("pg-handle"),
              };
              listeners.current?.abort();
              const controller = new AbortController();
              listeners.current = controller;
              const pointer = e.pointerId;
              const cancel = () => {
                controller.abort();
                origin.current = null;
                setDraft(null);
              };
              window.addEventListener("pointermove", event => {
                if(event.pointerId === pointer) setDraft(update(event));
              }, {signal: controller.signal});
              window.addEventListener("pointerup", event => {
                if(event.pointerId !== pointer) return;
                const v = update(event);
                cancel();
                if(v && (v.x!==o.x || v.y!==o.y || v.w!==o.w || v.h!==o.h)) write(v);
              }, {signal:controller.signal});
              window.addEventListener("pointercancel", cancel, {signal:controller.signal});
              el.setPointerCapture(e.pointerId);
            }}
            onKeyDown={(e) => {
              if (editing || o.locked) return;
              const step = e.shiftKey ? 5 : 1;
              if (e.key === "Enter") {
                e.preventDefault();
                setEditing(o.id);
              }
              const i = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].indexOf(e.key);
              if (i >= 0) {
                e.preventDefault();
                write({
                  ...o,
                  x: Math.max(0, Math.min(181 - o.w, o.x + [-step, step, 0, 0][i])),
                  y: Math.max(0, Math.min(60 - o.h, o.y + [0, 0, -step, step][i])),
                });
              }
            }}
          >
            {editing === o.id ? (
              <textarea
                autoFocus
                defaultValue={raw}
                aria-label="Kutudaki metin"
                maxLength={o.role === "title" ? 100 : 4000}
                onPointerDown={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  if (o.role === "title") rename(e.target.value.trim() || raw);
                  else write({ ...o, text: e.target.value });
                  setEditing("");
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") {
                    e.currentTarget.value = raw;
                    e.currentTarget.blur();
                  }
                  if (e.key === "Enter" && e.ctrlKey) e.currentTarget.blur();
                }}
              />
            ) : (
              lines.map((s, i) => <div key={i}>{s || "\u00a0"}</div>)
            )}
            {selected === o.id && !o.locked && !editing && <i className="pg-handle" />}
          </div>
        );
      })}
    </div>
  );
}
