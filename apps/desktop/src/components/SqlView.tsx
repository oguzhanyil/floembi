import type { Connection, ImportItem, QueryResult } from "@floem/client";
import { useEffect, useRef, useState } from "react";
import { toUiError, useClient, type UiError } from "../api";
import { ErrorBox } from "./ErrorBox";
import { ResultGrid, resultSummary } from "./ResultGrid";
import { SqlEditor, type SqlEditorHandle } from "./SqlEditor";

const LIMITS = [100, 1000, 10000];

/** SQL penceresi: bağlantı + veritabanı seç, yalnızca SELECT çalıştır, sonucu gör. */
export function SqlView({
  connections, onNewConnection, onImport, onProcedure,
}: {
  connections: Connection[];
  onProcedure?: (connectionId: string, item: ImportItem) => Promise<boolean>;
  onNewConnection: () => void;
  /** Sorguyu modele tablo olarak yükler (Power BI: "SQL deyimi" ile veri al) */
  onImport?: (connectionId: string, database: string | undefined, sql: string, name: string) => Promise<boolean>;
}) {
  const client = useClient();
  const sqlConnections = connections.filter((c) => c.kind !== "rest");
  const [connId, setConnId] = useState<string>(sqlConnections[0]?.id ?? "");
  const [databases, setDatabases] = useState<string[]>([]);
  const [database, setDatabase] = useState<string>("");
  const [limit, setLimit] = useState(1000);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [running, setRunning] = useState(false);
  const [tableName, setTableName] = useState("Sorgu1");
  const editor = useRef<SqlEditorHandle>(null);
  const [schema, setSchema] = useState("dbo");
  const [routine, setRoutine] = useState("");
  const [args, setArgs] = useState<string[]>([]);

  async function importQuery() {
    const sql = editor.current?.getRunnableText().trim();
    if (!sql || !connId || !onImport) return;
    if (!tableName.trim()) {
      setError({ message: "Modele yüklemek için bir tablo adı girin" });
      return;
    }
    setError(null);
    await onImport(connId, database || undefined, sql, tableName.trim());
  }

  useEffect(() => {
    if (!sqlConnections.some((c) => c.id === connId)) setConnId(sqlConnections[0]?.id ?? "");
  }, [connections, connId]);

  useEffect(() => {
    if (!connId) return;
    const conn = sqlConnections.find((c) => c.id === connId);
    setDatabases([]);
    client
      .databases(connId)
      .then((dbs) => {
        setDatabases(dbs);
        setDatabase(conn?.database ?? dbs[0] ?? "");
      })
      .catch((e) => setError(toUiError(e)));
  }, [connId, client, connections]);

  async function run() {
    const sql = editor.current?.getRunnableText().trim();
    if (!sql || !connId || running) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await client.runSql(connId, database || null, sql, limit));
    } catch (e) {
      setResult(null);
      setError(toUiError(e));
    } finally {
      setRunning(false);
    }
  }

  if (sqlConnections.length === 0) {
    return (
      <div className="empty-state">
        <h2>SQL sorgusu</h2>
        <p>Sorgu yazmak için SQL Server, SAP HANA veya SQLite bağlantısı ekleyin.</p>
        <button className="primary" onClick={onNewConnection}>
          Veri kaynağı ekle
        </button>
      </div>
    );
  }

  return (
    <div className="sql-view">
      <div className="toolbar">
        <label>
          Bağlantı
          <select value={connId} onChange={(e) => setConnId(e.target.value)}>
            {sqlConnections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.server} ({c.auth === "windows" ? "Windows" : c.user})
              </option>
            ))}
          </select>
        </label>
        <label>
          Veritabanı
          <select value={database} onChange={(e) => setDatabase(e.target.value)}>
            {databases.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Satır sınırı
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {LIMITS.map((l) => (
              <option key={l} value={l}>
                {l.toLocaleString("tr-TR")}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" onClick={run} disabled={running}>
          {running ? "Çalışıyor…" : "▶ Çalıştır"}
        </button>
        <span className="muted">Ctrl+Enter veya F5 · seçili metin varsa yalnızca o çalışır · yalnızca SELECT</span>
        {onImport && (
          <>
            <span className="spacer" />
            <label>
              Tablo adı
              <input type="text" value={tableName} onChange={(e) => setTableName(e.target.value)} />
            </label>
            <button onClick={importQuery} title="Sorgunun tüm sonucunu modele tablo olarak yükler (satır sınırı uygulanmaz)">
              Modele yükle
            </button>
          </>
        )}
      </div>
      {onProcedure && sqlConnections.find(c => c.id === connId)?.kind === "sqlserver" && <details>
        <summary>Saklı yordamdan veri al</summary>
        <div className="toolbar"><label>Şema<input value={schema} onChange={e => setSchema(e.target.value)} /></label>
          <label>Yordam adı<input value={routine} onChange={e => setRoutine(e.target.value)} /></label>
          {args.map((v,i) => <label key={i}>Parametre {i+1}<input value={v} onChange={e => setArgs(args.map((a,j) => j===i ? e.target.value : a))} /></label>)}
          <button onClick={() => setArgs([...args,""])}>Parametre ekle</button>{args.length > 0 && <button onClick={() => setArgs(args.slice(0,-1))}>Son parametreyi kaldır</button>}
          <button disabled={!schema.trim() || !routine.trim() || !tableName.trim()} onClick={() => onProcedure(connId, {
            database: database || undefined, procedure: routine.trim(), schema: schema.trim(), arguments: args, name: tableName.trim()
          })}>Yordamı çalıştır ve sonucu içe aktar</button></div>
        <small>Parametreleri yordamın tanım sırasıyla girin. İlk sonuç kümesi belgeye anlık görüntü olarak kaydedilir.</small>
      </details>}
      <div className="sql-split">
        <SqlEditor ref={editor} initial={"SELECT TOP 100 *\nFROM "} onRun={run} />
        <div className="sql-results">
          {error && <ErrorBox error={error} onClose={() => setError(null)} />}
          {result && (
            <>
              <div className="status">{resultSummary(result)}</div>
              <ResultGrid result={result} />
            </>
          )}
          {!result && !error && <p className="muted pad">Sonuçlar burada görünecek.</p>}
        </div>
      </div>
    </div>
  );
}
