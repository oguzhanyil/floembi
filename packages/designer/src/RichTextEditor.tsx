import { useState } from "react";
import type { VisualFormat } from "@floem/client";

type Paragraphs = NonNullable<VisualFormat["paragraphs"]>;
type Run = Paragraphs[number]["runs"][number];

/** Metni seçime göre böler. Seçimin iki yanındaki parça biçimleri korunur. */
function pieces(paragraphs: Paragraphs, start: number, end: number, apply: (run: Run) => Run): Paragraphs {
  let offset = 0;
  return paragraphs.map(p => {
    const runs = p.runs.flatMap(run => {
      const left = Math.max(0, Math.min(run.text.length, start - offset));
      const right = Math.max(left, Math.min(run.text.length, end - offset));
      offset += run.text.length;
      return [{ ...run, text: run.text.slice(0,left) }, apply({ ...run,text:run.text.slice(left,right) }),
        { ...run,text:run.text.slice(right) }].filter(r => r.text.length);
    });
    offset++;
    return { ...p, runs };
  });
}

export function RichTextEditor({ format, update }: { format: VisualFormat; update: (patch: Partial<VisualFormat>) => void }) {
  const [selection, setSelection] = useState([0,0]);
  const text = typeof format.text === "string" ? format.text : "";
  const paragraphs: Paragraphs = format.paragraphs ?? text.split("\n").map(line => ({ runs: [{ text: line }] }));
  function style(patch: Partial<Run>) {
    if (selection[0] < selection[1]) update({ paragraphs: pieces(paragraphs,selection[0],selection[1],r => ({ ...r, ...patch })) });
  }
  function edit(next: string) {
    if (!format.paragraphs) { update({ text: next }); return; }
    let start = 0, tail = 0;
    while (start < text.length && start < next.length && next[start] === text[start]) start++;
    while (tail < Math.min(text.length,next.length)-start && text[text.length-1-tail] === next[next.length-1-tail]) tail++;
    const inserted = next.slice(start,next.length-tail);
    let offset = 0;
    const output: Paragraphs = [{ align: paragraphs[0]?.align,runs: [] }];
    let insertedDone = false;
    let lastStyle: Run = { text:"" };
    function add(s: string, run: Run, align?: Paragraphs[number]["align"]) {
      s.split("\n").forEach((line,i) => {
        if (i) output.push({ align, runs: [] });
        if (line) output[output.length-1].runs.push({ ...run, text:line });
      });
    }
    function copy(s: string, run: Run, align?: Paragraphs[number]["align"]) {
      if (offset < start) add(s.slice(0,start-offset),run,align);
      if (!insertedDone && offset+s.length >= start) {
        add(inserted,run,align); insertedDone=true;
      }
      const end = Math.max(0,text.length-tail-offset);
      if (end < s.length) add(s.slice(end),run,align);
      offset+=s.length;
      lastStyle=run;
    }
    paragraphs.forEach((p,i) => {
      if (i) copy("\n",lastStyle,p.align);
      p.runs.forEach(r => copy(r.text,r,p.align));
    });
    if (!insertedDone) add(inserted,lastStyle);
    update({ text: next, paragraphs: output });
  }
  return <>
    <textarea rows={7} value={text} placeholder={"# Satış özeti\nBu dönemin satışı: [Toplam Satış]"}
      onSelect={e => setSelection([e.currentTarget.selectionStart,e.currentTarget.selectionEnd])} onChange={e => edit(e.target.value)} />
    {selection[1]>selection[0] && <fieldset><legend>Seçili metin</legend>
      <button type="button" onClick={() => style({bold:true})}>Kalın</button>
      <button type="button" onClick={() => style({italic:true})}>İtalik</button>
      <button type="button" onClick={() => style({bold:false,italic:false,underline:false})}>Normal</button>
      <label>Parça rengi<input type="color" defaultValue="#172033" onChange={e => style({color:e.target.value})} /></label>
    </fieldset>}
  </>;
}
