import { ApplicationThemeControl } from "@floem/report";
import type { ConnectResult, Connection, ImportItem, ViewAs } from "@floem/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClientProvider, toUiError, useClient } from "./api";
import { DateTableDialog } from "./components/DateTableDialog";
import { ErrorBox } from "./components/ErrorBox";
import { FormulaBar, type MeasureEdit } from "./components/FormulaBar";
import { GetDataDialog } from "./components/GetDataDialog";
import { JobDialog } from "./components/JobDialog";
import { PublishDialog } from "./components/PublishDialog";
import { Navigator, type SelectedObject } from "./components/Navigator";
import { SqlView } from "./components/SqlView";
import { DocumentProvider, useDocument } from "./document";
import { DataView } from "./data/DataView";
import { ModelView } from "./model/ModelView";
import { ReportView } from "./report/ReportView";
import { PrintDesigner } from "./print/PrintDesigner";
import { RolesDialog, ViewAsDialog } from "./model/RolesDialog";
import { FloemQueryEditor } from "./transform/FloemQueryEditor";

type View = "rapor" | "veri" | "model" | "sql" | "belge";

const VIEWS: { id: View; label: string; icon: string; ready: boolean; note?: string }[] = [
  { id: "rapor", label: "Rapor görünümü", icon: "▤", ready: true },
  { id: "belge", label: "Belge Tasarımcısı", icon: "▧", ready: true },
  { id: "veri", label: "Tablo görünümü", icon: "▦", ready: true },
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
  const { doc, save, open, opening, newDocument, error, setError, job, trackJob } = useDocument();
  const [view, setView] = useState<View>("rapor");
  const openedDocId = useRef("");
  useEffect(() => {
    if (!doc || openedDocId.current === doc.id) return;
    openedDocId.current = doc.id;
    if (doc.documentTemplates?.length && !doc.report.pages.some(p => p.visuals.length)) setView("belge");
  }, [doc]);
  const [reportToolbar, setReportToolbar] = useState<HTMLDivElement | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [getData, setGetData] = useState(false);
  const [navigator, setNavigator] = useState<ConnectResult | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [measureEdit, setMeasureEdit] = useState<MeasureEdit | null>(null);
  const [dateDialog, setDateDialog] = useState(false);
  const [transform, setTransform] = useState<{ table?: string } | null>(null);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [viewAsOpen, setViewAsOpen] = useState(false);
  const [viewAs, setViewAs] = useState<ViewAs | null>(null);
  // Rol silinir/yeniden adlandırılırsa ya da başka belge açılırsa "Farklı görüntüle" kapanır
  const roleNames = (doc?.model.roller ?? []).map((r) => r.ad);
  const activeViewAs = viewAs && viewAs.roles.every((r) => roleNames.includes(r)) ? viewAs : null;
  // Yeni ölçünün ana tablosu: olgu tablosu tahmini (en çok satırlı tablo)
  const defaultMeasureTable = () => {
    const tables = doc?.model.tablolar ?? [];
    const rows = (t: string) => doc?.stats[t]?.rows ?? 0;
    return [...tables].sort((a, b) => rows(b.ad) - rows(a.ad))[0]?.ad ?? "";
  };

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
      <ApplicationThemeControl />
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
          <button className="ribbon-btn" aria-pressed={view === "belge"} onClick={() => setView("belge")}>
            <span className="ribbon-ico">▧</span>Belge Tasarımcısı
          </button>
          <span className="ribbon-label">Belgeler</span>
        </div>
        {view === "rapor" && (tableCount > 0 || doc?.report.pages.some((p) => p.visuals.length > 0)) && <div className="ribbon-group">
          <div ref={setReportToolbar} />
          <span className="ribbon-label">Rapor</span>
        </div>}
        <div className="ribbon-group">
          <button className="ribbon-btn" onClick={() => setGetData(true)}>
            <span className="ribbon-ico">⛃</span>Veri al
          </button>
          <button
            className="ribbon-btn"
            onClick={() => setTransform({})}
            disabled={busy || !doc?.model.tablolar.some((t) => t.sorgu)}
            title="Floem Query düzenleyicisi: sütun böl, filtrele, birleştir…"
          >
            <span className="ribbon-ico">⚙</span>Verileri dönüştür
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
          <button
            className="ribbon-btn"
            onClick={() => setMeasureEdit({ mode: "new", table: defaultMeasureTable() })}
            disabled={tableCount === 0}
            title="Yeni FDX ölçüsü (formül çubuğu)"
          >
            <span className="ribbon-ico">ƒx</span>Yeni ölçü
          </button>
          <button className="ribbon-btn" onClick={() => setDateDialog(true)} disabled={tableCount === 0} title="Takvim tablosu oluştur">
            <span className="ribbon-ico">📅</span>Tarih tablosu
          </button>
          <span className="ribbon-label">Hesaplamalar</span>
        </div>
        <div className="ribbon-group">
          <button className="ribbon-btn" onClick={() => setRolesOpen(true)} disabled={tableCount === 0}
            title="Satır düzeyi güvenlik rolleri ve FDX filtreleri">
            <span className="ribbon-ico">🛡</span>Rolleri yönet
          </button>
          <button className="ribbon-btn" onClick={() => setViewAsOpen(true)} disabled={tableCount === 0}
            title="Raporu seçilen rollerin gözünden görüntüle">
            <span className="ribbon-ico">👁</span>Farklı görüntüle
          </button>
          <span className="ribbon-label">Güvenlik</span>
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

      <div className="formula-slot">
        {measureEdit && (
          <FormulaBar
            key={measureEdit.mode === "edit" ? `e:${measureEdit.name}` : `n:${measureEdit.table}`}
            edit={measureEdit}
            onClose={() => setMeasureEdit(null)}
          />
        )}
      </div>

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
          {view === "rapor" && tableCount > 0 && activeViewAs && (
            <div className="viewas-bar" role="status">
              <span>
                👁 Şu anda görüntülenen: <strong>{activeViewAs.roles.join(", ")}</strong>
                {activeViewAs.upn && <> · kullanıcı <strong>{activeViewAs.upn}</strong></>}
              </span>
              <button onClick={() => setViewAsOpen(true)}>Değiştir</button>
              <button onClick={() => setViewAs(null)}>Görüntülemeyi durdur</button>
            </div>
          )}
          {view === "rapor" && (tableCount > 0 || doc?.report.pages.some((p) => p.visuals.length > 0)) && (
            <ReportView
              key={doc?.id}
              viewAs={activeViewAs}
              toolbarTarget={reportToolbar}
              onEditMeasure={(name) => setMeasureEdit({ mode: "edit", name })}
            />
          )}
          {view === "rapor" && tableCount === 0 && !doc?.report.pages.some((p) => p.visuals.length > 0) && (
            <div className="empty-state">
              <h2>Rapora veri ekleyin</h2>
              <p>Başlamak için bir kaynağa bağlanın. Yüklediğiniz tablolar burada görselleştirilebilecek.</p>
              <div className="start-actions">
                <button className="tile" onClick={() => setGetData(true)}>
                  <strong>Veri al</strong>
                  <span>SQL Server, HANA, SQLite veya REST</span>
                </button>
                <button className="tile" onClick={() => void open()}>
                  <strong>Dosya aç</strong>
                  <span>Floem veya Power BI · .pbip / .pbix</span>
                </button>
              </div>
            </div>
          )}
          {view === "belge" && (activeViewAs ? <div className="empty-state">
            <h2>Rol önizlemesi açık</h2><p>Belge tasarımına dönmek için rol önizlemesini kapatın.</p>
            <button onClick={() => setViewAs(null)}>Farklı görüntülemeyi durdur</button>
          </div> : tableCount === 0 ? <div className="empty-state"><h2>Belge için veri ekleyin</h2>
            <p>Fatura veya teklif başlıklarıyla bunlara bağlı kalem tablolarını yükleyin.</p>
            <button className="primary" onClick={() => setGetData(true)}>Veri al</button></div> : <PrintDesigner key={doc?.id} />)}
          {view === "model" && (
            <ModelView
              onGetData={() => setGetData(true)}
              onRefreshTable={(t) => void refresh([t])}
              onTransformTable={(t) => setTransform({ table: t })}
              onEditMeasure={(name) => setMeasureEdit({ mode: "edit", name })}
              onNewMeasure={(table) => setMeasureEdit({ mode: "new", table })}
            />
          )}
          {view === "sql" && (
            <SqlView
              connections={connections}
              onNewConnection={() => setGetData(true)}
              onImport={(connectionId, database, sql, name) => startImport(connectionId, [{ database, sql, name }])}
            />
          )}
          {view === "veri" && tableCount > 0 && (
            <DataView
              key={doc?.id}
              onRefreshTable={(t) => void refresh([t])}
              onTransformTable={(t) => setTransform({ table: t })}
              onNewMeasure={(table) => setMeasureEdit({ mode: "new", table })}
            />
          )}
          {view === "veri" && tableCount === 0 && (
            <div className="empty-state">
              <h2>Tablo görünümü</h2>
              <p>Modelde henüz tablo yok. Veri al ile tabloları yükleyin.</p>
              <button className="primary" onClick={() => setGetData(true)}>
                Veri al
              </button>
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
      {opening && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Dosya açılıyor"><div className="modal" role="status" aria-busy="true"><h2>Dosya açılıyor…</h2><p>Power BI dosyalarında yerleşim, model ve gömülü veri aktarımı biraz sürebilir.</p></div></div>}
      {job && <JobDialog onShowModel={() => setView("model")} />}
      {publishing && <PublishDialog onClose={() => setPublishing(false)} />}
      {rolesOpen && <RolesDialog onClose={() => setRolesOpen(false)} />}
      {viewAsOpen && (
        <ViewAsDialog
          current={activeViewAs}
          onClose={() => setViewAsOpen(false)}
          onApply={(v) => {
            setViewAs(v);
            setViewAsOpen(false);
            setView("rapor");
          }}
        />
      )}
      {transform && <FloemQueryEditor initialTable={transform.table} onClose={() => setTransform(null)} />}
      {dateDialog && (
        <DateTableDialog
          onClose={() => setDateDialog(false)}
          onDone={() => {
            setDateDialog(false);
            setView("model");
          }}
        />
      )}
    </div>
  );
}
