import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCompanion } from '../lib/transport.js';

// Stands in for the pet process: says hello and ready, counts state frames, and after the second
// one reloads (sends ready again), which must bring the current state once more.
const PEER = `
const net = require('node:net'), fs = require('node:fs');
const socket = net.createConnection(process.env.DSH_WHALE_PIPE);
socket.setEncoding('utf8');
socket.write(JSON.stringify({ type: 'hello', token: process.env.DSH_WHALE_TOKEN }) + '\\n');
socket.write(JSON.stringify({ type: 'ready' }) + '\\n');
const frames = [];
let buffer = '';
socket.on('data', chunk => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\\n')) >= 0) {
    const msg = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
    if (msg.type !== 'state') continue;
    frames.push(msg.state.n);
    if (frames.length === 2) socket.write(JSON.stringify({ type: 'ready' }) + '\\n');
    if (frames.length === 3) { fs.writeFileSync(process.env.WHALE_PEER_OUT, JSON.stringify(frames)); process.exit(0); }
  }
});
`;

test('identical state frames are sent once; a reloaded pet gets the state again', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-transport-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const entry = path.join(dir, 'peer.cjs');
  const out = path.join(dir, 'frames.json');
  fs.writeFileSync(entry, PEER);
  process.env.WHALE_PEER_OUT = out;
  t.after(() => { delete process.env.WHALE_PEER_OUT; });
  let current = { n: 1 };
  const bridge = await startCompanion({ electronPath: process.execPath, entry, hidden: true, getState: () => current, onDecision() {}, onDisconnect() {} });
  t.after(() => bridge.close());
  for (let i = 0; i < 100 && !bridge.isReady(); i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(bridge.isReady(), 'the stand-in pet never got ready');
  bridge.send(current);            // same as the frame sent on ready: dropped
  current = { n: 2 };
  bridge.send(current);            // changed: sent
  bridge.send({ n: 2 });           // identical again: dropped
  for (let i = 0; i < 100 && !fs.existsSync(out); i++) await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), [1, 2, 2]);
});
