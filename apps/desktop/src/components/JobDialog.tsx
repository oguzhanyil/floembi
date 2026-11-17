import type { Job } from "@floem/client";
import { useEffect, useState } from "react";
import { toUiError, useClient } from "../api";
import { useDocument } from "../document";
import { ErrorBox } from "./ErrorBox";

const nf = new Intl.NumberFormat("tr-TR");

const STATUS: Record<string, { icon: string; text: string }> = {
  pending: { icon: "○", text: "Bekliyor" },
  running: { icon: "◌", text: "Yükleniyor" },
  done: { icon: "✓", text: "Tamam" },
  failed: { icon: "✕", text: "Hata" },
  cancelled: { icon: "–", text: "İptal edildi" },
};

/** Power BI'daki "Yükle" / "Yenile" penceresi: tablo tablo ilerleme, iptal, sonuç özeti. */
export function JobDialog({ onShowModel }: { onShowModel: () => void }) {
  const client = useClient();
  const { job, trackJob, reload } = useDocument();
  const [current, setCurrent] = useState<Job | null>(job);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => setCurrent(job), [job]);

  useEffect(() => {
    if (!current || current.status !== "running") return;
    const t = setTimeout(async () => {
      try {
        const next = await client.job(current.id);
        setCurrent(next);
        if (next.status !== "running") void reload();
      } catch (e) {
        setCurrent({ ...current, status: "failed", error: toUiError(e) as Job["error"] });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [current, client, reload]);

  if (!current) return null;
  const running = current.status === "running";
  const title = current.kind === "import" ? "Yükle" : "Yenile";
  const rels = current.result.relationships ?? [];
  const passive = rels.filter((r) => !r.aktif).length;

  async function cancel() {
    if (!current) return;
    setCancelling(true);
    try {
      setCurrent(await client.cancelJob(current.id));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal job-dialog" role="dialog" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          {!running && (
            <button className="link" onClick={() => trackJob(null)} aria-label="Kapat">
              ✕
            </button>
          )}
        </header>
        <div className="modal-body">
          <table className="job-table">
            <tbody>
              {current.tables.map((t) => (
                <tr key={t.name} className={`job-${t.status}`}>
                  <td className="job-icon" aria-hidden>
                    {STATUS[t.status].icon}
                  </td>
                  <td>
                    <strong>{t.name}</strong>
                    <div className="muted small">{t.label}</div>
                  </td>
                  <td className="job-rows">
                    {t.status === "pending" ? STATUS.pending.text : `${nf.format(t.rows)} satır`}
                    {t.status !== "pending" && t.status !== "running" && t.status !== "done" && (
                      <div className="small">{STATUS[t.status].text}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {current.status === "failed" && current.error && <ErrorBox error={current.error} />}
          {current.status === "cancelled" && (
            <p className="hint">İşlem iptal edildi. Model ve mevcut veri değişmedi.</p>
          )}
          {current.status === "succeeded" && (
            <div className="job-summary">
              <p>
                <strong>{current.tables.length} tablo</strong> {current.kind === "import" ? "yüklendi" : "yenilendi"} ·{" "}
                {(current.elapsed_ms / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sn
              </p>
              {current.kind === "import" && (
                <p>
                  {rels.length === 0
                    ? "Otomatik ilişki bulunamadı; model görünümünde sütunu sürükleyerek ilişki kurabilirsiniz."
                    : `${rels.length} ilişki otomatik algılandı${passive ? ` (${passive} tanesi belirsizlik oluşturmaması için pasif)` : ""}.`}
                </p>
              )}
              {!!current.result.warnings?.length && (
                <ul className="warnings">
                  {current.result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <footer className="modal-foot">
          {running ? (
            <>
              <span className="muted">
                {(current.elapsed_ms / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} sn
              </span>
              <span className="spacer" />
              <button onClick={cancel} disabled={cancelling}>
                {cancelling ? "İptal ediliyor…" : "İptal"}
              </button>
            </>
          ) : (
            <>
              {current.status === "succeeded" && current.kind === "import" && (
                <button
                  className="primary"
                  onClick={() => {
                    trackJob(null);
                    onShowModel();
                  }}
                >
                  Model görünümünü aç
                </button>
              )}
              <button onClick={() => trackJob(null)}>Kapat</button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
