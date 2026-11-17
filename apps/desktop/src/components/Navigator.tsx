import type { ConnectResult, DbObject, QueryResult } from "@floem/client";
import { useEffect, useMemo, useState } from "react";
import { toUiError, useClient, type UiError } from "../api";
import { ErrorBox } from "./ErrorBox";
import { ResultGrid, resultSummary } from "./ResultGrid";

export interface SelectedObject {
  connectionId: string;
  database: string;
  schema: string;
  name: string;
  type: DbObject["type"];
}

const key = (db: string, o: { schema: string; name: string }) => `${db}|${o.schema}|${o.name}`;
const nf = new Intl.NumberFormat("tr-TR");

/** Power BI'daki Navigator: veritabanı → şema → tablo/görünüm ağacı, onay kutuları ve önizleme. */
export function Navigator({
  connection,
  onClose,
  onLoad,
}: {
  connection: ConnectResult;
  onClose: () => void;
  onLoad?: (selection: SelectedObject[]) => void;
}) {
  const client = useClient();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    connection.database ? { [connection.database]: true } : {},
  );
  const [objects, setObjects] = useState<Record<string, DbObject[] | "loading" | UiError>>({});
  const [checked, setChecked] = useState<Record<string, SelectedObject>>({});
  const [focus, setFocus] = useState<{ db: string; obj: DbObject } | null>(null);
  const [preview, setPreview] = useState<QueryResult | "loading" | UiError | null>(null);
  const [filter, setFilter] = useState("");

  const databases = connection.database ? [connection.database] : connection.databases;

  async function loadObjects(db: string) {
    if (objects[db] && objects[db] !== "loading" && !("message" in (objects[db] as object))) return;
    setObjects((o) => ({ ...o, [db]: "loading" }));
    try {
      const list = await client.objects(connection.id, db);
      setObjects((o) => ({ ...o, [db]: list }));
    } catch (e) {
      setObjects((o) => ({ ...o, [db]: toUiError(e) }));
    }
  }

  useEffect(() => {
    for (const db of Object.keys(expanded)) if (expanded[db]) void loadObjects(db);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleDb(db: string) {
    const next = !expanded[db];
    setExpanded((x) => ({ ...x, [db]: next }));
    if (next) void loadObjects(db);
  }

  async function showPreview(db: string, obj: DbObject) {
    setFocus({ db, obj });
    setPreview("loading");
    try {
      setPreview(await client.preview(connection.id, db, obj.schema, obj.name, 200));
    } catch (e) {
      setPreview(toUiError(e));
    }
  }

  function toggleCheck(db: string, obj: DbObject) {
    const k = key(db, obj);
    setChecked((c) => {
      const n = { ...c };
      if (n[k]) delete n[k];
      else n[k] = { connectionId: connection.id, database: db, schema: obj.schema, name: obj.name, type: obj.type };
      return n;
    });
  }

  const needle = filter.trim().toLocaleLowerCase("tr");
  const selectedCount = Object.keys(checked).length;

  const grouped = useMemo(() => {
    const out: Record<string, Record<string, DbObject[]>> = {};
    for (const db of databases) {
      const list = objects[db];
      if (!Array.isArray(list)) continue;
      const bySchema: Record<string, DbObject[]> = {};
      for (const o of list) {
        if (needle && !`${o.schema}.${o.name}`.toLocaleLowerCase("tr").includes(needle)) continue;
        (bySchema[o.schema] ??= []).push(o);
      }
      out[db] = bySchema;
    }
    return out;
  }, [objects, databases, needle]);

  return (
    <div className="modal-backdrop">
      <div className="modal navigator" role="dialog" aria-label="Gezgin">
        <header className="modal-head">
          <h2>Gezgin</h2>
          <span className="muted">
            {[
              connection.server,
              connection.server_info.version && `${connection.server_info.edition} ${connection.server_info.version}`,
              connection.server_info.login || connection.user,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <button className="link" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </header>
        <div className="nav-body">
          <aside className="nav-tree">
            <input className="search" placeholder="Ara" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="tree-scroll">
              {databases.length === 0 && <p className="muted pad">Bu kullanıcının erişebildiği veritabanı yok.</p>}
              {databases.map((db) => (
                <div key={db}>
                  <button className="tree-node db" onClick={() => toggleDb(db)} aria-expanded={!!expanded[db]}>
                    <span className="chev">{expanded[db] ? "▾" : "▸"}</span>
                    <span className="ico-db" aria-hidden /> {db}
                  </button>
                  {expanded[db] && (
                    <div className="tree-children">
                      {objects[db] === "loading" && <p className="muted pad">Yükleniyor…</p>}
                      {objects[db] && typeof objects[db] === "object" && !Array.isArray(objects[db]) && (
                        <ErrorBox error={objects[db] as UiError} />
                      )}
                      {grouped[db] &&
                        Object.entries(grouped[db]).map(([schema, list]) => (
                          <div key={schema}>
                            <div className="tree-schema">{schema}</div>
                            {list.map((o) => {
                              const k = key(db, o);
                              const isFocus = focus?.db === db && focus.obj.schema === o.schema && focus.obj.name === o.name;
                              return (
                                <div key={k} className={`tree-leaf ${isFocus ? "focus" : ""}`}>
                                  <input type="checkbox" checked={!!checked[k]} onChange={() => toggleCheck(db, o)} aria-label={`${o.schema}.${o.name} seç`} />
                                  <button className="leaf-btn" onClick={() => showPreview(db, o)}>
                                    <span className={o.type === "VIEW" ? "ico-view" : "ico-table"} aria-hidden />
                                    {o.name}
                                    {o.row_count !== null && <span className="muted count">{nf.format(o.row_count)}</span>}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </aside>
          <section className="nav-preview">
            {!focus && <p className="muted pad">Önizlemek için soldan bir tablo seçin.</p>}
            {focus && (
              <>
                <div className="preview-title">
                  <strong>
                    {focus.obj.schema}.{focus.obj.name}
                  </strong>
                  {preview && typeof preview === "object" && "rows" in preview && <span className="muted"> · {resultSummary(preview)}</span>}
                </div>
                {preview === "loading" && <p className="muted pad">Önizleme yükleniyor…</p>}
                {preview && typeof preview === "object" && "message" in preview && <ErrorBox error={preview} />}
                {preview && typeof preview === "object" && "rows" in preview && <ResultGrid result={preview} />}
              </>
            )}
          </section>
        </div>
        <footer className="modal-foot">
          <span className="muted">{selectedCount} öğe seçildi</span>
          <span className="spacer" />
          <button
            className="primary"
            disabled={!selectedCount || !onLoad}
            title={onLoad ? "" : "İçe aktarım 2. haftada geliyor"}
            onClick={() => onLoad?.(Object.values(checked))}
          >
            Yükle
          </button>
          <button onClick={onClose}>İptal</button>
        </footer>
      </div>
    </div>
  );
}
