import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { apply } from '../lib/index.js';
import { PetState } from '../lib/state.js';

async function harness() {
  const session = { id: 'session', header: {} };
  const agent = { id: session.id, session, status: 'idle' };
  const listeners = new Map();
  const cleanups = [];
  let options, state;
  await apply({
    sessions: { list: () => [session] }, agents: { get: () => agent },
    on: (event, handler) => listeners.set(event, handler),
    effect: effect => cleanups.push(effect()),
  }, {}, {
    observe: plugin => { state = plugin.state; },
    startCompanion: async config => {
      options = config;
      return { isReady: () => true, send() {}, setStandby() {}, close() {} };
    },
  });
  return {
    options, state, dispose: () => cleanups.forEach(cleanup => cleanup()),
    ask: (signal, next) => listeners.get('user-questions/request')({
      agent, signal, questions: [{ id: 'q', question: 'Continue?', options: [{ label: 'Yes' }] }],
    }, next),
  };
}

test('settled questions release their turn signal listeners after either answer path', async t => {
  const h = await harness();
  t.after(h.dispose);
  const turn = new AbortController();
  const answer = { answers: [{ id: 'q', selected: ['Yes'] }] };
  for (let i = 0; i < 30; i++) {
    const pending = h.ask(turn.signal, i % 2 === 0 ? () => answer : () => new Promise(() => {}));
    if (i % 2 !== 0) {
      const id = h.state.snapshot().questions[0].id;
      h.options.onAnswer({ id, ...answer }, reply => assert.deepEqual(reply, { ok: true }));
    }
    assert.deepEqual(await pending, answer);
    assert.equal(getEventListeners(turn.signal, 'abort').length, 0);
  }
});

test('dropping a still-pending question keeps cancellation active until it settles', async t => {
  const h = await harness();
  t.after(h.dispose);
  const turn = new AbortController();
  const pending = h.ask(turn.signal, () => new Promise(() => {}));
  h.options.onDisconnect();
  assert.equal(h.state.snapshot().questions.length, 0);
  assert.equal(getEventListeners(turn.signal, 'abort').length, 1);
  const rejected = assert.rejects(pending, /cancelled by user/);
  turn.abort(new Error('cancelled by user'));
  await rejected;
  assert.equal(getEventListeners(turn.signal, 'abort').length, 0);
});

test('snapshot preserves approval precedence and live child visibility without mutating source sessions', () => {
  const state = new PetState();
  const root = { id: 'root', header: { cwd: 'C:\\demo' } };
  const child = { id: 'child', header: { origin: 'subagent', parentSession: 'root' } };
  const hidden = { id: 'hidden', header: {} };
  state.seed(root); state.seed(child); state.seed(hidden);
  state.addQuestion('question', { agent: { session: child }, questions: [{ id: 'q', question: 'Continue?' }] });
  state.addApproval('approval', { agent: { session: child }, toolName: 'exec_command' });
  assert.deepEqual(state.snapshot().projects.map(p => [p.id, p.detail]), [['root', '等待批准']]);
  assert.equal(state.sessions.get('root').status, 'idle');
  state.approvals.clear();
  assert.deepEqual(state.snapshot().projects.map(p => [p.id, p.detail]), [['root', '等待你的回答']]);
  state.questions.clear();
  assert.deepEqual(state.snapshot().projects.map(p => [p.id, p.status]), [['root', 'idle']]);
});

test('streamed events change nothing once a session is live, and the pet is not told about them', async t => {
  const h = await harness();
  t.after(h.dispose);
  const { state, session } = { state: h.state, session: { id: 'session', header: {} } };
  assert.equal(state.event(session, { type: 'message/delta', data: {} }), true, 'the first event marks the session live');
  for (let i = 0; i < 50; i++) assert.equal(state.event(session, { type: 'message/delta', data: { text: 'tok' } }), false);
  assert.equal(state.event(session, { type: 'tool/call', data: { callId: 'c', name: 'read_file', arguments: '{}' } }), true);
  assert.equal(state.snapshot().projects[0].status, 'working');
  const view = h.options.getState();
  assert.equal('sessions' in view, false, 'full session records stay in the Host');
  assert.equal(view.projects.length, 1);
});
