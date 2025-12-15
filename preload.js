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
  getPlatform: () => process.platform,

  /* ---------- Authentication ---------- */
  authDone: (userData) => ipcRenderer.invoke('auth-done', userData),
  getUser: () => ipcRenderer.invoke('get-user'),
  signOut: () => ipcRenderer.invoke('sign-out'),

  // ✅ ADD THIS
  openGoogleAuth: () => ipcRenderer.invoke('open-google-auth'),

  /* ---------- Trial & Premium ---------- */
  getRemainingSeconds: () => ipcRenderer.invoke('get-remaining-seconds'),
  startPdfTimer: () => ipcRenderer.invoke('start-pdf-timer'),
  stopPdfTimer: () => ipcRenderer.invoke('stop-pdf-timer'),

  /* ---------- Stripe Checkout ---------- */
  createCheckoutSession: () => ipcRenderer.invoke('create-checkout-session'),
  manageSubscription: () => ipcRenderer.invoke('manage-subscription')
});
