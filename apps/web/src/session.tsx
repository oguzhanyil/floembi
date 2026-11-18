import { FloemApiError, WebClient, type LiveEvent, type MailMode, type WebUser, type WorkspaceInfo } from "@floem/client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const KEY = "floem.session";

interface Stored {
  token: string;
  user: WebUser;
}

function readStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function writeStored(s: Stored | null) {
  try {
    if (s) window.localStorage.setItem(KEY, JSON.stringify(s));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* tarayıcı depolaması kapalıysa oturum yalnızca bu sekmede yaşar */
  }
}

interface SessionApi {
  user: WebUser | null;
  workspaces: WorkspaceInfo[];
  /** outbox: e-postalar sunucunun giden kutusunda (geliştirme) */
  mailMode: MailMode | null;
  /** Sistem yöneticisi: Yönetim menüsü */
  isAdmin: boolean;
  client: WebClient;
  login(email: string, password: string): Promise<void>;
  /** Davet kabulünden dönen oturumu kullan */
  adopt(token: string, user: WebUser): void;
  /** Çalışma alanı listesini ve rolleri yeniden oku */
  reload(): void;
  logout(): void;
  /** 401 gelirse oturumu kapatır; diğer hataları olduğu gibi fırlatır */
  guard<T>(p: Promise<T>): Promise<T>;
  /** Anlık güncelleme olaylarına abone ol; dönüş aboneliği bitirir */
  onLive(fn: (e: LiveEvent) => void): () => void;
}

const Ctx = createContext<SessionApi | null>(null);

export function useSession(): SessionApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("SessionProvider eksik");
  return c;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<Stored | null>(readStored);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [mailMode, setMailMode] = useState<MailMode | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rev, setRev] = useState(0);
  const client = useMemo(() => new WebClient(window.location.origin, stored?.token ?? null), [stored]);

  const logout = useCallback(() => {
    writeStored(null);
    setStored(null);
    setWorkspaces([]);
    setIsAdmin(false);
  }, []);

  const guard = useCallback(
    async <T,>(p: Promise<T>): Promise<T> => {
      try {
        return await p;
      } catch (e) {
        if (e instanceof FloemApiError && e.status === 401) logout();
        throw e;
      }
    },
    [logout],
  );

  useEffect(() => {
    if (!stored) return;
    guard(client.me())
      .then((me) => {
        setWorkspaces(me.workspaces);
        setMailMode(me.mail_mode);
        setIsAdmin(Boolean(me.is_admin));
      })
      .catch(() => undefined);
  }, [stored, client, guard, rev]);

  // Anlık güncelleme: oturum açıkken tek SSE bağlantısı; koparsa yeni biletle yeniden bağlanır
  const listeners = useRef(new Set<(e: LiveEvent) => void>());
  const onLive = useCallback((fn: (e: LiveEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);
  useEffect(() => {
    if (!stored || typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const dispatch = (raw: MessageEvent) => {
      try {
        const ev = JSON.parse(raw.data) as LiveEvent;
        listeners.current.forEach((fn) => fn(ev));
      } catch {
        /* bozuk olay: yok say */
      }
    };
    const retry = (ms: number) => {
      if (!closed) timer = setTimeout(connect, ms);
    };
    async function connect() {
      try {
        const { ticket } = await client.eventsTicket();
        if (closed) return;
        es = new EventSource(`/api/events?ticket=${encodeURIComponent(ticket)}`);
        es.addEventListener("report", dispatch as EventListener);
        es.addEventListener("dataset", dispatch as EventListener);
        es.addEventListener("app", dispatch as EventListener);
        es.onerror = () => {
          es?.close();             // bilet tek kullanımlık: tarayıcının kendi yeniden bağlanması işe yaramaz
          retry(5000);
        };
      } catch (e) {
        if (e instanceof FloemApiError && e.status === 401) return;
        retry(15000);
      }
    }
    void connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, [stored, client]);

  const adopt = useCallback((token: string, user: WebUser) => {
    const s = { token, user };
    writeStored(s);
    setStored(s);
  }, []);
  const reload = useCallback(() => setRev((x) => x + 1), []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await new WebClient(window.location.origin, null).login(email, password);
    const s = { token: res.token, user: res.user };
    writeStored(s);
    setStored(s);
  }, []);

  return (
    <Ctx.Provider
      value={{ user: stored?.user ?? null, workspaces, mailMode, isAdmin, client, login, logout, adopt, reload, guard, onLive }}
    >
      {children}
    </Ctx.Provider>
  );
}

// ------------------------------------------------------------------ basit yönlendirme
export function navigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return path;
}

export function Link({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

/** Bileşen açıkken anlık güncelleme olaylarını dinler. */
export function useLive(fn: (e: LiveEvent) => void) {
  const { onLive } = useSession();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => onLive((e) => ref.current(e)), [onLive]);
}
