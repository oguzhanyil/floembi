import { useEffect, useState } from "react";
import {
  FloemApiError,
  latestReports,
  type PagedLibrary,
  type PagedRunner,
  type PrintOutput,
  type Scalar,
} from "@floem/client";
import { tableExportBlob } from "./tableExport";
import "./pagedViewer.css";
import fontLicense from "./fonts/LICENSE.txt?raw";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]/g, "_");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function pagedPdf(result: PrintOutput) {
  const { default: pdf } = await import("./pdfEngine");
  const width = (result.width * 72) / 25.4,
    height = (result.height * 72) / 25.4;
  return pdf
    .createPdf({
      info: { title: result.name, creator: "Floem BI", subject: "Roboto v2.138 · Apache-2.0\n" + fontLicense },
      pageSize: { width, height },
      pageMargins: [0, 0, 0, 0],
      defaultStyle: { font: "Floem" },
      content: result.pages.map((svg, i) => ({
        svg,
        width,
        height,
        absolutePosition: { x: 0, y: 0 },
        pageBreak: i ? "before" : undefined,
      })),
    })
    .getBlob();
}

function problem(e: unknown) {
  return e instanceof FloemApiError && e.detail
    ? e.message + " · " + e.detail
    : e instanceof Error
      ? e.message
      : String(e);
}

export function PagedViewer({
  library,
  runner,
  initial,
}: {
  library: PagedLibrary;
  runner: PagedRunner;
  initial?: string;
}) {
  const reports = latestReports(library);
  const [id, setId] = useState(initial ?? reports[0]?.id ?? "");
  const report = reports.find((r) => r.id === id) ?? reports[0];
  const defaults = (id: string) =>
    Object.fromEntries(
      (reports.find((r) => r.id === id)?.params ?? []).map((p) => [p.label, p.default ?? ""]),
    );
  const [values, setValues] = useState<Record<string, Scalar>>(() => defaults(id));
  const [applied, setApplied] = useState<Record<string, Scalar>>(() => defaults(id));
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<PrintOutput>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setResult(undefined);
    setError("");
    setPage(0);
    if (report)
      runner
        .preview(report.id, applied)
        .then((r) => {
          if (current) setResult(r);
        })
        .catch((e) => {
          if (current) setError(problem(e));
        });
    return () => {
      current = false;
    };
  }, [runner, report, applied]);
  async function save(ext: string) {
    if (!result || !report) return;
    setBusy(true);
    setError("");
    try {
      let blob: Blob;
      if (ext === "pdf") blob = await pagedPdf(result);
      else if (ext === "html") {
        const { pagedHtml } = await import("./pagedHtml");
        blob = pagedHtml(result);
      } else if (ext === "docx") {
        const response = await runner.word(report.id, applied);
        blob = new Blob([Uint8Array.from(atob(response.word), (c) => c.charCodeAt(0))], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
      } else {
        const [first, ...rows] = result.sheet;
        blob = await tableExportBlob(
          {
            title: result.name,
            columns: first.map((v) => ({ name: String(v ?? ""), kind: "group", type: "string" })),
            rows,
            truncated: false,
          },
          ext === "xlsx" ? "xlsx" : "csv",
        );
      }
      download(blob, result.name + "." + ext);
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(false);
    }
  }
  async function print() {
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      const { pagedHtml } = await import("./pagedHtml");
      const frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;width:1px;height:1px;border:0;bottom:0;right:0";
      frame.title = "Yazdırma belgesi";
      frame.onload = async () => {
        const win = frame.contentWindow;
        if (win) {
          await win.document.fonts.ready;
          win.addEventListener("afterprint", () => frame.remove(), { once: true });
          win.focus();
          win.print();
        }
      };
      frame.srcdoc = await pagedHtml(result).text();
      document.body.appendChild(frame);
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="paged-view" aria-label="Sayfalı rapor önizlemesi">
      <div className="paged-controls">
        <label>
          Rapor
          <select
            value={report?.id}
            onChange={(e) => {
              const next = defaults(e.target.value);
              setId(e.target.value);
              setValues(next);
              setApplied(next);
            }}
          >
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.category ? r.category + " / " : ""}
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {report?.params.map((p, i) => (
          <label key={p.label}>
            {p.label}
            <input
              aria-label={p.label}
              type={p.kind === "date" ? "date" : p.kind === "number" ? "number" : "text"}
              list={p.kind === "choice" ? "paged-options-" + i : undefined}
              value={String(values[p.label] ?? "")}
              onChange={(e) => setValues({ ...values, [p.label]: e.target.value })}
            />
            {p.kind === "choice" && (
              <datalist id={"paged-options-" + i}>
                {result?.options[p.label]?.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            )}
          </label>
        ))}
        {Boolean(report?.params.length) && <button onClick={() => setApplied({ ...values })}>Uygula</button>}
        {result && (
          <>
            <button aria-label="Önceki sayfa" disabled={!page} onClick={() => setPage(page - 1)}>
              ‹
            </button>
            <span>
              {page + 1} / {result.pages.length} · {result.count.toLocaleString("tr-TR")} kayıt
            </span>
            <button
              aria-label="Sonraki sayfa"
              disabled={page + 1 >= result.pages.length}
              onClick={() => setPage(page + 1)}
            >
              ›
            </button>
            <button disabled={busy} onClick={() => void print()}>
              Yazdır
            </button>
            {["pdf", "xlsx", "docx", "csv", "html"].map((ext, i) => (
              <button
                key={ext}
                disabled={busy || (!result.sheet.length && (ext === "csv" || ext === "xlsx"))}
                onClick={() => void save(ext)}
              >
                {["PDF", "Excel", "Word", "CSV", "HTML"][i]}
              </button>
            ))}
          </>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {result ? (
        <div
          className="paged-paper"
          style={{ maxWidth: result.width + "mm" }}
          role="img"
          aria-label={`Sayfa ${page + 1}`}
          dangerouslySetInnerHTML={{ __html: result.pages[page] }}
        />
      ) : (
        !error && <p role="status">Sayfalar hazırlanıyor…</p>
      )}
    </section>
  );
}
