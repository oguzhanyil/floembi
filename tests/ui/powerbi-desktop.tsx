// Üretim Desktop App'i; yalnız Electron dosya seçici köprüsü test çiftidir.
import { createRoot } from "react-dom/client";
import { App } from "../../apps/desktop/src/App";
import "../../apps/desktop/src/styles.css";
import "../../apps/desktop/src/dialogs.css";

const state = window as unknown as { fixture: Record<string, string>; nextPath: string; docState: unknown };
state.fixture = await (await fetch("/api/fixture")).json();
window.confirm = () => true;
window.floem = {
  getConfig: async () => ({ baseUrl: `${location.origin}/api`, token: "powerbi-ui-fixture", version: "qa", dev: true, startView: null }),
  openFileDialog: async () => state.nextPath,
  saveFileDialog: async () => state.fixture.saved,
  setDocState: (value) => { state.docState = value; },
  closeNow: () => undefined,
  onSaveAndClose: () => () => undefined,
};
createRoot(document.getElementById("root")!).render(<App />);
