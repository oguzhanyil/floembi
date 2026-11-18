import type { GatewayInfo, PublishResult, PublishSession, WorkspaceInfo } from "@floem/client";
import { useEffect, useState, type FormEvent } from "react";
import { toUiError, useClient, type UiError } from "../api";
import { useDocument } from "../document";
import { ErrorBox } from "./ErrorBox";

const CAN_PUBLISH = new Set(["admin", "member", "contributor"]);

/** Power BI Desktop'taki "Yayımla": floembi.app'te oturum aç, çalışma alanı seç, yükle. */
export function PublishDialog({ onClose }: { onClose: () => void }) {
  const client = useClient();
  const { doc, save } = useDocument();
  const [session, setSession] = useState<PublishSession | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[] | null>(null);
  const [server, setServer] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [gateways, setGateways] = useState<GatewayInfo[]>([]);
  const [gatewayId, setGatewayId] = useState<number | null>(null);
  const [busy, setBusy] = useState<null | "login" | "publish" | "save">(null);
  const [error, setError] = useState<UiError | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);

  useEffect(() => {
    client
      .publishSession()
      .then(async (s) => {
        setSession(s);
        setServer(s.server_url);
        setEmail(s.email);
        if (s.logged_in) setWorkspaces(await client.publishWorkspaces());
      })
      .catch((e) => setError(toUiError(e)));
  }, [client]);

  useEffect(() => {
    if (workspaces && picked === null) setPicked(workspaces.find((w) => CAN_PUBLISH.has(w.role))?.id ?? null);
  }, [workspaces, picked]);

  useEffect(() => {
    if (picked === null || !session?.logged_in) return;
    let active = true;
    setGateways([]);
    setGatewayId(null);
    client.publishGateways(picked).then((items) => {
      if (!active) return;
      const registered = items.filter((g) => g.registered);
      setGateways(registered);
      setGatewayId(registered.length === 1 ? registered[0].id : null);
    }).catch((e) => { if (active) setError(toUiError(e)); });
    return () => { active = false; };
  }, [client, picked, session?.logged_in]);

  const needsSave = !doc?.path || doc.dirty;

  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy("login");
    setError(null);
    try {
      const r = await client.publishLogin(server, email, password);
      setSession(r);
      setWorkspaces(r.workspaces);
      setPassword("");
    } catch (err) {
      setError(toUiError(err));
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    setSession(await client.publishLogout());
    setWorkspaces(null);
    setPicked(null);
  }

  async function doSave() {
    setBusy("save");
    try {
      await save();
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (picked === null) return;
    setBusy("publish");
    setError(null);
    try {
      setResult(await client.publish(picked, gatewayId));
    } catch (err) {
      const ui = toUiError(err);
      setError(ui);
      if (ui.code === "publish_unauthorized") {
        setSession((s) => (s ? { ...s, logged_in: false, user: null } : s));
        setWorkspaces(null);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}>
      <div className="modal publish-dialog" role="dialog" aria-label="floembi.app'te yayımla">
        <header className="modal-head">
          <h2>floembi.app'te yayımla</h2>
          <button className="link" onClick={onClose} aria-label="Kapat" disabled={!!busy}>
            ✕
          </button>
        </header>
        <div className="modal-body form">
          {result ? (
            <div className="publish-done">
              <p className="ok-big">✓ Başarılı</p>
              <p>
                <strong>{result.name}</strong> floembi.app'te yayımlandı
                {result.replaced ? ` (mevcut rapor değiştirildi, sürüm ${result.version})` : ""}.
              </p>
              <a className="button primary" href={result.url} target="_blank" rel="noreferrer">
                Raporu floembi.app'te aç
              </a>
              <p className="hint">{result.url}</p>
              {result.gateway_sync.status !== "not_needed" && (
                <p className={result.gateway_sync.status === "ready" ? "ok-text" : "warn-text"} role="status">
                  {result.gateway_sync.message} ({result.gateway_sync.synced}/{result.gateway_sync.total})
                </p>
              )}
            </div>
          ) : needsSave ? (
            <>
              <p>Yayımlamadan önce raporu kaydetmeniz gerekiyor (yayımlanan, diske kaydedilmiş dosyadır).</p>
              <div>
                <button className="primary" onClick={doSave} disabled={!!busy}>
                  {busy === "save" ? "Kaydediliyor…" : "Kaydet"}
                </button>
              </div>
            </>
          ) : !session ? (
            <p className="muted">Yükleniyor…</p>
          ) : !session.logged_in || !workspaces ? (
            <form className="form" onSubmit={login}>
              <label>
                Sunucu
                <input type="text" value={server} onChange={(e) => setServer(e.target.value)} required />
              </label>
              <label>
                E-posta
                <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
              </label>
              <label>
                Şifre
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </label>
              <p className="hint">
                Geliştirme kullanıcıları: <code>yonetici@floembi.test</code> (Floem.Yonetici1) ve{" "}
                <code>izleyici@floembi.test</code> (Floem.Izleyici1). Sunucuyu başlatmak için: <code>npm run server</code>
              </p>
              <div>
                <button className="primary" disabled={!!busy}>
                  {busy === "login" ? "Oturum açılıyor…" : "Oturum aç"}
                </button>
              </div>
            </form>
          ) : (
            <>
              <p className="muted">
                {session.user?.name} ({session.user?.email}) ·{" "}
                <button className="link inline-link" onClick={logout}>
                  Farklı hesap
                </button>
              </p>
              <p>
                <strong>{doc?.name}</strong> için bir hedef seçin:
              </p>
              {workspaces.length === 0 && <p className="hint warn">Üye olduğunuz bir çalışma alanı yok.</p>}
              <div className="ws-list">
                {workspaces.map((w) => {
                  const allowed = CAN_PUBLISH.has(w.role);
                  return (
                    <label key={w.id} className={`ws-item ${allowed ? "" : "disabled"}`}>
                      <input type="radio" name="ws" checked={picked === w.id} disabled={!allowed} onChange={() => setPicked(w.id)} />
                      <span>
                        <strong>{w.name}</strong>
                        <span className="muted"> · {w.role_label}{allowed ? "" : " (yayımlama yetkisi yok)"}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {picked !== null && <div className="form">
                <h3>Floemway</h3>
                {gateways.length === 0 ? <p className="hint">Kayıtlı Floemway yok. Rapor yayımlanır; kaynak bağlantıları Floemway kaydından sonra bekler.</p> :
                  gateways.length === 1 ? <p className="hint">Bağlantılar {gateways[0].name} ile otomatik eşlenecek.</p> :
                    <label>Bağlantıları kullanacak Floemway
                      <select value={gatewayId ?? ""} onChange={(e) => setGatewayId(Number(e.target.value) || null)}>
                        <option value="">Seçin</option>
                        {gateways.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </label>}
              </div>}
            </>
          )}
          {error && <ErrorBox error={error} onClose={() => setError(null)} />}
        </div>
        <footer className="modal-foot">
          {!result && session?.logged_in && workspaces && !needsSave && (
            <button className="primary" onClick={publish} disabled={picked === null || !!busy}>
              {busy === "publish" ? "Yayımlanıyor…" : "Yayımla"}
            </button>
          )}
          <button onClick={onClose} disabled={!!busy}>
            {result ? "Kapat" : "İptal"}
          </button>
        </footer>
      </div>
    </div>
  );
}
