const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const axios = require('axios');

const currentVersion = "1.0.0"; // 🟡 Change this when you update your app
let mainWindow;
let pdfToOpen = null;

// ✅ 1. Update Checker
async function checkForUpdates() {
  console.log("🛰️ Checking for updates...");

  try {
    const res = await axios.get('https://raw.githubusercontent.com/AlfredXavier17/moonreader/main/version.json');
    console.log("📡 Response from GitHub:", res.data);
    const data = res.data;

    if (data.latestVersion !== currentVersion) {
      console.log(`⚠️ New version available: ${data.latestVersion}`);

      const choice = dialog.showMessageBoxSync({
        type: 'info',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        title: 'Update Available',
        message: `A new version (${data.latestVersion}) is available.`,
        detail: data.changelog
      });

      if (choice === 0) {
        shell.openExternal(data.downloadLink);
      }
    } else {
      console.log("✅ App is up to date.");
    }
  } catch (err) {
    console.log("❌ Update check failed:", err.message);
  }
}

// ✅ 2. Detect if user opened a PDF file directly (via "Open With")
for (const arg of process.argv) {
  if (arg.toLowerCase().endsWith('.pdf')) {
    pdfToOpen = `file://${arg.replace(/\\/g, '/')}`;
    console.log('📄 PDF to open:', pdfToOpen);
    break;
  }
}

// ✅ 3. Handle file picker from frontend (called from preload)
ipcMain.handle('select-pdf', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
  if (result.canceled) return null;
  return `file://${result.filePaths[0].replace(/\\/g, '/')}`;
});

// ✅ 4. Create main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'icon.ico'), // Use .ico for Windows
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

// ✅ 5. App ready
app.whenReady().then(() => {
  createWindow();
  checkForUpdates(); // 🔔 Run this every launch
});

// ✅ 6. Windows/Linux close behavior
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ✅ 7. macOS re-open
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
