import type { ReportDefinition, ViewAs, VisualQuery } from "@floem/client";
import { ReportDesigner, type DesignerHost } from "@floem/designer";
import { useCallback, useMemo } from "react";
import { toUiError, useClient } from "../api";
import { useDocument } from "../document";

/** Desktop rapor görünümü: ortak tasarımcıyı yerel servise bağlar. */
export function ReportView({ onEditMeasure, viewAs = null }: { onEditMeasure?: (name: string) => void; viewAs?: ViewAs | null }) {
  const client = useClient();
  const { doc, patchDoc, setError, registerFlush } = useDocument();
  const tables = doc!.model.tablolar;

  // Veri, ilişkiler, roller ya da "Farklı görüntüle" değişince görseller yeniden sorgulanır
  const dataRev = useMemo(
    () => JSON.stringify([
      doc!.stats, doc!.model.iliskiler, tables.map((t) => [t.ad, t.sutunlar.map((c) => c.tip)]),
      viewAs ? [viewAs, doc!.model.roller] : null,
    ]),
    [doc, tables, viewAs],
  );
  const run = useCallback((q: VisualQuery) => client.query(q, viewAs), [client, viewAs]);
  const save = useCallback(
    async (r: ReportDefinition) => {
      const res = await client.setReport(r);
      patchDoc((d) => ({ ...d, report: r, dirty: res.dirty }));
    },
    [client, patchDoc],
  );
  const onError = useCallback((e: unknown) => setError(toUiError(e)), [setError]);
  const componentLibrary = useMemo(() => ({ load: () => client.loadComponents(), save: (...args: Parameters<typeof client.saveComponents>) => client.saveComponents(...args) }), [client]);

  const host: DesignerHost = useMemo(
    () => ({ tables, report: doc!.report, dataRev, run, save, onError, registerFlush, onEditMeasure, componentLibrary }),
    [tables, doc, dataRev, run, save, onError, registerFlush, onEditMeasure, componentLibrary],
  );
  return <ReportDesigner key={doc!.id} host={host} />;
}
