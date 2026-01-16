// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /* ---------- PDF operations ---------- */
  selectPDF: async () => ipcRenderer.invoke('select-pdf'),
  onOpenPDF: (cb) => ipcRenderer.on('open-pdf', (_e, filePath) => cb(filePath)),
  onSavePDF: (cb) => ipcRenderer.on('save-pdf', () => cb()),
  onSaveAsPDF: (cb) => ipcRenderer.on('save-as-pdf', () => cb()),
  onMenuUndo: (cb) => ipcRenderer.on('menu-undo', () => cb()),
  onMenuRedo: (cb) => ipcRenderer.on('menu-redo', () => cb()),
  saveFile: (filePath, data) => ipcRenderer.send('save-file', filePath, data),
  saveFileAs: (filePath, data) => ipcRenderer.invoke('save-file-as', filePath, data),
  onPrintPDF: (cb) => ipcRenderer.on('print-pdf', () => cb()),

  /* ---------- External links ---------- */
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  /* ---------- App version ---------- */
  getVersion: () => ipcRenderer.invoke('get-app-version').catch(() => 'unknown'),
  getPlatform: () => process.platform
});
