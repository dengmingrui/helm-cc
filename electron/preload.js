// Safe IPC bridge (contextIsolation-friendly).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('helm', {
  isElectron: true,
  // dashboard asks main to open a session window explicitly (more reliable than window.open)
  openSession: (opts) => ipcRenderer.invoke('helm:open-session', opts),
  // a session window minimizes/restores/closes ITSELF (main resolves the sender window)
  minimize: () => ipcRenderer.send('helm:minimize'),
  restore: () => ipcRenderer.send('helm:restore'),
  close: () => ipcRenderer.send('helm:close'),
});
