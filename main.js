const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

let mainWindow;
let pdfToOpen = null;

// ✅ STEP 1: Detect if app was launched with a PDF file (e.g., "Open with")
for (const arg of process.argv) {
  if (arg.toLowerCase().endsWith('.pdf')) {
    pdfToOpen = `file://${arg.replace(/\\/g, '/')}`;
    console.log('📄 PDF to open:', pdfToOpen);
    break;
  }
}

// ✅ STEP 2: File picker via preload bridge
ipcMain.handle('select-pdf', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
  if (result.canceled) return null;
  return `file://${result.filePaths[0].replace(/\\/g, '/')}`;
});

// ✅ STEP 3: Create the app window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'icon.ico'), // ✅ Use .ico for Windows builds
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile('file-picker.html');

  mainWindow.webContents.once('did-finish-load', () => {
    if (pdfToOpen) {
      mainWindow.webContents.send('open-pdf', pdfToOpen);
    }
  });
}

// ✅ Launch
app.whenReady().then(createWindow);

// ✅ Windows/Linux quit
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ✅ macOS re-open behavior
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
