'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-storage-ui-'));
const dataDir = path.join(userData, 'YanData');
fs.mkdirSync(path.join(dataDir, 'sessions'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'sessions', 'storage-test.json'), JSON.stringify({
  id: 'storage-test', title: '存储测试', messages: [{ role: 'assistant', content: '本地聊天记录', agentRun: { subagents: [{ id: 'sub', text: '子任务' }] } }]
}));
(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-storage').click();
    await page.waitForFunction(() => document.querySelector('#tab-storage').dataset.totalBytes && document.querySelector('#tab-storage').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#settingsSectionTitle').textContent(), '存储空间');
    assert.equal(await page.locator('#settingsSectionTitle svg[data-keyline-icon="hard-drive"]').count(), 1);
    assert.equal(await page.locator('#storageStatus').count(), 0);
    assert.equal(await page.locator('#storageCleanup').isEnabled(), true);
    assert.equal(await page.locator('#settings-tab-configuration + #settings-tab-storage').count(), 1);
    const first = await page.evaluate(() => api.storageStats());
    assert.equal(first.ok, true);
    assert.ok(first.categories.chats > 0);
    assert.ok(first.categories.subagents > 0);
    assert.equal(path.resolve(first.dataDir), path.resolve(dataDir));
    const added = 5 * 1024 * 1024;
    fs.writeFileSync(path.join(dataDir, 'storage-refresh-fixture.bin'), Buffer.alloc(added));
    await page.locator('#storageRefresh').click();
    await page.waitForFunction(min => Number(document.querySelector('#tab-storage').dataset.totalBytes) >= min
      && document.querySelector('#tab-storage').getAttribute('aria-busy') === 'false', first.totalBytes + added);
    const beforeFailure = await page.locator('#storageTotal').textContent();
    fs.writeFileSync(path.join(dataDir, 'managed-worktrees.json'), '{invalid');
    await page.locator('#storageRefresh').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('保留上次统计结果'));
    assert.equal(await page.locator('#storageTotal').textContent(), beforeFailure);
    assert.equal(await page.locator('#storageRefresh').isEnabled(), true);
    fs.writeFileSync(path.join(dataDir, 'managed-worktrees.json'), '[]');
    await page.locator('#storageRefresh').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent === '存储空间已刷新');
    await page.locator('#storageWorktrees').click();
    assert.equal(await page.locator('#tab-worktrees').getAttribute('aria-hidden'), 'false');
    await page.locator('#settings-tab-storage').click();
    await page.locator('#storageArchives').click();
    assert.equal(await page.locator('#tab-archived').getAttribute('aria-hidden'), 'false');
    await page.locator('#settings-tab-storage').click();
    await page.waitForFunction(() => document.querySelector('#tab-storage').getAttribute('aria-busy') === 'false');
    const output = path.join(root, 'output/playwright');
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'storage-settings.png') });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.screenshot({ path: path.join(output, 'storage-settings-light.png') });
    await page.setViewportSize({ width: 940, height: 850 });
    assert.equal(await page.locator('#tab-storage').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({ path: path.join(output, 'storage-settings-narrow.png') });
    assert.deepEqual(errors, []);
    console.log('Storage real IPC, refresh, error preservation/recovery, disabled cleanup and management navigation passed.');
  } finally {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
