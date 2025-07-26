const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Optional: if you're using the "Open PDF" button
  selectPDF: async () => {
    const result = await ipcRenderer.invoke('select-pdf');
    return result;
  },

  // ✅ Listen for "open-pdf" event and pass the file path to renderer
  onOpenPDF: (callback) => {
    ipcRenderer.on('open-pdf', (event, filePath) => {
      callback(filePath);
    });
  }
});
