import type { FreeText } from "./printLayout";

/** DTP kutusu taşmayacak şekilde açık satır sonlarını korur, uzun satırları böler. */
export function fitText(
  box: { w: number; h: number; size: number; bold: boolean },
  text: string,
  measure: (s: string, bold: boolean) => number,
) {
  let size = (box.size * 25.4) / 72;
  function wrap(em: number) {
    const limit = Math.max(0.2, box.w - 0.8) / em;
    return text.split(/\r?\n/).flatMap((line) => {
      const lines: string[] = [];
      let current = "";
      for (const word of line.split(/\s+/)) {
        const next = current ? current + " " + word : word;
        if (current && measure(next, box.bold) > limit) {
          lines.push(current);
          current = "";
        }
        if (measure(word, box.bold) > limit) {
          for (const char of word) {
            if (current && measure(current + char, box.bold) > limit) {
              lines.push(current);
              current = "";
            }
            current += char;
          }
        } else current = current ? current + " " + word : word;
      }
      return [...lines, current];
    });
  }
  let lines = wrap(size);
  if (lines.length * size * 1.18 > box.h) {
    let lo = 0.01,
      hi = size;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (wrap(mid).length * mid * 1.18 > box.h) hi = mid;
      else lo = mid;
    }
    size = lo;
    lines = wrap(size);
  }
  return { size, lines };
}

let ctx: CanvasRenderingContext2D | null = null;
export function freeTextLines(box: FreeText, text: string) {
  ctx ??= document.createElement("canvas").getContext("2d");
  const c = ctx!;
  c.font = (box.bold ? "bold " : "") + "100px Floem, Arial, sans-serif";
  return fitText(box, text, (s) => c.measureText(s).width / 100);
}
