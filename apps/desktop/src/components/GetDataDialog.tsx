import type { ConnectResult, ConnectionInput } from "@floem/client";
import { useState, type FormEvent } from "react";
import { toUiError, useClient, type UiError } from "../api";
import { ErrorBox } from "./ErrorBox";

/** "Veri Al → SQL Server veritabanı" penceresi (Power BI'daki karşılığı gibi). */
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

  const canSubmit = form.server.trim() && (form.auth === "windows" || (form.user?.trim() && form.password));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="modal" onSubmit={submit} aria-label="SQL Server veritabanı">
        <header className="modal-head">
          <h2>SQL Server veritabanı</h2>
          <button type="button" className="link" onClick={onClose} disabled={busy} aria-label="Kapat">
            ✕
          </button>
        </header>
        <div className="modal-body form">
          <label>
            Sunucu
            <input
              autoFocus
              value={form.server}
              onChange={(e) => set("server", e.target.value)}
              placeholder="SUNUCU\INSTANCE veya 10.0.0.5,1433"
            />
          </label>
          <label>
            Veritabanı <span className="muted">(isteğe bağlı)</span>
            <input value={form.database ?? ""} onChange={(e) => set("database", e.target.value)} placeholder="Boş bırakılırsa tüm erişilebilir veritabanları listelenir" />
          </label>

          <fieldset>
            <legend>Kimlik doğrulama</legend>
            <label className="inline">
              <input type="radio" checked={form.auth === "sql"} onChange={() => set("auth", "sql")} /> Veritabanı (SQL kullanıcısı)
            </label>
            <label className="inline">
              <input type="radio" checked={form.auth === "windows"} onChange={() => set("auth", "windows")} /> Windows (mevcut oturum)
            </label>
          </fieldset>

          {form.auth === "sql" && (
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

          <label className="inline">
            <input type="checkbox" checked={form.trust_server_certificate} onChange={(e) => set("trust_server_certificate", e.target.checked)} />
            Sunucu sertifikasına güven
          </label>
          {form.auth === "sql" && (
            <label className="inline">
              <input type="checkbox" checked={form.remember_password} onChange={(e) => set("remember_password", e.target.checked)} />
              Şifreyi bu bilgisayarda hatırla (Windows Kimlik Bilgisi Yöneticisi)
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
