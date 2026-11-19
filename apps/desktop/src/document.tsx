import type { DocumentState, Job, ModelOp } from "@floem/client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toUiError, useClient, type UiError } from "./api";

interface DocumentApi {
  doc: DocumentState | null;
  /** Model işlemi uygular; hata olursa `error`a yazar ve false döner. */
  apply(ops: ModelOp[]): Promise<boolean>;
  save(saveAs?: boolean): Promise<boolean>;
  open(): Promise<void>;
  newDocument(): Promise<void>;
  reload(): Promise<void>;
  setDoc(d: DocumentState): void;
  /** Belgenin bir kısmını güncel duruma göre değiştirir (eşzamanlı güncellemelerde eski kopyayı yazmamak için) */
  patchDoc(fn: (d: DocumentState) => DocumentState): void;
  error: UiError | null;
  setError(e: UiError | null): void;
  /** Çalışan ya da sonucu gösterilen içe aktarım/yenileme işi */
  job: Job | null;
  trackJob(job: Job | null): void;
  /** Kaydetmeden önce bekleyen değişiklikleri yazan fonksiyon kaydeder (ör. rapor düzenleyicisi) */
  registerFlush(fn: () => Promise<void>): () => void;
}

const Ctx = createContext<DocumentApi | null>(null);

export function useDocument(): DocumentApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("DocumentProvider eksik");
  return c;
}

const DISCARD = "Kaydedilmemiş değişiklikler kaybolacak. Devam edilsin mi?";

export function DocumentProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const [doc, setDocState] = useState<DocumentState | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const docRef = useRef<DocumentState | null>(null);
  const loadGeneration = useRef(0);
  const flushers = useRef(new Set<() => Promise<void>>());
  const registerFlush = useCallback((fn: () => Promise<void>) => {
    flushers.current.add(fn);
    return () => {
      flushers.current.delete(fn);
    };
  }, []);
  const flushAll = useCallback(async () => {
    for (const f of flushers.current) await f();
  }, []);

  const setDoc = useCallback((d: DocumentState) => {
    docRef.current = d;
    setDocState(d);
    window.floem?.setDocState({ name: d.name, dirty: d.dirty });
  }, []);

  const patchDoc = useCallback((fn: (d: DocumentState) => DocumentState) => {
    const cur = docRef.current;
    if (cur) setDoc(fn(cur));
  }, [setDoc]);

  const reload = useCallback(async () => {
    const generation = loadGeneration.current;
    try {
      const d = await client.getDocument();
      if (generation !== loadGeneration.current) return;
      if (d.startup_error) setError(d.startup_error);
      setDoc(d);
    } catch (e) {
      if (generation !== loadGeneration.current) return;
      setError(toUiError(e));
    }
  }, [client, setDoc]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const apply = useCallback(
    async (ops: ModelOp[]) => {
      try {
        setDoc(await client.applyOps(ops));
        return true;
      } catch (e) {
        setError(toUiError(e));
        return false;
      }
    },
    [client, setDoc],
  );

  const save = useCallback(
    async (saveAs = false) => {
      await flushAll();
      const current = docRef.current;
      if (!current) return false;
      let path: string | undefined;
      if (saveAs || !current.path) {
        const chosen = await window.floem.saveFileDialog(current.name);
        if (!chosen) return false;
        path = chosen;
      }
      try {
        setDoc(await client.saveDocument(path));
        return true;
      } catch (e) {
        setError(toUiError(e));
        return false;
      }
    },
    [client, setDoc, flushAll],
  );

  const openPath = useCallback(async (path: string, confirmDirty = true) => {
    if (confirmDirty && docRef.current?.dirty && !window.confirm(DISCARD)) return;
    loadGeneration.current += 1;
    try {
      setDoc(await client.openDocument(path));
      setJob(null);
    } catch (e) {
      setError(toUiError(e));
    }
  }, [client, setDoc]);

  const open = useCallback(async () => {
    if (docRef.current?.dirty && !window.confirm(DISCARD)) return;
    const path = await window.floem.openFileDialog();
    if (!path) return;
    await openPath(path, false);
  }, [openPath]);

  useEffect(() => {
    // Vite HMR arayüzü yenilerken açık Electron sürecinde eski preload kalabilir.
    if (!doc || !window.floem?.onOpenFile) return;
    return window.floem.onOpenFile((path) => { void openPath(path); });
    // Yalnızca ilk belge geldikten sonra dosya açma olaylarını dinle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(doc), openPath]);

  const newDocument = useCallback(async () => {
    if (docRef.current?.dirty && !window.confirm(DISCARD)) return;
    try {
      setDoc(await client.newDocument());
      setJob(null);
    } catch (e) {
      setError(toUiError(e));
    }
  }, [client, setDoc]);

  // Pencere kapatılırken "Kaydet" seçilirse
  useEffect(
    () =>
      window.floem?.onSaveAndClose(async () => {
        if (await save()) window.floem.closeNow();
      }),
    [save],
  );

  // Kısayollar: Ctrl+S, Ctrl+Shift+S, Ctrl+O, Ctrl+N
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void save(e.shiftKey);
      } else if (k === "o") {
        e.preventDefault();
        void open();
      } else if (k === "n" && !e.shiftKey) {
        e.preventDefault();
        void newDocument();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, open, newDocument]);

  return (
    <Ctx.Provider
      value={{ doc, apply, save, open, newDocument, reload, setDoc, patchDoc, error, setError, job, trackJob: setJob, registerFlush }}
    >
      {children}
    </Ctx.Provider>
  );
}
