import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { PetState } from './state.js';
import { startCompanion } from './transport.js';

export const name = 'whale-pet';
export const inject = ['sessions', 'agents', 'approval'];

/**
 * DSH maps `@deepseek-ai/schemastery` to its own copy for profile packages. The
 * source checkout (tests, `link:` installs resolved by real path) may not see
 * that mapping, so fall back to the desktop profile's resolver.
 */
async function loadSchemastery() {
  try { return (await import('@deepseek-ai/schemastery')).default; } catch { /* try the profile resolver */ }
  try {
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
    const required = createRequire(path.join(home, 'profiles', 'desktop', 'package.json'))('@deepseek-ai/schemastery');
    return required.default ?? required;
  } catch { return undefined; }
}

const z = await loadSchemastery();
// The client switch writes this field through the settings form, which only
// exposes volatile fields; without volatile support the pet simply stays on.
export const SCALE = Object.freeze({ min: 0.6, max: 1.6, default: 1 });
export const NAME = Object.freeze({ default: '蓝色大肥鱼', maxLength: 20 });
export const CHAT_MAX_LENGTH = 4000;
export const Config = typeof z?.boolean?.().volatile === 'function'
  ? z.object({
    enabled: z.boolean().default(true).description('在桌面上显示鲸鱼娘桌宠').volatile(),
    scale: z.number().min(SCALE.min).max(SCALE.max).default(SCALE.default).description('桌宠大小（倍数）').volatile(),
    name: z.string().max(NAME.maxLength).default(NAME.default).description('桌宠昵称').volatile(),
  })
  : undefined;

/** Host-side warnings also go to the plugin's own log, since DSH keeps no host log on disk. */
const HOST_LOG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.local', 'host.log');
const note = message => { try { fs.mkdirSync(path.dirname(HOST_LOG), { recursive: true }); fs.appendFileSync(HOST_LOG, `${new Date().toISOString()} ${message}
`); } catch { /* logging is best effort */ } };

/** Read a plain or volatile config value. */
const read = value => value && typeof value.get === 'function' ? value.get() : value;

/** Install one companion for the desktop Host, never granting an operation automatically. */
export async function apply(ctx, config = {}, internals = {}) {
  const resolveRootId = session => {
    let agent = ctx.agents.get(session.id);
    if (!agent || !ctx.agents.roots) return session.header?.origin === 'subagent' ? session.header.parentSession ?? null : session.id;
    const roots = new Set(ctx.agents.roots().map(root => root.id));
    const seen = new Set();
    while (agent && !seen.has(agent.id)) {
      if (roots.has(agent.id)) return agent.id;
      seen.add(agent.id);
      agent = ctx.agents.list().find(candidate => ctx.agents.isOwnedBy(agent.id, candidate));
    }
    return null;
  };
  const state = new PetState(resolveRootId);
  const pending = new Map();
  const asked = new Map();
  let companion;
  let launching = null;
  let disposed = false;
  let publishTimer;
  const logger = ctx.logger ?? console;
  const isEnabled = () => read(config?.enabled) !== false;
  const petScale = () => { const value = Number(read(config?.scale)); return Number.isFinite(value) ? Math.min(SCALE.max, Math.max(SCALE.min, value)) : SCALE.default; };
  const petName = () => { const value = read(config?.name); return typeof value === 'string' && value.trim() ? value.trim().slice(0, NAME.maxLength) : NAME.default; };
  // What the pet window renders: task state plus its display preferences.
  let workspaceRegistry;
  /** DSH's projects, newest first, and the one a new chat goes to unless the user picks another. */
  const workspaces = (sessions) => {
    let list = [];
    try { list = workspaceRegistry?.list() ?? []; } catch { list = []; }
    const items = list.slice(0, 30).map(ws => ({ id: String(ws.id), title: String(ws.title || path.basename(ws.path) || ws.path).slice(0, 60), path: String(ws.path).slice(0, 400) }));
    const recent = sessions[0]?.id;
    const home = recent === undefined ? undefined : list.find(ws => { try { return ws.sessionIds.includes(recent); } catch { return false; } });
    return { workspaces: items, defaultWorkspaceId: home ? String(home.id) : items[0]?.id ?? null };
  };
  // The pet never reads the full session records (or the snapshot version), so they stay here.
  const view = () => { const { sessions, version: _version, ...shown } = state.snapshot(); return { ...shown, ...workspaces(sessions), scale: petScale(), name: petName() }; };
  // Streaming tokens may arrive hundreds of times per second; coalesce UI work.
  const publish = () => {
    if (disposed || publishTimer || !companion?.isReady()) return;
    publishTimer = setTimeout(() => { publishTimer = undefined; if (!disposed && companion?.isReady()) companion.send(view()); }, 60);
    publishTimer.unref?.();
  };
  const finish = (id, outcome, delegate = false) => {
    const entry = pending.get(id);
    if (!entry) return false;
    pending.delete(id);
    state.approvals.delete(id);
    entry.req.signal?.removeEventListener('abort', entry.abort);
    if (delegate && !entry.req.signal?.aborted) Promise.resolve().then(entry.next).then(entry.resolve, entry.reject);
    else entry.resolve(entry.req.signal?.aborted ? 'cancelled' : outcome);
    publish();
    return true;
  };
  const delegatePending = () => { for (const id of [...pending.keys()]) finish(id, 'unavailable', true); };
  // Questions are raced with DSH's own answerer, so dropping one from the pet hands nothing over:
  // the DSH card keeps waiting for the answer.
  const dropQuestion = (id) => {
    const entry = asked.get(id);
    if (!entry) return false;
    asked.delete(id);
    state.questions.delete(id);
    entry.cleanup();
    entry.dropped();
    publish();
    return true;
  };
  const dropQuestions = () => { for (const id of [...asked.keys()]) dropQuestion(id); };
  /** Check an answer from the pet against the question it answers: every question once, known labels only. */
  const checkAnswers = (questions, answers) => {
    if (!Array.isArray(answers) || answers.length !== questions.length) return null;
    const out = [];
    for (const question of questions) {
      const answer = answers.find(item => item && item.id === question.id);
      if (!answer || !Array.isArray(answer.selected)) return null;
      const labels = new Set((question.options ?? []).map(option => option.label));
      const selected = answer.selected.filter(label => typeof label === 'string');
      if (selected.some(label => !labels.has(label)) || (!question.multiSelect && selected.length > 1)) return null;
      const custom = typeof answer.custom === 'string' && answer.custom.trim() ? answer.custom.trim().slice(0, 4000) : undefined;
      out.push({ id: question.id, selected: custom !== undefined && !question.multiSelect ? [] : selected, ...(custom === undefined ? {} : { custom }) });
    }
    return out;
  };
  const close = () => {
    launching = null;
    const current = companion;
    companion = undefined;
    clearTimeout(publishTimer);
    publishTimer = undefined;
    delegatePending();
    dropQuestions();
    current?.close();
  };
  // Switching the pet off only hides it: the loaded window waits on standby so
  // switching back on is instant. Open approvals go back to the native dialog.
  const hide = () => {
    companion?.setStandby(true);
    delegatePending();
    dropQuestions();
  };
  const show = () => {
    if (companion?.exited) companion = undefined;
    if (companion) companion.setStandby(false);
    else return launch();
  };
  const launch = async () => {
    if (disposed || companion || launching) return;
    const attempt = launching = Symbol('launch');
    try {
      const started = await (internals.startCompanion ?? startCompanion)({
        logger,
        getState: view,
        onReady: publish,
        onHide: () => { requestSwitch(false); },
        onShow: () => { requestSwitch(true); },
        onChat: (text, target, workspaceId) => startChat(text, target, workspaceId),
        onDisconnect: () => { delegatePending(); dropQuestions(); },
        onAnswer: (message, reply) => {
          const entry = asked.get(message?.id);
          if (!entry || disposed) { reply({ ok: false, error: '这个问题已回答或已过期。' }); return; }
          const answers = checkAnswers(entry.req.questions, message.answers);
          if (!answers) { reply({ ok: false, error: '回答不完整，请为每个问题选择或填写答案。' }); return; }
          entry.resolve({ answers });
          dropQuestion(message.id);
          reply({ ok: true });
        },
        onDecision: (message, reply) => {
          if (!message || !['allowed-once', 'rejected'].includes(message.decision)) { reply({ ok: false, error: '无效的审批决定。' }); return; }
          const entry = pending.get(message.id);
          if (!entry || entry.req.signal?.aborted || disposed) {
            if (entry) finish(message.id, 'cancelled');
            reply({ ok: false, error: '此申请已处理或已过期。' }); return;
          }
          finish(message.id, message.decision);
          reply({ ok: true });
        },
      });
      if (disposed || launching !== attempt) { started.close(); return; }
      companion = started;
      // Switched off while the window was starting: keep it loaded but hidden.
      if (!isEnabled()) started.setStandby(true);
      publish();
    } catch (error) {
      logger.warn?.(`桌宠未能启动，审批仍由 dsh 原生界面处理：${error.message}`);
      delegatePending();
    } finally {
      if (launching === attempt) launching = null;
    }
  };
  const sync = () => isEnabled() ? show() : hide();
  ctx.effect(() => () => {
    disposed = true;
    close();
  });
  let settings;
  // Opt out of a generated settings form; the client half renders its own switch.
  ctx.inject?.(['settings'], child => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
    child.effect(() => { settings = child.settings; return () => { if (settings === child.settings) settings = undefined; }; });
  });
  // The same controller the DSH client uses for "new conversation", so the Session shows up there too.
  ctx.inject?.(['workspaceRegistry'], child => {
    child.effect(() => { workspaceRegistry = child.workspaceRegistry; publish(); return () => { if (workspaceRegistry === child.workspaceRegistry) workspaceRegistry = undefined; }; });
  });
  let sessionController;
  ctx.inject?.(['sessionController'], child => {
    child.effect(() => { sessionController = child.sessionController; return () => { if (sessionController === child.sessionController) sessionController = undefined; }; });
  });
  // With a target, the text continues that conversation; without one, a new Session is created.
  // Only a conversation the pet is showing can be targeted.
  const startChat = async (input, target, workspaceId) => {
    const text = String(input ?? '').trim();
    if (!text) return { ok: false, error: '请输入内容' };
    if (text.length > CHAT_MAX_LENGTH) return { ok: false, error: `内容过长，最多 ${CHAT_MAX_LENGTH} 字` };
    if (!sessionController) return { ok: false, error: 'dsh 会话服务不可用' };
    if (target !== undefined && !state.snapshot().sessions.some(item => item.id === target)) return { ok: false, error: '所选对话已不在桌宠中，请重新选择' };
    try {
      // A new chat goes to the chosen DSH project when it still exists, else to DSH's default directory.
      let known = false;
      try { known = typeof workspaceId === 'string' && !!workspaceRegistry?.get(workspaceId); } catch { known = false; }
      const sessionId = target ?? (await sessionController.create(known ? { workspaceId } : {})).sessionId;
      await sessionController.prompt({ sessionId, content: [{ type: 'text', text }], requestId: randomUUID() }, AbortSignal.timeout(30000));
      note(`chat ${target ? 'continued' : 'started'} (session=${sessionId})`);
      return { ok: true, sessionId, continued: target !== undefined };
    } catch (error) {
      note(`chat failed: ${error?.message ?? error}`);
      const code = error?.code ?? error?.error?.code;
      if (code === 'session/model-unavailable') return { ok: false, error: '请先在 dsh 中选择可用的模型' };
      return { ok: false, error: '发起对话失败，请在 dsh 中重试' };
    }
  };
  // The settings service keys entries by their own `options.id` (the row id in
  // cordis.patch.yml), not the loader's nested path id.
  const entryId = () => {
    for (let fiber = ctx.fiber, seen = 0; fiber && seen < 32; fiber = fiber.parent?.fiber, seen++) {
      const id = fiber.entry?.options?.id;
      if (typeof id === 'string') return id;
      if (fiber.parent?.fiber === fiber) break;
    }
    return 'desktop-whale-pet';
  };
  // The pet's own hide / show controls (panel, tray) write the same switch the
  // client shows, so the sidebar menu and settings follow them. The pet reacts
  // at once either way; the volatile update that follows is a no-op.
  const requestSwitch = async (enabled) => {
    if (enabled) show(); else hide();
    try {
      if (!settings) throw new Error('dsh 设置服务不可用');
      await settings.mutate(entryId(), [{ op: 'set', path: ['enabled'], value: enabled }]);
      note(`switch written (enabled=${enabled}, entry=${entryId()})`);
    } catch (error) {
      logger.warn?.(`桌宠${enabled ? '显示' : '隐藏'}状态未能写入 dsh 设置：${error.message}`);
      note(`switch write failed (enabled=${enabled}, entry=${entryId()}): ${error.message}`);
    }
  };
  ctx.on('loader/volatile-update', () => { sync(); publish(); });
  for (const session of ctx.sessions.list()) state.seed(session, ctx.agents.get(session.id));
  ctx.on('session/created', session => { state.seed(session, ctx.agents.get(session.id)); publish(); }, { global: true });
  ctx.on('session/disposed', session => {
    for (const [id, entry] of pending) if (entry.req.agent.id === session.id) finish(id, 'cancelled');
    state.remove(session.id); publish();
  }, { global: true });
  ctx.on('session/event', (session, event) => { if (state.event(session, event)) publish(); }, { global: true });
  ctx.on('agent/status', ({ agent, status }) => { state.agentStatus(agent, status); publish(); }, { global: true });
  ctx.on('agent/error', ({ agent }) => { state.agentError(agent); publish(); }, { global: true });
  // Model questions (ask_user_question): shown on the pet and still answerable in DSH. The rest of
  // the chain gets its own signal, cancelled when the pet answers first.
  ctx.on('user-questions/request', (req, next) => {
    if (disposed || !isEnabled() || !companion?.isReady() || !req?.agent?.session || !state.canPresentQuestions(req)) return next();
    const id = randomUUID();
    const original = req.signal;
    const relay = new AbortController();
    const onAbort = () => relay.abort(original.reason);
    original?.addEventListener('abort', onAbort, { once: true });
    req.signal = relay.signal;
    const native = Promise.resolve().then(() => next());
    return new Promise((resolve, reject) => {
      let settled = false;
      let nativeError;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        // A turn's signal can outlive many answered questions. Release each
        // completed request instead of retaining it until the whole turn aborts.
        original?.removeEventListener('abort', onQuestionAbort);
        fn(value);
      };
      const onQuestionAbort = () => { dropQuestion(id); settle(reject, original.reason ?? new Error('aborted')); };
      asked.set(id, {
        req,
        resolve: answer => { relay.abort(new Error('answered on the desktop pet')); settle(resolve, answer); },
        cleanup: () => original?.removeEventListener('abort', onAbort),
        // Leaving the pet with DSH's answerer already gone would strand the call: report DSH's failure.
        dropped: () => { if (nativeError !== undefined) settle(reject, nativeError); },
      });
      state.addQuestion(id, req);
      publish();
      native.then(answer => { dropQuestion(id); settle(resolve, answer); }, error => {
        if (settled) return;
        // DSH's answerer gave up (e.g. no window open); the pet can still answer unless the call ended.
        if (original?.aborted) { dropQuestion(id); settle(reject, error); return; }
        nativeError = error;
      });
      original?.addEventListener('abort', onQuestionAbort, { once: true });
    });
  }, { prepend: true, global: true });
  ctx.on('approval/request', (req, next) => {
    if (req.signal?.aborted) return Promise.resolve('cancelled');
    if (disposed || !isEnabled() || !companion?.isReady() || !state.canPresentApproval(req)) return next();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => finish(id, 'cancelled');
      pending.set(id, { req, next, resolve, reject, abort });
      state.addApproval(id, req);
      req.signal?.addEventListener('abort', abort, { once: true });
      if (req.signal?.aborted) abort();
      else publish();
    });
  }, { prepend: true, global: true });
  await sync();
  // Cordis validates async apply results as effects: only undefined or a disposer.
  internals.observe?.({ state, pending, sync });
}
