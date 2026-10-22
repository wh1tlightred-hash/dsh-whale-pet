// Run with Playwright available in NODE_PATH. Uses an isolated page and fixture state.
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.addInitScript(() => {
      Math.random = () => 0;
      window.whale = { onState(fn) { window.receiveFixture = fn; }, setExpanded() {}, setInteractive() {} };
    });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../ui/index.html')).href);
    const send = (status, updatedAt = 1) => page.evaluate(({status, updatedAt}) => window.receiveFixture({
      connected: true, forceExpanded: true,
      projects: [{ id: 'one', name: '测试项目', status, updatedAt, detail: status === 'completed' ? '任务完成' : '处理中' }],
      notice: status === 'completed' ? {id: `done-${updatedAt}`, sessionId: 'one', kind: 'completed', title: '任务完成'} : null
    }), {status, updatedAt});
    const status = () => page.locator('#app').getAttribute('data-status');
    await send('completed');
    assert.equal(await status(), 'completed');
    await page.locator('.project').click();
    assert.equal(await status(), 'idle');
    assert.equal(await page.locator('.project-state').textContent(), '等待新任务');
    assert.equal(await page.locator('#current-status').textContent(), '等待新任务');
    assert.equal(await page.locator('#notice').isHidden(), true);
    await send('completed');
    assert.equal(await status(), 'idle', 'repeat push must stay acknowledged');
    await page.clock.runFor(10000);
    assert.equal(await page.locator('#character').getAttribute('data-idle-action'), 'look');
    assert.match(await page.locator('#character').getAttribute('src'), /idle-look-left\.png$/);
    await page.clock.runFor(1030);
    assert.match(await page.locator('#character').getAttribute('src'), /idle-look-right\.png$/);
    await page.clock.runFor(1370);
    assert.equal(await page.locator('#character').getAttribute('data-idle-action'), null);
    await page.clock.runFor(10000);
    assert.equal(await page.locator('#character').getAttribute('data-idle-action'), 'nod');
    await page.clock.runFor(12400);
    assert.equal(await page.locator('#character').getAttribute('data-idle-action'), 'rice');
    assert.match(await page.locator('#character').getAttribute('src'), /idle-rice-reach\.png$/);
    await page.clock.runFor(800);
    assert.match(await page.locator('#character').getAttribute('src'), /idle-rice-hold\.png$/);
    await page.clock.runFor(650);
    assert.match(await page.locator('#character').getAttribute('src'), /idle-rice-eat\.png$/);
    await page.clock.runFor(1100);
    assert.match(await page.locator('#character').getAttribute('src'), /idle-rice-eat\.png$/);
    await send('working', 2);
    assert.equal(await status(), 'working');
    assert.equal(await page.locator('#character').getAttribute('data-idle-action'), null);
    await page.clock.runFor(4000);
    assert.match(await page.locator('#character').getAttribute('src'), /\/working(?:-02)?\.png$/);
    await send('completed', 3);
    assert.equal(await status(), 'completed', 'next completion must be visible');
    await page.locator('.project').click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.runFor(30000);
    assert.equal(await page.locator('#character').getAttribute('data-idle-action'), null);
    assert.match(await page.locator('#character').getAttribute('src'), /\/idle\.png$/);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await send('working', 4);
    await send('idle', 5);
    await page.clock.runFor(3000);
    assert.match(await page.locator('#character').getAttribute('src'), /idle-blink\.png$/);
    assert.equal(await page.locator('#character').evaluate(el => el.complete && el.naturalWidth > 0), true);
    await send('idle', 5);
    await page.clock.runFor(140);
    assert.match(await page.locator('#character').getAttribute('src'), /\/idle\.png$/);
    await page.clock.runFor(3000);
    assert.match(await page.locator('#character').getAttribute('src'), /idle-blink\.png$/);
    await send('working', 6);
    await page.clock.runFor(140);
    assert.match(await page.locator('#character').getAttribute('src'), /\/working(?:-02)?\.png$/);
    assert.deepEqual(errors, []);
    console.log('PASS: completion acknowledgement, repeat/new state pushes, idle gestures, blink timing and interruption, reduced motion');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
