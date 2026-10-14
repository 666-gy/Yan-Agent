'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { _electron } = require('playwright');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-usage-ui-'));
  let app;
  try {
  const dbDir = path.join(root, 'YanData', 'opencode-runtime', 'data', 'opencode');
  fs.mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(path.join(dbDir, 'opencode.db'));
  db.exec('CREATE TABLE session(id TEXT PRIMARY KEY, parent_id TEXT); CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)');
  db.exec("INSERT INTO session VALUES ('s1', NULL), ('s2', 's1')");
  const now = Date.now();
  const insert = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)');
  for (let i = 0; i < 40; i++) {
    insert.run(`m${i}`, i % 2 ? 's2' : 's1', now - i * 86400000, JSON.stringify({ role: 'assistant', modelID: i % 3 ? 'Claude Opus' : 'Model <script>alert(1)</script>', providerID: 'Test provider', tokens: { input: 1000, output: 400, reasoning: 100, cache: { read: 5000, write: 200 } } }));
  }
  db.close();
    app = await _electron.launch({ executablePath: require('electron'), args: [process.cwd()], env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: root } });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-usage').click();
    await page.waitForFunction(() => document.querySelector('#tab-usage').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#usageStatus').textContent(), '');
    assert.equal(await page.locator('.usage-card').count(), 2);
    assert.equal(await page.locator('#usagePanels script').count(), 0);
    assert.equal(await page.locator('.usage-metrics strong').nth(1).textContent(), '40');
    assert.equal(await page.locator('.usage-metrics strong').nth(2).getAttribute('title'), '268,000');
    assert.equal(await page.locator('#settings-tab-usage').evaluate(el => el.previousElementSibling.dataset.tab), 'vision-relay');
    for (const range of ['7d', '30d', 'all']) {
      await page.locator(`[data-usage-range="${range}"]`).first().click();
      await page.waitForFunction(() => document.querySelector('#tab-usage').getAttribute('aria-busy') === 'false');
      assert.equal(await page.locator(`[data-usage-range="${range}"][aria-pressed="true"]`).count(), 2);
      assert.equal(await page.locator('.usage-metrics strong').nth(1).textContent(), range === 'all' ? '40' : range === '7d' ? '7' : '30');
    }
    assert.equal((await page.evaluate(() => window.yan.getUsageStats({ range: 'invalid' }))).ok, false);
    fs.mkdirSync('output/playwright/usage', { recursive: true });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(async theme => { state.config = await api.setConfig({ theme }); applyTheme(theme); }, theme);
      await page.screenshot({ path: `output/playwright/usage/${theme}.png` });
      await page.locator('.usage-card').nth(1).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `output/playwright/usage/${theme}-models.png` });
      await page.locator('.usage-card').first().scrollIntoViewIfNeeded();
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1080, 820));
    await page.locator('.usage-card').nth(1).scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#tab-usage').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({ path: 'output/playwright/usage/narrow-models.png' });
    const writer = new DatabaseSync(path.join(dbDir, 'opencode.db'));
    writer.exec('DELETE FROM message');
    await page.locator('#usageRefresh').click();
    await page.waitForFunction(() => document.querySelector('#tab-usage').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('.usage-metrics strong').nth(1).textContent(), '0');
    assert.match(await page.locator('.usage-empty').textContent(), /该时间段内没有 Token 用量/);
    writer.exec('DROP TABLE message'); writer.close();
    await page.locator('#usageRefresh').click();
    await page.waitForFunction(() => document.querySelector('#tab-usage').getAttribute('aria-busy') === 'false');
    assert.match(await page.locator('#usageStatus').textContent(), /无法加载用量/);
    assert.equal(await page.locator('.usage-card').count(), 0, 'error does not masquerade as zero usage');
    assert.deepEqual(errors, []);
    console.log('PASS real SQLite → child process → IPC → two panels, ranges, escaping, themes, narrow layout, refresh, empty and error states');
  } finally {
    try { await app?.close(); } finally {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
