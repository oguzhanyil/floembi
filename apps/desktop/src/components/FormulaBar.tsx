import type { DaxDiagnostic, ModelOp } from "@floem/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { toUiError, useClient, type UiError } from "../api";
import { useDocument } from "../document";
import { monaco } from "../monaco";
import { registerDaxCompletion, setCompletionModel } from "./daxLanguage";
import { ErrorBox } from "./ErrorBox";

export type MeasureEdit = { mode: "new"; table: string } | { mode: "edit"; name: string };

const FORMATS: { value: string; label: string }[] = [
  { value: "", label: "Genel" },
  { value: "#,0", label: "Tam sayı" },
  { value: "#,0.00", label: "Ondalık" },
  { value: "₺#,0.00", label: "Para (₺)" },
  { value: "0%", label: "Yüzde" },
  { value: "0.0%", label: "Yüzde (1 basamak)" },
];

/** "Ad = ifade" metnini ayırır; ifadenin metindeki başlangıç konumunu da verir. */
function split(text: string): { name: string; expr: string; offset: number } | null {
  const i = text.indexOf("=");
  if (i < 0) return null;
  const rest = text.slice(i + 1);
  const lead = rest.length - rest.trimStart().length;
  return { name: text.slice(0, i).trim(), expr: rest.trim(), offset: i + 1 + lead };
}

/** Power BI formül çubuğu: ölçü oluşturma ve düzenleme. */
export function FormulaBar({ edit, onClose }: { edit: MeasureEdit; onClose: () => void }) {
  const client = useClient();
  const { doc, setDoc } = useDocument();
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [diags, setDiags] = useState<DaxDiagnostic[]>([]);
  const [error, setError] = useState<UiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [height, setHeight] = useState(30);

  const existing = useMemo(() => {
    if (edit.mode !== "edit" || !doc) return null;
    for (const t of doc.model.tablolar) {
      const m = t.olculer.find((x) => x.ad === edit.name);
      if (m) return { table: t.ad, m };
    }
    return null;
  }, [doc, edit]);

  const [table, setTable] = useState(edit.mode === "new" ? edit.table : existing?.table ?? "");
  const [format, setFormat] = useState(existing?.m.bicim ?? "");

  const taken = useMemo(
    () => new Set((doc?.model.tablolar ?? []).flatMap((t) => t.olculer.map((m) => m.ad.toLowerCase()))),
    [doc],
  );
  const initial = useMemo(() => {
    if (existing) return `${existing.m.ad} = ${existing.m.ifade}`;
    let i = 1;
    while (taken.has(`ölçü ${i}`)) i++;
    return `Ölçü ${i} = `;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setCompletionModel(doc?.model ?? null);
  }, [doc]);

  // Editörü bir kez kur
  useEffect(() => {
    registerDaxCompletion();
    const ed = monaco.editor.create(host.current!, {
      value: initial,
      language: "msdax",
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: "off",
      glyphMargin: false,
      folding: false,
      fontSize: 13,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      renderLineHighlight: "none",
      overviewRulerLanes: 0,
      scrollbar: { vertical: "auto", horizontal: "hidden" },
      fixedOverflowWidgets: true,
    });
    editor.current = ed;
    const model = ed.getModel()!;
    ed.setPosition(model.getPositionAt(initial.length));
    ed.focus();
    const resize = () => setHeight(Math.min(160, Math.max(30, ed.getContentHeight() + 4)));
    ed.onDidContentSizeChange(resize);
    resize();
    return () => ed.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Yazarken doğrulama (300 ms gecikmeli)
  useEffect(() => {
    const ed = editor.current;
    if (!ed) return;
    let timer: number | undefined;
    let seq = 0;
    const check = () => {
      const text = ed.getValue();
      const parts = split(text);
      const model = ed.getModel()!;
      if (!parts) {
        const d = [{ message: "Ölçüyü 'Ad = ifade' biçiminde yazın", start: 0, end: text.length }];
        setDiags(d);
        monaco.editor.setModelMarkers(model, "floem", []);
        return;
      }
      if (!parts.expr) {
        setDiags([]);
        monaco.editor.setModelMarkers(model, "floem", []);
        return;
      }
      const mine = ++seq;
      client
        .validateDax(parts.expr)
        .then((res) => {
          if (mine !== seq) return;
          setDiags(res.errors);
          monaco.editor.setModelMarkers(
            model, "floem",
            res.errors.map((e) => {
              const s = model.getPositionAt(parts.offset + (e.start ?? 0));
              const en = model.getPositionAt(parts.offset + (e.end ?? parts.expr.length));
              return {
                severity: monaco.MarkerSeverity.Error, message: e.message,
                startLineNumber: s.lineNumber, startColumn: s.column, endLineNumber: en.lineNumber,
                endColumn: Math.max(en.column, s.column + 1),
              };
            }),
          );
        })
        .catch(() => undefined);
    };
    const sub = ed.onDidChangeModelContent(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, 300);
    });
    check();
    return () => {
      sub.dispose();
      window.clearTimeout(timer);
    };
  }, [client]);

  async function commit() {
    const ed = editor.current;
    if (!ed || saving) return;
    const parts = split(ed.getValue());
    if (!parts || !parts.name || !parts.expr) {
      setError({ message: "Ölçüyü 'Ad = ifade' biçiminde yazın (ör. Toplam Satış = SUM(INV1[LineTotal]))" });
      return;
    }
    const op: ModelOp = existing
      ? {
          op: "update_measure", name: existing.m.ad, expression: parts.expr, bicim: format || null,
          ...(parts.name !== existing.m.ad ? { new_name: parts.name } : {}),
          ...(table && table !== existing.table ? { table } : {}),
        }
      : { op: "add_measure", table, name: parts.name, expression: parts.expr, bicim: format || null };
    setSaving(true);
    setError(null);
    try {
      setDoc(await client.applyOps([op]));
      onClose();
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!existing || !window.confirm(`[${existing.m.ad}] ölçüsü silinsin mi?`)) return;
    try {
      setDoc(await client.applyOps([{ op: "delete_measure", name: existing.m.ad }]));
      onClose();
    } catch (e) {
      setError(toUiError(e));
    }
  }

  // Enter kaydeder, Shift+Enter yeni satır, Esc vazgeçer
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const ed = editor.current;
    if (!ed) return;
    const a = ed.onKeyDown((e) => {
      if (e.keyCode === monaco.KeyCode.Enter && !e.shiftKey && !suggestOpen(ed)) {
        e.preventDefault();
        void commitRef.current();
      } else if (e.keyCode === monaco.KeyCode.Escape && !suggestOpen(ed)) {
        e.preventDefault();
        closeRef.current();
      }
    });
    return () => a.dispose();
  }, []);

  const tables = doc?.model.tablolar ?? [];
  return (
    <div className="formula-bar">
      <div className="fb-row">
        <span className="fb-fx" title="Ölçü">fx</span>
        <div className="fb-editor" ref={host} style={{ height }} />
        <button className="fb-ok" onClick={() => void commit()} disabled={saving || diags.length > 0} title="Kaydet (Enter)">
          ✓
        </button>
        <button className="fb-cancel" onClick={onClose} title="Vazgeç (Esc)">
          ✕
        </button>
      </div>
      <div className="fb-meta">
        <label>
          Ana tablo
          <select value={table} onChange={(e) => setTable(e.target.value)}>
            {tables.map((t) => (
              <option key={t.ad} value={t.ad}>
                {t.ad}
              </option>
            ))}
          </select>
        </label>
        <label>
          Biçim
          <select value={FORMATS.some((f) => f.value === format) ? format : "__custom"} onChange={(e) => e.target.value !== "__custom" && setFormat(e.target.value)}>
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
            {!FORMATS.some((f) => f.value === format) && <option value="__custom">{format}</option>}
          </select>
        </label>
        {diags.length > 0 ? (
          <span className="fb-diag" role="alert">⚠ {diags[0].message}</span>
        ) : (
          <span className="fb-hint">Enter: kaydet · Shift+Enter: yeni satır · Esc: vazgeç · Ctrl+Boşluk: öneriler</span>
        )}
        <span className="spacer" />
        {existing && (
          <button className="link danger-link" onClick={() => void remove()}>
            Ölçüyü sil
          </button>
        )}
      </div>
      {error && <ErrorBox error={error} onClose={() => setError(null)} />}
    </div>
  );
}

/** Öneri listesi açıkken Enter seçimi kabul eder, Esc listeyi kapatır (kaydetme/vazgeçme değil). */
function suggestOpen(ed: monaco.editor.IStandaloneCodeEditor): boolean {
  return !!ed.getDomNode()?.ownerDocument.querySelector(".suggest-widget.visible");
}
