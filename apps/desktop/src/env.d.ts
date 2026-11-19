/// <reference types="vite/client" />

interface FloemBridgeConfig {
  baseUrl: string;
  token: string;
  version: string;
  dev: boolean;
  startView: string | null;
}

interface Window {
  floem: {
    getConfig(): Promise<FloemBridgeConfig>;
    openFileDialog(): Promise<string | null>;
    saveFileDialog(defaultName: string): Promise<string | null>;
    setDocState(state: { name: string; dirty: boolean }): void;
    closeNow(): void;
    onOpenFile?(cb: (path: string) => void): () => void;
    onSaveAndClose(cb: () => void): () => void;
  };
}
