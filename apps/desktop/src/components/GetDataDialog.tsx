import type { ConnectResult, ConnectionInput, ConnectionKind } from "@floem/client";
import { useState, type FormEvent } from "react";
import { toUiError, useClient, type UiError } from "../api";
import { ErrorBox } from "./ErrorBox";

const SOURCES: { kind: ConnectionKind; label: string; hint: string }[] = [
  { kind: "sqlserver", label: "SQL Server", hint: "Veritabanı veya Windows kimliğiyle bağlanır." },
  { kind: "hana", label: "SAP HANA", hint: "Kurulu HDBODBC sürücüsünü kullanır." },
  { kind: "sqlite", label: "SQLite dosyası", hint: "Yerel dosyayı salt okunur açar." },
  { kind: "rest", label: "REST API", hint: "HTTPS JSON kaynağını içe aktarır." },
];

/** "Veri Al" penceresi: dört kaynak türünü aynı Gezgin akışına bağlar. */
export function GetDataDialog({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: (c: ConnectResult) => void;
}) {
  const client = useClient();
  const [form, setForm] = useState<ConnectionInput>({
    kind: "sqlserver",
    server: "",
    database: "",
    auth: "sql",
    user: "",
    password: "",
    trust_server_certificate: true,
    remember_password: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const set = <K extends keyof ConnectionInput>(k: K, v: ConnectionInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const pick = (kind: ConnectionKind) => {
    setError(null);
    setForm({ kind, server: "", database: "", auth: kind === "sqlite" || kind === "rest" ? "none" : "sql",
      user: "", password: "", trust_server_certificate: true, remember_password: true });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await client.connect({ ...form, database: form.database?.trim() || null });
      onConnected(res);
    } catch (err) {
      setError(toUiError(err));
    } finally {
      setBusy(false);
    }
  }

  const needsLogin = form.kind === "sqlserver" || form.kind === "hana";
  const canSubmit = !!form.server.trim() && (form.kind !== "rest" || !!form.database?.trim()) &&
    (!needsLogin || form.auth === "windows" || !!(form.user?.trim() && form.password)) &&
    (form.auth !== "bearer" || !!form.password);
  const title = SOURCES.find((source) => source.kind === form.kind)?.label ?? "Veri kaynağı";

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="modal" onSubmit={submit} aria-label={title}>
        <header className="modal-head">
          <h2>Veri al · {title}</h2>
          <button type="button" className="link" onClick={onClose} disabled={busy} aria-label="Kapat">
            ✕
          </button>
        </header>
        <div className="modal-body form">
          <div className="source-types" role="group" aria-label="Veri kaynağı türü">
            {SOURCES.map((source) => (
              <button key={source.kind} type="button" className={form.kind === source.kind ? "active" : ""}
                onClick={() => pick(source.kind)} title={source.hint}>
                {source.label}
              </button>
            ))}
          </div>
          <label>
            {form.kind === "sqlite" ? "Dosya yolu" : form.kind === "rest" ? "Temel URL" : "Sunucu"}
            <input
              autoFocus
              value={form.server}
              onChange={(e) => set("server", e.target.value)}
              placeholder={form.kind === "sqlite" ? "C:\\Veri\\rapor.sqlite" : form.kind === "rest" ? "https://ornek.com/api/" :
                form.kind === "hana" ? "hana-sunucu:30015" : "SUNUCU\\INSTANCE veya sunucu,1433"}
            />
          </label>
          {form.kind !== "sqlite" && (
          <label>
            {form.kind === "hana" ? "Şema" : form.kind === "rest" ? "Kaynak yolu" : "Veritabanı"}
            {form.kind !== "rest" && <span className="muted"> (isteğe bağlı)</span>}
            <input value={form.database ?? ""} onChange={(e) => set("database", e.target.value)}
              placeholder={form.kind === "rest" ? "orders" : "Boş bırakılırsa erişilebilir kaynaklar listelenir"} />
          </label>
          )}

          {(needsLogin || form.kind === "rest") && (
          <fieldset>
            <legend>Kimlik doğrulama</legend>
            {form.kind === "rest" ? <>
              <label className="inline"><input type="radio" checked={form.auth === "none"} onChange={() => setForm((f) => ({ ...f, auth: "none", password: "" }))} /> Yok</label>
              <label className="inline"><input type="radio" checked={form.auth === "bearer"} onChange={() => set("auth", "bearer")} /> Bearer belirteci</label>
            </> : <>
            <label className="inline">
              <input type="radio" checked={form.auth === "sql"} onChange={() => set("auth", "sql")} /> Veritabanı (SQL kullanıcısı)
            </label>
            {form.kind === "sqlserver" && <label className="inline">
              <input type="radio" checked={form.auth === "windows"} onChange={() => set("auth", "windows")} /> Windows (mevcut oturum)
            </label>}
            </>}
          </fieldset>
          )}

          {form.auth === "sql" && needsLogin && (
            <div className="row2">
              <label>
                Kullanıcı adı
                <input value={form.user ?? ""} onChange={(e) => set("user", e.target.value)} autoComplete="username" />
              </label>
              <label>
                Şifre
                <input type="password" value={form.password ?? ""} onChange={(e) => set("password", e.target.value)} autoComplete="current-password" />
              </label>
            </div>
          )}
          {form.auth === "bearer" && <label>Erişim belirteci
            <input type="password" value={form.password ?? ""} onChange={(e) => set("password", e.target.value)} autoComplete="off" />
          </label>}

          {form.kind === "sqlserver" && (
          <label className="inline">
            <input type="checkbox" checked={form.trust_server_certificate} onChange={(e) => set("trust_server_certificate", e.target.checked)} />
            Sunucu sertifikasına güven
          </label>
          )}
          {(form.auth === "sql" || form.auth === "bearer") && (
            <label className="inline">
              <input type="checkbox" checked={form.remember_password} onChange={(e) => set("remember_password", e.target.checked)} />
              Gizli bilgiyi bu bilgisayarda hatırla (Windows Kimlik Bilgisi Yöneticisi)
            </label>
          )}
          <p className="hint">Floem BI yalnızca okuma yapar. Kaynakta salt okuma yetkili bir kullanıcı kullanmanız önerilir.</p>
          {error && <ErrorBox error={error} />}
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={onClose} disabled={busy}>
            İptal
          </button>
          <button type="submit" className="primary" disabled={!canSubmit || busy}>
            {busy ? "Bağlanıyor…" : "Bağlan"}
          </button>
        </footer>
      </form>
    </div>
  );
}
