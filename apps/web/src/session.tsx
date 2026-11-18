import { FloemApiError, WebClient, type MailMode, type WebUser, type WorkspaceInfo } from "@floem/client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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
  client: WebClient;
  login(email: string, password: string): Promise<void>;
  logout(): void;
  /** 401 gelirse oturumu kapatır; diğer hataları olduğu gibi fırlatır */
  guard<T>(p: Promise<T>): Promise<T>;
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
  const client = useMemo(() => new WebClient(window.location.origin, stored?.token ?? null), [stored]);

  const logout = useCallback(() => {
    writeStored(null);
    setStored(null);
    setWorkspaces([]);
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
      })
      .catch(() => undefined);
  }, [stored, client, guard]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await new WebClient(window.location.origin, null).login(email, password);
    const s = { token: res.token, user: res.user };
    writeStored(s);
    setStored(s);
  }, []);

  return (
    <Ctx.Provider value={{ user: stored?.user ?? null, workspaces, mailMode, client, login, logout, guard }}>
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
