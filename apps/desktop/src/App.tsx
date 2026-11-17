import type { ConnectResult, Connection, ImportItem } from "@floem/client";
import { useCallback, useEffect, useState } from "react";
import { ClientProvider, toUiError, useClient } from "./api";
import { ErrorBox } from "./components/ErrorBox";
import { GetDataDialog } from "./components/GetDataDialog";
import { JobDialog } from "./components/JobDialog";
import { PublishDialog } from "./components/PublishDialog";
import { Navigator, type SelectedObject } from "./components/Navigator";
import { SqlView } from "./components/SqlView";
import { DocumentProvider, useDocument } from "./document";
import { ModelView } from "./model/ModelView";
import { ReportView } from "./report/ReportView";

type View = "rapor" | "veri" | "model" | "sql";

const VIEWS: { id: View; label: string; icon: string; ready: boolean; note?: string }[] = [
  { id: "rapor", label: "Rapor görünümü", icon: "▤", ready: true },
  { id: "veri", label: "Tablo görünümü", icon: "▦", ready: false, note: "3. haftada" },
  { id: "model", label: "Model görünümü", icon: "⛁", ready: true },
  { id: "sql", label: "SQL sorgusu", icon: "⌨", ready: true },
];

export function App() {
  return (
    <ClientProvider>
      <DocumentProvider>
        <Shell />
      </DocumentProvider>
    </ClientProvider>
  );
}

function Shell() {
  const client = useClient();
  const { doc, save, open, newDocument, error, setError, job, trackJob } = useDocument();
  const [view, setView] = useState<View>("rapor");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [getData, setGetData] = useState(false);
  const [navigator, setNavigator] = useState<ConnectResult | null>(null);
  const [publishing, setPublishing] = useState(false);

  const refreshConnections = useCallback(() => {
    client.listConnections().then(setConnections).catch((e) => setError(toUiError(e)));
  }, [client, setError]);
  useEffect(refreshConnections, [refreshConnections]);
  useEffect(() => {
    window.floem?.getConfig().then((c) => {
      if (c.startView && VIEWS.some((v) => v.id === c.startView)) setView(c.startView as View);
    });
  }, []);

  const tableCount = doc?.model.tablolar.length ?? 0;
  const busy = job?.status === "running";

  async function reopen(c: Connection) {
    // Kayıtlı bağlantıyı Gezgin'de aç (şifre Windows'ta kayıtlı olmalı)
    try {
      const dbs = await client.databases(c.id);
      setNavigator({ ...c, databases: dbs, server_info: { version: "", edition: "", database: c.database ?? "", login: c.user ?? "" } });
    } catch (e) {
      setError(toUiError(e));
    }
  }

  async function startImport(connectionId: string, items: ImportItem[]) {
    try {
      trackJob(await client.startImport(connectionId, null, items));
      return true;
    } catch (e) {
      setError(toUiError(e));
      return false;
    }
  }

  async function loadFromNavigator(selection: SelectedObject[]) {
    if (!navigator) return;
    const ok = await startImport(
      navigator.id,
      selection.map((s) => ({ database: s.database, schema: s.schema, table: s.name })),
    );
    if (ok) setNavigator(null);
  }

  async function refresh(tables?: string[]) {
    try {
      trackJob(await client.startRefresh(tables));
    } catch (e) {
      setError(toUiError(e));
    }
  }

  return (
    <div className="app">
      <header className="titlebar">
        <span className="brand">Floem BI</span>
        <span className="doc">
          {doc?.name ?? "…"}
          {doc?.dirty && <span className="dirty" title="Kaydedilmemiş değişiklikler var"> ●</span>}
        </span>
        {doc?.path && <span className="doc-path">{doc.path}</span>}
      </header>

      <nav className="ribbon" aria-label="Giriş">
        <div className="ribbon-group">
          <button className="ribbon-btn" onClick={() => void newDocument()} title="Ctrl+N">
            <span className="ribbon-ico">＋</span>Yeni
          </button>
          <button className="ribbon-btn" onClick={() => void open()} title="Ctrl+O">
            <span className="ribbon-ico">📂</span>Aç
          </button>
          <button className="ribbon-btn" onClick={() => void save()} title="Ctrl+S" disabled={busy}>
            <span className="ribbon-ico">💾</span>Kaydet
          </button>
          <button className="ribbon-btn" onClick={() => void save(true)} title="Ctrl+Shift+S" disabled={busy}>
            <span className="ribbon-ico">✎</span>Farklı kaydet
          </button>
          <span className="ribbon-label">Dosya</span>
        </div>
        <div className="ribbon-group">
          <button className="ribbon-btn" onClick={() => setGetData(true)}>
            <span className="ribbon-ico">⛃</span>Veri al
          </button>
          <button className="ribbon-btn" onClick={() => setView("sql")}>
            <span className="ribbon-ico">⌨</span>SQL sorgusu
          </button>
          <button
            className="ribbon-btn"
            onClick={() => void refresh()}
            disabled={busy || !doc?.model.tablolar.some((t) => t.sorgu)}
            title="Tüm tabloları kaynaktan yeniden yükle"
          >
            <span className="ribbon-ico">⟳</span>Yenile
          </button>
          <span className="ribbon-label">Veri</span>
        </div>
        <div className="ribbon-group">
          <button
            className="ribbon-btn"
            onClick={() => setPublishing(true)}
            disabled={busy || tableCount === 0}
            title="Raporu floembi.app'te yayımla"
          >
            <span className="ribbon-ico">☁</span>Yayımla
          </button>
          <span className="ribbon-label">Paylaş</span>
        </div>
        <div className="ribbon-group">
          {connections.slice(0, 4).map((c) => (
            <button key={c.id} className="ribbon-btn small" onClick={() => reopen(c)} title="Gezgin'de aç">
              {c.server}
              <span className="muted">{c.auth === "windows" ? "Windows" : c.user}</span>
            </button>
          ))}
          {connections.length === 0 && <span className="muted pad">Henüz bağlantı yok</span>}
          <span className="ribbon-label">Son kaynaklar</span>
        </div>
      </nav>

      <div className="workspace">
        <nav className="view-rail" aria-label="Görünümler">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`rail-btn ${view === v.id ? "active" : ""}`}
              onClick={() => setView(v.id)}
              title={v.ready ? v.label : `${v.label} (${v.note})`}
            >
              {v.icon}
            </button>
          ))}
        </nav>
        <main className="canvas">
          {error && (
            <div className="floating-error">
              <ErrorBox error={error} onClose={() => setError(null)} />
            </div>
          )}
          {view === "rapor" && tableCount > 0 && <ReportView key={doc?.id} />}
          {view === "rapor" && tableCount === 0 && (
            <div className="empty-state">
              <h2>Rapora veri ekleyin</h2>
              <p>Başlamak için bir kaynağa bağlanın. Yüklediğiniz tablolar burada görselleştirilebilecek.</p>
              <div className="start-actions">
                <button className="tile" onClick={() => setGetData(true)}>
                  <strong>SQL Server</strong>
                  <span>Tabloları seç ve yükle</span>
                </button>
                <button className="tile" onClick={() => void open()}>
                  <strong>Dosya aç</strong>
                  <span>Kayıtlı .floem raporunu aç</span>
                </button>
              </div>
            </div>
          )}
          {view === "model" && <ModelView onGetData={() => setGetData(true)} onRefreshTable={(t) => void refresh([t])} />}
          {view === "sql" && (
            <SqlView
              connections={connections}
              onNewConnection={() => setGetData(true)}
              onImport={(connectionId, database, sql, name) => startImport(connectionId, [{ database, sql, name }])}
            />
          )}
          {view === "veri" && (
            <div className="empty-state">
              <h2>Tablo görünümü</h2>
              <p>Satır satır veri görünümü 3. haftada geliyor. Şimdilik model görünümünde tabloyu seçip "Veriyi önizle"yi kullanın.</p>
            </div>
          )}
        </main>
      </div>

      {getData && (
        <GetDataDialog
          onClose={() => setGetData(false)}
          onConnected={(c) => {
            setGetData(false);
            refreshConnections();
            setNavigator(c);
          }}
        />
      )}
      {navigator && <Navigator connection={navigator} onClose={() => setNavigator(null)} onLoad={loadFromNavigator} />}
      {job && <JobDialog onShowModel={() => setView("model")} />}
      {publishing && <PublishDialog onClose={() => setPublishing(false)} />}
    </div>
  );
}
