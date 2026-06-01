// Helm — Electron desktop shell.
// Runs the dashboard server in a normal Node process (so the prebuilt node-pty
// keeps working), then shows it in native windows. Pop-outs become real OS windows.
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = process.env.PORT || 4317;
const ROOT = path.join(__dirname, '..');
const URL = `http://localhost:${PORT}`;
let server = null;

function startServer() {
  // use system `node` (not Electron) so the native node-pty binary loads cleanly
  server = spawn('node', [path.join(ROOT, 'server.js')], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit',
  });
  server.on('error', (e) => console.error('server spawn error:', e.message));
}

function waitForServer(cb, tries = 0) {
  http.get(URL + '/api/data', (res) => { res.destroy(); cb(); })
    .on('error', () => {
      if (tries > 60) { cb(); return; }
      setTimeout(() => waitForServer(cb, tries + 1), 250);
    });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#070b12',
    titleBarStyle: 'hiddenInset',
    title: 'Helm',
    webPreferences: { contextIsolation: true },
  });
  win.loadURL(URL);

  // pop-outs (window.open from the page) → native detached Helm windows, not browser tabs
  win.webContents.setWindowOpenHandler(({ url }) => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 960, height: 660, backgroundColor: '#070b12',
      titleBarStyle: 'hiddenInset', title: 'Helm',
    },
  }));
  return win;
}

app.whenReady().then(() => {
  startServer();
  waitForServer(() => {
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('quit', () => { if (server) { try { server.kill(); } catch {} } });
