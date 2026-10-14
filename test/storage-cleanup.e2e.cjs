'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-cleanup-ui-'));
const dataDir = path.join(userData, 'YanData'), sessionsDir = path.join(dataDir, 'sessions');
fs.mkdirSync(sessionsDir, { recursive: true });
for (const [id, days, title] of [['sess_old-archive', 100, '旧归档聊天'], ['sess_old-active', 200, '旧未归档聊天'], ['sess_recent', 1, '近期聊天']]) {
  fs.writeFileSync(path.join(sessionsDir, `${id}.json`), JSON.stringify({ id, title, createdAt: Date.now() - days * 86400000, updatedAt: Date.now() - days * 86400000,
    messages: [{ role: 'assistant', content: '记录', agentRun: { subagents: [{ id: 'sub', text: '子任务' }] } }] }));
}
fs.writeFileSync(path.join(sessionsDir, '.archived'), JSON.stringify({ 'sess_old-archive': 1 }));
(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    await page.locator('#settingsBtn').click(); await page.locator('#settings-tab-storage').click();
    await page.locator('#storageCleanup').click();
    const dialog = page.locator('#storageCleanupDialog');
    await page.waitForFunction(() => document.querySelector('#storageCleanupList').getAttribute('aria-busy') === 'false');
    assert.equal(await dialog.locator('.storage-cleanup-chat').count(), 1);
    assert.equal(await page.locator('#storageCleanupDelete').isDisabled(), true);
    await page.locator('#storageCleanupDays').click();
    assert.deepEqual(await page.locator('#storageCleanupDaysMenu button').allTextContents(), ['超过 30 天', '超过 90 天', '超过 180 天', '超过 365 天']);
    await page.locator('#storageCleanupDaysMenu button').filter({ hasText: '超过 365 天' }).click();
    await page.waitForFunction(() => document.querySelector('#storageCleanupList').textContent.includes('没有符合'));
    const output = path.join(root, 'output/playwright'); fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'storage-cleanup-empty.png') });
    const bounds = await dialog.boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) < 2);
    assert.ok(Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2) < 2);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.screenshot({ path: path.join(output, 'storage-cleanup-light.png') });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.locator('#storageCleanupDays').click();
    await page.screenshot({ path: path.join(output, 'storage-cleanup-days.png') });
    await page.locator('#storageCleanupDaysMenu button').filter({ hasText: '超过 30 天' }).click();
    await page.locator('#storageCleanupScope').click();
    await page.screenshot({ path: path.join(output, 'storage-cleanup-scope.png') });
    await page.locator('#storageCleanupScopeMenu button').filter({ hasText: '所有聊天' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.storage-cleanup-chat').length === 2);
    await page.locator('#storageCleanupSelectAll').check();
    assert.equal(await page.locator('#storageCleanupCount').textContent(), '已选择聊天：2 · 子智能体：2');
    await page.locator('#storageCleanupScope').click();
    await page.locator('#storageCleanupScopeMenu button').filter({ hasText: '已归档聊天' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.storage-cleanup-chat').length === 1);
    assert.equal(await page.locator('#storageCleanupDelete').isDisabled(), true);
    await dialog.locator('.storage-cleanup-chat input').check();
    await page.screenshot({ path: path.join(output, 'storage-cleanup-selected.png') });
    await page.locator('#storageCleanupDelete').click();
    await page.locator('#genericConfirmCancel').click();
    assert.equal(fs.existsSync(path.join(sessionsDir, 'sess_old-archive.json')), true);
    await page.locator('#storageCleanupDelete').click();
    await page.locator('#genericConfirmAccept').click();
    await page.waitForFunction(() => document.querySelector('#storageCleanupList').textContent.includes('没有符合'));
    assert.equal(fs.existsSync(path.join(sessionsDir, 'sess_old-archive.json')), false);
    assert.equal(fs.existsSync(path.join(sessionsDir, 'sess_old-active.json')), true);
    assert.equal(fs.existsSync(path.join(sessionsDir, 'sess_recent.json')), true);
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(sessionsDir, '.archived'))), 'sess_old-archive'), false);
    await page.locator('#storageCleanupCancel').click();
    const stats = await page.evaluate(() => api.storageStats());
    assert.equal(stats.categories.archivedChats, 0);
    assert.equal(await page.locator('#storageSize-archivedChats').textContent(), '0 B');
    assert.deepEqual(errors, []);
    console.log('Cleanup filters, menus, counts, confirmation/cancel, real deletion, preserved chats and storage refresh passed.');
  } catch (error) {
    const page = await app?.firstWindow();
    if (page) console.error(await page.evaluate(() => ({ toast: document.querySelector('#toast')?.textContent, list: document.querySelector('#storageCleanupList')?.textContent })));
    throw error;
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); }
    catch (error) { console.warn(`Temporary test data retained: ${error.message}`); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
