// main.js
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { pathToFileURL } = require('url');

// ------ Branding / Identity (Windows shell & notifications) ------
if (process.platform === 'win32') {
  // MUST match build.appId in package.json
  app.setAppUserModelId('com.eclipsepdf.app');
  // App display name
  app.setName('Eclipse PDF');
}

// Use the actual version from package.json/electron
const currentVersion = app.getVersion();

let mainWindow;
let pdfToOpen = null;

/* --------------------------
   1) Update Checker
---------------------------*/
async function checkForUpdates() {
  try {
    // TODO: change this to your new repo path once you create it
    // e.g., https://raw.githubusercontent.com/<you>/eclipse-pdf/main/version.json
    const res = await axios.get(
      'https://raw.githubusercontent.com/AlfredXavier17/moonreader/main/version.json',
      { timeout: 8000 }
    );
    const data = res.data;
    if (data?.latestVersion && data.latestVersion !== currentVersion) {
      const choice = dialog.showMessageBoxSync({
        type: 'info',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        title: 'Update Available',
        message: `A new version (${data.latestVersion}) is available.`,
        detail: data.changelog || ''
      });
      if (choice === 0 && data.downloadLink) shell.openExternal(data.downloadLink);
    }
  } catch (err) {
    console.log('Update check failed:', err.message);
  }
}

/* --------------------------------------------
   2) Helpers to extract a PDF path from argv
--------------------------------------------- */
function toFileUrl(p) {
  try {
    if (typeof p === 'string' && p.startsWith('file://')) return p;
    return String(pathToFileURL(p));
  } catch {
    return null;
  }
}

function normalizeArg(a) {
  if (typeof a !== 'string') return null;
  // Strip quotes Windows sometimes adds
  const s = a.trim().replace(/^"(.*)"$/, '$1');
  if (s.startsWith('--')) return null; // ignore flags
  return s;
}

function looksLikePdf(s) {
  if (!s) return false;
  const lower = s.toLowerCase();
  return lower.endsWith('.pdf') || (lower.startsWith('file://') && lower.includes('.pdf'));
}

function findPdfPathInArgv(argv) {
  const args = process.platform === 'win32' ? argv.slice(1) : argv;
  for (const raw of args) {
    const a = normalizeArg(raw);
    if (!a) continue;
    if (looksLikePdf(a)) {
      const url = toFileUrl(a);
      if (url) return url;
    }
  }
  return null;
}

// initial check for PDFs passed on first launch
pdfToOpen = findPdfPathInArgv(process.argv);

/* ------------------------------------------------
   3) Single-instance: open next PDFs in same app
------------------------------------------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const nextPdf = findPdfPathInArgv(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (nextPdf) mainWindow.webContents.send('open-pdf', nextPdf);
    }
  });
}

/* ----------------------------------------
   4) macOS: handle 'open with' integration
----------------------------------------- */
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  const url = toFileUrl(filePath);
  if (mainWindow) {
    mainWindow.webContents.send('open-pdf', url);
  } else {
    pdfToOpen = url;
  }
});

/* -----------------------------------------
   5) File picker handler (frontend trigger)
------------------------------------------ */
ipcMain.handle('select-pdf', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
  if (result.canceled) return null;
  return toFileUrl(result.filePaths[0]);
});

/* -----------------------------
   6) Icon per platform
------------------------------ */
function firstExisting(paths) {
  return paths.find(p => p && fs.existsSync(p));
}

function getIconPath() {
  if (process.platform === 'win32') {
    // extraResources -> resources/icon.ico
    return path.join(process.resourcesPath, 'icon.ico');
  }
  if (process.platform === 'darwin') {
    return firstExisting([
      path.join(__dirname, 'assets', 'icon.icns'),
      path.join(__dirname, 'assets', 'icons', 'mac', 'icon.icns')
    ]);
  }
  // linux prefers a PNG
  return firstExisting([
    path.join(__dirname, 'assets', 'icon.png'),
    path.join(__dirname, 'assets', 'icons', 'png', '512x512.png'),
    path.join(__dirname, 'assets', 'icons', 'png', '256x256.png')
  ]);
}

/* -----------------------------
   7) Create the main window
------------------------------ */
function createWindow() {
  const iconPath = getIconPath();
  console.log('Icon path:', iconPath);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Eclipse PDF',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // setIcon is only meaningful on Linux; on Win/mac it’s ignored
  if (process.platform === 'linux' && iconPath && mainWindow) {
    mainWindow.setIcon(iconPath);
  }

  mainWindow.loadFile('file-picker.html');

  mainWindow.webContents.once('did-finish-load', () => {
    if (pdfToOpen) {
      mainWindow.webContents.send('open-pdf', pdfToOpen);
      pdfToOpen = null;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* -----------------------------
   8) App lifecycle
------------------------------ */
app.whenReady().then(() => {
  createWindow();
  // Skip updater when running as a Microsoft Store/MSIX app
  if (app.isPackaged && !process.windowsStore) {
    checkForUpdates();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
