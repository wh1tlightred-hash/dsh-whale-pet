import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';
import { PetState, classifyTool, MAX_OPERATION_LENGTH } from '../lib/state.js';

const makeSession = (id = 'session-1', events = []) => ({ id, header: { cwd: 'C:\\work\\demo' }, snapshotEvents: () => events });

async function harness({ ready = true, config = {}, settings, sessionController, workspaceRegistry } = {}) {
  const session = makeSession();
  const agent = { id: session.id, session, status: 'idle' };
  const listeners = new Map();
  const cleanups = [];
  let options;
  let closed = false;
  let starts = 0;
  let standby = false;
  const ctx = {
    sessions: { list: () => [session] }, agents: { get: () => agent }, logger: { warn() {} },
    effect: fn => cleanups.push(fn()),
    inject: (deps, fn) => {
      const services = { settings, sessionController, workspaceRegistry };
      if (deps.every(name => services[name])) fn({ ...services, effect: f => cleanups.push(f()) });
    },
    fiber: {},
    on: (event, handler, config) => { listeners.set(event, { handler, config }); },
  };
  let plugin;
  const applyResult = await apply(ctx, config, { observe: value => { plugin = value; }, startCompanion: async config => {
    options = config;
    starts++;
    closed = false;
    standby = false;
    return { isReady: () => ready, send() {}, close() { closed = true; }, setStandby(value) { standby = value; }, exited: false };
  } });
  return { ...plugin, applyResult, session, agent, options, listeners, dispose: () => cleanups.forEach(fn => fn()), isClosed: () => closed, starts: () => starts, isStandby: () => standby,
    volatileUpdate: () => listeners.get('loader/volatile-update').handler([['enabled']]),
    request: (next, signal) => listeners.get('approval/request').handler({ agent, toolName: 'exec_command', callId: 'call-1', reason: '安装所需依赖', signal }, next),
    decide(id, decision) { let reply; options.onDecision({ id, decision }, result => { reply = result; }); return reply; },
  };
}

test('live event projection distinguishes successful, failed, and interrupted turns', () => {
  const state = new PetState();
  const session = makeSession();
  state.seed(session);
  state.event(session, { type: 'turn/start', data: {} });
  state.event(session, { type: 'tool/call', data: { callId: 'a', name: 'exec_command', arguments: '{"cmd":"npm test"}' } });
  assert.equal(state.snapshot().sessions[0].status, 'testing');
  state.event(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  assert.equal(state.snapshot().notice, null);
  state.agentStatus({ session, inbox: { nextTurn: [], nextStep: [] } }, 'idle');
  assert.equal(state.snapshot().notice.kind, 'completed');
  state.event(session, { type: 'turn/end', data: { reason: { kind: 'error' } } });
  assert.equal(state.snapshot().notice.kind, 'error');
  state.event(session, { type: 'turn/end', data: { reason: { kind: 'aborted' } } });
  assert.equal(state.snapshot().notice.kind, 'aborted');
});

test('startup reads title and running state without replaying completion notifications', () => {
  const state = new PetState();
  const session = makeSession('s1', [
    { type: 'session/title', data: { title: '修复登录' } },
    { type: 'turn/end', data: { reason: { kind: 'completed' } } },
  ]);
  state.seed(session, { status: 'running' });
  assert.equal(state.snapshot().notice, null);
  assert.equal(state.snapshot().sessions[0].title, '修复登录');
  assert.equal(state.snapshot().sessions[0].project, 'demo');
  assert.equal(state.snapshot().sessions[0].status, 'thinking');
});

test('approval is answered once and stale IDs cannot approve a later request', async () => {
  const h = await harness();
  let nativeCalls = 0;
  const promise = h.request(() => { nativeCalls++; return 'rejected'; });
  const id = h.state.snapshot().approvals[0].id;
  assert.equal(h.listeners.get('approval/request').config.prepend, true);
  assert.equal(h.state.snapshot().sessions[0].status, 'approval');
  assert.deepEqual(h.decide(id, 'allowed-once'), { ok: true });
  assert.equal(await promise, 'allowed-once');
  assert.equal(h.decide(id, 'allowed-once').ok, false);
  assert.equal(nativeCalls, 0);
  assert.equal(h.state.snapshot().approvals.length, 0);
});

test('not-ready companion delegates to native approval without capturing the request', async () => {
  const h = await harness({ ready: false });
  let nativeCalls = 0;
  assert.equal(await h.request(() => { nativeCalls++; return 'rejected'; }), 'rejected');
  assert.equal(nativeCalls, 1);
  assert.equal(h.state.snapshot().approvals.length, 0);
});

test('disconnect delegates pending approvals exactly once and expires old desktop buttons', async () => {
  const h = await harness();
  let nativeCalls = 0;
  const promise = h.request(() => { nativeCalls++; return 'rejected'; });
  const id = h.state.snapshot().approvals[0].id;
  h.options.onDisconnect();
  h.options.onDisconnect();
  assert.equal(await promise, 'rejected');
  assert.equal(nativeCalls, 1);
  assert.equal(h.decide(id, 'allowed-once').ok, false);
});

test('cancelling the source task invalidates its approval and never delegates', async () => {
  const h = await harness();
  const controller = new AbortController();
  let nativeCalls = 0;
  const promise = h.request(() => { nativeCalls++; return 'allowed-once'; }, controller.signal);
  const id = h.state.snapshot().approvals[0].id;
  controller.abort();
  assert.equal(await promise, 'cancelled');
  assert.equal(h.decide(id, 'allowed-once').ok, false);
  assert.equal(nativeCalls, 0);
});

test('multiple sessions keep approval identity and operation details separate', () => {
  const state = new PetState();
  const first = makeSession('first');
  const second = makeSession('second');
  state.event(first, { type: 'tool/call', data: { callId: 'same', name: 'exec_command', arguments: '{"cmd":"first"}' } });
  state.event(second, { type: 'tool/call', data: { callId: 'same', name: 'exec_command', arguments: '{"cmd":"second"}' } });
  state.addApproval('id-first', { agent: { session: first }, callId: 'same', toolName: 'exec_command' });
  state.addApproval('id-second', { agent: { session: second }, callId: 'same', toolName: 'exec_command' });
  assert.deepEqual(state.snapshot().approvals.map(item => item.operation), ['{"cmd":"first"}', '{"cmd":"second"}']);
});

test('plugin disposal closes companion and delegates unresolved approval', async () => {
  const h = await harness();
  const promise = h.request(() => 'rejected');
  h.dispose();
  assert.equal(await promise, 'rejected');
  assert.equal(h.isClosed(), true);
});

test('tool names and structured test commands map to concise truthful status', () => {
  assert.equal(classifyTool('apply_patch'), 'editing');
  assert.equal(classifyTool('read_file'), 'reading');
  assert.equal(classifyTool('exec_command', '{"cmd":"node --test"}'), 'testing');
  assert.equal(classifyTool('exec_command', 'broken-json'), 'running');
});

test('continued turns and queued inbox work do not announce completion prematurely', () => {
  const state = new PetState();
  const session = makeSession();
  state.event(session, { type: 'turn/start', data: {} });
  state.event(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  assert.equal(state.snapshot().notice, null);
  state.agentStatus({ session, inbox: { nextTurn: [{}], nextStep: [] } }, 'idle');
  assert.equal(state.snapshot().notice, null);
  state.event(session, { type: 'turn/start', data: {} });
  state.event(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  state.agentStatus({ session, inbox: { nextTurn: [], nextStep: [] } }, 'idle');
  const notice = state.snapshot().notice;
  assert.equal(notice.kind, 'completed');
  state.agentStatus({ session }, 'idle');
  assert.equal(state.snapshot().notice.id, notice.id);
});

test('subagent completion is quiet, while its approval remains actionable under the parent', () => {
  const state = new PetState();
  const parent = makeSession('parent');
  const child = makeSession('child');
  child.header.origin = 'subagent';
  child.header.parentSession = parent.id;
  state.seed(parent);
  state.seed(child);
  state.event(child, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  state.agentStatus({ session: child }, 'idle');
  assert.equal(state.snapshot().notice, null);
  assert.deepEqual(state.snapshot().projects.map(item => item.id), ['parent']);
  state.addApproval('child-approval', { agent: { session: child }, toolName: 'exec_command', reason: '执行子任务操作' });
  assert.equal(state.snapshot().approvals[0].projectId, 'parent');
  assert.equal(state.snapshot().approvals[0].sessionId, 'child');
  assert.equal(state.snapshot().projects[0].status, 'approval');
});

test('oversized operation delegates to native UI instead of offering approval of truncated text', async () => {
  const h = await harness();
  h.state.event(h.session, { type: 'tool/call', data: { callId: 'call-1', name: 'exec_command', arguments: 'x'.repeat(MAX_OPERATION_LENGTH + 1) } });
  let nativeCalls = 0;
  assert.equal(await h.request(() => { nativeCalls++; return 'rejected'; }), 'rejected');
  assert.equal(nativeCalls, 1);
  assert.equal(h.state.snapshot().approvals.length, 0);
});

test('apply returns undefined, which is an admissible Cordis async effect result', async () => {
  const h = await harness();
  assert.equal(h.applyResult, undefined);
});

const volatile = value => ({ get: () => value.current });

test('the client switch launches the pet once, then hides and shows it on standby', async () => {
  const enabled = { current: false };
  const h = await harness({ config: { enabled: volatile(enabled) } });
  assert.equal(h.starts(), 0, 'a pet that starts switched off is not launched');
  let nativeCalls = 0;
  assert.equal(await h.request(() => { nativeCalls++; return 'rejected'; }), 'rejected');
  assert.equal(nativeCalls, 1, 'a disabled pet leaves approvals to DSH');
  enabled.current = true;
  await h.volatileUpdate();
  assert.equal(h.starts(), 1);
  enabled.current = false;
  await h.volatileUpdate();
  assert.equal(h.isStandby(), true);
  assert.equal(h.isClosed(), false, 'switching off keeps the window loaded');
  assert.equal(await h.request(() => 'rejected'), 'rejected', 'a hidden pet does not take approvals');
  enabled.current = true;
  await h.volatileUpdate();
  assert.equal(h.isStandby(), false);
  assert.equal(h.starts(), 1, 'showing again reuses the loaded window');
});

test("the pet's own hide / show controls write the DSH switch", async () => {
  const writes = [];
  const settings = { configure: () => () => {}, mutate: async (ns, ops) => { writes.push([ns, ops]); } };
  const h = await harness({ settings, config: { enabled: volatile({ current: true }) } });
  await h.options.onHide();
  assert.equal(h.isStandby(), true, 'hides at once');
  h.options.onShow();
  assert.equal(h.isStandby(), false, 'shows at once');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, [
    ['desktop-whale-pet', [{ op: 'set', path: ['enabled'], value: false }]],
    ['desktop-whale-pet', [{ op: 'set', path: ['enabled'], value: true }]],
  ]);
});

test('switching off hands an open approval back to the native dialog', async () => {
  const enabled = { current: true };
  const h = await harness({ config: { enabled: volatile(enabled) } });
  let nativeCalls = 0;
  const promise = h.request(() => { nativeCalls++; return 'allowed-once'; });
  const id = h.state.snapshot().approvals[0].id;
  enabled.current = false;
  await h.volatileUpdate();
  assert.equal(await promise, 'allowed-once');
  assert.equal(nativeCalls, 1);
  assert.equal(h.decide(id, 'allowed-once').ok, false);
});

test('only projects that ran in this DSH run are listed', () => {
  const state = new PetState();
  const old = makeSession('old');
  const running = makeSession('running');
  const later = makeSession('later');
  state.seed(old, { status: 'idle' });
  state.seed(running, { status: 'running' });
  state.seed(later, { status: 'idle' });
  assert.deepEqual(state.snapshot().projects.map(item => item.id), ['running']);
  state.event(later, { type: 'session/title', data: { title: '改名不算运行' } });
  assert.deepEqual(state.snapshot().projects.map(item => item.id), ['running']);
  state.event(later, { type: 'turn/start', data: {} });
  assert.deepEqual(state.snapshot().projects.map(item => item.id).sort(), ['later', 'running']);
});

test('the pet window receives the size preference, clamped to its range', async () => {
  const scale = { current: 1.3 };
  const h = await harness({ config: { enabled: volatile({ current: true }), scale: volatile(scale) } });
  assert.equal(h.options.getState().scale, 1.3);
  scale.current = 9;
  assert.equal(h.options.getState().scale, 1.6);
  scale.current = 'x';
  assert.equal(h.options.getState().scale, 1);
});

test('the pet is called 蓝色大肥鱼 unless the user names it', async () => {
  const name = { current: undefined };
  const h = await harness({ config: { enabled: volatile({ current: true }), name: volatile(name) } });
  assert.equal(h.options.getState().name, '蓝色大肥鱼');
  name.current = '  小蓝  ';
  assert.equal(h.options.getState().name, '小蓝');
  name.current = '   ';
  assert.equal(h.options.getState().name, '蓝色大肥鱼');
  name.current = '一二三四五六七八九十一二三四五六七八九十多余';
  assert.equal(h.options.getState().name.length, 20);
});

test('the pet starts a DSH conversation with the typed text', async () => {
  const calls = [];
  const sessionController = {
    create: async request => { calls.push(['create', request]); return { sessionId: 'new-session' }; },
    prompt: async (request, signal) => { calls.push(['prompt', request, signal instanceof AbortSignal]); return { accepted: true }; },
  };
  const h = await harness({ sessionController });
  assert.deepEqual(await h.options.onChat('  帮我整理一下桌面  '), { ok: true, sessionId: 'new-session', continued: false });
  assert.deepEqual(calls[0], ['create', {}]);
  assert.equal(calls[1][1].sessionId, 'new-session');
  assert.deepEqual(calls[1][1].content, [{ type: 'text', text: '帮我整理一下桌面' }]);
  assert.equal(typeof calls[1][1].requestId, 'string');
  assert.equal(calls[1][2], true);
  assert.equal((await h.options.onChat('   ')).ok, false, 'blank text is refused before reaching DSH');
  assert.equal(calls.length, 2);
});

test('starting a conversation explains why it could not', async () => {
  const noService = await harness();
  assert.match((await noService.options.onChat('你好')).error, /会话服务不可用/);
  const failing = await harness({ sessionController: {
    create: async () => ({ sessionId: 's' }),
    prompt: async () => { const error = new Error('no model'); error.code = 'session/model-unavailable'; throw error; },
  } });
  assert.match((await failing.options.onChat('你好')).error, /选择可用的模型/);
});

test('a selected conversation is continued instead of starting a new one', async () => {
  const calls = [];
  const sessionController = {
    create: async () => { calls.push('create'); return { sessionId: 'unused' }; },
    prompt: async request => { calls.push(['prompt', request.sessionId, request.content[0].text]); return { accepted: true }; },
  };
  const h = await harness({ sessionController });
  h.state.event(h.session, { type: 'turn/start', data: {} });
  assert.deepEqual(await h.options.onChat('继续说', 'session-1'), { ok: true, sessionId: 'session-1', continued: true });
  assert.deepEqual(calls, [['prompt', 'session-1', '继续说']], 'no new Session is created');
  assert.match((await h.options.onChat('你好', 'not-on-the-pet')).error, /重新选择/);
  assert.equal(calls.length, 1, 'an unknown target never reaches DSH');
});

const askReq = (h, signal) => ({ agent: h.agent, signal, questions: [
  { id: 'city', header: '确认城市', question: '你想查哪座城市的天气？', options: [{ label: '上海', description: '按上海查询' }, { label: '北京', description: '按北京查询' }] },
] });
// DSH's own answerer: settles when told to, rejects when its signal is cancelled.
// Like Cordis, next() takes no arguments: the chain shares the request object the listener received.
const nativeAnswerer = req => {
  let answer, seenSignal;
  const next = () => { seenSignal = req.signal; return new Promise((resolve, reject) => { answer = resolve; req.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); }); };
  return { next, answer: value => answer(value), signal: () => seenSignal };
};
const answerOnPet = (h, id, answers) => { let reply; h.options.onAnswer({ id, answers }, result => { reply = result; }); return reply; };

test('a model question shows on the pet and the pet can answer it', async () => {
  const h = await harness();
  const req = askReq(h);
  const native = nativeAnswerer(req);
  const listener = h.listeners.get('user-questions/request');
  assert.equal(listener.config.prepend, true);
  const promise = listener.handler(req, native.next);
  await Promise.resolve();
  const shown = h.state.snapshot().questions[0];
  assert.equal(shown.questions[0].question, '你想查哪座城市的天气？');
  assert.equal(h.state.snapshot().sessions[0].statusText, '等待你的回答');
  assert.equal(answerOnPet(h, shown.id, [{ id: 'city', selected: ['火星'] }]).ok, false, 'labels must come from the question');
  assert.deepEqual(answerOnPet(h, shown.id, [{ id: 'city', selected: ['上海'] }]), { ok: true });
  assert.deepEqual(await promise, { answers: [{ id: 'city', selected: ['上海'] }] });
  assert.equal(native.signal().aborted, true, "DSH's card stops waiting once the pet answered");
  assert.equal(h.state.snapshot().questions.length, 0);
  assert.equal(answerOnPet(h, shown.id, [{ id: 'city', selected: ['北京'] }]).ok, false, 'an answered question cannot be answered again');
});

test('answering in DSH first closes the question on the pet', async () => {
  const h = await harness();
  const req = askReq(h);
  const native = nativeAnswerer(req);
  const promise = h.listeners.get('user-questions/request').handler(req, native.next);
  await Promise.resolve();
  const id = h.state.snapshot().questions[0].id;
  native.answer({ answers: [{ id: 'city', selected: ['北京'] }] });
  assert.deepEqual(await promise, { answers: [{ id: 'city', selected: ['北京'] }] });
  assert.equal(h.state.snapshot().questions.length, 0);
  assert.equal(answerOnPet(h, id, [{ id: 'city', selected: ['上海'] }]).ok, false);
});

test('a custom reply replaces the options of a single-choice question', async () => {
  const h = await harness();
  const req = askReq(h);
  const promise = h.listeners.get('user-questions/request').handler(req, nativeAnswerer(req).next);
  await Promise.resolve();
  const id = h.state.snapshot().questions[0].id;
  assert.deepEqual(answerOnPet(h, id, [{ id: 'city', selected: ['上海'], custom: '  杭州 ' }]), { ok: true });
  assert.deepEqual(await promise, { answers: [{ id: 'city', selected: [], custom: '杭州' }] });
});

test('a cancelled question leaves the pet, and a stranded one reports why', async () => {
  const h = await harness();
  const controller = new AbortController();
  const req = askReq(h, controller.signal);
  const promise = h.listeners.get('user-questions/request').handler(req, nativeAnswerer(req).next);
  await Promise.resolve();
  controller.abort(new Error('turn cancelled'));
  await assert.rejects(promise);
  assert.equal(h.state.snapshot().questions.length, 0);

  const enabled = { current: true };
  const h2 = await harness({ config: { enabled: volatile(enabled) } });
  const gone = h2.listeners.get('user-questions/request').handler(askReq(h2), () => Promise.reject(new Error('no user-questions answerer accepted the request')));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h2.state.snapshot().questions.length, 1, 'the pet still answers when DSH has no answerer');
  enabled.current = false;
  await h2.volatileUpdate();
  await assert.rejects(gone, /no user-questions answerer/);
});

test('new chats go to the chosen DSH workspace, and the pet is told which ones exist', async () => {
  const created = [];
  const sessionController = { create: async request => { created.push(request); return { sessionId: 'new' }; }, prompt: async () => ({ accepted: true }) };
  const projects = [
    { id: 'w-dsh', title: 'dsh', path: 'C:\\work\\dsh', sessionIds: [] },
    { id: 'w-demo', title: '', path: 'C:\\work\\demo', sessionIds: ['session-1'] },
  ];
  const workspaceRegistry = { list: () => projects, get: id => projects.find(p => p.id === id) };
  const h = await harness({ sessionController, workspaceRegistry });
  h.state.event(h.session, { type: 'turn/start', data: {} });
  const view = h.options.getState();
  assert.deepEqual(view.workspaces.map(w => [w.id, w.title]), [['w-dsh', 'dsh'], ['w-demo', 'demo']]);
  assert.equal(view.defaultWorkspaceId, 'w-demo', 'defaults to the project of the most recent conversation');
  await h.options.onChat('在 dsh 里开始', undefined, 'w-dsh');
  await h.options.onChat('未知工作区', undefined, 'w-gone');
  assert.deepEqual(created, [{ workspaceId: 'w-dsh' }, {}], 'an unknown workspace falls back to the default directory');
});
