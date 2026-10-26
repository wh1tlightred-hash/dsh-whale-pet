/* Renderer deliberately has no Node or network access. All task content is text. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const host = window.whale;
  const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  // Custom properties written only when they change: drag hints re-render up to 60 times a second.
  const setVar = (element, name, value) => { value = String(value); if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value); };
  let edgeSide = null;
  let edgeAttraction = null;
  const spriteNames = {idle:'idle',thinking:'thinking',working:'working',approval:'waiting_approval',question:'waiting_question',completed:'success',error:'error',aborted:'idle',disconnected:'offline'};
  spriteNames['peek-left'] = 'peek-left'; spriteNames['peek-right'] = 'peek-left';
  spriteNames['attracted-left'] = 'idle-look-left'; spriteNames['attracted-right'] = 'idle-look-right';
  spriteNames['attracted-bottom'] = 'idle-look-down'; spriteNames.landing = 'idle-look-down';
  let spriteState = '', typingFrame = 0, typingTimer;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let landingAnimation = null, landingTimer, landingActive = false;
  function stopLanding() {
    clearTimeout(landingTimer);
    landingAnimation?.cancel(); landingAnimation = null; landingActive = false;
    $('app').dataset.landing = '';
  }
  function land(payload) {
    stopLanding();
    const distance = Number(payload?.drop);
    // Already touching the floor: no artificial hop, including display rounding.
    if (!Number.isFinite(distance) || distance <= 2 || reducedMotion.matches || document.hidden || edgeSide || state.approvals.length || state.questions.length) {
      render();
      return;
    }
    edgeAttraction = null;
    landingActive = true;
    render();
    const el = $('character');
    const wrap = $('character-wrap');
    const scale = wrap.getBoundingClientRect().height / wrap.offsetHeight || 1;
    const drop = Math.min(160, distance) / scale;
    // Constant acceleration from rest; farther drops take longer. No upward bounce.
    const fallMs = Math.sqrt(2 * drop / 1800) * 1000;
    const duration = fallMs + 150;
    const frames = Array.from({length:13}, (_, i) => {
      const t = i / 12;
      return {transform:`translateY(${-drop * (1 - t*t)}px) scaleY(1)`, offset:t * fallMs / duration};
    });
    frames.push(
      {transform:'translateY(0) scaleY(.985)',offset:(fallMs + 45) / duration,easing:'ease-out'},
      {transform:'translateY(0) scaleY(1)',offset:1}
    );
    landingAnimation = el.animate(frames, {duration,fill:'both',easing:'linear'});
    landingTimer = setTimeout(() => { stopLanding(); render(); }, duration);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopLanding(); render(); } });
  reducedMotion.addEventListener('change', () => { stopLanding(); render(); });
  window.addEventListener('unload', stopLanding);
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
  // Briefly blend registered eating frames instead of snapping the whole sprite.
  const previousFrame = $('character').cloneNode(false);
  previousFrame.removeAttribute('id');
  previousFrame.alt = ''; previousFrame.setAttribute('aria-hidden', 'true');
  previousFrame.classList.add('character-transition'); previousFrame.hidden = true;
  $('character').before(previousFrame);
  let frameFade, frameFadeTimer;
  function clearFrameFade() {
    clearTimeout(frameFadeTimer); frameFade?.cancel(); frameFade = null;
    previousFrame.hidden = true;
  }
  function paintIdleFrame(src, blend) {
    clearFrameFade();
    const character = $('character');
    if (blend && character.src !== src && !reducedMotion.matches) {
      previousFrame.src = character.src; previousFrame.hidden = false;
      character.src = src;
      frameFade = character.animate([{opacity: 0}, {opacity: 1}], {duration: 90, easing: 'ease-out'});
      frameFadeTimer = setTimeout(clearFrameFade, 90);
    } else character.src = src;
  }
  const idleSequences = {
    look: [['idle-look-left', 850], ['idle', 180], ['idle-look-right', 1000], ['idle', 370]],
    rice: [
      ['idle-rice-reach', 700], ['idle-rice-hold', 400],
      ['idle-rice-scoop', 380], ['idle-rice-lift', 220], ['idle-rice-eat', 240],
      ['idle-rice-chew', 650], ['idle-rice-satisfied', 330],
      ['idle-rice-hold', 250], ['idle-rice-scoop', 320], ['idle-rice-lift', 200],
      ['idle-rice-eat', 220], ['idle-rice-chew', 780], ['idle-rice-satisfied', 700],
      ['idle-rice-hold', 350], ['idle', 400]
    ],
    nod: [['idle', 2400]]
  };
  const idleFrames = new Map();
  for (const name of new Set(Object.values(idleSequences).flat().map(frame => frame[0]))) {
    const img = new Image(); img.src = '../assets/winter/' + name + '.png'; idleFrames.set(name, img);
  }
  function stopIdleAction() {
    clearTimeout(idleTimer); clearTimeout(idleEndTimer);
    clearFrameFade();
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
        paintIdleFrame(idleFrames.get(name).src, action === 'rice');
        idleEndTimer = setTimeout(() => play(index + 1), duration);
      };
      play(0);
    }, 10000 + Math.random() * 14000);
  }
  [...new Set(Object.values(spriteNames).concat('working-02'))].filter(name => !idleFrames.has(name)).forEach(name => { const img = new Image(); img.src = '../assets/winter/' + name + '.png'; });
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
  // The task list opens by itself for an approval or a question (prompt = true) and closes again once
  // nothing is waiting. Opening or closing it any other way is the user's choice and is left alone.
  let openedForPrompt = false;
  function setExpanded(value, prompt = false) {
    openedForPrompt = prompt ? openedForPrompt || !expanded : false;
    const changed = expanded !== Boolean(value);
    expanded = Boolean(value);
    $('app').classList.toggle('expanded',expanded);
    $('panel').hidden = !expanded;
    $('summary').setAttribute('aria-expanded',String(expanded));
    $('summary-chevron').textContent = expanded ? '⌄' : '⌃';
    paintComposer();
    if (changed) syncSize();
  }
  // The window has a fixed height (the work area's), so only the expanded state and the width are
  // reported; measuring the content's height on every render would be wasted layout work.
  let sentExpanded = null;
  let sentWidth = 0;
  let sentPetRect = null;
  function syncSize() {
    if (!host) return;
    const petBounds = $('character-wrap').getBoundingClientRect();
    const rect = {x: petBounds.x, y: petBounds.y, width: petBounds.width, height: petBounds.height, viewHeight: window.innerHeight};
    if (!sentPetRect || Object.keys(rect).some(key => rect[key] !== sentPetRect[key])) {
      sentPetRect = rect;
      host.reportPetRect?.(rect);
    }
    const appStyle = getComputedStyle($('app'));
    // Width: the page's own 276px column plus side padding, which grows while the composer shows.
    const width = Math.ceil(276 + (parseFloat(appStyle.paddingLeft) || 0) + (parseFloat(appStyle.paddingRight) || 0));
    if (sentExpanded === expanded && width === sentWidth) return;
    sentExpanded = expanded;
    sentWidth = width;
    host.setExpanded(expanded, 0, width);
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
  // The pet's work area (from the host). Where the composer on the pet's left would run off the screen's
  // left edge, it opens mirrored on the pet's right instead.
  let workArea = null, windowBounds = null;
  // How far the window reaches below the screen's bottom edge (she stands on it); the composer, which
  // sits at her feet, is lifted by about as much so it stays on screen.
  const belowFloor = () => workArea && windowBounds ? Math.max(0, windowBounds.y + windowBounds.height - workArea.y - workArea.height) : 0;
  // Worked out again only when the window moves, the screen changes or the pet is resized.
  let composerSideValue = 'left';
  function updateComposerSide() { composerSideValue = composerSide(); }
  function composerSide() {
    if (!workArea) return 'left';
    const stage = document.querySelector('.pet-stage').getBoundingClientRect();
    const scale = Number(getComputedStyle(document.documentElement).getPropertyValue('--pet-scale')) || 1;
    // In pet-stage coordinates, as in styles.css: --icon-right, the 280px bar and its 14px hover ring.
    const iconRight = 64 - 20 * scale, reach = 280 + 14;
    const x = (windowBounds ? windowBounds.x : window.screenX) + stage.left;
    const leftOverflow = workArea.x - (x + iconRight - reach);
    const rightOverflow = x + 276 - iconRight + reach - (workArea.x + workArea.width);
    return leftOverflow > 0 && rightOverflow < leftOverflow ? 'right' : 'left';
  }
  function paintComposer() {
    if ($('app').dataset.composerSide !== composerSideValue) $('app').dataset.composerSide = composerSideValue;
    setVar($('app'), '--floor-lift', Math.max(0, belowFloor() - 3) + 'px');
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
    const scale = String(Math.min(1.6, Math.max(0.6, Number(value) || 1)));
    if (document.documentElement.style.getPropertyValue('--pet-scale') === scale) return;
    document.documentElement.style.setProperty('--pet-scale', scale);
    updateComposerSide();
  }

  // Retain card nodes and their listeners; state and drag updates usually do not change their content.
  const projectCards = new Map();
  function renderProjects() {
    const list = $('projects');
    const liveIds = new Set();
    let cursor = list.firstChild;
    for (const project of state.projects) {
      liveIds.add(project.id);
      let card = projectCards.get(project.id);
      if (!card) {
        const button = document.createElement('button'); button.type = 'button';
        const symbol = document.createElement('span'); symbol.className = 'project-symbol'; symbol.textContent = '⌁';
        const copy = document.createElement('span'); copy.className = 'project-copy';
        const name = document.createElement('span'); name.className = 'project-name';
        const detail = document.createElement('span'); detail.className = 'project-state';
        copy.append(name, detail);
        const badge = document.createElement('span'); badge.className = 'project-status';
        const badgeText = document.createTextNode(''); badge.append(document.createElement('i'), badgeText);
        button.append(symbol, copy, badge);
        card = {button, name, detail, badgeText, project};
        projectCards.set(project.id, card);
        button.addEventListener('click', event => {
          if (event.detail > 1) return;
          // Always use current state, including a new completion with unchanged display text.
          const project = card.project;
          if (project.status === 'completed') {
            acknowledgedCompletions.set(project.id, project.updatedAt);
            if (state.notice?.sessionId === project.id && state.notice.kind === 'completed') dismissedNoticeId = state.notice.id;
          }
          if (edgeSide && !expanded) { chatTarget = project.id; selectedId = project.id; host?.revealEdge?.(); setExpanded(true); render(); return; }
          if (chatTarget === project.id) { chatTarget = null; } else { chatTarget = project.id; selectedId = project.id; }
          render();
        });
        button.addEventListener('dblclick', async event => {
          event.preventDefault();
          const project = card.project;
          chatTarget = project.id; selectedId = project.id;
          render();
          if (!host?.openSession) { composerStatus('演示模式：无法打开 dsh 对话', null, 2500); return; }
          if (card.opening) return;
          card.opening = true;
          try {
            const result = await host.openSession(project.id);
            if (!result?.ok) composerStatus(string(result?.error) || '打开对话失败，请稍后重试', 'error', 5000);
          } catch { composerStatus('打开对话失败，请稍后重试', 'error', 5000); }
          finally { card.opening = false; }
        });
      }
      card.project = project;
      const status = projectStatus(project);
      const selected = project.id === chatTarget;
      const className = 'project' + (selected ? ' selected' : '');
      if (card.button.className !== className) card.button.className = className;
      if (card.button.dataset.status !== status) card.button.dataset.status = status;
      if (card.button.getAttribute('aria-pressed') !== String(selected)) card.button.setAttribute('aria-pressed', String(selected));
      const name = string(project.name), detail = projectDetail(project);
      setText(card.name, name || '未命名项目'); setText(card.detail, detail);
      const badge = status === 'approval' ? '待审批' : status === 'completed' ? '已完成' : status === 'error' ? '异常' : status === 'aborted' ? '已中断' : status === 'idle' ? '待机' : '进行中';
      if (card.badgeText.data !== badge) card.badgeText.data = badge;
      const title = name + ' · ' + detail;
      if (card.button.title !== title) card.button.title = title;
      if (card.button !== cursor) list.insertBefore(card.button, cursor);
      cursor = card.button.nextSibling;
    }
    for (const [id, card] of projectCards) {
      if (!liveIds.has(id)) { card.button.remove(); projectCards.delete(id); }
    }
  }
  function renderApproval() {
    const approval = state.approvals.find(a=>a.projectId===selectedId) || state.approvals[0];
    $('approval-section').hidden=!approval;
    if (!approval) {activeApprovalId=null;return;}
    if (activeApprovalId !== approval.id) {
      activeApprovalId=approval.id;
      $('decision-error').hidden=true;
    }
    // Unchanged text is left alone: the operation can be 64KB, re-laid out on every state push otherwise.
    setText($('approval-count'), state.approvals.length>1?`还有 ${state.approvals.length} 项操作等待审批`:'等待你确认后继续');
    setText($('approval-project'), string(approval.projectName)||'当前项目');
    setText($('approval-reason'), string(approval.reason)||'此操作需要你的授权。');
    setText($('operation-label'), approval.tool?'具体操作 · '+string(approval.tool):'具体操作');
    setText($('approval-operation'), string(approval.operation)||'未提供操作详情，请在 dsh 中核实。');
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
    setText($('question-count'), state.questions.length > 1 ? `还有 ${state.questions.length} 组问题等待回答` : '回答后任务会继续');
    setText($('question-project'), string(batch.projectName) || '当前项目');
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
  function render(poseOnly = false) {
    // Answered here or in DSH: the list the prompt opened folds away again.
    if (!poseOnly && openedForPrompt && expanded && !state.approvals.length && !state.questions.length && !pendingDecision && !pendingAnswer) setExpanded(false);
    if (!state.projects.some(p=>p.id===selectedId)) selectedId=state.projects[0]?.id ?? null;
    if (chatTarget && !state.projects.some(p=>p.id===chatTarget)) chatTarget=null;
    const project=state.projects.find(p=>p.id===selectedId);
    const waiting=state.approvals.length+state.questions.length;
    const status=waiting?'approval':!state.connected?'disconnected':project?projectStatus(project):'idle';
    $('app').dataset.status=status;
    const poseStatus = status === 'completed' && (!state.notice || state.notice.id === dismissedNoticeId) ? 'idle' : status;
    const peeking = edgeSide && !expanded && !waiting;
    if (waiting || peeking) stopLanding();
    $('app').dataset.landing = landingActive ? 'true' : '';
    const attracted = !peeking && !waiting && !landingActive ? edgeAttraction : null;
    $('app').dataset.edge = peeking ? edgeSide : '';
    if (!peeking) peekHover = false;
    // Peeking: the cards stay laid out (faded out) so hovering the pet can breathe them in.
    $('panel').hidden = !expanded && !(peeking && state.projects.length);
    $('app').dataset.peek = peeking && peekHover ? (state.projects.length ? 'cards' : 'summary') : '';
    $('app').dataset.attracted = attracted?.side || '';
    setVar($('character'), '--floor-squash', 1 - (attracted?.side === 'bottom' ? attracted.strength * .015 : 0));
    const pull = (attracted?.side === 'left' ? -1 : 1) * (attracted?.strength || 0);
    setVar($('character'), '--edge-pull-x', (pull * 5) + 'px');
    // Pivot near the face: positive rotation pulls the legs left, negative pulls them right.
    setVar($('character'), '--edge-pull-angle', (-pull * 20) + 'deg');
    showSprite(landingActive ? 'landing' : peeking ? 'peek-' + edgeSide : attracted ? 'attracted-' + attracted.side : state.approvals.length ? 'approval' : state.questions.length ? 'question' : poseStatus);
    // Attraction changes only the sprite; cards, composer and geometry are unchanged.
    if (poseOnly) return;
    // Quiet: nothing thinking, working or waiting for approval. The status bubble then hides until hovered.
    $('app').dataset.quiet=String(!waiting && !state.projects.some(p=>['thinking','working'].includes(safeStatus(p.status))));
    setText($('current-project'), project?string(project.name):petName);
    $('character-wrap').removeAttribute('title');
    const statusText=state.approvals.length?`${state.approvals.length} 项操作等待批准`:state.questions.length?`${state.questions.length} 组问题等待回答`:state.connected && project?projectDetail(project):labels[status];
    setText($('current-status'), statusText);
    if ($('current-status').title!==statusText) $('current-status').title=statusText;
    setText($('mood'), moods[status]);
    $('demo-label').hidden=!displayDemo;
    renderProjects();
    renderQuestion();
    renderApproval();
    const notice=state.notice;
    $('notice').hidden=!notice || notice.id===dismissedNoticeId;
    if (notice && notice.id!==dismissedNoticeId && notice.id!==noticeTimerFor) {noticeTimerFor=notice.id;$('notice').classList.remove('leaving');armNotice();}
    if (notice) {
      $('notice').dataset.kind=string(notice.kind);
      setText($('notice-title'), string(notice.title)||'有新的任务消息');
      setText($('notice-body'), string(notice.body));
    }
    paintComposer();
    if (peeking) placePeek();
    syncSize();
  }
  // Peeking from a screen edge: hovering the pet breathes the task cards in just above its head,
  // leaning towards the screen (right of the head on the left edge, left of it on the right edge).
  // With no tasks the status bubble shows there instead.
  let peekHover = false, peekLeaveTimer;
  function placePeek() {
    const app = $('app').getBoundingClientRect();
    const stage = document.querySelector('.pet-stage').getBoundingClientRect();
    const pet = $('character-wrap').getBoundingClientRect();
    // The middle of the head, just above the hood; the cards grow away from the screen edge.
    const x = edgeSide === 'left' ? pet.left + pet.width * 0.5 : pet.right - pet.width * 0.5;
    const y = pet.top + pet.height * 0.16;
    const style = $('app').style;
    style.setProperty('--peek-panel-x', Math.round(edgeSide === 'left' ? x - app.left : app.right - x) + 'px');
    style.setProperty('--peek-panel-y', Math.round(app.bottom - y) + 'px');
    style.setProperty('--peek-stage-x', Math.round(edgeSide === 'left' ? x - stage.left : stage.right - x) + 'px');
    style.setProperty('--peek-stage-y', Math.round(stage.bottom - y) + 'px');
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
    if (fresh) {selectedId=fresh.projectId;setExpanded(true,true);}
    const freshQuestion=state.questions.find(q=>!seenQuestionIds.has(q.id));
    seenQuestionIds=new Set(state.questions.map(q=>q.id));
    if (freshQuestion && !fresh) {selectedId=freshQuestion.projectId;setExpanded(true,true);}
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
  pet.addEventListener('dblclick', event => { if (event.ctrlKey) return; host?.revealEdge?.(); setExpanded(true); render(); });
  // Moving between the peeking pet and what it shows (across the small gap) never counts as leaving.
  const PEEK_PARTS = '#character-wrap, #panel, #summary';
  const peekEnter = () => {
    clearTimeout(peekLeaveTimer);
    if (!edgeSide || expanded || peekHover) return;
    peekHover = true;
    render();
  };
  const peekLeave = event => {
    if (!peekHover || (event.relatedTarget instanceof Element && event.relatedTarget.closest(PEEK_PARTS))) return;
    clearTimeout(peekLeaveTimer);
    peekLeaveTimer = setTimeout(() => { peekHover = false; render(); }, 300);
  };
  for (const id of ['character-wrap', 'panel', 'summary']) { $(id).addEventListener('pointerenter', peekEnter); $(id).addEventListener('pointerleave', peekLeave); }
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
  // Ctrl + left button brings DSH's window forward instead of starting a drag.
  pet.addEventListener('pointerdown',event=>{if(event.button!==0)return;if(event.ctrlKey){event.preventDefault();host?.openDsh?.();return;}if(landingActive){stopLanding();render();}if(!host){pressedAt={x:event.screenX,y:event.screenY,t:Date.now()};return;}dragging=true;pressedAt={x:event.screenX,y:event.screenY,t:Date.now()};host.dragStart();});
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
    const top=Math.max(4,Math.min(y,window.innerHeight-belowFloor()-menu.offsetHeight-4))-stage.top;
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
  } else {
    const offLanding = host.onLanding?.(land);
    window.addEventListener('unload', () => offLanding?.());
    const offHint = host.onEdgeHint?.(hint => {
      edgeAttraction = hint && ['left','right','bottom'].includes(hint.side) ? {side: hint.side, strength: Math.max(.25, Math.min(1, Number(hint.strength) || .25))} : null;
      render(true);
    });
    window.addEventListener('unload', () => offHint?.());
    const offEdge = host.onEdge?.(side => { edgeSide = side === 'left' || side === 'right' ? side : null; peekHover = false; clearTimeout(peekLeaveTimer); if (edgeSide) setExpanded(false); render(); });
    window.addEventListener('unload', () => offEdge?.());
    const offArea = host.onArea?.(area => { if (area && ['x','y','width','height'].every(k => Number.isFinite(area[k]))) { workArea = area; const w = area.window; windowBounds = w && ['x','y','width','height'].every(k => Number.isFinite(w[k])) ? w : null; updateComposerSide(); paintComposer(); } });
    window.addEventListener('unload', () => offArea?.());
    // The new width can land after the host's area message: work the composer's side out again.
    window.addEventListener('resize', () => { updateComposerSide(); paintComposer(); syncSize(); });
    render();unsubscribe=host.onState(receive);
  }
  window.addEventListener('unload',()=>{if(typeof unsubscribe==='function')unsubscribe();});
})();
