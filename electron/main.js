// 纯粹CC — Electron desktop shell.
// Runs the dashboard server in a normal Node process (so the prebuilt node-pty
// keeps working). Sessions open as native windows; minimizing parks them as small
// bars stacked at the bottom-right of the screen.
const { app, BrowserWindow, ipcMain, screen, Menu } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const APP_NAME = '纯粹CC';
// must run before app is ready so the macOS menu-bar / dock name is correct (even in dev)
app.setName(APP_NAME);
app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: '1.0.0', credits: 'by 存粹' });

function buildAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: APP_NAME, submenu: [
      { role: 'about', label: `关于 ${APP_NAME}` },
      { type: 'separator' },
      { role: 'hide', label: `隐藏 ${APP_NAME}` },
      { role: 'hideOthers', label: '隐藏其他' },
      { role: 'unhide', label: '全部显示' },
      { type: 'separator' },
      { role: 'quit', label: `退出 ${APP_NAME}` },
    ] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' },
    ] },
    { label: '视图', submenu: [
      { role: 'reload', label: '重新加载' }, { role: 'toggleDevTools', label: '开发者工具' },
      { type: 'separator' }, { role: 'resetZoom', label: '实际大小' },
      { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' },
      { type: 'separator' }, { role: 'togglefullscreen', label: '全屏' },
    ] },
    { label: '窗口', role: 'windowMenu' },
  ]));
}

const PORT = process.env.PORT || 4317;
const ROOT = path.join(__dirname, '..');
const URL = `http://localhost:${PORT}`;
const PRELOAD = path.join(__dirname, 'preload.js');
let server = null;

// forward a window's renderer console + load failures to this terminal (debugging)
function attachDiag(win, tag) {
  const wc = win.webContents;
  wc.on('console-message', (_e, level, message, line, src) => {
    console.log(`  [${tag}] ${message}`);
  });
  wc.on('did-fail-load', (_e, code, desc, url) => {
    console.log(`  [${tag}] 加载失败 ${code} ${desc} -> ${url}`);
  });
  wc.on('render-process-gone', (_e, d) => console.log(`  [${tag}] 渲染进程崩溃: ${d.reason}`));
}

// ---- minimized session windows: park as bars at bottom-right ----
const PILL_W = 240, PILL_H = 46, GAP = 8;
const minimized = new Map();   // win.id -> { bounds, slot }
const usedSlots = new Set();
function nextSlot() { let i = 0; while (usedSlots.has(i)) i++; return i; }
function slotBounds(slot, win) {
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  return { x: wa.x + wa.width - PILL_W - 12, y: wa.y + wa.height - PILL_H - 12 - slot * (PILL_H + GAP), width: PILL_W, height: PILL_H };
}

// dashboard → main: open a session window explicitly (one per project key)
const sessionWins = new Map(); // key (cwd) -> BrowserWindow
ipcMain.handle('helm:open-session', (e, opts) => {
  const { cwd, name, sessionId, resume, force, key } = opts || {};
  console.log(`  [open-session] name=${name} cwd=${cwd} sid=${(sessionId||'').slice(0,8)} resume=${resume}`);
  const existing = sessionWins.get(key);
  if (existing && !existing.isDestroyed()) {
    if (force) existing.close();
    else { if (existing.isMinimized()) existing.restore(); existing.focus(); return { focused: true }; }
  }
  const params = new URLSearchParams({ cwd: cwd || '', name: name || '终端', sessionId: sessionId || '', resume: resume ? '1' : '0' });
  const win = new BrowserWindow({
    width: 860, height: 560, minWidth: 360, minHeight: 0,
    backgroundColor: '#070b12', frame: false, title: name || '纯粹CC',
    webPreferences: { contextIsolation: true, preload: PRELOAD },
  });
  attachDiag(win, 'session');
  win.loadURL(URL + '/terminal.html?' + params.toString());
  sessionWins.set(key, win);
  win.on('closed', () => {
    if (sessionWins.get(key) === win) sessionWins.delete(key);
    const m = minimized.get(win.id); if (m) { usedSlots.delete(m.slot); minimized.delete(win.id); }
  });
  return { opened: true };
});

ipcMain.on('helm:minimize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || minimized.has(win.id)) return;
  const slot = nextSlot(); usedSlots.add(slot);
  minimized.set(win.id, { bounds: win.getBounds(), slot });
  win.setResizable(false);
  win.setBounds(slotBounds(slot, win));
  win.setAlwaysOnTop(true, 'floating');
});
ipcMain.on('helm:restore', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  const m = minimized.get(win.id); if (!m) return;
  win.setAlwaysOnTop(false);
  win.setResizable(true);
  win.setBounds(m.bounds);
  usedSlots.delete(m.slot); minimized.delete(win.id);
  win.focus();
});
ipcMain.on('helm:close', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  const m = minimized.get(win.id); if (m) { usedSlots.delete(m.slot); minimized.delete(win.id); }
  win.close();
});

function startServer() {
  const env = { ...process.env, PORT: String(PORT) };
  // packaged: end users may not have Node installed → run server with Electron's own Node
  let exec = 'node';
  if (app.isPackaged) { exec = process.execPath; env.ELECTRON_RUN_AS_NODE = '1'; }
  server = spawn(exec, [path.join(ROOT, 'server.js')], { cwd: ROOT, env, stdio: 'inherit' });
  server.on('error', (err) => console.error('server spawn error:', err.message));
}
function waitForServer(cb, tries = 0) {
  http.get(URL + '/api/data', (res) => { res.destroy(); cb(); })
    .on('error', () => { tries > 60 ? cb() : setTimeout(() => waitForServer(cb, tries + 1), 250); });
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#070b12', titleBarStyle: 'hiddenInset', title: '纯粹CC',
    webPreferences: { contextIsolation: true, preload: PRELOAD },
  });
  attachDiag(win, 'main');
  win.loadURL(URL);

  // session windows (window.open from the dashboard) → frameless native windows
  win.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 860, height: 560, minWidth: 360, minHeight: 0,
      backgroundColor: '#070b12', frame: false, title: '纯粹CC',
      webPreferences: { contextIsolation: true, preload: PRELOAD },
    },
  }));
  return win;
}

app.whenReady().then(() => {
  buildAppMenu();
  startServer();
  waitForServer(() => {
    createMainWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('quit', () => { if (server) { try { server.kill(); } catch {} } });
