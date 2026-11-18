import {
  FloemApiError, type AdminUsers, type GrantResult, type InvitationInfo, type MailConfigInput, type MailConfigView,
  type MailSendResult, type WorkspaceRole,
} from "@floem/client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { navigate, useSession } from "./session";

const dateFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });
const when = (iso: string) => dateFmt.format(new Date(iso));

interface Err {
  message: string;
  detail?: string;
}

function toErr(e: unknown): Err {
  if (e instanceof FloemApiError) return { message: e.message, detail: e.detail };
  return { message: String(e) };
}

function ErrorLine({ error }: { error: Err }) {
  return (
    <div className="error-box" role="alert">
      <strong>{error.message}</strong>
      {error.detail && <span className="small">{error.detail}</span>}
    </div>
  );
}

const MAIL_TEXT: Record<string, string> = {
  sent: "e-posta gönderildi",
  outbox: "e-posta giden kutusuna yazıldı",
  failed: "e-posta gönderilemedi",
  skipped: "",
};

// ================================================================== E-posta sunucusu
const PRESETS: { label: string; host: string; port: number; security: MailConfigInput["security"]; note?: string }[] = [
  {
    label: "Microsoft 365", host: "smtp.office365.com", port: 587, security: "starttls",
    note: "Posta kutusunda “Kimliği doğrulanmış SMTP” açık olmalı. Microsoft bu yöntemi kademeli olarak kapatıyor; "
      + "kapalıysa SMTP rölesi ya da bir gönderim servisi (SES, Postmark…) kullanın.",
  },
  { label: "Gmail / Google Workspace", host: "smtp.gmail.com", port: 587, security: "starttls",
    note: "Hesap şifresi değil, Google “Uygulama şifresi” kullanılır." },
  { label: "GoDaddy", host: "smtpout.secureserver.net", port: 465, security: "ssl",
    note: "GoDaddy e-postası (alan adının MX kaydı secureserver.net). Kullanıcı adı ve gönderen tam e-posta adresi, şifre posta kutusu şifresidir." },
  { label: "Titan", host: "smtp.titan.email", port: 465, security: "ssl",
    note: "Kullanıcı adı ve gönderen adresi Titan e-posta adresinizin tamamı, şifre posta kutusu şifresidir." },
  { label: "Mailpit (geliştirme)", host: "127.0.0.1", port: 1025, security: "none",
    note: "E-postalar http://127.0.0.1:8025 adresinde okunur; kimseye gerçekten gitmez." },
];

const EMPTY: MailConfigInput = {
  enabled: false, host: "", port: 587, security: "starttls", username: "", password: null,
  from_address: "", from_name: "floembi.app",
};

export function MailSettingsPage() {
  const { client, guard, user, reload } = useSession();
  const [view, setView] = useState<MailConfigView | null>(null);
  const [form, setForm] = useState<MailConfigInput>(EMPTY);
  const [clearPw, setClearPw] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "test">("");
  const [error, setError] = useState<Err | null>(null);
  const [saved, setSaved] = useState(false);
  const [testTo, setTestTo] = useState(user?.email ?? "");
  const [test, setTest] = useState<MailSendResult | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const apply = useCallback((v: MailConfigView) => {
    setView(v);
    const c = v.config;
    setForm({
      enabled: c.enabled, host: c.host, port: c.port, security: c.security, username: c.username,
      password: null, from_address: c.from_address, from_name: c.from_name,
    });
    setClearPw(false);
    setDirty(false);
  }, []);

  useEffect(() => {
    guard(client.mailConfig()).then(apply).catch((e) => setError(toErr(e)));
  }, [client, guard, apply]);

  function set<K extends keyof MailConfigInput>(k: K, v: MailConfigInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
    setSaved(false);
  }

  const payload = (): MailConfigInput => ({ ...form, password: clearPw ? "" : form.password || null });

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy("save");
    setError(null);
    try {
      apply(await guard(client.saveMailConfig(payload())));
      setSaved(true);
      reload();                                  // gezinti: "Gelen e-postalar" bağlantısı moda göre
    } catch (err) {
      setError(toErr(err));
    } finally {
      setBusy("");
    }
  }

  async function sendTest() {
    setBusy("test");
    setError(null);
    setTest(null);
    try {
      setTest(await guard(client.testMailConfig(payload(), testTo.trim() || null)));
      if (!dirty) setView(await guard(client.mailConfig()));
    } catch (err) {
      setError(toErr(err));
    } finally {
      setBusy("");
    }
  }

  if (!view) {
    return <div className="page-wrap">{error ? <ErrorLine error={error} /> : <p className="muted">Yükleniyor…</p>}</div>;
  }
  const c = view.config;
  const last = view.last_attempt;
  const userHint = form.enabled && form.username && !form.username.includes("@")
    && /(gmail|office365|outlook|yandex|titan|secureserver)\./i.test(form.host)
    ? "Bu sağlayıcıda kullanıcı adı tam e-posta adresi olmalı (ör. ad@gmail.com)" : null;
  return (
    <div className="page-wrap admin">
      <h1>E-posta sunucusu</h1>
      <p className="muted">
        floembi.app paylaşım, davet ve yetki e-postalarını bu sunucu üzerinden otomatik gönderir.
      </p>
      <div className={`status-banner ${view.source}${last?.status === "failed" ? " failing" : ""}`}>
        {view.source === "screen" && <>SMTP ayarı etkin: <strong>{c.host}:{c.port}</strong>.</>}
        {view.source === "env" && view.env && (
          <>Ortam değişkenlerindeki SMTP ayarı etkin: <strong>{view.env.host}:{view.env.port}</strong>.
            Bu ekranda ayarı etkinleştirirseniz o geçerli olur.</>
        )}
        {view.source !== "outbox" && !last && (
          <div className="small">Bu ayarla henüz e-posta gönderilmedi; aşağıdan test e-postası gönderin.</div>
        )}
        {view.source !== "outbox" && last && (
          <div className="small">
            {last.status === "sent" ? "✓ Son gönderim başarılı" : "⚠ Son gönderim başarısız"}
            {" "}({when(last.at)}, {last.kind === "test" ? "test e-postası" : "e-posta"} → {last.to})
            {last.error && <>: {last.error}</>}
          </div>
        )}
        {view.source === "outbox" && (
          <>Geliştirme modu: e-posta sunucusu ayarlı değil. E-postalar gönderilmez, sunucuda saklanır ve
            {" "}<strong>✉ Gelen e-postalar</strong> sayfasında görünür.</>
        )}
        {c.updated_at && <div className="muted small">Son değişiklik: {when(c.updated_at)}{c.updated_by ? ` · ${c.updated_by}` : ""}</div>}
      </div>

      <form className="form-card" onSubmit={save}>
        <label className="inline">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          E-postaları bu SMTP sunucusuyla gönder
        </label>
        <div className="presets">
          <span className="muted small">Hazır ayar:</span>
          {PRESETS.map((p) => (
            <button
              type="button" key={p.label} className="chip"
              onClick={() => {
                setForm((f) => ({ ...f, host: p.host, port: p.port, security: p.security, enabled: true }));
                setDirty(true);
                setNote(p.note ?? null);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        {note && <p className="hint">{note}</p>}
        <fieldset disabled={!form.enabled} className="grid2">
          <label className="span2">
            SMTP sunucusu
            <input value={form.host} placeholder="smtp.sirket.com" onChange={(e) => set("host", e.target.value)} />
          </label>
          <label>
            Port
            <input type="number" min={1} max={65535} value={form.port}
              onChange={(e) => set("port", Number(e.target.value) || 0)} />
          </label>
          <label>
            Güvenlik
            <select value={form.security} onChange={(e) => {
              const sec = e.target.value as MailConfigInput["security"];
              set("security", sec);
              set("port", sec === "ssl" ? 465 : sec === "starttls" ? 587 : form.port);
            }}>
              <option value="starttls">STARTTLS (587)</option>
              <option value="ssl">SSL/TLS (465)</option>
              <option value="none">Şifrelemesiz (yalnızca iç ağ / geliştirme)</option>
            </select>
          </label>
          <label>
            Kullanıcı adı
            <input value={form.username} autoComplete="off" placeholder="Boşsa kimlik doğrulama yapılmaz"
              onChange={(e) => set("username", e.target.value)} />
            {userHint && <span className="warn-text small">⚠ {userHint}</span>}
          </label>
          <label>
            Şifre
            <input
              type="password" autoComplete="new-password" value={form.password ?? ""} disabled={clearPw}
              placeholder={c.has_password ? "Kayıtlı · değiştirmek için yazın" : ""}
              onChange={(e) => set("password", e.target.value)}
            />
            {c.has_password && (
              <span className="inline small">
                <input type="checkbox" checked={clearPw} onChange={(e) => { setClearPw(e.target.checked); setDirty(true); }} />
                Kayıtlı şifreyi sil
              </span>
            )}
          </label>
          <label>
            Gönderen adresi
            <input type="email" value={form.from_address} placeholder="bi@sirket.com"
              onChange={(e) => set("from_address", e.target.value)} />
          </label>
          <label>
            Gönderen adı
            <input value={form.from_name} onChange={(e) => set("from_name", e.target.value)} />
          </label>
        </fieldset>
        <p className="hint">
          Şifre sunucuda şifrelenmiş olarak saklanır ve bu ekrana geri gönderilmez. E-postalarda gönderen adı,
          işlemi yapan kişinin adıyla görünür (ör. “Ayşe Yılmaz (floembi.app)”). E-postalardaki bağlantılar
          {" "}<code>{view.public_url}</code> adresini kullanır.
        </p>
        {error && <ErrorLine error={error} />}
        <div className="form-actions">
          <button className="primary" disabled={busy !== "" || !dirty}>
            {busy === "save" ? "Kaydediliyor…" : "Kaydet"}
          </button>
          {saved && !dirty && <span className="ok-text">✓ Kaydedildi</span>}
        </div>
      </form>

      <section className="form-card">
        <h2>Test e-postası</h2>
        <p className="hint">Ekrandaki ayarla (kaydetmeden de) bir test e-postası gönderir.</p>
        <div className="row">
          <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label="Test alıcısı" />
          <button type="button" onClick={() => void sendTest()} disabled={busy !== ""}>
            {busy === "test" ? "Gönderiliyor…" : "Test e-postası gönder"}
          </button>
        </div>
        {test && (
          <ul className="share-results">
            <li className={test.status === "failed" ? "bad" : "ok"}>
              <span aria-hidden>{test.status === "failed" ? "⚠" : "✓"}</span>
              <span>
                <strong>{test.to}</strong>: {test.status === "sent" ? "e-posta sunucusu kabul etti; gelen kutusunu kontrol edin"
                  : test.status === "outbox" ? "giden kutusuna yazıldı (SMTP kapalı)" : test.error}
                {test.detail && <div className="muted small">{test.detail}</div>}
              </span>
            </li>
          </ul>
        )}
      </section>
    </div>
  );
}

// ================================================================== Kullanıcılar ve yetkilendirme
const GRANT_TEXT: Record<GrantResult["status"], string> = {
  granted: "Eklendi",
  updated: "Rolü değişti",
  unchanged: "Değişiklik yok",
  invited: "Hesabı yok, davet gönderildi",
  invalid: "Geçersiz adres",
  last_admin: "Son Yönetici",
};

export function UsersPage() {
  const { client, guard, user, reload } = useSession();
  const [data, setData] = useState<AdminUsers | null>(null);
  const [error, setError] = useState<Err | null>(null);
  const [emails, setEmails] = useState("");
  const [wid, setWid] = useState<number | "">("");
  const [role, setRole] = useState<WorkspaceRole>("viewer");
  const [message, setMessage] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<GrantResult[] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    guard(client.adminUsers())
      .then((d) => {
        setData(d);
        setWid((w) => (w === "" && d.workspaces.length ? d.workspaces[0].id : w));
      })
      .catch((e) => setError(toErr(e)));
  }, [client, guard]);
  useEffect(load, [load]);

  async function act(p: Promise<unknown>, ok?: string) {
    setError(null);
    setFlash(null);
    try {
      const r = await guard(p);
      const failed = r && typeof r === "object" && "status" in r && (r as MailSendResult).status === "failed";
      if (failed) setError({ message: (r as MailSendResult).error ?? "E-posta gönderilemedi", detail: (r as MailSendResult).detail ?? undefined });
      else if (ok) setFlash(ok);
      load();
      reload();
    } catch (e) {
      setError(toErr(e));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const list = emails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!list.length || wid === "") {
      setError({ message: "En az bir e-posta adresi yazın ve çalışma alanı seçin" });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await guard(client.grant(list, wid, role, message.trim() || null, notify));
      setResults(r.results);
      if (r.results.every((x) => !["invalid", "last_admin"].includes(x.status) && x.mail !== "failed")) setEmails("");
      load();
      reload();
    } catch (err) {
      setError(toErr(err));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <div className="page-wrap">{error ? <ErrorLine error={error} /> : <p className="muted">Yükleniyor…</p>}</div>;
  }
  return (
    <div className="page-wrap admin">
      <h1>Kullanıcılar ve yetkilendirme</h1>
      <p className="muted">
        E-posta adresine çalışma alanı rolü verin; floembi.app kişiye otomatik e-posta gönderir. Hesabı olmayan
        adrese davet gider: kişi bağlantıdan adını ve şifresini belirler, hesabı açılınca yetkisi hemen geçerli olur.
      </p>
      {data.mail_mode === "outbox" && (
        <p className="hint">
          E-posta sunucusu ayarlı değil: e-postalar <strong>✉ Gelen e-postalar</strong> sayfasına yazılır.
          {" "}<a href="/admin/mail" onClick={(e) => { e.preventDefault(); navigate("/admin/mail"); }}>E-posta sunucusunu ayarla</a>
        </p>
      )}

      <form className="form-card" onSubmit={submit}>
        <h2>Yetki ver</h2>
        <div className="grid2">
          <label className="span2">
            E-posta adresleri
            <input value={emails} placeholder="ad@sirket.com, ikinci@sirket.com" onChange={(e) => setEmails(e.target.value)} />
          </label>
          <label>
            Çalışma alanı
            <select value={wid} onChange={(e) => setWid(Number(e.target.value))}>
              {data.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label>
            Rol
            <select value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)}>
              {data.roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <label className="span2">
            Mesaj (isteğe bağlı, davet e-postasında görünür)
            <textarea rows={2} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
        </div>
        <label className="inline">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Hesabı olanlara “erişim verildi” e-postası gönder (davet e-postası her zaman gider)
        </label>
        <p className="hint">
          İzleyici: raporları görür · Katkıda bulunan: yayımlar ve yeniler · Üye: ayrıca paylaşır · Yönetici: ayrıca
          çalışma alanını yönetir.
        </p>
        <div className="form-actions">
          <button className="primary" disabled={busy}>{busy ? "Gönderiliyor…" : "Yetki ver"}</button>
        </div>
        {results && (
          <ul className="share-results">
            {results.map((r) => {
              const ok = !["invalid", "last_admin"].includes(r.status) && r.mail !== "failed";
              return (
                <li key={r.email} className={ok ? "ok" : "bad"}>
                  <span aria-hidden>{ok ? "✓" : "⚠"}</span>
                  <span>
                    <strong>{r.email}</strong>: {r.status === "invited" || r.status === "invalid" ? GRANT_TEXT[r.status] : r.message}
                    {MAIL_TEXT[r.mail] && `, ${MAIL_TEXT[r.mail]}`}
                    {r.mail_error && <span className="muted"> ({r.mail_error})</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </form>

      {error && <ErrorLine error={error} />}
      {flash && <p className="ok-text">✓ {flash}</p>}

      <h2>Kullanıcılar</h2>
      <table className="items compact">
        <thead>
          <tr><th>Kullanıcı</th><th>Çalışma alanı rolleri</th><th>Sistem yöneticisi</th></tr>
        </thead>
        <tbody>
          {data.users.map((u) => (
            <tr key={u.id} className="static">
              <td>{u.name}<div className="muted small">{u.email}</div></td>
              <td>
                {u.workspaces.length === 0 && <span className="muted">Üyelik yok (yalnızca paylaşılan raporlar)</span>}
                {u.workspaces.map((w) => (
                  <div key={w.workspace_id} className="member-role">
                    <span>{w.workspace}</span>
                    <select
                      value={w.role} aria-label={`${w.workspace} rolü`}
                      onChange={(e) => void act(client.setMemberRole(u.id, w.workspace_id, e.target.value as WorkspaceRole), "Rol değişti")}
                    >
                      {data.roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                    <button
                      className="link danger" title="Çalışma alanından çıkar"
                      onClick={() => void act(client.removeMember(u.id, w.workspace_id), "Çalışma alanından çıkarıldı")}
                    >
                      Çıkar
                    </button>
                  </div>
                ))}
              </td>
              <td>
                <label className="inline">
                  <input
                    type="checkbox" checked={u.is_admin} disabled={u.id === user?.id}
                    title={u.id === user?.id ? "Kendi yetkinizi kaldıramazsınız" : ""}
                    onChange={(e) => void act(client.setSystemAdmin(u.id, e.target.checked))}
                  />
                  {u.is_admin ? "Evet" : "Hayır"}
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Bekleyen davetler</h2>
      {data.invitations.length === 0 ? (
        <p className="muted">Bekleyen davet yok.</p>
      ) : (
        <table className="items compact">
          <thead>
            <tr><th>E-posta</th><th>Verilecek erişim</th><th>Davet eden</th><th>Geçerlilik</th><th /></tr>
          </thead>
          <tbody>
            {data.invitations.map((i) => (
              <tr key={i.id} className="static">
                <td>{i.email}</td>
                <td>{i.grants.map((g) => <div key={g}>{g}</div>)}</td>
                <td>{i.invited_by}<div className="muted small">{when(i.created_at)}</div></td>
                <td>{i.expired ? <span className="bad-text">Süresi doldu</span> : when(i.expires_at)}</td>
                <td className="actions">
                  <button className="link" onClick={() => void act(client.resendInvitation(i.id), `Davet yeniden gönderildi: ${i.email}`)}>
                    Yeniden gönder
                  </button>
                  <button className="link danger" onClick={() => void act(client.revokeInvitation(i.id), `Davet iptal edildi: ${i.email}`)}>
                    İptal et
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ================================================================== Davet kabulü (oturumsuz)
export function InvitePage({ token }: { token: string }) {
  const { client, user, adopt } = useSession();
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [error, setError] = useState<Err | null>(null);
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    client.invitation(token).then(setInfo).catch((e) => setError(toErr(e)));
  }, [client, token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setFormError("Şifre en az 8 karakter olmalı");
    if (pw !== pw2) return setFormError("Şifreler aynı değil");
    setBusy(true);
    setFormError(null);
    try {
      const r = await client.acceptInvitation(token, name.trim(), pw);
      adopt(r.token, r.user);
      navigate("/");
    } catch (err) {
      setFormError(toErr(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-lg">floembi.app</div>
        {error && (
          <>
            <h1>Davet açılamadı</h1>
            <ErrorLine error={error} />
            <button type="button" className="link" onClick={() => navigate("/")}>Oturum açma sayfasına git</button>
          </>
        )}
        {!error && !info && <p className="muted">Davet yükleniyor…</p>}
        {info && (
          <>
            <h1>Hesabınızı oluşturun</h1>
            <p className="muted">
              {info.inviter ? <><strong>{info.inviter}</strong> sizi davet etti. </> : null}
              Hesabınız <strong>{info.email}</strong> adresiyle açılacak.
            </p>
            {info.grants.length > 0 && (
              <ul className="grant-list">
                {info.grants.map((g) => <li key={g}>{g}</li>)}
              </ul>
            )}
            {user && (
              <p className="hint">
                Şu an {user.email} olarak oturumunuz açık; daveti kabul edince yeni hesapla oturum açılır.
              </p>
            )}
            <label>
              Adınız soyadınız
              <input value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} required maxLength={120} />
            </label>
            <label>
              Şifre (en az 8 karakter)
              <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
            </label>
            <label>
              Şifre (tekrar)
              <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
            </label>
            {formError && <div className="error-box" role="alert"><strong>{formError}</strong></div>}
            <button className="primary" disabled={busy}>{busy ? "Hesap açılıyor…" : "Hesabı oluştur ve oturum aç"}</button>
            <p className="hint">Davet bağlantısı {when(info.expires_at)} tarihine kadar geçerlidir ve tek kullanımlıktır.</p>
          </>
        )}
      </form>
    </div>
  );
}
