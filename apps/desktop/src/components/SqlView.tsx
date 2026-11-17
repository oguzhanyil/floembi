import type { Connection, QueryResult } from "@floem/client";
import { useEffect, useRef, useState } from "react";
import { toUiError, useClient, type UiError } from "../api";
import { ErrorBox } from "./ErrorBox";
import { ResultGrid, resultSummary } from "./ResultGrid";
import { SqlEditor, type SqlEditorHandle } from "./SqlEditor";

const LIMITS = [100, 1000, 10000];

/** SQL penceresi: bağlantı + veritabanı seç, yalnızca SELECT çalıştır, sonucu gör. */
export function SqlView({
  connections, onNewConnection, onImport,
}: {
  connections: Connection[];
  onNewConnection: () => void;
  /** Sorguyu modele tablo olarak yükler (Power BI: "SQL deyimi" ile veri al) */
  onImport?: (connectionId: string, database: string | undefined, sql: string, name: string) => Promise<boolean>;
}) {
  const client = useClient();
  const [connId, setConnId] = useState<string>(connections[0]?.id ?? "");
  const [databases, setDatabases] = useState<string[]>([]);
  const [database, setDatabase] = useState<string>("");
  const [limit, setLimit] = useState(1000);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [running, setRunning] = useState(false);
  const [tableName, setTableName] = useState("Sorgu1");
  const editor = useRef<SqlEditorHandle>(null);

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
    if (!connId && connections[0]) setConnId(connections[0].id);
  }, [connections, connId]);

  useEffect(() => {
    if (!connId) return;
    const conn = connections.find((c) => c.id === connId);
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

  if (connections.length === 0) {
    return (
      <div className="empty-state">
        <h2>SQL sorgusu</h2>
        <p>Sorgu yazmak için önce bir SQL Server bağlantısı ekleyin.</p>
        <button className="primary" onClick={onNewConnection}>
          SQL Server'a bağlan
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
            {connections.map((c) => (
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
