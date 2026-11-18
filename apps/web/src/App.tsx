import {
  FloemApiError, type DatasetBindings, type DatasetDetails, type GatewaySource, type GatewaySourceStatus, type RefreshRun,
  type PublishedReport, type SharedReport, type VisualQuery, type WorkspaceContent,
} from "@floem/client";
import { InboxPage, ShareDialog } from "./share";
import { InvitePage, MailSettingsPage, UsersPage } from "./admin";
import { SecurityPage } from "./security";
import { AppSetupPage, AppTiles, AppViewerPage, AppsPage } from "./apps";
import type { AppListItem } from "@floem/client";
import { ReportViewer } from "@floem/report";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, SessionProvider, navigate, useLive, usePath, useSession } from "./session";

export function App() {
  return (
    <SessionProvider>
      <Router />
    </SessionProvider>
  );
}

interface UiError {
  status?: number;
  message: string;
  detail?: string;
}

function toUiError(e: unknown): UiError {
  if (e instanceof FloemApiError) return { status: e.status, message: e.message, detail: e.detail };
  return { message: "Beklenmeyen hata", detail: String(e) };
}

const dateFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });
const when = (iso: string) => dateFmt.format(new Date(iso));

function ErrorPanel({ error }: { error: UiError }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="error-box" role="alert">
      <strong>{error.status === 403 ? "Yetkiniz yok: " : ""}{error.message}</strong>
      {error.detail && (
        <>
          <button className="link" onClick={() => setOpen(!open)}>
            {open ? "Ayrıntıları gizle" : "Ayrıntılar"}
          </button>
          {open && <pre>{error.detail}</pre>}
        </>
      )}
    </div>
  );
}

function Router() {
  const { user, isAdmin } = useSession();
  const path = usePath();
  const invite = /^\/invite\/([A-Za-z0-9_-]+)$/.exec(path);
  if (invite) return <InvitePage token={invite[1]} key={invite[1]} />;   // oturumsuz açılır
  if (!user) return <Login />;
  let page = <Home />;
  let m: RegExpExecArray | null;
  if ((m = /^\/reports\/(\d+)/.exec(path))) page = <ReportPage id={Number(m[1])} key={m[1]} />;
  else if (path === "/apps") page = <AppsPage />;
  else if ((m = /^\/apps\/(\d+)(?:\/(\d+))?$/.exec(path))) {
    return <Shell><AppViewerPage id={Number(m[1])} itemId={m[2] ? Number(m[2]) : null} key={m[1]} /></Shell>;
  }
  else if ((m = /^\/workspaces\/(\d+)\/app$/.exec(path))) page = <AppSetupPage workspaceId={Number(m[1])} key={m[1]} />;
  else if ((m = /^\/datasets\/(\d+)\/security$/.exec(path))) page = <SecurityPage id={Number(m[1])} key={m[1]} />;
  else if ((m = /^\/datasets\/(\d+)\/refresh$/.exec(path))) page = <DatasetRefreshPage id={Number(m[1])} key={m[1]} />;
  else if ((m = /^\/workspaces\/(\d+)\/gateways$/.exec(path))) page = <GatewayPage id={Number(m[1])} key={m[1]} />;
  else if ((m = /^\/workspaces\/(\d+)/.exec(path))) page = <WorkspacePage id={Number(m[1])} key={m[1]} />;
  else if (path === "/inbox") page = <InboxPage />;
  else if (path === "/admin/mail" && isAdmin) page = <MailSettingsPage />;
  else if (path === "/admin/users" && isAdmin) page = <UsersPage />;
  return <Shell>{page}</Shell>;
}

// ------------------------------------------------------------------ giriş
function Login() {
  const { login } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const local = ["127.0.0.1", "localhost"].includes(window.location.hostname);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(toUiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-lg">floembi.app</div>
        <h1>Oturum açın</h1>
        <label>
          E-posta
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Şifre
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <ErrorPanel error={error} />}
        <button className="primary" disabled={busy}>
          {busy ? "Giriş yapılıyor…" : "Oturum aç"}
        </button>
        {local && (
          <div className="dev-users">
            <strong>Geliştirme kullanıcıları</strong>
            <button type="button" className="link" onClick={() => { setEmail("yonetici@floembi.test"); setPassword("Floem.Yonetici1"); }}>
              yonetici@floembi.test · Yönetici
            </button>
            <button type="button" className="link" onClick={() => { setEmail("izleyici@floembi.test"); setPassword("Floem.Izleyici1"); }}>
              izleyici@floembi.test · İzleyici
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ kabuk
function Shell({ children }: { children: React.ReactNode }) {
  const { user, workspaces, logout, mailMode, isAdmin } = useSession();
  const path = usePath();
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">floembi.app</Link>
        <span className="spacer" />
        <span className="who">{user?.name} · {user?.email}</span>
        <button className="link light" onClick={logout}>Çıkış</button>
      </header>
      <nav className="sidenav" aria-label="Gezinti">
        <Link to="/" className={path === "/" ? "active" : ""}>⌂ Giriş</Link>
        <Link to="/apps" className={path.startsWith("/apps") ? "active" : ""}>▦ Uygulamalar</Link>
        {mailMode === "outbox" && (
          <Link to="/inbox" className={path === "/inbox" ? "active" : ""}>✉ Gelen e-postalar</Link>
        )}
        {workspaces.length > 0 && <div className="nav-section">Çalışma alanları</div>}
        {workspaces.map((w) => (
          <Link key={w.id} to={`/workspaces/${w.id}`} className={path === `/workspaces/${w.id}` ? "active" : ""}>
            ▣ {w.name}
          </Link>
        ))}
        {isAdmin && (
          <>
            <div className="nav-section">Yönetim</div>
            <Link to="/admin/users" className={path === "/admin/users" ? "active" : ""}>👥 Kullanıcılar</Link>
            <Link to="/admin/mail" className={path === "/admin/mail" ? "active" : ""}>⚙ E-posta sunucusu</Link>
          </>
        )}
      </nav>
      <main className="content">{children}</main>
    </div>
  );
}

// ------------------------------------------------------------------ giriş sayfası
function Home() {
  const { client, guard, workspaces, user } = useSession();
  const [shared, setShared] = useState<SharedReport[] | null>(null);
  const [apps, setApps] = useState<AppListItem[]>([]);
  const [error, setError] = useState<UiError | null>(null);
  useEffect(() => {
    guard(client.sharedWithMe()).then(setShared).catch((e) => setError(toUiError(e)));
    guard(client.apps()).then(setApps).catch((e) => setError(toUiError(e)));
  }, [client, guard]);
  return (
    <div className="page-wrap">
      <h1>Merhaba, {user?.name}</h1>
      {error && <ErrorPanel error={error} />}
      {apps.length > 0 && (
        <section>
          <h2>Uygulamalar</h2>
          <AppTiles apps={apps} />
        </section>
      )}
      <section>
        <h2>Benimle paylaşılanlar</h2>
        {shared && shared.length === 0 && <p className="muted">Henüz sizinle paylaşılan bir rapor yok.</p>}
        {shared && shared.length > 0 && (
          <table className="items">
            <thead>
              <tr><th>Ad</th><th>Çalışma alanı</th><th>Paylaşan</th><th>Son yayımlama</th></tr>
            </thead>
            <tbody>
              {shared.map((r) => (
                <tr key={r.id} onClick={() => navigate(`/reports/${r.id}`)}>
                  <td><span className="ico-report" aria-hidden /> {r.name}</td>
                  <td>{r.workspace}</td>
                  <td>{r.shared_by}</td>
                  <td>{when(r.published_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {workspaces.length === 0 ? (
        <p className="muted small">
          Size açılan uygulamalar ve raporlar yukarıda görünür. Raporları hazırlayıp yayımlamak için bir çalışma
          alanına üye olmanız gerekir; bunu sistem yöneticiniz verir.
        </p>
      ) : (
      <section>
        <h2>Çalışma alanlarım</h2>
        <div className="tiles">
          {workspaces.map((w) => (
            <Link key={w.id} to={`/workspaces/${w.id}`} className="tile">
              <strong>{w.name}</strong>
              <span className="muted">Rolünüz: {w.role_label}</span>
            </Link>
          ))}
        </div>
      </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ çalışma alanı
function WorkspacePage({ id }: { id: number }) {
  const { client, guard } = useSession();
  const [data, setData] = useState<WorkspaceContent | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  useEffect(() => {
    guard(client.content(id)).then(setData).catch((e) => setError(toUiError(e)));
  }, [client, guard, id]);
  if (error) return <div className="page-wrap"><ErrorPanel error={error} /></div>;
  if (!data) return <div className="page-wrap muted">Yükleniyor…</div>;
  const items = [
    ...data.reports.map((r) => ({ ...r, kind: "Rapor" as const })),
    ...data.datasets.map((d) => ({ ...d, kind: "Anlam modeli" as const })),
  ];
  const canManage = data.workspace.role === "admin" || data.workspace.role === "member";
  const open = (it: (typeof items)[number]) => {
    if (it.kind === "Rapor") navigate(`/reports/${it.id}`);
    else if (canManage) navigate(`/datasets/${it.id}/refresh`);
  };
  return (
    <div className="page-wrap">
      <div className="ws-head">
        <h1>{data.workspace.name}</h1>
        {canManage && <Link to={`/workspaces/${id}/gateways`} className="button">Floemway</Link>}
        <span className="spacer" />
        {data.app && (
          <Link to={`/apps/${data.app.id}`} className="button">▦ Uygulamayı aç</Link>
        )}
        {canManage && data.reports.length > 0 && (
          <Link to={`/workspaces/${data.workspace.id}/app`} className={`button${data.app?.outdated ? " primary" : ""}`}>
            {data.app ? (data.app.outdated ? "⟳ Uygulamayı güncelle" : "✎ Uygulamayı düzenle") : "＋ Uygulama oluştur"}
          </Link>
        )}
      </div>
      <p className="muted">
        Rolünüz: {data.workspace.role_label}
        {data.app && <> · Uygulama yayında: <strong>{data.app.name}</strong> (sürüm {data.app.version})
          {data.app.outdated && <span className="warn-text"> · raporlarda yayımlanmamış değişiklik var</span>}</>}
      </p>
      {items.length === 0 ? (
        <div className="empty">
          <p>Bu çalışma alanında henüz içerik yok.</p>
          <p className="muted">Floem BI Desktop'ta raporu kaydedin ve <strong>Yayımla</strong> düğmesiyle bu çalışma alanını seçin.</p>
        </div>
      ) : (
        <table className="items">
          <thead>
            <tr><th>Ad</th><th>Tür</th><th>Sahibi</th><th>Son yayımlama</th><th>Sürüm</th></tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={`${it.kind}-${it.id}`}
                className={it.kind === "Rapor" || canManage ? "" : "static"}
                onClick={() => open(it)}
                title={it.kind === "Rapor" ? undefined : canManage ? "Anlam modeli ayarları" : undefined}
              >
                <td>
                  <span className={it.kind === "Rapor" ? "ico-report" : "ico-dataset"} aria-hidden /> {it.name}
                  {it.kind !== "Rapor" && canManage && <span className="muted small"> · Yenileme ve güvenlik</span>}
                  {it.kind === "Anlam modeli" && it.gateway_source_count > 0 &&
                    <span className={it.gateway_ready ? "ok-text small" : "warn-text small"}>
                      {it.gateway_ready ? " · Floemway hazır" : " · Floemway bağlantısı bekliyor"}
                    </span>}
                </td>
                <td>{it.kind}</td>
                <td>{it.published_by}</td>
                <td>{when(it.published_at)}</td>
                <td>{it.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function GatewayPage({ id }: { id: number }) {
  const { client, guard } = useSession();
  const [items, setItems] = useState<import("@floem/client").GatewayInfo[]>([]);
  const [sources, setSources] = useState<GatewaySource[]>([]);
  const [publishedSources, setPublishedSources] = useState<GatewaySourceStatus[]>([]);
  const [name, setName] = useState("");
  const [source, setSource] = useState({ gateway_id: 0, server: "", database: "", username: "", password: "" });
  const [enrollment, setEnrollment] = useState<import("@floem/client").GatewayEnrollment | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [saved, setSaved] = useState("");
  const load = useCallback(() => Promise.all([guard(client.gateways(id)), guard(client.gatewaySources(id)), guard(client.sourceStatus(id))])
    .then(([g, s, p]) => { setItems(g); setSources(s); setPublishedSources(p); }).catch((e) => setError(toUiError(e))), [client, guard, id]);
  useEffect(() => { load(); const timer = setInterval(load, 15000); return () => clearInterval(timer); }, [load]);
  async function create(e: FormEvent) {
    e.preventDefault(); setError(null);
    try { setEnrollment(await guard(client.createGateway(id, name))); setName(""); await load(); }
    catch (e) { setError(toUiError(e)); }
  }
  async function saveSource(e: FormEvent) {
    e.preventDefault(); setError(null); setSaved("");
    try {
      await guard(client.saveGatewaySource(source));
      setSource({ ...source, password: "" });
      setSaved("Bağlantı kaydedildi. Şifre yalnızca Floemway tarafından çözülebilir.");
      await load();
    } catch (err) { setError(toUiError(err)); }
  }
  const command = enrollment && `python -m floem_bi.gateway --server ${window.location.origin} --id ${enrollment.id} --token ${enrollment.registration_token}`;
  return <div className="page-wrap">
    <p><Link to={`/workspaces/${id}`}>← Çalışma alanı</Link></p>
    <h1>Floemway</h1>
    <p className="muted">Floemway, şirket ağındaki ayrı bir servistir. floembi.app'e dışa doğru bağlanır; Desktop'ta kayıtlı SQL bağlantıları yayımlama sırasında otomatik eşlenir.</p>
    {error && <ErrorPanel error={error} />}
    <form className="inline-form" onSubmit={create}>
      <label>Floemway adı<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></label>
      <button className="primary">Kayıt anahtarı oluştur</button>
    </form>
    {enrollment && <section><h2>{enrollment.name}: tek kullanımlık kayıt</h2>
      <p>Bu anahtar 15 dakika geçerlidir ve yalnızca şimdi gösterilir.</p><pre>{command}</pre>
      <button className="link" onClick={() => command && navigator.clipboard.writeText(command)}>Komutu kopyala</button>
      <button className="link" onClick={() => setEnrollment(null)}>Gizle</button>
    </section>}
    <table className="items"><thead><tr><th>Ad</th><th>Durum</th><th>Son bağlantı</th></tr></thead><tbody>
      {items.map((g) => <tr key={g.id}><td>{g.name}</td><td>{g.online ? "Çevrimiçi" : g.registered ? "Çevrimdışı" : "Kayıt bekliyor"}</td><td>{g.last_seen ? when(g.last_seen) : "Henüz bağlanmadı"}</td></tr>)}
      {items.length === 0 && <tr><td colSpan={3} className="muted">Henüz Floemway yok.</td></tr>}
    </tbody></table>
    <h2>Yayımlanan veri kaynakları</h2>
    <p className="hint">Desktop'tan yayımlanan bağlantılar burada görünür. Hazır durumu, Floemway bağlantı eşlemesini gösterir.</p>
    <table className="items"><thead><tr><th>Anlam modeli</th><th>Sunucu</th><th>Veritabanı</th><th>SQL kullanıcısı</th><th>Floemway</th><th>Durum</th></tr></thead><tbody>
      {publishedSources.map((s) => <tr key={`${s.dataset_id}-${s.source_key}`} className="static">
        <td>{s.dataset_name}</td><td>{s.server}</td><td>{s.database}</td><td>{s.username}</td>
        <td>{s.gateway_name ?? "—"}</td><td className={s.ready ? "ok-text" : "warn-text"}>{s.ready ? "Hazır" : "Bağlantı bekliyor"}</td>
      </tr>)}
      {publishedSources.length === 0 && <tr><td colSpan={6} className="muted">Henüz yayımlanmış kaynak bağlantısı yok.</td></tr>}
    </tbody></table>
    <section className="form-card gateway-form">
      <h2>Elle SQL Server bağlantısı</h2>
      <p className="hint">Desktop'tan otomatik eşlenmeyen bir kaynak için bağlantıyı burada tamamlayabilirsiniz.</p>
      <form onSubmit={saveSource} className="gateway-fields">
        <label>Floemway<select value={source.gateway_id} onChange={(e) => setSource({ ...source, gateway_id: Number(e.target.value) })} required>
          <option value={0}>Seçin</option>{items.filter((g) => g.registered).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select></label>
        <label>Sunucu<input value={source.server} onChange={(e) => setSource({ ...source, server: e.target.value })} required /></label>
        <label>Veritabanı<input value={source.database} onChange={(e) => setSource({ ...source, database: e.target.value })} required /></label>
        <label>SQL kullanıcısı<input value={source.username} onChange={(e) => setSource({ ...source, username: e.target.value })} required /></label>
        <label>Şifre<input type="password" autoComplete="new-password" value={source.password} onChange={(e) => setSource({ ...source, password: e.target.value })} required /></label>
        <button className="primary" disabled={!source.gateway_id}>Bağlantıyı kaydet</button>
      </form>
      {saved && <p className="ok-text" role="status">{saved}</p>}
    </section>
    <h2>Kaydedilen bağlantılar</h2>
    <table className="items"><thead><tr><th>Floemway</th><th>Sunucu</th><th>Veritabanı</th><th>Kullanıcı</th></tr></thead><tbody>
      {sources.map((s) => <tr key={s.id} className="static"><td>{s.gateway_name}</td><td>{s.server}</td><td>{s.database}</td><td>{s.username}</td></tr>)}
      {sources.length === 0 && <tr><td colSpan={4} className="muted">Henüz bağlantı tanımlanmadı.</td></tr>}
    </tbody></table>
  </div>;
}

function DatasetRefreshPage({ id }: { id: number }) {
  const { client, guard } = useSession();
  const [dataset, setDataset] = useState<DatasetDetails | null>(null);
  const [bindings, setBindings] = useState<DatasetBindings | null>(null);
  const [sources, setSources] = useState<GatewaySource[]>([]);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<RefreshRun[]>([]);
  const [error, setError] = useState<UiError | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);

  const loadHistory = useCallback(() => guard(client.refreshHistory(id)).then(setHistory)
    .catch((e) => setError(toUiError(e))), [client, guard, id]);
  useEffect(() => {
    guard(client.dataset(id)).then(async (d) => {
      setDataset(d);
      const [b, s] = await Promise.all([guard(client.datasetBindings(id)), guard(client.gatewaySources(d.workspace_id))]);
      setBindings(b); setSources(s);
      setSelected(Object.fromEntries(b.sources.map((x) => [x.id, x.binding_id ?? 0])));
    }).catch((e) => setError(toUiError(e)));
    void loadHistory();
    const timer = setInterval(() => { void loadHistory(); }, 5000);
    return () => clearInterval(timer);
  }, [client, guard, id, loadHistory]);
  useLive((event) => {
    if (event.type === "dataset" && event.dataset_id === id) {
      void guard(client.dataset(id)).then(setDataset).catch((e) => setError(toUiError(e)));
      void loadHistory();
    }
  });

  async function saveBindings(e: FormEvent) {
    e.preventDefault(); setError(null); setSaved("");
    try {
      await guard(client.saveDatasetBindings(id, selected));
      setSaved("Veri kaynağı eşlemesi kaydedildi.");
    } catch (err) { setError(toUiError(err)); }
  }
  async function refresh() {
    setBusy(true); setError(null);
    try {
      await guard(client.refreshDataset(id));
      await loadHistory();
    } catch (err) { setError(toUiError(err)); }
    finally { setBusy(false); }
  }
  if (!dataset || !bindings) return <div className="page-wrap">{error ? <ErrorPanel error={error} /> : "Yükleniyor…"}</div>;
  return <div className="page-wrap dataset-refresh">
    <p><Link to={`/workspaces/${dataset.workspace_id}`}>← Çalışma alanı</Link></p>
    <div className="ws-head"><h1>{dataset.name}</h1><span className="spacer" />
      <Link className="button" to={`/datasets/${id}/security`}>Güvenlik</Link>
      <button className="primary" onClick={refresh} disabled={busy || history[0]?.status === "running" || history[0]?.status === "queued"}>
        {busy ? "Başlatılıyor…" : "⟳ Şimdi yenile"}
      </button>
    </div>
    <p className="muted">Anlam modeli sürümü {dataset.version}. Yenileme bitene kadar raporlar önceki veriyle çalışır.</p>
    {error && <ErrorPanel error={error} />}
    <section className="form-card">
      <h2>Floemway bağlantısı eşlemesi</h2>
      <p className="hint">Desktop'tan yayımlanan SQL bağlantıları otomatik eşlenir. Eksik kalan kaynakları burada tamamlayabilirsiniz.</p>
      <form onSubmit={saveBindings} className="gateway-fields">
        {bindings.sources.map((x) => {
          const matches = sources.filter((s) => s.server.toLowerCase() === x.server.toLowerCase() &&
            s.database.toLowerCase() === x.database.toLowerCase());
          return <label key={x.id}>{x.server} / {x.database}
            <select value={selected[x.id] ?? 0} onChange={(e) => setSelected({ ...selected, [x.id]: Number(e.target.value) })} required>
              <option value={0}>Floemway bağlantısı seçin</option>
              {matches.map((s) => <option key={s.id} value={s.id}>{s.gateway_name} · {s.username}</option>)}
            </select>
          </label>;
        })}
        {bindings.sources.length === 0 && <p>Bu anlam modelinde kaynak bağlantısı yok.</p>}
        <button className="primary" disabled={bindings.sources.length === 0 || bindings.sources.some((x) => !selected[x.id])}>Eşlemeyi kaydet</button>
      </form>
      {saved && <p className="ok-text" role="status">{saved}</p>}
      <p><Link to={`/workspaces/${dataset.workspace_id}/gateways`}>Floemway bağlantılarını yönet</Link></p>
    </section>
    <h2>Yenileme geçmişi</h2>
    <table className="items"><thead><tr><th>Başlangıç</th><th>Durum</th><th>Tablo / adım</th><th>Süre</th><th>Hata</th></tr></thead><tbody>
      {history.map((r) => <tr key={r.id} className="static">
        <td>{when(r.started_at)}</td>
        <td>{({ queued: "Kuyrukta", running: "Çalışıyor", succeeded: "Başarılı", failed: "Hata" })[r.status]}</td>
        <td>{r.table_name ? `${r.table_name} · ` : ""}{r.stage}</td>
        <td>{(r.elapsed_ms / 1000).toFixed(1)} sn</td>
        <td>{r.error && <><strong className="bad-text">{r.error.message}</strong>
          {r.error.detail && <details><summary>Ham hata</summary><pre>{r.error.detail}</pre></details>}</>}</td>
      </tr>)}
      {history.length === 0 && <tr><td colSpan={5} className="muted">Henüz yenileme yapılmadı.</td></tr>}
    </tbody></table>
  </div>;
}

// ------------------------------------------------------------------ rapor
function ReportPage({ id }: { id: number }) {
  const { client, guard } = useSession();
  const [report, setReport] = useState<PublishedReport | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [rev, setRev] = useState(0);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(() => {
    guard(client.report(id))
      .then((r) => {
        setReport(r);
        setRev((x) => x + 1);
      })
      .catch((e) => setError(toUiError(e)));
  }, [client, guard, id]);
  useEffect(load, [load]);

  const run = useCallback((q: VisualQuery) => guard(client.reportQuery(id, q)), [client, guard, id]);

  // Anlık güncelleme: rapor yeniden yayımlanınca açık ekran kendiliğinden yenilenir
  const [notice, setNotice] = useState<string | null>(null);
  useLive((e) => {
    if (e.type === "report" && e.report_id === id) {
      load();
      setNotice(`Rapor güncellendi (sürüm ${e.version})`);
    } else if (e.type === "dataset" && e.dataset_id === report?.dataset.id) {
      load();
      setNotice("Veri güncellendi");
    }
  });
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  if (error) {
    return (
      <div className="page-wrap">
        <ErrorPanel error={error} />
        <Link to="/">← Giriş sayfasına dön</Link>
      </div>
    );
  }
  if (!report) return <div className="page-wrap muted">Rapor yükleniyor…</div>;
  return (
    <div className="report-page">
      <div className="report-bar">
        <div>
          <strong>{report.name}</strong>
          <span className="muted">
            {" "}· {report.workspace.name} · Son yayımlama {when(report.published_at)} ({report.published_by}) · sürüm {report.version}
          </span>
        </div>
        <span className="spacer" />
        {notice && <span className="live-note" role="status">⟳ {notice}</span>}
        {report.rls_roles && (
          <span className="role rls" title="Satır düzeyi güvenlik: yalnızca bu rollerin görebildiği veriyi görüyorsunuz">
            🔒 {report.rls_roles.join(", ")}
          </span>
        )}
        <span className="role">{report.role_label}</span>
        <button onClick={load} title="Raporu ve veriyi yeniden yükle">⟳ Yenile</button>
        {report.can_share && (
          <button className="primary" onClick={() => setSharing(true)} title="Raporu e-postayla paylaş">
            ⤴ Paylaş
          </button>
        )}
      </div>
      {sharing && <ShareDialog report={report} onClose={() => setSharing(false)} />}
      <div className="report-body">
        <ReportViewer report={report.definition} run={run} dataRev={`${report.dataset.version}:${rev}`} />
      </div>
    </div>
  );
}
