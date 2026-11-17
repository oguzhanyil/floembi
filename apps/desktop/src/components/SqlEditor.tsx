import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { monaco } from "../monaco";

export interface SqlEditorHandle {
  /** Seçili metin varsa onu, yoksa tüm metni döndürür (SSMS davranışı). */
  getRunnableText(): string;
  focus(): void;
}

export const SqlEditor = forwardRef<SqlEditorHandle, { initial: string; onRun: () => void; language?: string }>(
  function SqlEditor({ initial, onRun, language = "sql" }, ref) {
    const host = useRef<HTMLDivElement>(null);
    const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const runRef = useRef(onRun);
    runRef.current = onRun;

    useEffect(() => {
      const ed = monaco.editor.create(host.current!, {
        value: initial,
        language,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        renderWhitespace: "none",
        tabSize: 4,
      });
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
      ed.addCommand(monaco.KeyCode.F5, () => runRef.current());
      editor.current = ed;
      return () => ed.dispose();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(ref, () => ({
      getRunnableText() {
        const ed = editor.current;
        if (!ed) return "";
        const sel = ed.getSelection();
        const model = ed.getModel();
        if (sel && model && !sel.isEmpty()) return model.getValueInRange(sel);
        return ed.getValue();
      },
      focus() {
        editor.current?.focus();
      },
    }));

    return <div className="code-editor" ref={host} />;
  },
);
