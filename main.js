const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

let mainWindow;
let pdfToOpen = null;

// ✅ STEP 1: Detect if app was launched with a PDF file (e.g., "Open with")
for (const arg of process.argv) {
  if (arg.toLowerCase().endsWith('.pdf')) {
    pdfToOpen = `file://${arg.replace(/\\/g, '/')}`;
    console.log('📄 PDF to open:', pdfToOpen); // terminal debug
    break;
  }
}

// ✅ STEP 2: Allow manual file picking from the "Open PDF" button
ipcMain.handle('select-pdf', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
  if (result.canceled) return null;
  return `file://${result.filePaths[0].replace(/\\/g, '/')}`;
});

// ✅ STEP 3: Create the main window
app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile('file-picker.html');

  // ✅ Enable DevTools to see console output in the app
  mainWindow.webContents.openDevTools();

  // ✅ After UI loads, send file path if app was launched with a file
  mainWindow.webContents.once('did-finish-load', () => {
    if (pdfToOpen) {
      mainWindow.webContents.send('open-pdf', pdfToOpen);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
