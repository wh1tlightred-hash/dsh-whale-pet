// Browser regression check; run with the workspace Playwright NODE_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<main id="stream"></main><div id="portal"></div>');
    await page.evaluate(() => {
      window.__ModuleLoader__ = { load: entry => { window.petModule = entry.factory(() => ({})); } };
    });
    await page.addScriptTag({ content: fs.readFileSync(process.env.WHALE_CLIENT_SOURCE || path.join(__dirname, '../lib/client.js'), 'utf8') });
    await page.evaluate(() => {
      window.formListeners = new Set();
      window.petConfig = { status: 'ready', writable: true, value: { enabled: true } };
      window.cleanups = [];
      window.petModule.apply({
        effect: effect => cleanups.push(effect()),
        locale: { register: () => () => {}, bind: () => key => key },
        configForms: {
          whileServed: () => () => {},
          get: () => ({
            getSnapshot: () => petConfig,
            subscribe: listener => { formListeners.add(listener); return () => formListeners.delete(listener); },
            set: async (field, value) => {
              petConfig.value[field] = value;
              for (const listener of formListeners) listener();
              return true;
            },
          }),
        },
      });
      window.wholeScans = 0;
      const originalQuery = document.querySelectorAll.bind(document);
      document.querySelectorAll = selector => {
        if (selector === '[role="menu"]') wholeScans++;
        return originalQuery(selector);
      };
    });
    // Each task gives the observer a chance to run, like streamed tokens.
    const wholeScans = await page.evaluate(async () => {
      for (let i = 0; i < 120; i++) {
        document.getElementById('stream').textContent = 'token ' + i;
        await new Promise(resolve => queueMicrotask(resolve));
      }
      return window.wholeScans;
    });
    console.log(JSON.stringify({ streamedUpdates: 120, wholeDocumentMenuScans: wholeScans }));
    if (process.env.WHALE_BENCHMARK_ONLY) return;
    assert.equal(wholeScans, 0, 'streaming outside menus does not scan the document');
    const rows = '<div><button role="menuitem"><span><svg></svg></span><span>Settings</span></button></div><div><button role="menuitem"><span><svg></svg></span><span>Feedback</span></button></div>';
    const petRow = page.locator('[data-dsh-whale-pet-item]');
    await page.evaluate(html => { document.getElementById('portal').innerHTML = '<section><div role="menu">' + html + '</div></section>'; }, rows);
    await petRow.waitFor();
    assert.equal(await petRow.innerText(), 'Hide desktop pet');
    await petRow.locator('button').click();
    assert.equal(await petRow.innerText(), 'Show desktop pet');
    await page.evaluate(() => { document.getElementById('portal').innerHTML = '<section><div role="menu" id="late"></div></section>'; });
    await page.evaluate(html => { document.getElementById('late').innerHTML = html; }, rows);
    await petRow.waitFor();
    assert.equal(await petRow.count(), 1, 'late children and replaced menu ancestors are handled');
    await page.evaluate(html => { document.getElementById('portal').innerHTML = '<div id="late-role">' + html + '</div>'; }, rows);
    await page.evaluate(() => { document.getElementById('late-role').setAttribute('role', 'menu'); });
    await petRow.waitFor();
    await page.evaluate(() => { document.getElementById('late-role').className = 'open'; });
    assert.equal(await petRow.count(), 1);
    await page.evaluate(() => { document.querySelector('[data-dsh-whale-pet-item]').remove(); });
    await petRow.waitFor();
    assert.equal(await petRow.count(), 1, 'React replacement restores the injected item without duplicates');
    await page.evaluate(() => { for (const cleanup of cleanups) cleanup(); });
    assert.equal(await petRow.count(), 0, 'disposing removes injected rows and observers');
    assert.deepEqual(errors, []);
    console.log('Client menu performance and behavior checks passed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
