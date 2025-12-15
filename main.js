// main.js
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');


const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { pathToFileURL, fileURLToPath } = require('url');

if (process.platform === 'win32') {
  app.setAppUserModelId('com.eclipsepdf.app');
  app.setName('Eclipse PDF');
}
const currentVersion = app.getVersion();

// Backend URL - UPDATE THIS AFTER YOU DEPLOY
const BACKEND_URL = 'https://eclipse-pdf-backend.onrender.com';

let mainWindow;
let pdfToOpen = null;

/* ===== Local storage for user auth ===== */
function getUserDataPath() {
  return path.join(app.getPath("userData"), "user.json");
}

function getUsagePath() {
  return path.join(app.getPath("userData"), "usage.json");
}

function loadUser() {
  try {
    const userDataPath = getUserDataPath();
    if (!fs.existsSync(userDataPath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(userDataPath, "utf8"));
  } catch {
    return null;
  }
}

function saveUser(userData) {
  try {
    const userDataPath = getUserDataPath();
    fs.writeFileSync(userDataPath, JSON.stringify(userData, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save user:", err);
  }
}

// Get today's date string (YYYY-MM-DD) in local timezone
function getTodayDateString() {
  const now = new Date();
  if (now.getHours() < 3) {
    // If before 3 AM, count it as yesterday
    now.setDate(now.getDate() - 1);
  }
  return now.toLocaleDateString('en-CA'); // Returns YYYY-MM-DD
}


function loadUsage() {
  try {
    const usagePath = getUsagePath();
    if (!fs.existsSync(usagePath)) {
      return {
        dailySecondsUsed: 0,
        lastResetDate: getTodayDateString()
      };
    }
    const data = JSON.parse(fs.readFileSync(usagePath, "utf8"));

    // Check if we need to reset (new day)
    const today = getTodayDateString();
    const lastReset = data.lastResetDate || today;

    if (today !== lastReset) {
      // New day! Reset the counter
      return {
        dailySecondsUsed: 0,
        lastResetDate: today
      };
    }

    return {
      dailySecondsUsed: data.dailySecondsUsed || 0,
      lastResetDate: lastReset
    };
  } catch {
    return {
      dailySecondsUsed: 0,
      lastResetDate: getTodayDateString()
    };
  }
}

function saveUsage(dailySecondsUsed) {
  try {
    const usagePath = getUsagePath();
    const data = {
      dailySecondsUsed,
      lastResetDate: getTodayDateString()
    };
    fs.writeFileSync(usagePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save usage:", err);
  }
}

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

/* ===== Auth IPC handlers ===== */
ipcMain.handle('auth-done', async (_event, userData) => {
  // Save user data locally
  saveUser(userData);

  // Create/sync user in Firestore via backend
  try {
    await axios.post(`${BACKEND_URL}/sync-user`, {
      uid: userData.uid,
      email: userData.email,
      displayName: userData.displayName
    });
  } catch (err) {
    console.error('Failed to sync user to backend:', err);
  }

  return { success: true };
});

ipcMain.handle('get-user', () => {
  return loadUser();
});

ipcMain.handle('sign-out', () => {
  try {
    const userDataPath = getUserDataPath();
    if (fs.existsSync(userDataPath)) {
      fs.unlinkSync(userDataPath);
    }
    return { success: true };
  } catch (err) {
    console.error('Failed to sign out:', err);
    return { success: false };
  }
});

/* ===== Trial tracking ===== */
let timerStartTime = null;
let timerInterval = null;

function updateUsageTime() {
  if (!timerStartTime) return;

  const usage = loadUsage();
  const now = Date.now();
  const elapsedMs = now - timerStartTime;
  const elapsedSeconds = Math.floor(elapsedMs / 1000);

  const newSecondsUsed = usage.dailySecondsUsed + elapsedSeconds;
  saveUsage(newSecondsUsed);

  timerStartTime = now;

  // Sync to backend if user is signed in
  const user = loadUser();
  if (user?.uid) {
    syncUsageToBackend(user.uid, newSecondsUsed).catch(console.error);
  }
}

async function syncUsageToBackend(uid, dailySecondsUsed) {
  try {
    await axios.post(`${BACKEND_URL}/sync-usage`, {
      uid,
      dailySecondsUsed,
      date: getTodayDateString()
    });
  } catch (err) {
    console.error('Failed to sync usage to backend:', err);
  }
}

// IPC: Start PDF timer
ipcMain.handle("start-pdf-timer", () => {
  if (timerStartTime) return;
  timerStartTime = Date.now();
  timerInterval = setInterval(() => {
    if (timerStartTime) {
      updateUsageTime();
    }
  }, 5000); // Every 5 seconds
});

// IPC: Stop PDF timer
ipcMain.handle("stop-pdf-timer", () => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  updateUsageTime();
  timerStartTime = null;
});

// IPC: Get remaining trial seconds
ipcMain.handle("get-remaining-seconds", async () => {
  const user = loadUser();

  // Check premium status from backend if user is signed in
  if (user?.uid) {
    try {
      const response = await axios.post(`${BACKEND_URL}/entitlement`, {
        uid: user.uid
      });

      if (response.data.isPremium) {
        return Infinity; // Unlimited for premium users
      }

      // Return trial time from backend
      if (response.data.trialSecondsRemaining !== undefined) {
        return response.data.trialSecondsRemaining;
      }
    } catch (err) {
      console.error('Failed to check entitlement:', err);
    }
  }

  // Fallback to local trial tracking (1 hour per day)
  const usage = loadUsage();
  const DAILY_LIMIT_SECONDS = 3600; // 1 hour per day
  return Math.max(0, DAILY_LIMIT_SECONDS - usage.dailySecondsUsed);
});

// IPC: Create Stripe checkout session
ipcMain.handle("create-checkout-session", async (_event) => {
  const user = loadUser();

  if (!user?.uid) {
    return { error: "You must be signed in to upgrade" };
  }

  try {
    const response = await axios.post(`${BACKEND_URL}/create-checkout-session`, {
      uid: user.uid,
      email: user.email
    });

    return { url: response.data.url };
  } catch (err) {
    console.error('Failed to create checkout session:', err);
    return { error: err.message };
  }
});

// IPC: Manage subscription (open Stripe customer portal)
ipcMain.handle("manage-subscription", async (_event) => {
  const user = loadUser();

  if (!user?.uid) {
    return { error: "You must be signed in" };
  }

  try {
    const response = await axios.post(`${BACKEND_URL}/manage-subscription`, {
      uid: user.uid
    });

    return { url: response.data.url };
  } catch (err) {
    console.error('Failed to get customer portal:', err);
    return { error: err.message };
  }
});

async function checkForUpdates() {
  try {
    // read version info from YOUR website
    const res = await axios.get('https://www.eclipsepdf.com/version.json', { timeout: 8000 });
    const data = res.data;

    if (data?.latestVersion && data.latestVersion !== currentVersion) {
      // choose the right link for this OS
      const downloadLink = process.platform === 'win32'
        ? data.windowsStoreLink
        : data.linuxAppImageLink;

      const choice = dialog.showMessageBoxSync({
        type: 'info',
        buttons: ['Open download page', 'Later'],
        defaultId: 0,
        title: 'Update Available',
        message: `A new version (${data.latestVersion}) is available.`,
        detail: data.changelog || ''
      });

      if (choice === 0 && downloadLink) shell.openExternal(downloadLink);
    }
  } catch (err) {
    console.log('Update check failed:', err.message);
  }
}


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
      sandbox: false,
      webSecurity: false
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
  if (app.isPackaged && !process.windowsStore) checkForUpdates();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
