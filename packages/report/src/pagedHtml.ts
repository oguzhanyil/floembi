import type { PrintOutput } from "@floem/client";
import regular from "./fonts/Roboto-Regular.ttf?inline";
import medium from "./fonts/Roboto-Medium.ttf?inline";
import fontLicense from "./fonts/LICENSE.txt?raw";

export function pagedHtml(r: PrintOutput) {
  const style = `@font-face{font-family:Floem;src:url(${regular})}@font-face{font-family:Floem;font-weight:bold;src:url(${medium})}
    @page{size:${r.width}mm ${r.height}mm;margin:0}body{margin:0;background:#eee}section{width:${r.width}mm;height:${r.height}mm;margin:auto;background:white;break-after:page}section:last-child{break-after:auto}svg{display:block;width:100%;height:100%}`;
  return new Blob(
    [
      '<!doctype html><html lang="tr"><meta charset="utf-8"><title>',
      r.name.replace(/&/g, "&amp;").replace(/</g, "&lt;"),
      "</title><style>",
      style,
      "</style><!-- Roboto v2.138\n", fontLicense.replace(/-->/g,"-- >"), "\n--><body>",
      ...r.pages.map((p) => "<section>" + p + "</section>"),
      "</body></html>",
    ],
    { type: "text/html;charset=utf-8" },
  );
}
