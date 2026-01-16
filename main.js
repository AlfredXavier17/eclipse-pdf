// main.js
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');

const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');

if (process.platform === 'win32') {
  app.setAppUserModelId('com.eclipsepdf.app');
  app.setName('Eclipse PDF');
}

let mainWindow;
let pdfToOpen = null;

/* ===== IPC helpers ===== */
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('open-external', (_e, url) => {
  try {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      return shell.openExternal(url);
    }
  } catch {}
  return false;
});


function toFileUrl(p) {
  try {
    if (typeof p === 'string' && p.startsWith('file://')) return p;
    return String(pathToFileURL(p));
  } catch { return null; }
}
function normalizeArg(a) {
  if (typeof a !== 'string') return null;
  const s = a.trim().replace(/^"(.*)"$/, '$1');
  if (s.startsWith('--')) return null;
  return s;
}
function looksLikePdf(s) {
  if (!s) return false;
  const t = s.toLowerCase();
  return t.endsWith('.pdf') || (t.startsWith('file://') && t.includes('.pdf'));
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
pdfToOpen = findPdfPathInArgv(process.argv);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const nextPdf = findPdfPathInArgv(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (nextPdf) mainWindow.webContents.send('open-pdf', nextPdf);
    }
  });
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  const url = toFileUrl(filePath);
  if (mainWindow) mainWindow.webContents.send('open-pdf', url);
  else pdfToOpen = url;
});

ipcMain.handle('select-pdf', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Open PDF',
    properties: ['openFile'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
  if (canceled || !filePaths?.[0]) return null;
  return toFileUrl(filePaths[0]);
});
ipcMain.on('save-file', (_event, filePath, dataBuffer) => {
  try {
    if (typeof filePath === 'string' && filePath.startsWith('file://')) {
      filePath = fileURLToPath(filePath);
    }
    fs.writeFileSync(filePath, Buffer.from(dataBuffer));
  } catch (err) {
    console.error('Failed to save file:', err);
  }
});

ipcMain.handle('save-file-as', async (_event, defaultPath, dataBuffer) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save PDF As',
      defaultPath,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, Buffer.from(dataBuffer));
    return toFileUrl(filePath);
  } catch (err) {
    console.error('Failed to save as:', err);
    return null;
  }
});

async function promptToSave(win, next) {
  const runNext = async () => {
    win.webContents.once('will-prevent-unload', e => e.preventDefault());
    await next();
  };
  try {
    const hasUnsaved = await win.webContents.executeJavaScript(
      '(()=>{try{return !!(window.__hasUnsavedChanges && window.__hasUnsavedChanges());}catch(e){return false;}})()'
    );
    if (!hasUnsaved) {
      await runNext();
      return true;
    }
    const response = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'You have unsaved changes. What would you like to do?'
    });
    if (response === 0) {
      await win.webContents.executeJavaScript('window.__saveCurrent?.()').catch(() => {});

      await runNext();
      return true;
    }
    if (response === 1) {
      await runNext();

      return true;
    }
    return false;
  } catch (e) {
    console.error('promptToSave failed:', e);
    await runNext();
    return true;
  }
}

function firstExisting(paths) {
  for (const p of paths) {
    try { if (p && fs.existsSync(p)) return p; } catch {}
  }
  return undefined;
}

function getIconPath() {
  if (process.platform === 'win32') {
    return firstExisting([
      path.join(__dirname, 'web', 'assets', 'icon.ico'),
      path.join(process.resourcesPath, 'web', 'assets', 'icon.ico'),
    ]);
  }

  if (process.platform === 'darwin') {
    return firstExisting([
      path.join(__dirname, 'web', 'assets', 'icon.icns'),
      path.join(process.resourcesPath, 'web', 'assets', 'icon.icns'),
    ]);
  }

  // Linux
  return firstExisting([
    path.join(__dirname, 'web', 'assets', 'icon.png'),
    path.join(process.resourcesPath, 'web', 'assets', 'icon.png'),
  ]);
}

////

function setHomeMenu() {
  Menu.setApplicationMenu(null);
  if (mainWindow) mainWindow.setMenuBarVisibility(false);
}
function setViewerMenu(win) {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Back to Home',
          accelerator: 'Alt+Left',
          click: async () => {
            if (!win) return;
            await promptToSave(win, () => win.loadFile(path.join(__dirname, 'file-picker.html')));
          }
        },
        {
          label: 'Open PDF…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (!win) return;
            await promptToSave(win, async () => {
              const { canceled, filePaths } = await dialog.showOpenDialog({
                title: 'Open PDF',
                properties: ['openFile'],
                filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
              });
              if (!canceled && filePaths?.[0]) {
                const url = toFileUrl(filePaths[0]);
                win.webContents.send('open-pdf', url);
              }
            });
          }
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => { if (win) win.webContents.send('save-pdf'); }
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => { if (win) win.webContents.send('save-as-pdf'); }
        },
                {
                  label: 'Print',
                  accelerator: 'CmdOrCtrl+P',
                  click: () => {
                    if (win) win.webContents.send('print-pdf'); // send message to the viewer
                  }
                },
        { type: 'separator' },
        { role: 'close' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z',
          click: () => { if (win) win.webContents.send('menu-undo'); } },
        { label: 'Redo', accelerator: process.platform === 'darwin' ? 'CmdOrCtrl+Shift+Z' : 'CmdOrCtrl+Y',
          click: () => { if (win) win.webContents.send('menu-redo'); } },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  win.setMenuBarVisibility(true);
}


function createWindow() {
  const iconPath = getIconPath();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Eclipse PDF',
    icon: iconPath || undefined,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
 
  if (process.platform === 'linux' && iconPath) mainWindow.setIcon(iconPath);
  if (pdfToOpen) {
  mainWindow.loadFile(path.join(__dirname, 'web', 'viewer.html')).then(() => {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('open-pdf', pdfToOpen);
      pdfToOpen = null;
    });
  });
} else {
  mainWindow.loadFile(path.join(__dirname, 'file-picker.html'));
  setHomeMenu();
}


  mainWindow.webContents.on('did-navigate', (_e, url) => {
    if (url.includes('web/viewer.html')) setViewerMenu(mainWindow);
    else setHomeMenu();
  });

  mainWindow.webContents.once('did-finish-load', () => {
    if (pdfToOpen) {
      mainWindow.webContents.send('open-pdf', pdfToOpen);
      pdfToOpen = null;
    }
  });

  mainWindow.on('close', async (e) => {
    if (mainWindow.forceClose) return;
    e.preventDefault();
    await promptToSave(mainWindow, () => {
      mainWindow.forceClose = true;
      mainWindow.close();
    });
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}



app.whenReady().then(() => {
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
