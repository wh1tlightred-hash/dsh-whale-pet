import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const STATUS_TEXT = Object.freeze({ idle: '待机中', thinking: '思考中', reading: '正在读取文件', editing: '正在修改文件', testing: '正在运行测试', running: '正在执行操作', approval: '等待批准', question: '等待你的回答', completed: '任务完成', error: '任务出错', interrupted: '任务已中断' });
const clean = (value, limit = 200) => typeof value === 'string' ? value.slice(0, limit) : '';
export const MAX_OPERATION_LENGTH = 65536;

export function classifyTool(name, argumentsText = '') {
  const label = String(name).toLowerCase();
  if (/apply_patch|write_file|edit_file|replace|notebook_edit/.test(label)) return 'editing';
  if (/read_file|read_text|search|grep|glob|list_dir|view_image/.test(label)) return 'reading';
  if (/test/.test(label)) return 'testing';
  if (/bash|shell|exec_command|terminal/.test(label)) {
    let command = '';
    try { const args = JSON.parse(argumentsText); command = args.cmd ?? args.command ?? ''; } catch { /* Only classify structured command arguments. */ }
    if (/(?:\b(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b|\b(?:pytest|jest|vitest)\b|\b(?:cargo|go)\s+test\b|\bnode\s+--test\b)/i.test(command)) return 'testing';
  }
  return 'running';
}

/** A small projection of live DSH events. Historical turns never trigger a notice. */
export class PetState {
  constructor(resolveRootId = session => session.header?.origin === 'subagent' ? session.header.parentSession ?? null : session.id) { this.resolveRootId = resolveRootId; this.sessions = new Map(); this.calls = new Map(); this.approvals = new Map(); this.questions = new Map(); this.endedTurns = new Map(); this.notice = null; }
  ensure(session) {
    let item = this.sessions.get(session.id);
    if (!item) {
      const cwd = clean(session.header?.cwd, 2048);
      const project = cwd ? (path.win32.basename(cwd) || path.posix.basename(cwd) || cwd) : '未命名项目';
      item = { id: session.id, project, title: '新会话', cwd, status: 'idle', statusText: STATUS_TEXT.idle, toolName: '', updatedAt: Date.now(), running: false, live: false };
      this.sessions.set(session.id, item);
      this.calls.set(session.id, new Map());
    }
    item.rootId = this.resolveRootId(session);
    return item;
  }
  setStatus(item, status) { item.status = status; item.statusText = STATUS_TEXT[status]; item.updatedAt = Date.now(); }
  seed(session, agent) {
    const item = this.ensure(session);
    for (const event of session.snapshotEvents?.() ?? []) {
      if (event.type === 'session/title') item.title = clean(event.data.title) || '新会话';
      if (event.type === 'tool/call') this.rememberCall(session.id, event.data);
      if (event.type === 'tool/result') this.calls.get(session.id)?.delete(event.data.message?.toolCallId);
    }
    item.running = agent?.status === 'running';
    if (item.running) item.live = true;
    this.setStatus(item, item.running ? 'thinking' : 'idle');
  }
  rememberCall(sessionId, data) {
    const calls = this.calls.get(sessionId);
    calls?.set(data.callId, { name: clean(data.name), arguments: clean(data.arguments, MAX_OPERATION_LENGTH), truncated: typeof data.arguments === 'string' && data.arguments.length > MAX_OPERATION_LENGTH });
    if (calls?.size > 128) calls.delete(calls.keys().next().value);
  }
  event(session, event) {
    const item = this.ensure(session);
    const data = event.data ?? {};
    if (event.type === 'session/title') item.title = clean(data.title) || '新会话';
    else item.live = true;
    if (event.type === 'turn/start') { this.endedTurns.delete(session.id); item.running = true; this.setStatus(item, 'thinking'); }
    if (event.type === 'step/start') this.setStatus(item, 'thinking');
    if (event.type === 'tool/call') {
      this.rememberCall(session.id, data);
      item.toolName = clean(data.name);
      this.setStatus(item, classifyTool(data.name, data.arguments));
    }
    if (event.type === 'tool/result') {
      const calls = this.calls.get(session.id);
      calls?.delete(data.message?.toolCallId);
      const active = calls && [...calls.values()].at(-1);
      if (item.running) {
        item.toolName = active?.name ?? '';
        this.setStatus(item, active ? classifyTool(active.name, active.arguments) : 'thinking');
      }
    }
    if (event.type === 'turn/end') {
      item.toolName = '';
      this.calls.get(session.id)?.clear();
      const reason = data.reason?.kind;
      const status = reason === 'completed' ? 'completed' : reason === 'error' ? 'error' : 'interrupted';
      this.endedTurns.set(session.id, status);
      // A completed turn can immediately continue via inbox/goal; wait for agent idle.
      if (reason !== 'completed') {
        item.running = false;
        this.setStatus(item, status);
        if (reason !== 'forked') this.announce(item, status);
      } else this.setStatus(item, 'thinking');
    }
  }
  agentStatus(agent, status) {
    const item = this.ensure(agent.session);
    item.running = status === 'running';
    if (item.running) item.live = true;
    const queued = (agent.inbox?.nextTurn?.length ?? 0) + (agent.inbox?.nextStep?.length ?? 0);
    if (!item.running && this.endedTurns.get(item.id) === 'completed' && queued === 0) {
      this.endedTurns.delete(item.id);
      this.setStatus(item, 'completed');
      this.announce(item, 'completed');
      return;
    }
    if (item.running && !['thinking', 'reading', 'editing', 'testing', 'running'].includes(item.status)) this.setStatus(item, 'thinking');
    if (!item.running && !['completed', 'error', 'interrupted'].includes(item.status)) this.setStatus(item, 'idle');
  }
  announce(item, status) {
    if (item.rootId !== item.id) return;
    this.notice = { id: randomUUID(), sessionId: item.id, project: item.project, title: item.title, kind: status, text: STATUS_TEXT[status], createdAt: Date.now() };
  }
  agentError(agent) { this.setStatus(this.ensure(agent.session), 'error'); }
  remove(sessionId) { this.sessions.delete(sessionId); this.calls.delete(sessionId); this.endedTurns.delete(sessionId); }
  canPresentApproval(req) {
    const call = this.calls.get(req.agent.session.id)?.get(req.callId);
    return !call?.truncated && (req.reason?.length ?? 0) <= MAX_OPERATION_LENGTH && Object.values(req.displayReason ?? {}).every(value => typeof value !== 'string' || value.length <= MAX_OPERATION_LENGTH);
  }
  addApproval(id, req) {
    const item = this.ensure(req.agent.session);
    item.live = true;
    const call = req.callId === undefined ? null : this.calls.get(item.id)?.get(req.callId);
    const localized = req.displayReason?.['zh-CN'] ?? req.displayReason?.zh ?? req.displayReason?.en;
    this.approvals.set(id, { id, sessionId: item.id, rootId: item.rootId, project: item.project, title: item.title, toolName: clean(req.toolName), reason: clean(localized ?? req.reason, MAX_OPERATION_LENGTH) || '此操作需要你批准。', operation: call?.arguments || clean(req.reason, MAX_OPERATION_LENGTH) || clean(req.toolName), createdAt: Date.now() });
  }
  /** A model question (ask_user_question) shown on the pet; text is clipped, options kept as given. */
  addQuestion(id, req) {
    const item = this.ensure(req.agent.session);
    item.live = true;
    const questions = (req.questions ?? []).slice(0, 8).map(q => ({
      id: clean(String(q.id ?? ''), 200),
      header: clean(q.header, 80),
      question: clean(q.question, 4000),
      multiSelect: q.multiSelect === true,
      options: (q.options ?? []).slice(0, 12).map(option => ({ label: clean(option.label, 300), description: clean(option.description, 600) })).filter(option => option.label),
    }));
    this.questions.set(id, { id, sessionId: item.id, rootId: item.rootId, project: item.project, title: item.title, questions, createdAt: Date.now() });
  }
  /** Questions the pet can show faithfully: ids are unique and nothing would be clipped. */
  canPresentQuestions(req) {
    const questions = req.questions ?? [];
    if (!questions.length || questions.length > 8) return false;
    const ids = new Set(questions.map(q => String(q.id ?? '')));
    return ids.size === questions.length && questions.every(q => String(q.id ?? '').length <= 200 && (q.question ?? '').length <= 4000 && (q.options ?? []).length <= 12 && (q.options ?? []).every(o => typeof o.label === 'string' && o.label.length <= 300));
  }
  snapshot() {
    const label = item => { const root = this.sessions.get(item.rootId); return { projectId: root?.id ?? item.sessionId, projectName: root ? `${root.project} · ${root.title}${root.id === item.sessionId ? '' : `（子任务：${item.title}）`}` : `${item.project} · ${item.title}` }; };
    const questions = [...this.questions.values()].map(item => ({ id: item.id, sessionId: item.sessionId, ...label(item), questions: item.questions }));
    const asking = new Set(questions.map(item => item.projectId));
    const approvals = [...this.approvals.values()].map(item => {
      const root = this.sessions.get(item.rootId);
      return { ...item, projectId: root?.id ?? item.sessionId, projectName: root ? `${root.project} · ${root.title}${root.id === item.sessionId ? '' : `（子任务：${item.title}）`}` : `${item.project} · ${item.title}`, tool: item.toolName };
    });
    const waiting = new Set([...approvals.map(item => item.projectId), ...asking]);
    // A project ran in this DSH run when it or any of its subagents did.
    const live = new Set([...this.sessions.values()].filter(item => item.live).map(item => item.rootId));
    const sessions = [...this.sessions.values()].filter(item => item.rootId === item.id && (live.has(item.id) || waiting.has(item.id))).map(item => ({ ...item, ...(waiting.has(item.id) ? { status: 'approval', statusText: asking.has(item.id) && !approvals.some(a => a.projectId === item.id) ? STATUS_TEXT.question : STATUS_TEXT.approval } : {}) })).sort((a, b) => Number(b.running) - Number(a.running) || b.updatedAt - a.updatedAt);
    const uiStatus = status => ['reading', 'editing', 'testing', 'running'].includes(status) ? 'working' : status === 'interrupted' ? 'aborted' : status;
    const projects = sessions.map(item => ({ id: item.id, name: `${item.project} · ${item.title}`, status: uiStatus(item.status), detail: item.statusText, updatedAt: item.updatedAt }));
    const notice = this.notice ? { ...this.notice, sessionTitle: this.notice.title, kind: uiStatus(this.notice.kind), title: this.notice.text, body: `${this.notice.project} · ${this.notice.title}` } : null;
    return { version: 1, connected: true, projects, sessions, approvals, questions, notice };
  }
}
