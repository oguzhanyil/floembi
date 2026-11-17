import { DesktopClient, FloemApiError } from "@floem/client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const ClientContext = createContext<DesktopClient | null>(null);

export function ClientProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<DesktopClient | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.floem) {
      setError("Bu sayfa Floem BI Desktop içinde açılmalı (Electron köprüsü bulunamadı).");
      return;
    }
    window.floem
      .getConfig()
      .then((cfg) => setClient(new DesktopClient(cfg.baseUrl, cfg.token)))
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="boot boot-error">{error}</div>;
  if (!client) return <div className="boot">Floem BI başlatılıyor…</div>;
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useClient(): DesktopClient {
  const c = useContext(ClientContext);
  if (!c) throw new Error("ClientProvider eksik");
  return c;
}

export interface UiError {
  message: string;
  detail?: string;
  code?: string;
}

export function toUiError(e: unknown): UiError {
  if (e instanceof FloemApiError) return { message: e.message, detail: e.detail, code: e.code };
  return { message: "Beklenmeyen hata", detail: String(e) };
}
