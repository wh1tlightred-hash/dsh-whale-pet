import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_FRAME = 1024 * 1024;

export async function startCompanion({ onDecision, onDisconnect, onReady, onHide, onShow, onChat, onAnswer, getState, logger = console, electronPath, hidden = false, entry = path.join(ROOT, 'desktop', 'main.cjs') }) {
  const executable = electronPath || process.env.DSH_WHALE_ELECTRON || path.join(ROOT, '.runtime', 'electron', 'electron.exe');
  if (!fs.existsSync(executable)) throw new Error('桌宠运行时缺失，请运行 scripts/install.ps1。');
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\dsh-whale-${randomBytes(16).toString('hex')}` : path.join(ROOT, '.local', `whale-${randomBytes(16).toString('hex')}.sock`);
  fs.mkdirSync(path.join(ROOT, '.local'), { recursive: true });
  const token = randomBytes(32).toString('hex');
  let socket, child, ready = false, closed = false, standby = false;
  const peers = new Set();
  // Identical frames are dropped: the pet would parse and re-render them for nothing.
  let lastFrame = '';
  const send = (state) => {
    if (!ready || !socket?.writable) return;
    const frame = JSON.stringify({ type: 'state', state }) + '\n';
    if (frame === lastFrame) return;
    lastFrame = frame;
    socket.write(frame);
  };
  const sendStandby = () => { if (ready && socket?.writable) socket.write(JSON.stringify({ type: 'standby', value: standby }) + '\n'); };
  const server = net.createServer((peer) => {
    peer.setEncoding('utf8');
    peers.add(peer);
    let buffer = '', authenticated = false;
    const timer = setTimeout(() => { if (!authenticated) peer.destroy(); }, 5000);
    timer.unref();
    peer.on('error', () => {});
    peer.on('close', () => {
      clearTimeout(timer); peers.delete(peer);
      if (socket === peer) { ready = false; socket = undefined; if (!closed) onDisconnect?.(); }
    });
    peer.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > MAX_FRAME) return peer.destroy();
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { peer.destroy(); return; }
        if (!authenticated) {
          if (msg.type !== 'hello' || msg.token !== token || socket) { peer.destroy(); return; }
          authenticated = true; clearTimeout(timer); socket = peer;
          continue;
        }
        if (msg.type === 'hide') { onHide?.(); continue; }
        if (msg.type === 'show') { onShow?.(); continue; }
        if (msg.type === 'ready') { ready = true; lastFrame = ''; if (standby) sendStandby(); send(getState()); onReady?.(); }
        if (msg.type === 'answer' && typeof msg.id === 'string' && typeof msg.requestId === 'string') {
          const reply = (result) => { if (!peer.destroyed) peer.write(JSON.stringify({ type: 'result', requestId: msg.requestId, result }) + '\n'); };
          Promise.resolve().then(() => onAnswer ? onAnswer({ id: msg.id, answers: msg.answers }, reply) : reply({ ok: false, error: '当前 dsh 不支持在桌宠中回答' })).catch(() => reply({ ok: false, error: '回答提交失败，请回到 dsh 查看。' }));
          continue;
        }
        if (msg.type === 'chat' && typeof msg.requestId === 'string') {
          const reply = (result) => { if (!peer.destroyed) peer.write(JSON.stringify({ type: 'result', requestId: msg.requestId, result }) + '\n'); };
          Promise.resolve().then(() => onChat ? onChat(String(msg.text ?? ''), typeof msg.sessionId === 'string' ? msg.sessionId : undefined, typeof msg.workspaceId === 'string' ? msg.workspaceId : undefined) : { ok: false, error: '当前 dsh 不支持从桌宠发起对话' }).then(reply, () => reply({ ok: false, error: '发起对话失败，请在 dsh 中重试' }));
          continue;
        }
        if (msg.type === 'decide' && typeof msg.id === 'string' && typeof msg.requestId === 'string') {
          const reply = (result) => { if (!peer.destroyed) peer.write(JSON.stringify({ type: 'result', requestId: msg.requestId, result }) + '\n'); };
          if (!['allowed-once', 'rejected'].includes(msg.decision)) { reply({ ok: false, error: '无效的审批选项' }); continue; }
          Promise.resolve().then(() => onDecision({ id: msg.id, decision: msg.decision }, reply)).catch(() => reply({ ok: false, error: '审批处理失败，请回到 dsh 查看。' }));
        }
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipe, () => { server.off('error', reject); resolve(); }); });
  server.on('error', (error) => logger.warn?.('[whale-pet] pipe:', error.message));
  const env = { ...process.env, DSH_WHALE_PIPE: pipe, DSH_WHALE_TOKEN: token, DSH_WHALE_PARENT: String(process.pid), DSH_WHALE_HIDDEN: hidden ? '1' : '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  let log;
  try {
    log = fs.openSync(path.join(ROOT, '.local', 'desktop.log'), 'a');
    child = spawn(executable, [entry], { env, windowsHide: true, stdio: ['ignore', log, log] });
  } catch (error) {
    for (const peer of peers) peer.destroy();
    server.close();
    throw error;
  } finally { if (log !== undefined) fs.closeSync(log); }
  const lost = () => {
    if (!closed) { const wasReady = ready; ready = false; if (!wasReady) onDisconnect?.(); socket?.destroy(); }
    server.close();
    for (const peer of peers) peer.destroy();
  };
  child.once('error', (error) => { logger.warn?.('[whale-pet] launch:', error.message); lost(); });
  child.once('exit', lost);
  return {
    send,
    isReady: () => ready,
    /** Hide the pet but keep its window loaded, so showing it again is instant. */
    setStandby(value) { if (standby === Boolean(value)) return; standby = Boolean(value); sendStandby(); },
    close() {
      if (closed) return;
      closed = true; ready = false;
      socket?.write(JSON.stringify({ type: 'shutdown' }) + '\n');
      for (const peer of peers) peer.end();
      server.close();
      const timer = setTimeout(() => { for (const peer of peers) peer.destroy(); if (child.exitCode === null) child.kill(); }, 2000);
      timer.unref();
    },
    get pid() { return child.pid; },
    get exited() { return child.exitCode !== null || child.signalCode !== null; },
  };
}
