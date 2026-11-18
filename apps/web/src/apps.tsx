import {
  FloemApiError, type AppAdminView, type AppInfo, type AppItemInput, type AppItemView, type AppListItem, type ShareResult,
  type VisualQuery,
} from "@floem/client";
import { ReportViewer } from "@floem/report";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useLive, useSession } from "./session";

interface Err {
  message: string;
  detail?: string;
}

const toErr = (e: unknown): Err =>
  e instanceof FloemApiError ? { message: e.message, detail: e.detail } : { message: String(e) };

const dateFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });
const when = (iso: string) => dateFmt.format(new Date(iso));

function ErrorLine({ error }: { error: Err }) {
  return (
    <div className="error-box" role="alert">
      <strong>{error.message}</strong>
      {error.detail && <span className="small"> {error.detail}</span>}
    </div>
  );
}

const COLORS = ["#1f6feb", "#107c10", "#c239b3", "#d83b01", "#008272", "#5c2e91", "#323130"];

function AppIcon({ name, color, size = 40 }: { name: string; color: string; size?: number }) {
  return (
    <span className="app-icon" style={{ background: color, width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      {name.trim().charAt(0).toLocaleUpperCase("tr-TR") || "A"}
    </span>
  );
}

// ================================================================== Uygulamalar listesi
export function AppsPage() {
  const { client, guard } = useSession();
  const [apps, setApps] = useState<AppListItem[] | null>(null);
  const [error, setError] = useState<Err | null>(null);
  useEffect(() => {
    guard(client.apps()).then(setApps).catch((e) => setError(toErr(e)));
  }, [client, guard]);
  return (
    <div className="page-wrap">
      <h1>Uygulamalar</h1>
      {error && <ErrorLine error={error} />}
      {apps && apps.length === 0 && (
        <p className="muted">Size açılmış bir uygulama yok. Bir uygulamaya erişim verildiğinde burada görünür.</p>
      )}
      {apps && apps.length > 0 && <AppTiles apps={apps} />}
    </div>
  );
}

export function AppTiles({ apps }: { apps: AppListItem[] }) {
  return (
    <div className="tiles">
      {apps.map((a) => (
        <Link key={a.id} to={`/apps/${a.id}`} className="tile app-tile">
          <AppIcon name={a.name} color={a.color} />
          <span>
            <strong>{a.name}</strong>
            {a.description && <span className="muted small app-desc">{a.description}</span>}
            <span className="muted small">{a.workspace.name} · {a.items} rapor</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

// ================================================================== Uygulama görüntüleyici
export function AppViewerPage({ id, itemId }: { id: number; itemId: number | null }) {
  const { client, guard } = useSession();
  const [app, setApp] = useState<AppInfo | null>(null);
  const [item, setItem] = useState<AppItemView | null>(null);
  const [error, setError] = useState<Err | null>(null);
  const [itemError, setItemError] = useState<Err | null>(null);
  const [rev, setRev] = useState(0);

  const [appRev, setAppRev] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    guard(client.app(id)).then(setApp).catch((e) => setError(toErr(e)));
  }, [client, guard, id, appRev]);

  const current = app ? (app.items.find((i) => i.id === itemId) ?? app.items[0] ?? null) : null;
  const load = useCallback(() => {
    if (!current) return;
    setItemError(null);
    guard(client.appItem(id, current.id))
      .then((v) => {
        setItem(v);
        setRev((x) => x + 1);
      })
      .catch((e) => {
        setItem(null);
        setItemError(toErr(e));
      });
  }, [client, guard, id, current]);
  useEffect(load, [load]);

  const run = useCallback(
    (q: VisualQuery) => guard(client.appItemQuery(id, current!.id, q)),
    [client, guard, id, current],
  );

  // Anlık güncelleme: App güncellenince menü ve rapor, veri yenilenince görseller yeniden yüklenir
  useLive((e) => {
    if (e.type === "app" && e.app_id === id) {
      if (e.removed) {
        setApp(null);
        setError({ message: "Bu uygulama yayından kaldırıldı ya da erişiminiz kalktı" });
        return;
      }
      setAppRev((x) => x + 1);
      setNotice(`Uygulama güncellendi (sürüm ${e.version})`);
    } else if ((e.type === "report" || e.type === "dataset") && item && e.dataset_id === item.dataset.id) {
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
        <ErrorLine error={error} />
        <Link to="/apps">← Uygulamalar</Link>
      </div>
    );
  }
  if (!app) return <div className="page-wrap muted">Uygulama yükleniyor…</div>;

  const sections: { name: string | null; items: AppInfo["items"] }[] = [];
  for (const it of app.items) {
    const last = sections[sections.length - 1];
    if (last && last.name === it.section) last.items.push(it);
    else sections.push({ name: it.section, items: [it] });
  }

  return (
    <div className="app-shell">
      <aside className="app-nav" style={{ borderTopColor: app.color }}>
        <div className="app-head">
          <AppIcon name={app.name} color={app.color} size={32} />
          <div>
            <strong>{app.name}</strong>
            <span className="muted small">Sürüm {app.version} · {when(app.published_at)}</span>
          </div>
        </div>
        {app.description && <p className="muted small app-about">{app.description}</p>}
        <nav aria-label="Uygulama içeriği">
          {sections.map((s, i) => (
            <div key={i}>
              {s.name && <div className="nav-section">{s.name}</div>}
              {s.items.map((it) => (
                <Link key={it.id} to={`/apps/${app.id}/${it.id}`} className={current?.id === it.id ? "active" : ""}>
                  <span className="ico-report" aria-hidden /> {it.title}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        {app.can_manage && (
          <Link to={`/workspaces/${app.workspace.id}/app`} className="app-edit">✎ Uygulamayı düzenle</Link>
        )}
      </aside>
      <section className="app-main">
        {itemError && <div className="page-wrap"><ErrorLine error={itemError} /></div>}
        {!current && <div className="page-wrap muted">Bu uygulamada rapor yok.</div>}
        {item && current && (
          <div className="report-page">
            <div className="report-bar">
              <div><strong>{item.title}</strong></div>
              <span className="spacer" />
              {notice && <span className="live-note" role="status">⟳ {notice}</span>}
              {item.rls_roles && (
                <span className="role rls" title="Satır düzeyi güvenlik: yalnızca bu rollerin görebildiği veriyi görüyorsunuz">
                  🔒 {item.rls_roles.join(", ")}
                </span>
              )}
              <button onClick={load} title="Veriyi yeniden yükle">⟳ Yenile</button>
            </div>
            <div className="report-body">
              <ReportViewer report={item.definition} run={run} dataRev={`${current.id}:${item.dataset.version}:${rev}`} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ================================================================== Uygulama kurulumu (Yönetici/Üye)
interface DraftItem extends AppItemInput {
  name: string;
}

export function AppSetupPage({ workspaceId }: { workspaceId: number }) {
  const { client, guard, workspaces } = useSession();
  const ws = workspaces.find((w) => w.id === workspaceId);
  const [view, setView] = useState<AppAdminView | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Err | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const adopt = useCallback((v: AppAdminView) => {
    setView(v);
    const names = new Map(v.reports.map((r) => [r.id, r.name]));
    if (v.app) {
      setName(v.app.name);
      setDescription(v.app.description ?? "");
      setColor(v.app.color);
      setItems(v.items.map((i) => ({ report_id: i.report_id, title: i.title, section: i.section ?? "", name: names.get(i.report_id) ?? "" })));
    } else {
      setName(ws?.name ?? "");
      setItems(v.reports.map((r) => ({ report_id: r.id, title: r.name, section: "", name: r.name })));
    }
  }, [ws]);

  useEffect(() => {
    guard(client.workspaceApp(workspaceId)).then(adopt).catch((e) => setError(toErr(e)));
  }, [client, guard, workspaceId, adopt]);

  const chosen = useMemo(() => new Set(items.map((i) => i.report_id)), [items]);

  if (!view) {
    return <div className="page-wrap">{error ? <ErrorLine error={error} /> : <p className="muted">Yükleniyor…</p>}</div>;
  }

  const toggle = (r: { id: number; name: string }) =>
    setItems((all) => (chosen.has(r.id)
      ? all.filter((i) => i.report_id !== r.id)
      : [...all, { report_id: r.id, title: r.name, section: "", name: r.name }]));
  const move = (idx: number, d: -1 | 1) =>
    setItems((all) => {
      const next = [...all];
      const j = idx + d;
      if (j < 0 || j >= next.length) return all;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  const patch = (idx: number, p: Partial<DraftItem>) => setItems((all) => all.map((it, i) => (i === idx ? { ...it, ...p } : it)));

  async function publish() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const v = await guard(client.publishApp(workspaceId, {
        name, description: description || null, color,
        items: items.map(({ report_id, title, section }) => ({ report_id, title, section })),
      }));
      adopt(v);
      setNotice(`Uygulama yayımlandı (sürüm ${v.app!.version}). İzleyiciler bu hâlini görür.`);
    } catch (e) {
      setError(toErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    if (!window.confirm("Uygulama yayından kaldırılsın mı? Erişim verilen kişiler uygulamayı artık göremez.")) return;
    try {
      adopt(await guard(client.unpublishApp(workspaceId)));
      setNotice("Uygulama yayından kaldırıldı.");
    } catch (e) {
      setError(toErr(e));
    }
  }

  const app = view.app;
  return (
    <div className="page-wrap app-setup">
      <p className="muted small">
        <Link to={`/workspaces/${workspaceId}`}>{ws?.name ?? "Çalışma alanı"}</Link> › Uygulama
      </p>
      <h1>{app ? "Uygulamayı güncelle" : "Uygulama oluştur"}</h1>
      <p className="muted">
        Uygulama, bu çalışma alanından seçtiğiniz raporları izleyicilere düzenli bir paket olarak açar. Yayımladığınız
        anki rapor tasarımı dondurulur; çalışma alanında raporu değiştirseniz de izleyiciler siz güncelleyene kadar
        eski hâlini görür. Veri her zaman günceldir.
      </p>
      {app && (
        <div className={`status-banner ${app.outdated ? "failing" : "screen"}`}>
          Yayında: <strong>{app.name}</strong>, sürüm {app.version} ({when(app.published_at)}, {app.published_by}).{" "}
          <Link to={`/apps/${app.id}`}>Uygulamayı aç</Link>
          {app.outdated && (
            <div className="small">⚠ Çalışma alanında daha yeni rapor sürümleri var; izleyicilere göndermek için “Uygulamayı güncelle”ye basın.</div>
          )}
        </div>
      )}
      {error && <ErrorLine error={error} />}
      {notice && <div className="status-banner screen">✓ {notice}</div>}

      <section className="form-card">
        <h2>Ayarlar</h2>
        <div className="grid2">
          <label>
            Uygulama adı
            <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Tema rengi
            <span className="colors">
              {COLORS.map((c) => (
                <button key={c} type="button" className={c === color ? "active" : ""} style={{ background: c }}
                  aria-label={`Renk ${c}`} onClick={() => setColor(c)} />
              ))}
            </span>
          </label>
        </div>
        <label>
          Açıklama
          <textarea rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Uygulamanın ne için olduğunu izleyicilere anlatın" />
        </label>
      </section>

      <section className="form-card">
        <h2>İçerik</h2>
        {view.reports.length === 0 ? (
          <p className="muted">Bu çalışma alanında rapor yok. Desktop'tan rapor yayımlayın.</p>
        ) : (
          <>
            <div className="app-pick">
              {view.reports.map((r) => (
                <label key={r.id} className="inline">
                  <input type="checkbox" checked={chosen.has(r.id)} onChange={() => toggle(r)} /> {r.name}
                </label>
              ))}
            </div>
            {items.length > 0 && (
              <table className="items app-items">
                <thead>
                  <tr><th /><th>Menüdeki başlık</th><th>Bölüm (isteğe bağlı)</th><th>Rapor</th><th /></tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const st = view.items.find((x) => x.report_id === it.report_id);
                    return (
                      <tr key={it.report_id} className="static">
                        <td className="order">
                          <button className="link" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Yukarı">▲</button>
                          <button className="link" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Aşağı">▼</button>
                        </td>
                        <td><input value={it.title ?? ""} onChange={(e) => patch(i, { title: e.target.value })} /></td>
                        <td><input value={it.section ?? ""} placeholder="ör. Satış" onChange={(e) => patch(i, { section: e.target.value })} /></td>
                        <td className="muted small">
                          {it.name}
                          {st && st.current_version !== null && st.current_version > st.report_version && (
                            <span className="warn-text"> · yeni sürüm var</span>
                          )}
                        </td>
                        <td><button className="link" onClick={() => toggle({ id: it.report_id, name: it.name })}>Çıkar</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
        <div className="actions">
          <button className="primary" disabled={busy || !name.trim() || items.length === 0} onClick={() => void publish()}>
            {busy ? "Yayımlanıyor…" : app ? "Uygulamayı güncelle" : "Uygulamayı yayımla"}
          </button>
          {app && <button onClick={() => void unpublish()}>Yayından kaldır</button>}
        </div>
      </section>

      {app && <AppAccess appId={app.id} view={view} onChange={adopt} />}
    </div>
  );
}

const STATUS_OK = new Set(["shared", "already", "member", "invited"]);

function AppAccess({ appId, view, onChange }: { appId: number; view: AppAdminView; onChange: (v: AppAdminView) => void }) {
  const { client, guard } = useSession();
  const [emails, setEmails] = useState("");
  const [message, setMessage] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ShareResult[] | null>(null);
  const [error, setError] = useState<Err | null>(null);

  async function grant(e: FormEvent) {
    e.preventDefault();
    const list = emails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!list.length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await guard(client.grantApp(appId, list, message.trim() || null, notify));
      setResults(r.results);
      onChange(r);
      setEmails("");
    } catch (err) {
      setError(toErr(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(p: Promise<AppAdminView>) {
    setError(null);
    try {
      onChange(await guard(p));
    } catch (err) {
      setError(toErr(err));
    }
  }

  return (
    <section className="form-card">
      <h2>Erişim</h2>
      <p className="muted small">
        Erişim verilen kişiler uygulamayı <strong>İzleyici</strong> olarak görür; çalışma alanını ve diğer içeriği görmez.
        Çalışma alanı üyeleri uygulamayı zaten görür. Modelde rol varsa satır düzeyi güvenlik burada da uygulanır.
      </p>
      <form onSubmit={grant}>
        <label>
          E-posta adresleri
          <textarea rows={2} value={emails} onChange={(e) => setEmails(e.target.value)}
            placeholder="ad@sirket.com, ikinci@sirket.com" />
        </label>
        <label>
          Mesaj (isteğe bağlı)
          <input value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <label className="inline">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Kişilere e-posta gönder
        </label>
        <div className="actions">
          <button className="primary" disabled={busy || !emails.trim()}>{busy ? "Veriliyor…" : "Erişim ver"}</button>
        </div>
      </form>
      {error && <ErrorLine error={error} />}
      {results && (
        <ul className="share-results">
          {results.map((r) => (
            <li key={r.email} className={STATUS_OK.has(r.status) ? "ok" : "bad"}>
              <strong>{r.email}</strong>: {r.message}
              {r.mail === "sent" && " · e-posta gönderildi"}
              {r.mail === "outbox" && " · e-posta giden kutusuna yazıldı"}
              {r.mail === "failed" && <span className="warn-text"> · e-posta gönderilemedi{r.mail_error ? `: ${r.mail_error}` : ""}</span>}
            </li>
          ))}
        </ul>
      )}
      <table className="items">
        <tbody>
          {view.access.map((a) => (
            <tr key={a.id} className="static">
              <td>{a.name}</td>
              <td className="muted">{a.email}</td>
              <td className="muted small">{a.granted_by} · {when(a.granted_at)}</td>
              <td className="right"><button className="link" onClick={() => void act(client.revokeApp(appId, a.id))}>Kaldır</button></td>
            </tr>
          ))}
          {view.pending.map((g) => (
            <tr key={`p${g.id}`} className="static">
              <td className="muted">Davet bekliyor</td>
              <td className="muted">{g.email}</td>
              <td className="muted small">{g.granted_by} · {when(g.granted_at)}</td>
              <td className="right"><button className="link" onClick={() => void act(client.cancelAppPending(appId, g.id))}>Geri al</button></td>
            </tr>
          ))}
          {view.access.length === 0 && view.pending.length === 0 && (
            <tr className="static"><td className="muted" colSpan={4}>Henüz kimseye erişim verilmedi.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

