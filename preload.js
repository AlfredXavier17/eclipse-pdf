// preload.js
const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /* ---------- existing methods you already had ---------- */
  selectPDF: async () => ipcRenderer.invoke('select-pdf'),
  onOpenPDF: (cb) => ipcRenderer.on('open-pdf', (_e, filePath) => cb(filePath)),
  onSavePDF: (cb) => ipcRenderer.on('save-pdf', () => cb()),
  onSaveAsPDF: (cb) => ipcRenderer.on('save-as-pdf', () => cb()),
  onMenuUndo: (cb) => ipcRenderer.on('menu-undo', () => cb()),
  onMenuRedo: (cb) => ipcRenderer.on('menu-redo', () => cb()),
  saveFile: (filePath, data) => ipcRenderer.send('save-file', filePath, data),
  saveFileAs: (filePath, data) => ipcRenderer.invoke('save-file-as', filePath, data),

  /* ---------- new: always open links in the default browser ---------- */
  openExternal: (url) => {
    try {
      if (typeof url === 'string' && url.startsWith('http')) {
        shell.openExternal(url);
      }
    } catch (e) {
      // swallow errors; UI can fall back to window.open
    }
  },

  /* ---------- optional helpers (safe to keep) ---------- */
  // Ask main for your app version (implement handler in main if you want exact version)
  getVersion: () =>
    ipcRenderer.invoke('get-app-version').catch(() => 'unknown'),

  // Quick OS string for support payloads
  getPlatform: () => process.platform,
});
