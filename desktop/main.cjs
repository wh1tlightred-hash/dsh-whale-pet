const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const LOCAL = path.join(ROOT, '.local');
fs.mkdirSync(LOCAL, { recursive: true });
app.setPath('userData', path.join(LOCAL, 'electron-data'));
app.setName('鲸鱼娘 · DSH');
app.commandLine.appendSwitch('disable-http-cache');
let win, tray, socket, state = { connected: false, projects: [], approvals: [], notice: null }, expanded = false, closing = false, rendererReady = false, standby = false;
const pending = new Map();
const hidden = process.env.DSH_WHALE_HIDDEN === '1';
const preferences = path.join(LOCAL, 'window.json');
// Every launch starts on top; unpinning lasts for this run only, so only the position is remembered.
let settings = { top: true };
try { const saved = JSON.parse(fs.readFileSync(preferences, 'utf8')); settings = { ...settings, x: saved.x, y: saved.y }; } catch {}
// Hidden test windows never overwrite the real pet's remembered position.
function save() { if (hidden || !win || win.isDestroyed()) return; const b = win.getBounds(); fs.writeFileSync(preferences, JSON.stringify({ x: b.x + b.width, y: b.y + b.height })); }
// The window keeps one size while the pet is used: resizing a transparent window repaints it, and the
// pet visibly flickered whenever cards, notices or the composer changed its size. It is as tall as the
// work area and as wide as the page asks (room for the composer; it only changes with the pet size),
// anchored at the pet's bottom-right corner. Empty parts let the mouse through (see whale:interactive).
const SIZES = { collapsed: { width: 300, height: 240 }, expanded: { width: 300 } };
let reportedWidth = 0;
// The size the window is meant to have; drags reuse it so display-scaling rounding never accumulates.
let targetSize = { width: SIZES.collapsed.width, height: SIZES.collapsed.height };
function resize(value, _height, reported) {
  expanded = value;
  const b = win.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  if (reported > 0) reportedWidth = Math.round(reported);
  const width = Math.min(area.width, Math.max(SIZES.collapsed.width, reportedWidth));
  const height = area.height;
  targetSize = { width, height };
  // Keep the pet column (the right 300px) and the pet's feet on screen; the rest may hang off an edge.
  const right = Math.max(area.x + SIZES.collapsed.width, Math.min(b.x + b.width, area.x + area.width));
  const bottom = Math.max(area.y + 200, Math.min(b.y + b.height, area.y + area.height));
  const next = { x: right - width, y: bottom - height, width, height };
  if (next.x !== b.x || next.y !== b.y || next.width !== b.width || next.height !== b.height) win.setBounds(next);
}
function publish() { if (rendererReady && win && !win.isDestroyed()) win.webContents.send('whale:state', { ...state, alwaysOnTop: settings.top }); }
function show() { if (!hidden && !standby && win && !win.isDestroyed()) win.showInactive(); }
// Switched off in DSH: stay loaded but invisible (no window, no pop-ups) until switched back on.
// The tray icon stays so the pet can be shown again from it.
function setStandby(value) {
  standby = value;
  if (standby) win?.hide();
  else show();
}
// Hide / show through DSH's switch so the client menu and settings show the same
// state; the pet reacts at once and the Host's standby message confirms it.
function requestSwitch(enabled) {
  console.log(`[whale-pet] ${enabled ? 'show' : 'hide'} requested`);
  setStandby(!enabled);
  if (socket?.writable) socket.write(JSON.stringify({ type: enabled ? 'show' : 'hide' }) + '\n');
}
const requestHide = () => requestSwitch(false);
function expandFromTray() {
  console.log('[whale-pet] expand requested from tray');
  if (standby) requestSwitch(true);
  resize(true); show();
  win.webContents.send('whale:state', { ...state, forceExpanded: true, alwaysOnTop: settings.top });
}
function setTop(value) {
  settings.top = Boolean(value);
  win.setAlwaysOnTop(settings.top);
  publish();
}
// Rebuilt on every right-click so the toggle names the current state. The open
// menu is kept referenced until the next one, so its click handlers stay alive.
let trayMenu;
const trayTip = () => `${typeof state.name === 'string' && state.name ? state.name : '蓝色大肥鱼'} · DSH 任务助手`;
function createTray() {
  if (tray || hidden) return;
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'whale-girl.png')).resize({ width: 24, height: 24 });
  tray = new Tray(icon);
  tray.setToolTip(trayTip());
  tray.on('click', () => { if (standby) requestSwitch(true); else show(); });
  tray.on('right-click', () => {
    trayMenu = Menu.buildFromTemplate([
      { label: standby ? '显示桌宠' : '隐藏桌宠', click: () => requestSwitch(standby) },
      { label: '展开项目与审批', click: expandFromTray },
    ]);
    tray.popUpContextMenu(trayMenu);
  });
}
function quit() { closing = true; for (const p of pending.values()) { clearTimeout(p.timer); p.resolve({ ok: false, error: 'dsh 连接已断开' }); } pending.clear(); app.quit(); }
function connect() {
  const pipe = process.env.DSH_WHALE_PIPE, token = process.env.DSH_WHALE_TOKEN;
  if (!pipe || !token) return quit();
  socket = net.createConnection(pipe);
  socket.setEncoding('utf8');
  let buffer = '';
  socket.on('connect', () => {
    socket.write(JSON.stringify({ type: 'hello', token }) + '\n');
    if (rendererReady) socket.write(JSON.stringify({ type: 'ready' }) + '\n');
  });
  socket.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024) return socket.destroy();
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx); buffer = buffer.slice(idx + 1);
      let msg; try { msg = JSON.parse(line); } catch { return socket.destroy(); }
      if (msg.type === 'shutdown') return quit();
      if (msg.type === 'standby') { setStandby(msg.value === true); continue; }
      if (msg.type === 'result') { const item = pending.get(msg.requestId); if (item) { clearTimeout(item.timer); pending.delete(msg.requestId); item.resolve(msg.result); } }
      if (msg.type === 'state') {
        if (typeof msg.state?.name === 'string' && msg.state.name !== state.name) tray?.setToolTip(`${msg.state.name} · DSH 任务助手`);
        const previous = new Set([...state.approvals, ...(state.questions ?? [])].map(a => a.id));
        const oldNotice = state.notice?.id;
        state = msg.state;
        if ([...state.approvals, ...(state.questions ?? [])].some(a => !previous.has(a.id))) { resize(true); show(); }
        if (state.notice?.id && state.notice.id !== oldNotice) show();
        publish();
      }
    }
  });
  socket.on('error', () => {});
  socket.on('close', () => { if (!closing) quit(); });
}
app.whenReady().then(async () => {
  const area = screen.getPrimaryDisplay().workArea;
  const right = Number.isFinite(settings.x) ? settings.x : area.x + area.width - 24;
  const bottom = Number.isFinite(settings.y) ? settings.y : area.y + area.height - 16;
  win = new BrowserWindow({
    width: SIZES.collapsed.width, height: SIZES.collapsed.height, x: Math.max(area.x, Math.min(right - SIZES.collapsed.width, area.x + area.width - SIZES.collapsed.width)), y: Math.max(area.y, Math.min(bottom - SIZES.collapsed.height, area.y + area.height - SIZES.collapsed.height)),
    title: '鲸鱼娘 · DSH', frame: false, transparent: true, backgroundColor: '#00000000', show: false, hasShadow: false,
    resizable: false, maximizable: false, minimizable: false, skipTaskbar: true, alwaysOnTop: settings.top,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: false, backgroundThrottling: true, spellcheck: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  win.on('close', (e) => { if (!closing) { e.preventDefault(); win.hide(); } });
  win.on('moved', save);
  // Windows reports right-clicks on drag regions as a system menu request; show ours instead.
  // The pet is dragged by the page (not a drag region), so right-clicks reach it as ordinary
  // events. While a drag lasts the window follows the real cursor; page move events are not
  // used, since they go stale once the window moves under the pointer.
  let drag;
  const stopDrag = () => {
    if (!drag) return;
    clearInterval(drag.timer);
    const { width, height } = targetSize;
    drag = undefined;
    if (win && !win.isDestroyed()) { const b = win.getBounds(); if (b.width !== width || b.height !== height) win.setBounds({ x: b.x, y: b.y, width, height }); }
    save();
  };
  ipcMain.on('whale:drag', (e, phase) => {
    if (!own(e)) return;
    if (phase === 'end') return stopDrag();
    if (phase !== 'start') return;
    stopDrag();
    const cursor = screen.getCursorScreenPoint();
    const start = win.getBounds();
    const offset = { x: cursor.x - start.x, y: cursor.y - start.y };
    const startedAt = Date.now();
    drag = { timer: setInterval(() => {
      if (!win || win.isDestroyed() || Date.now() - startedAt > 30000) return stopDrag();
      const point = screen.getCursorScreenPoint();
      const b = win.getBounds();
      const x = point.x - offset.x, y = point.y - offset.y;
      // Always the intended size: re-reading it lets display-scaling rounding grow the window.
      if (x !== b.x || y !== b.y) win.setBounds({ x, y, ...targetSize });
    }, 16) };
  });
  win.on('blur', stopDrag);
  const own = event => event.sender === win.webContents;
  ipcMain.on('whale:ready', e => { if (!own(e)) return; rendererReady = true; publish(); if (socket?.readyState === 'open') socket.write(JSON.stringify({ type: 'ready' }) + '\n'); });
  ipcMain.on('whale:expanded', (e, value, height, width) => { if (own(e)) resize(Boolean(value), Number(height), Number(width)); });
  // The page says whether the pointer is over something it draws; elsewhere clicks go to what is below.
  let interactive = false;
  const setInteractive = value => { if (interactive === value || !win || win.isDestroyed()) return; interactive = value; win.setIgnoreMouseEvents(!value, { forward: true }); };
  ipcMain.on('whale:interactive', (e, value) => { if (own(e)) setInteractive(Boolean(value)); });
  // A click-through window is never told when the cursor leaves it, so the page would keep its hover
  // state (an empty composer bar would stay open). Watch the cursor and report the exit ourselves.
  let cursorInside = false;
  const cursorWatch = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) { cursorInside = false; return; }
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    if (cursorInside && !inside) win.webContents.sendInputEvent({ type: 'mouseLeave', x: -1, y: -1 });
    cursorInside = inside;
  }, 100);
  cursorWatch.unref?.();
  ipcMain.on('whale:top', (e, value) => { if (own(e)) setTop(value); });
  ipcMain.on('whale:hide', e => { if (own(e)) requestHide(); });
  ipcMain.handle('whale:answer', async (e, id, answers) => {
    if (!own(e) || !socket?.writable || !(state.questions ?? []).some(q => q.id === id) || !Array.isArray(answers)) return { ok: false, error: '问题已回答或连接已断开' };
    return new Promise(resolve => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(requestId); resolve({ ok: false, error: '回答提交超时，请查看 dsh 当前状态' }); }, 15000);
      pending.set(requestId, { resolve, timer });
      socket.write(JSON.stringify({ type: 'answer', id, answers, requestId }) + '\n');
    });
  });
  ipcMain.handle('whale:chat', async (e, text, sessionId, workspaceId) => {
    if (!own(e) || !socket?.writable) return { ok: false, error: 'dsh 连接已断开' };
    const input = String(text ?? '').slice(0, 4000);
    if (!input.trim()) return { ok: false, error: '请输入内容' };
    const target = typeof sessionId === 'string' && state.projects.some(p => p.id === sessionId) ? sessionId : undefined;
    if (sessionId != null && target === undefined) return { ok: false, error: '所选对话已不在桌宠中，请重新选择' };
    return new Promise(resolve => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(requestId); resolve({ ok: false, error: '发起对话超时，请在 dsh 中查看' }); }, 35000);
      pending.set(requestId, { resolve, timer });
      const workspace = !target && typeof workspaceId === 'string' && (state.workspaces ?? []).some(w => w.id === workspaceId) ? workspaceId : undefined;
      socket.write(JSON.stringify({ type: 'chat', text: input, requestId, ...(target ? { sessionId: target } : {}), ...(workspace ? { workspaceId: workspace } : {}) }) + '\n');
    });
  });
  ipcMain.handle('whale:decide', async (e, id, decision) => {
    if (!own(e) || !socket?.writable || !['allowed-once', 'rejected'].includes(decision) || !state.approvals.some(a => a.id === id)) return { ok: false, error: '审批已失效或连接已断开' };
    return new Promise(resolve => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(requestId); resolve({ ok: false, error: '审批响应超时，请查看 dsh 当前状态' }); }, 15000);
      pending.set(requestId, { resolve, timer });
      socket.write(JSON.stringify({ type: 'decide', id, decision, requestId }) + '\n');
    });
  });
  createTray();
  await win.loadFile(path.join(ROOT, 'ui', 'index.html'));
  win.setIgnoreMouseEvents(true, { forward: true });
  connect(); show();
  const parentPid = Number(process.env.DSH_WHALE_PARENT);
  const timer = setInterval(() => { if (parentPid) { try { process.kill(parentPid, 0); } catch { quit(); } } }, 3000);
  timer.unref();
}).catch(error => { console.error('[whale-pet]', error); app.exit(1); });
app.on('before-quit', () => { closing = true; save(); socket?.destroy(); tray?.destroy(); });
app.on('window-all-closed', () => app.quit());
module.exports = { getWindow: () => win, getState: () => state, isPinned: () => settings.top, quit };
