import {
  FloemApiError, type PublishedReport, type SharedReport, type VisualQuery, type WorkspaceContent,
} from "@floem/client";
import { ReportViewer } from "@floem/report";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, SessionProvider, navigate, usePath, useSession } from "./session";

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
  const { user } = useSession();
  const path = usePath();
  if (!user) return <Login />;
  let page = <Home />;
  let m: RegExpExecArray | null;
  if ((m = /^\/reports\/(\d+)/.exec(path))) page = <ReportPage id={Number(m[1])} key={m[1]} />;
  else if ((m = /^\/workspaces\/(\d+)/.exec(path))) page = <WorkspacePage id={Number(m[1])} key={m[1]} />;
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
  const { user, workspaces, logout } = useSession();
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
        <div className="nav-section">Çalışma alanları</div>
        {workspaces.map((w) => (
          <Link key={w.id} to={`/workspaces/${w.id}`} className={path === `/workspaces/${w.id}` ? "active" : ""}>
            ▣ {w.name}
          </Link>
        ))}
        {workspaces.length === 0 && <span className="muted pad">Üye olduğunuz çalışma alanı yok</span>}
      </nav>
      <main className="content">{children}</main>
    </div>
  );
}

// ------------------------------------------------------------------ giriş sayfası
function Home() {
  const { client, guard, workspaces, user } = useSession();
  const [shared, setShared] = useState<SharedReport[] | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  useEffect(() => {
    guard(client.sharedWithMe()).then(setShared).catch((e) => setError(toUiError(e)));
  }, [client, guard]);
  return (
    <div className="page-wrap">
      <h1>Merhaba, {user?.name}</h1>
      {error && <ErrorPanel error={error} />}
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
      <section>
        <h2>Çalışma alanlarım</h2>
        {workspaces.length === 0 ? (
          <p className="muted">Hiçbir çalışma alanına üye değilsiniz. Raporlar sizinle paylaşıldığında yukarıda görünür.</p>
        ) : (
          <div className="tiles">
            {workspaces.map((w) => (
              <Link key={w.id} to={`/workspaces/${w.id}`} className="tile">
                <strong>{w.name}</strong>
                <span className="muted">Rolünüz: {w.role_label}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
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
  return (
    <div className="page-wrap">
      <h1>{data.workspace.name}</h1>
      <p className="muted">Rolünüz: {data.workspace.role_label}</p>
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
                className={it.kind === "Rapor" ? "" : "static"}
                onClick={it.kind === "Rapor" ? () => navigate(`/reports/${it.id}`) : undefined}
              >
                <td><span className={it.kind === "Rapor" ? "ico-report" : "ico-dataset"} aria-hidden /> {it.name}</td>
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

// ------------------------------------------------------------------ rapor
function ReportPage({ id }: { id: number }) {
  const { client, guard } = useSession();
  const [report, setReport] = useState<PublishedReport | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [rev, setRev] = useState(0);

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
        <span className="role">{report.role_label}</span>
        <button onClick={load} title="Raporu ve veriyi yeniden yükle">⟳ Yenile</button>
      </div>
      <div className="report-body">
        <ReportViewer report={report.definition} run={run} dataRev={`${report.dataset.version}:${rev}`} />
      </div>
    </div>
  );
}
