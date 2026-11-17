// Arayüze yalnızca bu dar köprü açılır (contextIsolation + sandbox).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("floem", {
  getConfig: () => ipcRenderer.invoke("floem:config"),
  openFileDialog: () => ipcRenderer.invoke("floem:open-file-dialog"),
  saveFileDialog: (defaultName) => ipcRenderer.invoke("floem:save-file-dialog", defaultName),
  setDocState: (state) => ipcRenderer.send("floem:doc-state", state),
  closeNow: () => ipcRenderer.send("floem:close-now"),
  onSaveAndClose: (cb) => {
    const listener = () => cb();
    ipcRenderer.on("floem:save-and-close", listener);
    return () => ipcRenderer.removeListener("floem:save-and-close", listener);
  },
});
