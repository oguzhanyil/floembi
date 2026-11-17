import type { QueryResult } from "@floem/client";
import { useEffect, useState } from "react";
import { toUiError, useClient, type UiError } from "../api";
import { ErrorBox } from "../components/ErrorBox";
import { ResultGrid } from "../components/ResultGrid";
import { nf } from "./modelUtils";

/** Yüklenmiş tablonun ilk satırları (tam veri görünümü H3'te). */
export function TablePreviewDialog({ table, rows, onClose }: { table: string; rows: number | null; onClose: () => void }) {
  const client = useClient();
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<UiError | null>(null);

  useEffect(() => {
    client.tablePreview(table, 200).then(setResult).catch((e) => setError(toUiError(e)));
  }, [client, table]);

  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal navigator" role="dialog" aria-label={`${table} önizleme`}>
        <header className="modal-head">
          <h2>{table}</h2>
          <span className="muted">
            {rows !== null && `${nf.format(rows)} satır`}
            {result && rows !== null && rows > result.row_count && ` · ilk ${nf.format(result.row_count)} satır gösteriliyor`}
          </span>
          <button className="link" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </header>
        {error && <ErrorBox error={error} />}
        {!result && !error && <p className="muted pad">Yükleniyor…</p>}
        {result && <ResultGrid result={result} />}
      </div>
    </div>
  );
}
