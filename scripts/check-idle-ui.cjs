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
      window.whale = { onState(fn) { window.receiveFixture = fn; }, onLanding(fn) { window.landFixture = fn; }, onEdgeHint(fn) { window.hintFixture = fn; }, setExpanded() {}, setInteractive() {} };
    });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../ui/index.html')).href);
    await page.evaluate(() => window.hintFixture({side:'left',ready:false,strength:.5}));
    assert.match(await page.locator('#character').getAttribute('src'), /idle-look-left\.png$/);
    assert.equal(await page.locator('#character').evaluate(el => el.style.getPropertyValue('--edge-pull-x')), '-2.5px');
    assert.equal(await page.locator('#character').evaluate(el => el.style.getPropertyValue('--edge-pull-angle')), '10deg');
    await page.evaluate(() => window.hintFixture({side:'right',ready:true,strength:1}));
    assert.match(await page.locator('#character').getAttribute('src'), /idle-look-right\.png$/);
    assert.equal(await page.locator('#character').evaluate(el => el.style.getPropertyValue('--edge-pull-x')), '5px');
    assert.equal(await page.locator('#character').evaluate(el => el.style.getPropertyValue('--edge-pull-angle')), '-20deg');
    await page.evaluate(() => window.hintFixture({side:'bottom',strength:1}));
    assert.match(await page.locator('#character').getAttribute('src'), /idle-look-down\.png$/);
    assert.equal(await page.locator('#character').evaluate(el => el.style.getPropertyValue('--floor-squash')), '0.985');
    await page.evaluate(() => window.landFixture({drop:40}));
    assert.equal(await page.locator('#app').getAttribute('data-landing'), 'true');
    const fall = await page.locator('#character').evaluate(el => {
      const a = el.getAnimations().find(a => a.effect.getTiming().fill === 'both');
      return {duration:a.effect.getTiming().duration, frames:a.effect.getKeyframes().map(f=>f.transform)};
    });
    assert.ok(fall.duration > 300 && fall.duration < 450);
    assert.equal(fall.frames.length, 15);
    assert.match(fall.frames[0], /translateY\(-40px\)/);
    assert.equal(fall.frames[12], 'translateY(0px) scaleY(1)');
    assert.equal(fall.frames[13], 'translateY(0px) scaleY(0.985)');
    await page.clock.runFor(650);
    assert.equal(await page.locator('#app').getAttribute('data-landing'), '');
    for (const drop of [0, 1, 2, -1]) {
      await page.evaluate(drop => window.landFixture({drop}), drop);
      assert.notEqual(await page.locator('#app').getAttribute('data-landing'), 'true', 'touching floor must not hop');
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(() => window.landFixture({drop:40}));
    assert.notEqual(await page.locator('#app').getAttribute('data-landing'), 'true');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(() => window.hintFixture(null));
    assert.equal(await page.locator('#app').getAttribute('data-attracted'), '');
    assert.equal(await page.locator('#edge-hint').count(), 0);
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
    await page.clock.runFor(700);
    assert.match(await page.locator('#character').getAttribute('src'), /idle-rice-hold\.png$/);
    await page.clock.runFor(400);
    assert.match(await page.locator('#character').getAttribute('src'), /idle-rice-scoop\.png$/);
    await page.clock.runFor(380);
    assert.match(await page.locator('#character').getAttribute('src'), /idle-rice-lift\.png$/);
    await page.clock.runFor(220);
    assert.match(await page.locator('#character').getAttribute('src'), /idle-rice-eat\.png$/);
    await page.clock.runFor(240);
    assert.match(await page.locator('#character').getAttribute('src'), /idle-rice-chew\.png$/);
    await page.clock.runFor(650);
    assert.match(await page.locator('#character').getAttribute('src'), /idle-rice-satisfied\.png$/);
    // Finish the second bite: the ending must go straight from holding the bowl to front-facing idle.
    await page.clock.runFor(330 + 250 + 320 + 200 + 220 + 780 + 700);
    assert.match(await page.locator('#character').getAttribute('src'), /idle-rice-hold\.png$/);
    await page.clock.runFor(350);
    assert.match(await page.locator('#character').getAttribute('src'), /\/idle\.png$/);
    await page.clock.runFor(400);
    assert.equal(await page.locator('#character').getAttribute('data-idle-action'), null);
    assert.equal(await page.locator('.character-transition').isHidden(), true);
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
