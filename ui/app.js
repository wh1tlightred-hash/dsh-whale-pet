/* Renderer deliberately has no Node or network access. All task content is text. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const host = window.whale;
  const spriteNames = {idle:'idle',thinking:'thinking',working:'working',approval:'waiting_approval',question:'waiting_question',completed:'success',error:'error',aborted:'idle',disconnected:'offline'};
  let spriteState = '', typingFrame = 0, typingTimer;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let blinkTimer, blinkEndTimer, blinking = false;
  const blinkFrame = new Image();
  blinkFrame.src = '../assets/winter/idle-blink.png';
  function stopBlink() {
    clearTimeout(blinkTimer); clearTimeout(blinkEndTimer);
    if (blinking) $('character').src = '../assets/winter/idle.png';
    blinking = false;
  }
  function scheduleBlink() {
    stopBlink();
    if (spriteState !== 'idle' || reducedMotion.matches || document.hidden || $('character').dataset.idleAction) return;
    blinkTimer = setTimeout(() => {
      if (!blinkFrame.complete || !blinkFrame.naturalWidth) { scheduleBlink(); return; }
      blinking = true;
      $('character').src = blinkFrame.src;
      blinkEndTimer = setTimeout(scheduleBlink, 140);
    }, 3000 + Math.random() * 4000);
  }
  let idleTimer, idleEndTimer, lastIdleAction = -1;
  const idleSequences = {
    look: [['idle-look-left', 850], ['idle', 180], ['idle-look-right', 1000], ['idle', 370]],
    rice: [['idle-rice-reach', 800], ['idle-rice-hold', 650], ['idle-rice-eat', 650], ['idle-rice-hold', 450], ['idle-rice-eat', 650], ['idle-rice-hold', 450], ['idle-rice-eat', 650], ['idle-rice-hold', 650], ['idle-rice-reach', 450], ['idle', 250]],
    nod: [['idle', 2400]]
  };
  const idleFrames = new Map();
  for (const name of new Set(Object.values(idleSequences).flat().map(frame => frame[0]))) {
    const img = new Image(); img.src = '../assets/winter/' + name + '.png'; idleFrames.set(name, img);
  }
  function stopIdleAction() {
    clearTimeout(idleTimer); clearTimeout(idleEndTimer);
    if ($('character').dataset.idleAction) $('character').src = '../assets/winter/idle.png';
    delete $('character').dataset.idleAction;
  }
  function scheduleIdleAction() {
    stopIdleAction();
    if (spriteState !== 'idle' || reducedMotion.matches || document.hidden) return;
    idleTimer = setTimeout(() => {
      const actions = ['look', 'nod', 'rice'];
      lastIdleAction = (lastIdleAction + 1 + Math.floor(Math.random() * 2)) % actions.length;
      const action = actions[lastIdleAction];
      const frames = idleSequences[action];
      if (!frames.every(([name]) => idleFrames.get(name).complete && idleFrames.get(name).naturalWidth)) { scheduleIdleAction(); return; }
      stopBlink();
      $('character').dataset.idleAction = action;
      const play = index => {
        if (index === frames.length) { scheduleIdleAction(); scheduleBlink(); return; }
        const [name, duration] = frames[index];
        $('character').src = idleFrames.get(name).src;
        idleEndTimer = setTimeout(() => play(index + 1), duration);
      };
      play(0);
    }, 10000 + Math.random() * 14000);
  }
  Object.values(spriteNames).concat('working-02').forEach(name => { const img = new Image(); img.src = '../assets/winter/' + name + '.png'; });
  function showSprite(status) {
    if (spriteState === status) return;
    stopBlink();
    spriteState = status; clearInterval(typingTimer); typingFrame = 0;
    scheduleIdleAction();
    scheduleBlink();
    $('character').src = '../assets/winter/' + (spriteNames[status] || 'idle') + '.png';
    if (status === 'working' && !reducedMotion.matches) typingTimer = setInterval(() => {
      typingFrame = 1 - typingFrame;
      $('character').src = '../assets/winter/' + (typingFrame ? 'working-02' : 'working') + '.png';
    }, 380);
  }
  document.addEventListener('visibilitychange', () => { scheduleIdleAction(); scheduleBlink(); });
  reducedMotion.addEventListener('change', () => { const status = spriteState; spriteState = ''; showSprite(status); });
  window.addEventListener('unload', () => { clearInterval(typingTimer); stopIdleAction(); stopBlink(); });
  const isDemo = !host;
  let displayDemo = isDemo;
  const labels = {idle:'等待新任务',thinking:'思考中',working:'正在处理任务',approval:'等待你的批准',completed:'任务完成',error:'任务遇到问题',aborted:'任务已中断',disconnected:'等待 dsh 连接'};
  const moods = {idle:'✦',thinking:'···',working:'⌘',approval:'!',completed:'✧',error:'?',aborted:'☁',disconnected:'☁'};
  let state = {connected:false,projects:[],approvals:[],questions:[],workspaces:[],defaultWorkspaceId:null,notice:null};
  let pinned = true;
  // New-conversation composer: off | icon | open. It is always open while the task cards are.
  let composer = 'off';
  // Workspace for new chats: the user's pick (remembered on this machine), else the host's default.
  let chosenWorkspace = null;
  try { chosenWorkspace = localStorage.getItem('whale-pet.workspace'); } catch {}
  let sending = false;
  let statusTimer;
  let petName = '蓝色大肥鱼';
  let selectedId = null;
  // The card the user picked: the composer continues that conversation. Unlike selectedId (which
  // falls back to the first card for the status bubble), nothing is picked until a card is clicked.
  let chatTarget = null;
  let expanded = false;
  let pendingDecision = false;
  let activeApprovalId = null;
  let dismissedNoticeId = null;
  // A notice breathes out by itself after NOTICE_MS without attention; hovering it holds it.
  const NOTICE_MS = 4000;
  let noticeTimerFor = null;
  let noticeTimer;
  let seenApprovalIds = new Set();
  let seenQuestionIds = new Set();
  // The question batch on screen, with the user's picks per question id (kept across state pushes).
  let activeQuestionId = null;
  let questionPicks = new Map();
  let pendingAnswer = false;
  let unsubscribe;
  const string = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value,null,2);
  const safeStatus = value => Object.hasOwn(labels,value) ? value : 'working';
  // Acknowledge a specific completion locally; a later turn gets its own updatedAt.
  const acknowledgedCompletions = new Map();
  const projectStatus = project => project.status === 'completed' && acknowledgedCompletions.has(project.id) && acknowledgedCompletions.get(project.id) === project.updatedAt ? 'idle' : safeStatus(project.status);
  const projectDetail = project => project.status === 'completed' && projectStatus(project) === 'idle' ? labels.idle : string(project.detail) || labels[projectStatus(project)];
  function setExpanded(value) {
    const changed = expanded !== Boolean(value);
    expanded = Boolean(value);
    $('app').classList.toggle('expanded',expanded);
    $('panel').hidden = !expanded;
    $('summary').setAttribute('aria-expanded',String(expanded));
    $('summary-chevron').textContent = expanded ? '⌄' : '⌃';
    paintComposer();
    if (changed) syncSize();
  }
  // The window grows with the panel's content: report the height the open panel needs.
  let sentHeight = 0;
  // Both layouts are bottom-anchored columns, so the height they need is everything from the
  // top of the first visible block down to the window bottom, plus the top padding.
  function neededHeight() {
    const top = parseFloat(getComputedStyle($('app')).paddingTop) || 0;
    if (!expanded) return Math.ceil(window.innerHeight - document.querySelector('.pet-stage').getBoundingClientRect().top + top);
    const content = $('panel-content');
    const overflow = content.scrollHeight - content.clientHeight;
    return Math.ceil(window.innerHeight - $('panel').getBoundingClientRect().top + overflow + top);
  }
  let sentExpanded = null;
  let sentWidth = 0;
  function syncSize() {
    if (!host) return;
    const height = neededHeight();
    // Width: the page's own 276px column plus side padding, which grows while the composer shows.
    const width = Math.ceil(276 + (parseFloat(getComputedStyle($('app')).paddingLeft) || 0) + (parseFloat(getComputedStyle($('app')).paddingRight) || 0));
    if (sentExpanded === expanded && Math.abs(height - sentHeight) < 2 && width === sentWidth) return;
    sentExpanded = expanded;
    sentHeight = height;
    sentWidth = width;
    host.setExpanded(expanded, height, width);
  }
  const composerState = () => expanded ? 'open' : composer;
  function chatTitle(project) {
    const name = string(project?.name);
    const title = name.includes(' · ') ? name.split(' · ').slice(1).join(' · ') : name;
    return title.length > 12 ? title.slice(0, 12) + '…' : title;
  }
  function currentWorkspace() {
    const list = state.workspaces || [];
    return list.find(w => w.id === chosenWorkspace) || list.find(w => w.id === state.defaultWorkspaceId) || list[0] || null;
  }
  function paintWorkspace() {
    const ws = currentWorkspace();
    $('composer-workspace-name').textContent = ws ? string(ws.title) : '默认目录';
    $('composer-workspace').title = ws ? '新对话的工作区：' + string(ws.path) : '新对话将建在 dsh 的默认目录';
    // Continuing a picked conversation needs no workspace; the chip steps aside.
    $('composer-workspace').dataset.hidden = String(!!chatTarget);
    if (chatTarget || composerState() !== 'open') closeWorkspaceMenu();
  }
  function closeWorkspaceMenu() { $('workspace-menu').hidden = true; $('composer-workspace').setAttribute('aria-expanded', 'false'); }
  function openWorkspaceMenu() {
    const list = state.workspaces || [];
    const current = currentWorkspace();
    const menu = $('workspace-menu');
    const items = list.length ? list : [{ id: null, title: '默认目录', path: 'dsh 的默认目录' }];
    menu.replaceChildren(...items.map(ws => {
      const item = document.createElement('button');
      item.type = 'button'; item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String((current?.id ?? null) === ws.id));
      item.title = string(ws.path);
      const label = document.createElement('span'); label.textContent = string(ws.title); item.append(label);
      item.addEventListener('click', () => {
        chosenWorkspace = ws.id;
        try { if (ws.id) localStorage.setItem('whale-pet.workspace', ws.id); } catch {}
        closeWorkspaceMenu(); paintWorkspace(); $('composer-input').focus();
      });
      return item;
    }));
    menu.hidden = false;
    $('composer-workspace').setAttribute('aria-expanded', 'true');
  }
  function paintComposer() {
    const target = state.projects.find(p => p.id === chatTarget);
    const input = $('composer-input');
    const placeholder = target ? '回复「' + chatTitle(target) + '」…' : '今天有什么可以帮您的？';
    if (input.placeholder !== placeholder) input.placeholder = placeholder;
    input.setAttribute('aria-label', target ? '继续对话：' + string(target.name) : '发起新对话');
    $('composer-form').dataset.target = target ? 'continue' : 'new';
    const current = composerState();
    $('app').dataset.composer = current;
    paintWorkspace();
    $('composer-icon').hidden = current === 'open';
    $('composer-form').hidden = current !== 'open';
    if (current !== 'open') $('composer-status').hidden = $('composer-status').dataset.tone !== 'ok' || $('composer-status').hidden;
  }
  let composerCloseTimer;
  function setComposer(next) {
    const wasOpen = composerState() === 'open';
    composer = next;
    clearTimeout(composerCloseTimer);
    $('composer-form').classList.remove('closing');
    // Roll the bar back into the icon before it goes, and only then let the window narrow.
    if (wasOpen && composerState() !== 'open') {
      $('composer-form').classList.add('closing');
      composerCloseTimer = setTimeout(() => { $('composer-form').classList.remove('closing'); paintComposer(); syncSize(); }, 180);
      return;
    }
    paintComposer();
    syncSize();
    if (composerState() === 'open' && next === 'open') setTimeout(() => $('composer-input').focus(), 0);
  }
  function composerStatus(text, tone, ms) {
    clearTimeout(statusTimer);
    const status = $('composer-status');
    status.hidden = !text;
    status.textContent = text || '';
    if (tone) status.dataset.tone = tone; else delete status.dataset.tone;
    if (ms) statusTimer = setTimeout(() => { status.hidden = true; }, ms);
  }
  async function submitChat() {
    const input = $('composer-input');
    const text = input.value.trim();
    if (!text || sending) return;
    if (!host) { composerStatus('演示模式：不会发起真实对话', null, 2500); return; }
    sending = true;
    input.disabled = true;
    composerStatus(chatTarget ? '正在发送…' : '正在发起对话…');
    let result;
    const target = state.projects.some(p => p.id === chatTarget) ? chatTarget : null;
    try { result = await host.startChat(text, target, target ? null : currentWorkspace()?.id ?? null); } catch { result = { ok: false, error: '发起对话失败，请在 dsh 中重试' }; }
    sending = false;
    input.disabled = false;
    if (result?.ok) {
      input.value = '';
      composerStatus(result.continued ? '已发送到所选对话' : '已发起新对话', 'ok', 2500);
      if (!expanded) setComposer('off');
    } else {
      composerStatus(string(result?.error) || '发起对话失败，请在 dsh 中重试', 'error', 5000);
      input.focus();
    }
  }
  function applyScale(value) {
    const scale = Math.min(1.6, Math.max(0.6, Number(value) || 1));
    document.documentElement.style.setProperty('--pet-scale', String(scale));
  }

  function renderProjects() {
    const fragment = document.createDocumentFragment();
    for (const project of state.projects) {
      const status = projectStatus(project);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'project' + (project.id === chatTarget ? ' selected' : '');
      button.dataset.status = status;
      button.setAttribute('aria-pressed',String(project.id === chatTarget));
      const symbol = document.createElement('span'); symbol.className='project-symbol'; symbol.textContent = '⌁';
      const copy = document.createElement('span'); copy.className='project-copy';
      const name = document.createElement('span'); name.className='project-name'; name.textContent=string(project.name)||'未命名项目';
      const detail = document.createElement('span'); detail.className='project-state'; detail.textContent=projectDetail(project);
      copy.append(name,detail);
      const badge = document.createElement('span'); badge.className='project-status';
      const dot = document.createElement('i');
      badge.append(dot,document.createTextNode(status==='approval'?'待审批':status==='completed'?'已完成':status==='error'?'异常':status==='aborted'?'已中断':status==='idle'?'待机':'进行中'));
      button.append(symbol,copy,badge);
      button.title=string(project.name)+' · '+projectDetail(project);
      // Clicking a card picks it as the conversation to continue; clicking it again un-picks it.
      button.addEventListener('click',() => {
        if (project.status === 'completed') {
          acknowledgedCompletions.set(project.id, project.updatedAt);
          if (state.notice?.sessionId === project.id && state.notice.kind === 'completed') dismissedNoticeId = state.notice.id;
        }
        if(chatTarget===project.id){chatTarget=null;}else{chatTarget=project.id;selectedId=project.id;}
        render();
      });
      fragment.append(button);
    }
    $('projects').replaceChildren(fragment);
  }
  function renderApproval() {
    const approval = state.approvals.find(a=>a.projectId===selectedId) || state.approvals[0];
    $('approval-section').hidden=!approval;
    if (!approval) {activeApprovalId=null;return;}
    if (activeApprovalId !== approval.id) {
      activeApprovalId=approval.id;
      $('decision-error').hidden=true;
    }
    $('approval-count').textContent=state.approvals.length>1?`还有 ${state.approvals.length} 项操作等待审批`:'等待你确认后继续';
    $('approval-project').textContent=string(approval.projectName)||'当前项目';
    $('approval-reason').textContent=string(approval.reason)||'此操作需要你的授权。';
    $('operation-label').textContent=approval.tool?'具体操作 · '+string(approval.tool):'具体操作';
    $('approval-operation').textContent=string(approval.operation)||'未提供操作详情，请在 dsh 中核实。';
    $('allow').disabled=pendingDecision || !approval.operation;
    $('reject').disabled=pendingDecision;
  }
  function questionAnswers(batch) {
    return batch.questions.map(q => {
      const pick = questionPicks.get(q.id) ?? { selected: new Set(), custom: '' };
      const custom = pick.custom.trim();
      return { id: q.id, selected: [...pick.selected], ...(custom ? { custom } : {}) };
    });
  }
  const answered = answer => answer.selected.length > 0 || answer.custom !== undefined;
  async function submitQuestion(batch) {
    if (pendingAnswer || !batch) return;
    const answers = questionAnswers(batch);
    if (!answers.every(answered)) { $('question-error').textContent = '请为每个问题选择或填写答案。'; $('question-error').hidden = false; return; }
    pendingAnswer = true;
    $('question-error').hidden = true;
    renderQuestion();
    try {
      const result = isDemo ? { ok: true } : await host.answer(batch.id, answers);
      if (!result?.ok) throw new Error(result?.error || '回答提交失败，请重试或回到 dsh 回答。');
      state.questions = state.questions.filter(q => q.id !== batch.id);
    } catch (error) {
      $('question-error').textContent = string(error.message) || '回答提交失败';
      $('question-error').hidden = false;
    } finally { pendingAnswer = false; render(); }
  }
  // Rebuilt only when another batch comes up, so typing and picks survive state pushes.
  function buildQuestion(batch) {
    questionPicks = new Map(batch.questions.map(q => [q.id, { selected: new Set(), custom: '' }]));
    const simple = batch.questions.length === 1 && !batch.questions[0].multiSelect;
    const list = document.createDocumentFragment();
    for (const q of batch.questions) {
      const item = document.createElement('div'); item.className = 'question-item';
      if (q.header) { const header = document.createElement('span'); header.className = 'question-header'; header.textContent = string(q.header); item.append(header); }
      const text = document.createElement('p'); text.className = 'question-text'; text.textContent = string(q.question); item.append(text);
      const options = document.createElement('div'); options.className = 'question-options'; options.setAttribute('role', q.multiSelect ? 'group' : 'radiogroup');
      (q.options ?? []).forEach((option, index) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'question-option'; button.setAttribute('aria-pressed', 'false');
        const number = document.createElement('span'); number.className = 'question-option-index'; number.textContent = String(index + 1);
        const copy = document.createElement('span'); copy.className = 'question-option-copy';
        const label = document.createElement('span'); label.className = 'question-option-label'; label.textContent = string(option.label);
        copy.append(label);
        if (option.description) { const description = document.createElement('span'); description.className = 'question-option-description'; description.textContent = string(option.description); copy.append(description); }
        button.append(number, copy);
        button.addEventListener('click', () => {
          const pick = questionPicks.get(q.id);
          if (q.multiSelect) { if (pick.selected.has(option.label)) pick.selected.delete(option.label); else pick.selected.add(option.label); }
          else { pick.selected = new Set([option.label]); pick.custom = ''; customInput.value = ''; }
          for (const other of options.children) other.setAttribute('aria-pressed', String(pick.selected.has(other.querySelector('.question-option-label').textContent)));
          // One single-choice question: a click is the answer.
          if (simple) submitQuestion(batch); else renderQuestion();
        });
        options.append(button);
      });
      item.append(options);
      const customInput = document.createElement('input');
      customInput.className = 'question-custom'; customInput.type = 'text'; customInput.maxLength = 4000;
      customInput.placeholder = q.options?.length ? '或者输入你的回答…' : '输入你的回答…';
      customInput.addEventListener('input', () => {
        const pick = questionPicks.get(q.id);
        pick.custom = customInput.value;
        if (!q.multiSelect && customInput.value.trim()) { pick.selected.clear(); for (const other of options.children) other.setAttribute('aria-pressed', 'false'); }
        renderQuestion();
      });
      customInput.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); submitQuestion(batch); } });
      item.append(customInput);
      list.append(item);
    }
    $('question-list').replaceChildren(list);
  }
  function renderQuestion() {
    const batch = state.questions.find(q => q.projectId === selectedId) || state.questions[0];
    $('question-section').hidden = !batch;
    if (!batch) { activeQuestionId = null; return; }
    if (activeQuestionId !== batch.id) { activeQuestionId = batch.id; $('question-error').hidden = true; buildQuestion(batch); }
    $('question-count').textContent = state.questions.length > 1 ? `还有 ${state.questions.length} 组问题等待回答` : '回答后任务会继续';
    $('question-project').textContent = string(batch.projectName) || '当前项目';
    const simple = batch.questions.length === 1 && !batch.questions[0].multiSelect;
    // A one-click question only needs the button for a typed reply.
    $('question-submit').hidden = simple && !questionAnswers(batch)[0].custom;
    $('question-submit').disabled = pendingAnswer || !questionAnswers(batch).every(answered);
    for (const button of $('question-list').querySelectorAll('button, input')) button.disabled = pendingAnswer;
  }
  function armNotice() {
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      if ($('notice').matches(':hover')) return armNotice();
      $('notice').classList.add('leaving');
      noticeTimer = setTimeout(() => { dismissedNoticeId = noticeTimerFor; $('notice').classList.remove('leaving'); render(); }, 800);
    }, NOTICE_MS);
  }
  function render() {
    if (!state.projects.some(p=>p.id===selectedId)) selectedId=state.projects[0]?.id ?? null;
    if (chatTarget && !state.projects.some(p=>p.id===chatTarget)) chatTarget=null;
    const project=state.projects.find(p=>p.id===selectedId);
    const waiting=state.approvals.length+state.questions.length;
    const status=waiting?'approval':!state.connected?'disconnected':project?projectStatus(project):'idle';
    $('app').dataset.status=status;
    const poseStatus = status === 'completed' && (!state.notice || state.notice.id === dismissedNoticeId) ? 'idle' : status;
    showSprite(state.approvals.length ? 'approval' : state.questions.length ? 'question' : poseStatus);
    // Quiet: nothing thinking, working or waiting for approval. The status bubble then hides until hovered.
    $('app').dataset.quiet=String(!waiting && !state.projects.some(p=>['thinking','working'].includes(safeStatus(p.status))));
    $('current-project').textContent=project?string(project.name):petName;
    $('character-wrap').title='右键打开菜单';
    $('current-status').textContent=state.approvals.length?`${state.approvals.length} 项操作等待批准`:state.questions.length?`${state.questions.length} 组问题等待回答`:state.connected && project?projectDetail(project):labels[status];
    $('current-status').title=$('current-status').textContent;
    $('mood').textContent=moods[status];
    $('demo-label').hidden=!displayDemo;
    renderProjects();
    renderQuestion();
    renderApproval();
    const notice=state.notice;
    $('notice').hidden=!notice || notice.id===dismissedNoticeId;
    if (notice && notice.id!==dismissedNoticeId && notice.id!==noticeTimerFor) {noticeTimerFor=notice.id;$('notice').classList.remove('leaving');armNotice();}
    if (notice) {
      $('notice').dataset.kind=string(notice.kind);
      $('notice-title').textContent=string(notice.title)||'有新的任务消息';
      $('notice-body').textContent=string(notice.body);
    }
    paintComposer();
    syncSize();
  }
  function receive(next) {
    if (!next || typeof next!=='object') return;
    displayDemo=isDemo || next.demo===true;
    if(typeof next.alwaysOnTop==='boolean'){pinned=next.alwaysOnTop;paintMenu();}
    if(typeof next.scale==='number')applyScale(next.scale);
    if(typeof next.name==='string'&&next.name.trim())petName=next.name.trim().slice(0,20);
    if (next.forceExpanded===true) setExpanded(true);
    state={connected:Boolean(next.connected),projects:Array.isArray(next.projects)?next.projects.filter(p=>p&&p.id):[],approvals:Array.isArray(next.approvals)?next.approvals.filter(a=>a&&a.id):[],questions:Array.isArray(next.questions)?next.questions.filter(q=>q&&q.id&&Array.isArray(q.questions)):[],workspaces:Array.isArray(next.workspaces)?next.workspaces.filter(w=>w&&typeof w.id==='string'):[],defaultWorkspaceId:typeof next.defaultWorkspaceId==='string'?next.defaultWorkspaceId:null,notice:next.notice||null};
    for (const [id, stamp] of acknowledgedCompletions) {
      const project = state.projects.find(p => p.id === id);
      if (!project || project.status !== 'completed' || project.updatedAt !== stamp) acknowledgedCompletions.delete(id);
    }
    const fresh=state.approvals.find(a=>!seenApprovalIds.has(a.id));
    seenApprovalIds=new Set(state.approvals.map(a=>a.id));
    if (fresh) {selectedId=fresh.projectId;setExpanded(true);}
    const freshQuestion=state.questions.find(q=>!seenQuestionIds.has(q.id));
    seenQuestionIds=new Set(state.questions.map(q=>q.id));
    if (freshQuestion && !fresh) {selectedId=freshQuestion.projectId;setExpanded(true);}
    render();
  }
  async function decide(decision) {
    if (pendingDecision || !activeApprovalId) return;
    const id=activeApprovalId;
    pendingDecision=true;
    $('decision-error').hidden=true;
    renderApproval();
    try {
      const result=isDemo?{ok:true}:await host.decide(id,decision);
      if (!result?.ok) throw new Error(result?.error||'审批未能提交，请重试或返回 dsh 处理。');
      // Remove only this approval; an arriving request can never inherit this decision.
      state.approvals=state.approvals.filter(a=>a.id!==id);
      if (isDemo) {state.projects=state.projects.map(p=>p.id===selectedId?{...p,status:decision==='allowed-once'?'working':'aborted',detail:decision==='allowed-once'?'演示：操作获批，继续任务':'演示：操作已拒绝'}:p);}
    } catch(error) {
      if (activeApprovalId===id) {$('decision-error').textContent=string(error.message)||'审批失败';$('decision-error').hidden=false;}
    } finally {pendingDecision=false;render();}
  }
  $('summary').addEventListener('click',()=>setExpanded(!expanded));
  // Drag the window from the pet: the host moves it with the real cursor until the button is released.
  let dragging=false;
  let pressedAt=null;
  const pet=$('character-wrap');
  // The compose icon shows while the pointer is on the pet and fades after; a click does not pin it.
  const petClicked=()=>{};
  const endDrag=event=>{
    if(!dragging)return;
    dragging=false;
    host.dragEnd();
    const from=pressedAt;pressedAt=null;
    if(from&&event&&event.type==='pointerup'&&Math.hypot(event.screenX-from.x,event.screenY-from.y)<4&&Date.now()-from.t<600)petClicked();
  };
  // No pointer capture: the window stays under the cursor anyway, and a capture that outlives a
  // lost pointerup would swallow every later click on the buttons.
  pet.addEventListener('pointerdown',event=>{if(event.button!==0)return;if(!host){pressedAt={x:event.screenX,y:event.screenY,t:Date.now()};return;}dragging=true;pressedAt={x:event.screenX,y:event.screenY,t:Date.now()};host.dragStart();});
  // Demo page (no host): no dragging, but a click still toggles the composer icon.
  pet.addEventListener('pointerup',event=>{if(host||!pressedAt)return;const from=pressedAt;pressedAt=null;if(Math.hypot(event.screenX-from.x,event.screenY-from.y)<4)petClicked();});
  window.addEventListener('pointermove',event=>{if(dragging&&event.buttons===0)endDrag(event);});
  window.addEventListener('pointerup',endDrag);
  window.addEventListener('pointercancel',endDrag);
  window.addEventListener('blur',endDrag);
  // Right-click menu drawn in the page: compact, labels aligned, check mark on the right.
  const menu=$('pet-menu');
  function paintMenu(){$('menu-top').setAttribute('aria-checked',String(pinned));}
  function closeMenu(){menu.hidden=true;}
  function openMenu(x,y){
    paintMenu();
    menu.hidden=false;
    const stage=document.querySelector('.pet-stage').getBoundingClientRect();
    const left=Math.max(4,Math.min(x,window.innerWidth-menu.offsetWidth-4))-stage.left;
    const top=Math.max(4,Math.min(y,window.innerHeight-menu.offsetHeight-4))-stage.top;
    menu.style.left=left+'px';menu.style.top=top+'px';
  }
  document.addEventListener('contextmenu',event=>{
    event.preventDefault();
    if(event.target.closest('#notice, #summary, #panel, #pet-menu, #composer'))return;
    openMenu(event.clientX,event.clientY);
  });
  document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target))closeMenu();},true);
  window.addEventListener('blur',closeMenu);
  $('menu-top').addEventListener('click',()=>{pinned=!pinned;paintMenu();host?.setAlwaysOnTop(pinned);closeMenu();});
  $('menu-hide').addEventListener('click',()=>{closeMenu();if(host)host.hide();});
  $('allow').addEventListener('click',()=>decide('allowed-once'));
  $('question-submit').addEventListener('click',()=>submitQuestion(state.questions.find(q=>q.id===activeQuestionId)));
  $('reject').addEventListener('click',()=>decide('rejected'));
  $('dismiss-notice').addEventListener('click',()=>{clearTimeout(noticeTimer);dismissedNoticeId=state.notice?.id;render();});
  $('notice').addEventListener('pointerenter',()=>{if($('notice').classList.contains('leaving')){$('notice').classList.remove('leaving');armNotice();}});
  document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(!menu.hidden)closeMenu();else if(expanded)setExpanded(false);});
  $('composer-icon').addEventListener('click',()=>setComposer('open'));
  $('composer-workspace').addEventListener('click',event=>{event.stopPropagation();if($('workspace-menu').hidden)openWorkspaceMenu();else closeWorkspaceMenu();});
  document.addEventListener('pointerdown',event=>{if(!$('workspace-menu').hidden&&!event.target.closest('#workspace-menu, #composer-workspace'))closeWorkspaceMenu();},true);
  // Only what the page draws takes the mouse; the empty rest of the (fixed-size) window lets clicks
  // through to the desktop. Hover still works there because the host forwards mouse moves.
  const INTERACTIVE = '#panel .project, #question-section, #approval-section, #summary, #notice, #character-wrap, #composer-icon, #composer-form, #composer-status, #composer-workspace, #workspace-menu, #pet-menu';
  let overInteractive = null;
  const trackPointer = target => {
    const next = dragging || !$('pet-menu').hidden || !!(target instanceof Element && target.closest(INTERACTIVE));
    if (next === overInteractive) return;
    overInteractive = next;
    host?.setInteractive?.(next);
  };
  document.addEventListener('mousemove', event => trackPointer(event.target), true);
  document.addEventListener('mouseleave', () => trackPointer(null));
  // An empty bar rolls back into the icon once the pointer leaves it; the icon then fades with the
  // pointer leaving the pet (it is shown on hover only, not pinned).
  // An empty bar folds once the pointer leaves the bar, its workspace chip and list, and the hover zone
  // around them; moving between those (across the gaps) never counts as leaving.
  const COMPOSER_PARTS = '#composer-zone, #composer-form, #composer-workspace, #workspace-menu, #composer-status';
  const maybeFold = event => {
    if (expanded || sending || composerState() !== 'open' || $('composer-input').value.trim()) return;
    if (event.relatedTarget instanceof Element && event.relatedTarget.closest(COMPOSER_PARTS)) return;
    closeWorkspaceMenu();
    $('composer-input').blur();
    setComposer('off');
  };
  for (const id of ['composer-zone', 'composer-form', 'composer-workspace', 'workspace-menu']) $(id).addEventListener('pointerleave', maybeFold);
  $('composer-form').addEventListener('submit',event=>{event.preventDefault();});
  $('composer-input').addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.isComposing){event.preventDefault();submitChat();}
    else if(event.key==='Escape'){event.stopPropagation();event.currentTarget.blur();if(!expanded)setComposer('off');}
  });
  $('demo-label').hidden=!isDemo;
  if (isDemo) {
    receive({connected:true,projects:[{id:'demo-1',name:'个人网站',status:'working',detail:'正在修改页面样式'},{id:'demo-2',name:'数据分析助手',status:'approval',detail:'等待运行命令的批准'}],approvals:[{id:'demo-approval',projectId:'demo-2',projectName:'数据分析助手',tool:'shell',reason:'需要运行测试来验证刚才的修改。此处为演示数据。',operation:'npm test'}],notice:null});
  } else {render();unsubscribe=host.onState(receive);}
  window.addEventListener('unload',()=>{if(typeof unsubscribe==='function')unsubscribe();});
})();
