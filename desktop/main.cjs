const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sideAt, dockBounds, hintAt, clampPetBounds } = require('./edge.cjs');
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
// Empty room the page keeps right of the pet column (--peek-room in styles.css): peeking from the left
// edge, the task cards lean right of the head into it, and near the left edge the composer opens there.
// Only the pet column has to stay on screen.
const PEEK_ROOM = 250;
// Hidden test windows never overwrite the real pet's remembered position (the pet column's right edge).
// Unchanged positions are not rewritten.
let savedPosition = '';
function save() {
  if (hidden || !win || win.isDestroyed()) return;
  const b = win.getBounds();
  const position = JSON.stringify({ x: b.x + b.width - PEEK_ROOM, y: b.y + b.height });
  if (position === savedPosition) return;
  savedPosition = position;
  fs.writeFileSync(preferences, position);
}
// The window keeps one size while the pet is used: resizing a transparent window repaints it, and the
// pet visibly flickered whenever cards, notices or the composer changed its size. It is as tall as the
// work area and as wide as the page asks (room for the composer; it only changes with the pet size),
// anchored at the pet's bottom-right corner. Empty parts let the mouse through (see whale:interactive).
const SIZES = { collapsed: { width: 300, height: 240 }, expanded: { width: 300 } };
let reportedWidth = 0;
// The size the window is meant to have; drags reuse it so display-scaling rounding never accumulates.
let targetSize = { width: SIZES.collapsed.width, height: SIZES.collapsed.height };
let petRect = null, edgeSide = null;
let lastEdgeHint = '';
function updateDragHint(active) {
  const hint = active && petRect && !state.approvals.length && !(state.questions ?? []).length
    ? hintAt(win.getBounds(), petRect, petDisplay().workArea) : null;
  const key = JSON.stringify(hint);
  if (key === lastEdgeHint) return;
  lastEdgeHint = key;
  if (rendererReady) win.webContents.send('whale:edge-hint', hint);
}
function petDisplay() {
  const b = win.getBounds();
  return screen.getDisplayNearestPoint({ x: Math.round(b.x + (petRect?.x ?? b.width / 2) + (petRect?.width ?? 0) / 2), y: Math.round(b.y + (petRect?.y ?? b.height / 2) + (petRect?.height ?? 0) / 2) });
}
// Where her feet are in the pet box: the sprites are square with the feet at 98.8% of their height,
// drawn 112px wide in a 156px image box, inside the 160px-tall pet box.
const FEET = 0.84;
const feetFromTop = () => petRect.y + petRect.height * FEET;
// Released close above the bottom edge of the screen, she stands on it (her box may hang below it).
function standOnFloor(bounds, area) {
  if (!petRect) return bounds;
  const gap = area.y + area.height - (bounds.y + feetFromTop());
  const snap = Math.max(48, petRect.height * (1 - FEET) + 16);
  return gap >= -1 && gap <= snap ? { ...bounds, y: Math.round(area.y + area.height - feetFromTop()) } : bounds;
}
// Keep the pet on the screen; downwards she may go until her feet touch the bottom edge.
function keepOnScreen(bounds, area) {
  const clamped = clampPetBounds(bounds, petRect, area);
  return bounds.y > clamped.y ? { ...clamped, y: Math.round(Math.min(bounds.y, area.y + area.height - feetFromTop())) } : clamped;
}
// Released: on the screen, standing on its bottom edge when she is close to it.
const placePet = (bounds, area) => standOnFloor(keepOnScreen(bounds, area), area);
function setEdge(side) {
  if (edgeSide === side) return;
  edgeSide = side;
  if (rendererReady) win.webContents.send('whale:edge', side);
}
function dockAtEdge() {
  if (!petRect || state.approvals.length || (state.questions ?? []).length) return;
  const area = petDisplay().workArea;
  const b = win.getBounds();
  const side = sideAt(b, petRect, area);
  if (side) expanded = false;
  setEdge(side);
  if (side) win.setBounds(dockBounds(b, petRect, area, side));
}
function revealEdge() {
  if (!edgeSide) return;
  setEdge(null);
  resize(expanded);
}
function resize(value, _height, reported) {
  expanded = value;
  if (expanded) setEdge(null);
  const b = win.getBounds();
  const area = petDisplay().workArea;
  if (reported > 0) reportedWidth = Math.round(reported);
  const width = Math.min(area.width, Math.max(SIZES.collapsed.width, reportedWidth));
  const height = area.height;
  targetSize = { width, height };
  // Keep the pet column (300px left of the peek room) and the pet's feet on screen; the rest may hang off an edge.
  const right = Math.max(area.x + SIZES.collapsed.width + PEEK_ROOM, Math.min(b.x + b.width, area.x + area.width + PEEK_ROOM));
  // Standing on the bottom edge, the window reaches below it by as much as her feet are above its bottom.
  const below = petRect ? Math.max(0, Math.round(b.height - feetFromTop())) : 0;
  const bottom = Math.max(area.y + 200, Math.min(b.y + b.height, area.y + area.height + below));
  let next = { x: right - width, y: bottom - height, width, height };
  if (edgeSide && petRect) next = dockBounds({ ...next, x: b.x + b.width - width }, { ...petRect, x: petRect.x + width - b.width, y: petRect.y + height - b.height }, area, edgeSide);
  if (next.x !== b.x || next.y !== b.y || next.width !== b.width || next.height !== b.height) win.setBounds(next);
  publishArea();
}
// The pet's work area and the window's bounds, so the page can keep the composer on screen. Sent only
// when they change: the page measures its layout on each one.
let sentArea = '';
function publishArea() {
  if (!rendererReady || !win || win.isDestroyed()) return;
  const area = { ...petDisplay().workArea, window: win.getBounds() };
  const key = JSON.stringify(area);
  if (key === sentArea) return;
  sentArea = key;
  win.webContents.send('whale:area', area);
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
        if (state.notice?.id && state.notice.id !== oldNotice) { revealEdge(); show(); }
        publish();
      }
    }
  });
  socket.on('error', () => {});
  socket.on('close', () => { if (!closing) quit(); });
}
app.whenReady().then(async () => {
  const area = screen.getPrimaryDisplay().workArea;
  const right = (Number.isFinite(settings.x) ? settings.x : area.x + area.width - 24) + PEEK_ROOM;
  const bottom = Number.isFinite(settings.y) ? settings.y : area.y + area.height - 16;
  win = new BrowserWindow({
    width: SIZES.collapsed.width, height: SIZES.collapsed.height, x: Math.max(area.x, Math.min(right - SIZES.collapsed.width, area.x + area.width + PEEK_ROOM - SIZES.collapsed.width)), y: Math.max(area.y, Math.min(bottom - SIZES.collapsed.height, area.y + area.height - SIZES.collapsed.height)),
    title: '鲸鱼娘 · DSH', frame: false, transparent: true, backgroundColor: '#00000000', show: false, hasShadow: false,
    resizable: false, maximizable: false, minimizable: false, skipTaskbar: true, alwaysOnTop: settings.top,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: false, backgroundThrottling: true, spellcheck: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  win.on('close', (e) => { if (!closing) { e.preventDefault(); win.hide(); } });
  // A drag saves once when it ends.
  win.on('moved', () => { if (!drag) save(); });
  // Windows reports right-clicks on drag regions as a system menu request; show ours instead.
  // The pet is dragged by the page (not a drag region), so right-clicks reach it as ordinary
  // events. While a drag lasts the window follows the real cursor; page move events are not
  // used, since they go stale once the window moves under the pointer.
  let drag;
  const stopDrag = () => {
    updateDragHint(false);
    if (!drag) return;
    clearInterval(drag.timer);
    const { width, height } = targetSize;
    const moved = drag.moved;
    drag = undefined;
    let landing = null;
    if (win && !win.isDestroyed()) {
      const b = win.getBounds();
      const next = petRect ? placePet({...b,width,height}, petDisplay().workArea) : {...b,width,height};
      win.setBounds(next);
      const area = petDisplay().workArea;
      if (moved && petRect && next.y - b.y > 2 && Math.abs(next.y + feetFromTop() - (area.y + area.height)) <= 1)
        landing = {drop: Math.max(0, next.y - b.y)};
    }
    save();
    dockAtEdge();
    if (landing && !edgeSide && rendererReady) win.webContents.send('whale:landing', landing);
    publishArea();
  };
  ipcMain.on('whale:drag', (e, phase) => {
    if (!own(e)) return;
    if (phase === 'end') return stopDrag();
    if (phase !== 'start') return;
    stopDrag();
    setEdge(null);
    const cursor = screen.getCursorScreenPoint();
    const start = win.getBounds();
    const offset = { x: cursor.x - start.x, y: cursor.y - start.y };
    const startedAt = Date.now();
    updateDragHint(true);
    let last = cursor;
    drag = { timer: setInterval(() => {
      if (!win || win.isDestroyed() || Date.now() - startedAt > 30000) return stopDrag();
      const point = screen.getCursorScreenPoint();
      // A held but unmoved cursor leaves the window where it is.
      if (point.x === last.x && point.y === last.y) return;
      last = point;
      if (Math.hypot(point.x - cursor.x, point.y - cursor.y) > 3) drag.moved = true;
      const b = win.getBounds();
      const desired = {x: point.x - offset.x, y: point.y - offset.y, ...targetSize};
      const next = petRect ? keepOnScreen(desired, screen.getDisplayNearestPoint(point).workArea) : desired;
      // Always the intended size: re-reading it lets display-scaling rounding grow the window.
      if (next.x !== b.x || next.y !== b.y) win.setBounds(next);
      updateDragHint(true);
    }, 16) };
  });
  win.on('blur', stopDrag);
  const own = event => event.sender === win.webContents;
  ipcMain.on('whale:ready', e => { if (!own(e)) return; rendererReady = true; sentArea = ''; publish(); publishArea(); if (socket?.readyState === 'open') socket.write(JSON.stringify({ type: 'ready' }) + '\n'); });
  ipcMain.on('whale:pet-rect', (e, rect) => {
    if (!own(e) || !rect || !['x','y','width','height'].every(key => Number.isFinite(rect[key])) || rect.width <= 0 || rect.height <= 0 || rect.width > 1000 || rect.height > 1000) return;
    // The page is laid out from the bottom, and under display scaling its height can differ from the
    // window's by a pixel or two: keep the pet's distance from the bottom, as the window sees it.
    const shift = Number.isFinite(rect.viewHeight) && rect.viewHeight > 0 ? win.getBounds().height - rect.viewHeight : 0;
    petRect = { x: rect.x, y: rect.y + shift, width: rect.width, height: rect.height };
    // Reported on every render: display-scaling rounding may differ by a pixel from the last placement,
    // and chasing it would make the pet creep, so only real moves are applied.
    const b = win.getBounds();
    const next = edgeSide && !expanded ? dockBounds(b, petRect, petDisplay().workArea, edgeSide) : drag ? keepOnScreen(b, petDisplay().workArea) : placePet(b, petDisplay().workArea);
    if (Math.abs(next.x - b.x) > 1 || Math.abs(next.y - b.y) > 1) { win.setBounds(next); publishArea(); }
  });
  ipcMain.on('whale:reveal', e => { if (own(e)) revealEdge(); });
  const displayChanged = () => { if (!win || win.isDestroyed()) return; setEdge(null); resize(expanded); };
  screen.on('display-removed', displayChanged);
  screen.on('display-metrics-changed', displayChanged);
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
module.exports = { getWindow: () => win, getState: () => state, isPinned: () => settings.top, dockAtEdge, revealEdge, quit };
