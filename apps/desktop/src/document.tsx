import type { DocumentState, FormKind, Job, ModelOp, PagedLibrary, PrintTemplate } from "@floem/client";
import { defaultPrintTemplate } from "@floem/client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toUiError, useClient, type UiError } from "./api";

interface DocumentApi {
  doc: DocumentState | null;
  /** Model işlemi uygular; hata olursa `error`a yazar ve false döner. */
  apply(ops: ModelOp[]): Promise<boolean>;
  save(saveAs?: boolean): Promise<boolean>;
  open(): Promise<void>;
  opening: boolean;
  newDocument(): Promise<void>;
  reload(): Promise<void>;
  setDoc(d: DocumentState): void;
  /** Belgenin bir kısmını güncel duruma göre değiştirir (eşzamanlı güncellemelerde eski kopyayı yazmamak için) */
  patchDoc(fn: (d: DocumentState) => DocumentState): void;
  editPaged(library: PagedLibrary): void;
  flushPaged(): Promise<void>;
  editPrintTemplate(id: string, kind: FormKind, change: Partial<PrintTemplate>): void;
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
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const docRef = useRef<DocumentState | null>(null);
  const loadGeneration = useRef(0);
  const flushers = useRef(new Set<() => Promise<void>>());
  const pendingTemplates = useRef(new Map<FormKind, PrintTemplate>());
  const pendingPaged = useRef<PagedLibrary | null>(null);
  const pagedQueue = useRef(Promise.resolve());
  const flushPaged = useCallback(() => {
    const id = docRef.current?.id;
    const work = pagedQueue.current.catch(() => {}).then(async () => {
      const library = pendingPaged.current;
      if (library && id && docRef.current?.id === id) {
        await client.setPagedLibrary(id, library);
        if (pendingPaged.current === library && docRef.current?.id === id) pendingPaged.current = null;
      }
    });
    pagedQueue.current = work;
    return work;
  }, [client]);
  const registerFlush = useCallback((fn: () => Promise<void>) => {
    flushers.current.add(fn);
    return () => {
      flushers.current.delete(fn);
    };
  }, []);
  const flushAll = useCallback(async () => {
    await flushPaged();
    for (const f of flushers.current) await f();
    const id = docRef.current?.id;
    if (id) for (const [kind, template] of pendingTemplates.current) {
      await client.setPrintTemplate(id, template.title.trim() ? template : { ...template, title: defaultPrintTemplate(kind).title });
      if (docRef.current?.id === id && pendingTemplates.current.get(kind) === template) pendingTemplates.current.delete(kind);
    }
  }, [client, flushPaged]);

  const setDoc = useCallback((d: DocumentState) => {
    if (docRef.current?.id !== d.id) pendingTemplates.current.clear();
    if (docRef.current?.id !== d.id) pendingPaged.current = null;
    if (pendingPaged.current) d = { ...d, paginated: pendingPaged.current, dirty: true };
    if (pendingTemplates.current.size) {
      const templates = new Map((d.documentTemplates ?? []).map(t => [t.kind, t]));
      for (const [kind, template] of pendingTemplates.current) templates.set(kind, template);
      d = { ...d, dirty: true, documentTemplates: [...templates.values()] };
    }
    docRef.current = d;
    setDocState(d);
    window.floem?.setDocState({ name: d.name, dirty: d.dirty });
  }, []);

  const patchDoc = useCallback((fn: (d: DocumentState) => DocumentState) => {
    const cur = docRef.current;
    if (cur) setDoc(fn(cur));
  }, [setDoc]);
  const editPaged = useCallback((library: PagedLibrary) => {
    pendingPaged.current = library;
    if (docRef.current) setDoc(docRef.current);
  }, [setDoc]);

  const editPrintTemplate = useCallback((id: string, kind: FormKind, change: Partial<PrintTemplate>) => {
    const current = docRef.current;
    if (current?.id !== id) return;
    const before = current.documentTemplates?.find(t => t.kind === kind) ?? defaultPrintTemplate(kind);
    pendingTemplates.current.set(kind, { ...before, ...change });
    setDoc(current);
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
      if (openingRef.current) return false;
      try { await flushAll(); } catch (e) { setError(toUiError(e)); return false; }
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
    if (openingRef.current) return;
    if (confirmDirty && docRef.current?.dirty && !window.confirm(DISCARD)) return;
    loadGeneration.current += 1;
    openingRef.current = true; setOpening(true);
    setError(null);
    try {
      await flushAll();
      setDoc(await client.openDocument(path));
      setJob(null);
    } catch (e) {
      setError(toUiError(e));
    } finally {
      openingRef.current = false; setOpening(false);
    }
  }, [client, setDoc, flushAll]);

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
    if (openingRef.current) return;
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
      if (!e.ctrlKey || e.altKey || openingRef.current) return;
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
      value={{ doc, apply, save, open, opening, newDocument, reload, setDoc, patchDoc, editPaged, flushPaged, editPrintTemplate, error, setError, job, trackJob: setJob, registerFlush }}
    >
      {children}
    </Ctx.Provider>
  );
}
