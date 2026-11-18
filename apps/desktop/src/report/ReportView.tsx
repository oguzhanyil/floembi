import type { ReportDefinition, VisualQuery } from "@floem/client";
import { ReportDesigner, type DesignerHost } from "@floem/designer";
import { useCallback, useMemo } from "react";
import { toUiError, useClient } from "../api";
import { useDocument } from "../document";

/** Desktop rapor görünümü: ortak tasarımcıyı yerel servise bağlar. */
export function ReportView({ onEditMeasure }: { onEditMeasure?: (name: string) => void }) {
  const client = useClient();
  const { doc, patchDoc, setError, registerFlush } = useDocument();
  const tables = doc!.model.tablolar;

  // Veri ya da ilişkiler değişince görseller yeniden sorgulanır
  const dataRev = useMemo(
    () => JSON.stringify([doc!.stats, doc!.model.iliskiler, tables.map((t) => [t.ad, t.sutunlar.map((c) => c.tip)])]),
    [doc, tables],
  );
  const run = useCallback((q: VisualQuery) => client.query(q), [client]);
  const save = useCallback(
    async (r: ReportDefinition) => {
      const res = await client.setReport(r);
      patchDoc((d) => ({ ...d, report: r, dirty: res.dirty }));
    },
    [client, patchDoc],
  );
  const onError = useCallback((e: unknown) => setError(toUiError(e)), [setError]);

  const host: DesignerHost = useMemo(
    () => ({ tables, report: doc!.report, dataRev, run, save, onError, registerFlush, onEditMeasure }),
    [tables, doc, dataRev, run, save, onError, registerFlush, onEditMeasure],
  );
  return <ReportDesigner host={host} />;
}
