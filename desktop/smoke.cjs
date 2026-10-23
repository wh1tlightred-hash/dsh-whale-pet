// Automated UI verification against a local fixture bridge, never a live DSH task.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const main = require('./main.cjs');
const output = path.resolve(__dirname, '..', '.local');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
(async () => {
  await app.whenReady();
  let win;
  for (let attempt = 0; attempt < 100; attempt++) { win = main.getWindow(); if (win && main.getState().projects.length) break; await wait(100); }
  assert(main.getState().projects.length === 2, 'fixture state did not arrive');
  await wait(500);
  const facts = await win.webContents.executeJavaScript(`({imageReady: document.getElementById('character').naturalWidth > 0, projects: document.querySelectorAll('.project').length, approval: !document.getElementById('approval-section').hidden, text: document.getElementById('approval-operation').textContent, injected: !!document.getElementById('xss-test'), expanded: document.getElementById('app').classList.contains('expanded')})`);
  assert(facts.imageReady, 'PNG did not load');
  assert(facts.projects === 2 && facts.approval && facts.expanded, 'project/approval rendering failed');
  assert(facts.text.includes('<img') && !facts.injected, 'task text must remain literal');
  fs.writeFileSync(path.join(output, 'preview-approval.png'), (await win.webContents.capturePage()).toPNG());
  const withApproval = win.getBounds();
  const petExpanded = await win.webContents.executeJavaScript("(() => { const c = document.getElementById('character'); return c.offsetWidth + 'x' + c.offsetHeight; })()");
  // One window size throughout: as tall as the work area, wide enough for the composer (300 + 236).
  const area = require('electron').screen.getDisplayMatching(withApproval).workArea;
  const sameWindow = b => Math.abs(b.width - withApproval.width) <= 1 && Math.abs(b.height - withApproval.height) <= 1;
  assert(Math.abs(withApproval.width - 786) <= 2 && Math.abs(withApproval.height - area.height) <= 1, `the window should be work-area tall and 786 wide (536 + 250 peek room), got ${JSON.stringify(withApproval)}`);
  const panelHeight = () => win.webContents.executeJavaScript("document.getElementById('panel').offsetHeight");
  const panelWithApproval = await panelHeight();
  await win.webContents.executeJavaScript("document.getElementById('allow').click()");
  for (let attempt = 0; attempt < 50 && main.getState().approvals.length; attempt++) await wait(100);
  assert(main.getState().approvals.length === 0, 'approval round trip failed');
  await wait(200);
  const complete = await win.webContents.executeJavaScript(`({notice: !document.getElementById('notice').hidden, text: document.getElementById('notice-title').textContent})`);
  assert(complete.notice && complete.text.includes('完成'), 'completion notice missing');
  const twoProjects = { height: await panelHeight(), bounds: win.getBounds() };
  assert(twoProjects.height < panelWithApproval && sameWindow(twoProjects.bounds), 'the panel should shrink once the approval is gone, without resizing the window');
  const many = Array.from({ length: 7 }, (_, i) => ({ id: `many-${i}`, name: `项目 ${i + 1} · 任务`, status: i ? 'thinking' : 'working', detail: '思考中' }));
  win.webContents.send('whale:state', { ...main.getState(), projects: many });
  await wait(400);
  const sevenProjects = { height: await panelHeight(), bounds: win.getBounds() };
  assert(sevenProjects.height > twoProjects.height + 150 && sameWindow(sevenProjects.bounds), `the panel should grow with the number of tasks: ${twoProjects.height} -> ${sevenProjects.height}, rows=${await win.webContents.executeJavaScript("document.querySelectorAll('.project').length")}`);
  const fits = await win.webContents.executeJavaScript("(() => { const c = document.getElementById('panel-content'); return c.scrollHeight - c.clientHeight; })()");
  assert(fits <= 1, 'panel content should fit without scrolling');
  fs.writeFileSync(path.join(output, 'preview-many.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.getElementById('summary').click()");
  await wait(300);
  fs.writeFileSync(path.join(output, 'preview-complete.png'), (await win.webContents.capturePage()).toPNG());
  const js = code => win.webContents.executeJavaScript(code);
  const openMenu = () => js("(() => { const pet = document.getElementById('character-wrap').getBoundingClientRect(); document.getElementById('character-wrap').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: pet.x + pet.width / 2, clientY: pet.y + pet.height / 2 })); const m = document.getElementById('pet-menu'); const r = m.getBoundingClientRect(); return { open: !m.hidden, labels: [...m.querySelectorAll('button')].map(b => b.childNodes[0].textContent.trim()), checked: document.getElementById('menu-top').getAttribute('aria-checked'), inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; })()");
  let menu = await openMenu();
  assert(menu.open && menu.inside && menu.labels.join('|') === '置顶|隐藏桌宠', `right-click menu wrong: ${JSON.stringify(menu)}`);
  assert(menu.checked === 'true' && main.isPinned(), 'the pet starts pinned on top');
  await js("document.getElementById('menu-top').click()"); await wait(200);
  assert(!main.isPinned(), 'unchecking 置顶 should unpin the window');
  menu = await openMenu();
  assert(menu.checked === 'false', 'the menu should show 置顶 unchecked');
  await js("document.getElementById('menu-top').click()"); await wait(200);
  assert(main.isPinned() && await js("document.getElementById('pet-menu').hidden"), 'checking 置顶 again should pin the window and close the menu');
  // Drag three times with a simulated cursor: each drag follows it, release stops following, buttons still work.
  const electron = require('electron');
  const realCursor = electron.screen.getCursorScreenPoint;
  let cursor = { x: 0, y: 0 };
  electron.screen.getCursorScreenPoint = () => ({ ...cursor });
  const petPoint = () => js("(() => { const r = document.getElementById('character-wrap').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()");
  const dragBy = async (dx, dy) => {
    const b = win.getBounds(); const p = await petPoint();
    cursor = { x: b.x + p.x, y: b.y + p.y };
    await js(`document.getElementById('character-wrap').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, clientX: ${p.x}, clientY: ${p.y}, screenX: ${cursor.x}, screenY: ${cursor.y} }))`);
    await wait(60);
    cursor = { x: cursor.x + dx, y: cursor.y + dy };
    await wait(120);
    const moved = win.getBounds();
    await js(`window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, buttons: 0, screenX: ${cursor.x}, screenY: ${cursor.y} }))`);
    await wait(60);
    cursor = { x: cursor.x + 50, y: cursor.y + 50 };
    await wait(120);
    const after = win.getBounds();
    return { dx: moved.x - b.x, dy: moved.y - b.y, followedAfterRelease: after.x !== moved.x || after.y !== moved.y, sameSize: Math.abs(moved.width - b.width) <= 1 && Math.abs(moved.height - b.height) <= 1 };
  };
  // Drag mid-screen: released close above the bottom edge she would step down onto it.
  // The hidden window opens where the real pet was left; centre it so no screen edge is near (near the left
  // edge the composer would open on the pet's right).
  { const b = win.getBounds(); win.setPosition(area.x + Math.round((area.width - b.width) / 2), b.y - 300); await wait(200); }
  const sizeBefore = win.getBounds();
  const drags = [await dragBy(30, -20), await dragBy(-30, 20), await dragBy(15, 10)];
  const sizeAfter = win.getBounds();
  // Display scaling may round an edge by 1px at some positions; it must never accumulate.
  assert(Math.abs(sizeAfter.width - sizeBefore.width) <= 1 && Math.abs(sizeAfter.height - sizeBefore.height) <= 1, `dragging changed the window size: ${sizeBefore.width}x${sizeBefore.height} -> ${sizeAfter.width}x${sizeAfter.height}`);
  electron.screen.getCursorScreenPoint = realCursor;
  assert(drags.every((d, i) => d.dx === [30, -30, 15][i] && d.dy === [-20, 20, 10][i] && !d.followedAfterRelease && d.sameSize), `drags misbehaved: ${JSON.stringify(drags)}`);
  const clickable = await js("(() => { const before = document.getElementById('app').classList.contains('expanded'); document.getElementById('summary').click(); const after = document.getElementById('app').classList.contains('expanded'); document.getElementById('summary').click(); return before !== after; })()");
  assert(clickable, 'the status bubble should still respond after dragging');
  // The DSH size setting zooms the pet and the window follows.
  const petBox = () => js("(() => { const r = document.getElementById('character-wrap').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()");
  const normal = { pet: await petBox(), win: win.getBounds() };
  win.webContents.send('whale:state', { ...main.getState(), scale: 1.4 });
  await wait(400);
  const large = { pet: await petBox(), win: win.getBounds() };
  win.webContents.send('whale:state', { ...main.getState(), scale: 1 });
  await wait(400);
  const back = { pet: await petBox(), win: win.getBounds() };
  assert(Math.abs(large.pet.w - normal.pet.w * 1.4) <= 2 && large.win.width > normal.win.width && Math.abs(back.pet.w - normal.pet.w) <= 1 && Math.abs(back.win.width - normal.win.width) <= 1, `scaling misbehaved: ${JSON.stringify({ normal, large, back })}`);
  // The pet's name (DSH setting) titles the bubble when no task is selected.
  win.webContents.send('whale:state', { ...main.getState(), projects: [], approvals: [], name: '小蓝鲸' });
  await wait(200);
  const named = await js("document.getElementById('current-project').textContent");
  win.webContents.send('whale:state', { ...main.getState(), projects: [], approvals: [] });
  await wait(200);
  const defaultName = await js("document.getElementById('current-project').textContent");
  assert(named === '小蓝鲸' && defaultName === '小蓝鲸', 'the bubble should show the configured name and keep it when a state carries none: ' + named + ' / ' + defaultName);
  // A click on the pet leaves the compose icon to hover; the icon itself opens the bar.
  const clickPet = () => js("(() => { const p = document.getElementById('character-wrap').getBoundingClientRect(); const at = { bubbles: true, button: 0, buttons: 1, clientX: p.x + p.width / 2, clientY: p.y + p.height / 2, screenX: 500, screenY: 500 }; document.getElementById('character-wrap').dispatchEvent(new PointerEvent('pointerdown', at)); window.dispatchEvent(new PointerEvent('pointerup', { ...at, buttons: 0 })); })()");
  const composerFacts = () => js("({ state: document.getElementById('app').dataset.composer, icon: !document.getElementById('composer-icon').hidden, bar: !document.getElementById('composer-form').hidden, status: document.getElementById('composer-status').hidden ? '' : document.getElementById('composer-status').textContent })");
  const plain = win.getBounds();
  await clickPet(); await wait(250);
  const withIcon = { ...(await composerFacts()), bounds: win.getBounds() };
  await js("document.getElementById('composer-icon').click()"); await wait(250);
  const withBar = { ...(await composerFacts()), bounds: win.getBounds(), gap: await js("Math.round(document.getElementById('character').getBoundingClientRect().left + document.getElementById('character').offsetWidth * 0.36 - document.getElementById('composer-form').getBoundingClientRect().right)") };
  await js("(() => { const i = document.getElementById('composer-input'); i.value = '帮我写一份周报'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()");
  await wait(600);
  const afterSend = { ...(await composerFacts()), bounds: win.getBounds(), input: await js("document.getElementById('composer-input').value") };
  assert(withIcon.state === 'off' && withIcon.icon && !withIcon.bar && Math.abs(withIcon.bounds.width - plain.width) <= 1 && Math.abs((withIcon.bounds.x + withIcon.bounds.width) - (plain.x + plain.width)) <= 1, `a click on the pet must not pin the compose icon (it shows on hover only): ${JSON.stringify({ plain, withIcon })}`);
  assert(withBar.state === 'open' && withBar.bar && Math.abs(withBar.bounds.width - plain.width) <= 1 && withBar.gap >= 60 && Math.abs((withBar.bounds.x + withBar.bounds.width) - (plain.x + plain.width)) <= 1, `the icon should open the composer bar: ${JSON.stringify(withBar)}`);
  assert(afterSend.status === '已发起新对话' && afterSend.state === 'off' && afterSend.input === '' && Math.abs(afterSend.bounds.width - plain.width) <= 1, `sending should start a chat and fold the composer: ${JSON.stringify(afterSend)}`);
  // With the task cards open, the composer bar always shows.
  await js("document.getElementById('summary').click()"); await wait(250);
  const openWithCards = await composerFacts();
  await js("document.getElementById('summary').click()"); await wait(250);
  const closedAgain = await composerFacts();
  assert(openWithCards.state === 'open' && openWithCards.bar && closedAgain.state === 'off', `the composer should stay open with the cards: ${JSON.stringify({ openWithCards, closedAgain })}`);
  const removed = await win.webContents.executeJavaScript("!document.getElementById('pet-toggle') && !document.getElementById('pin')");
  assert(removed, 'the ••• and pin buttons should be gone');
  const petCollapsed = await win.webContents.executeJavaScript("(() => { const c = document.getElementById('character'); return c.offsetWidth + 'x' + c.offsetHeight; })()");
  assert(petCollapsed === petExpanded, `the pet should be the same size open and closed: ${petExpanded} vs ${petCollapsed}`);
  const bounds = win.getBounds();
  assert(sameWindow(bounds) && await js("document.getElementById('panel').hidden"), 'clicking the status bubble should collapse the panel without resizing the window');
  fs.writeFileSync(path.join(output, 'smoke-result.json'), JSON.stringify({ ok: true, facts, complete, panelHeights: { withApproval: panelWithApproval, twoProjects: twoProjects.height, sevenProjects: sevenProjects.height }, bounds }, null, 2));
  main.quit();
})().catch(error => { fs.writeFileSync(path.join(output, 'smoke-result.json'), JSON.stringify({ ok: false, error: error.stack })); app.exit(1); });
