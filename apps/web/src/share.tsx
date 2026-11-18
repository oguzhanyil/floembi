import {
  FloemApiError, type MailItem, type MailMessage, type PublishedReport, type ReportAccess, type ShareResult,
} from "@floem/client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { navigate, useSession } from "./session";

/** E-postadaki rapor bağlantısı (aynı sunucudaysa uygulama içinde açılır) */
function reportPath(html: string | null, text: string): string | null {
  const m = /https?:\/\/[^\s"'<>]+\/reports\/\d+/.exec(html ?? text);
  if (!m) return null;
  try {
    const u = new URL(m[0].replace(/&amp;/g, "&"));
    return u.origin === window.location.origin ? u.pathname : null;
  } catch {
    return null;
  }
}

const dateFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });
const when = (iso: string) => dateFmt.format(new Date(iso));

function errText(e: unknown) {
  if (e instanceof FloemApiError) return e.detail ? `${e.message} (${e.detail})` : e.message;
  return String(e);
}

const STATUS_TEXT: Record<ShareResult["status"], string> = {
  shared: "Erişim verildi",
  already: "Zaten paylaşılmış",
  member: "Çalışma alanı üyesi",
  unknown: "Kullanıcı bulunamadı",
  invalid: "Geçersiz adres",
  self: "Siz",
};

const MAIL_TEXT: Record<ShareResult["mail"], string> = {
  sent: "e-posta gönderildi",
  outbox: "e-posta giden kutusuna yazıldı",
  failed: "e-posta gönderilemedi",
  skipped: "",
};

/** Power BI "Raporu paylaş": alıcılar, mesaj, e-posta bildirimi ve erişimi olanlar. */
export function ShareDialog({ report, onClose }: { report: PublishedReport; onClose: () => void }) {
  const { client, guard } = useSession();
  const [emails, setEmails] = useState("");
  const [message, setMessage] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<ShareResult[] | null>(null);
  const [access, setAccess] = useState<ReportAccess | null>(null);

  const loadAccess = useCallback(() => {
    guard(client.reportAccess(report.id)).then(setAccess).catch((e) => setError(errText(e)));
  }, [client, guard, report.id]);
  useEffect(loadAccess, [loadAccess]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const list = emails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!list.length) {
      setError("En az bir e-posta adresi yazın");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await guard(client.share(report.id, list, message.trim() || null, notify));
      setResults(r.results);
      if (r.results.every((x) => ["shared", "already", "member"].includes(x.status) && x.mail !== "failed")) setEmails("");
      loadAccess();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(uid: number) {
    try {
      await guard(client.unshare(report.id, uid));
      loadAccess();
    } catch (err) {
      setError(errText(err));
    }
  }

  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <form className="modal share-dialog" role="dialog" aria-label="Raporu paylaş" onSubmit={submit}>
        <header className="modal-head">
          <h2>Raporu paylaş</h2>
          <span className="muted">{report.name}</span>
          <button type="button" className="link close" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <label>
            Alıcılar
            <input
              type="text"
              autoFocus
              value={emails}
              placeholder="ad@sirket.com, ikinci@sirket.com"
              onChange={(e) => setEmails(e.target.value)}
            />
          </label>
          <label>
            Mesaj (isteğe bağlı)
            <textarea rows={3} value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <label className="inline">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Alıcılara e-posta bildirimi gönder
          </label>
          {access?.mail_mode === "outbox" && notify && (
            <p className="hint">
              Geliştirme modu: e-posta sunucusu ayarlı değil. E-postalar gerçekten gönderilmez; alıcı floembi.app'te
              <strong> ✉ Gelen e-postalar</strong> sayfasında görür.
            </p>
          )}
          <p className="hint">
            Alıcılar raporu ve verisini salt okunur görür; raporu düzenleyemez, yayımlayamaz, yenileyemez.
          </p>
          {error && <div className="error-box">{error}</div>}
          {results && (
            <ul className="share-results">
              {results.map((r) => {
                const ok = ["shared", "already", "member"].includes(r.status) && r.mail !== "failed";
                return (
                  <li key={r.email} className={ok ? "ok" : "bad"}>
                    <span aria-hidden>{ok ? "✓" : "⚠"}</span>
                    <span>
                      <strong>{r.email}</strong>: {STATUS_TEXT[r.status]}
                      {MAIL_TEXT[r.mail] && `, ${MAIL_TEXT[r.mail]}`}
                      {!ok && r.status !== "shared" && r.message && <span className="muted"> ({r.message})</span>}
                      {r.mail_error && <span className="muted"> ({r.mail_error})</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <h3>Erişimi olanlar</h3>
          {!access && <p className="muted">Yükleniyor…</p>}
          {access && (
            <table className="items compact">
              <tbody>
                {access.members.map((m) => (
                  <tr key={`m${m.id}`} className="static">
                    <td>{m.name}<div className="muted small">{m.email}</div></td>
                    <td>Çalışma alanı: {m.role_label}</td>
                    <td />
                  </tr>
                ))}
                {access.shares.map((s) => (
                  <tr key={`s${s.id}`} className="static">
                    <td>{s.name}<div className="muted small">{s.email}</div></td>
                    <td>
                      Paylaşıldı · {s.shared_by}
                      <div className="muted small">{when(s.shared_at)}</div>
                    </td>
                    <td>
                      <button type="button" className="link danger" onClick={() => void remove(s.id)}>
                        Erişimi kaldır
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={onClose}>
            Kapat
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Paylaşılıyor…" : "Paylaş"}
          </button>
        </footer>
      </form>
    </div>
  );
}

/**
 * Geliştirme modu (SMTP ayarsız): sunucunun giden kutusundaki bu kullanıcıya gelen ve
 * kullanıcının gönderdiği e-postalar. Gerçek e-posta sunucusu ayarlanınca e-postalar
 * alıcının kendi posta kutusuna gider; bu sayfa yalnızca gönderim kaydını gösterir.
 */
export function InboxPage() {
  const { client, guard, user } = useSession();
  const [items, setItems] = useState<MailItem[] | null>(null);
  const [open, setOpen] = useState<MailMessage | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    guard(client.inbox()).then((r) => setItems(r.items)).catch((e) => setError(errText(e)));
  }, [client, guard]);

  async function show(id: number) {
    try {
      setOpen(await guard(client.mailMessage(id)));
    } catch (e) {
      setError(errText(e));
    }
  }

  return (
    <div className="page-wrap inbox">
      <h1>Gelen e-postalar</h1>
      <p className="muted">
        Geliştirme modu: e-posta sunucusu ayarlanmadığı için floembi.app'in gönderdiği e-postalar burada görünür
        ({user?.email}). Gerçek kullanımda e-postalar alıcının posta kutusuna gider.
      </p>
      {error && <div className="error-box">{error}</div>}
      {items && items.length === 0 && <p className="muted">Henüz e-posta yok.</p>}
      {items && items.length > 0 && (
        <table className="items">
          <thead>
            <tr><th /><th>Konu</th><th>Kimden / kime</th><th>Tarih</th><th>Durum</th></tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id} onClick={() => m.readable && void show(m.id)} className={m.readable ? "" : "static"}>
                <td>{m.incoming ? "📥" : "📤"}</td>
                <td>{m.subject}</td>
                <td>{m.incoming ? `Kimden: ${m.from}` : `Kime: ${m.to}`}</td>
                <td>{when(m.created_at)}</td>
                <td>
                  {m.status === "failed" ? <span className="bad-text" title={m.error ?? ""}>Gönderilemedi</span>
                    : m.status === "sent" ? "Gönderildi" : "Giden kutusunda"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && (
        <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && setOpen(null)}>
          <div className="modal mail-view" role="dialog" aria-label={open.subject}>
            <header className="modal-head">
              <div>
                <h2>{open.subject}</h2>
                <div className="muted small">Kimden: {open.from} · Kime: {open.to} · {when(open.created_at)}</div>
              </div>
              {reportPath(open.html, open.text) && (
                <button className="primary mail-open" onClick={() => navigate(reportPath(open.html, open.text)!)}>
                  Raporu aç
                </button>
              )}
              <button className="link close" onClick={() => setOpen(null)} aria-label="Kapat">
                ✕
              </button>
            </header>
            {open.html ? (
              // E-posta içeriği betiksiz, yalıtılmış çerçevede; bağlantı tıklanınca ana pencerede açılır
              <iframe
                title={open.subject}
                className="mail-frame"
                sandbox="allow-top-navigation-by-user-activation allow-popups"
                srcDoc={open.html}
              />
            ) : (
              <pre className="mail-text">{open.text}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
