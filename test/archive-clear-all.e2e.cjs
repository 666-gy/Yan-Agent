'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-archive-clear-all-'));
fs.mkdirSync(path.join(profile, 'YanData'), { recursive: true });
fs.writeFileSync(path.join(profile, 'YanData', 'config.json'), '{}');
const workspace = path.join(profile, 'project');
fs.mkdirSync(workspace);
const output = path.join(root, 'output/playwright/archive-clear-all');
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile, YAN_DISABLE_SINGLE_INSTANCE: '1' } });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(() => window.YanStartupHello?.skip());
    fs.mkdirSync(output, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    const ids = await page.evaluate(async workspace => {
      const ids = [];
      for (const title of ['清除测试一', '清除测试二', '清除测试三']) {
        const session = await api.createSession(true, workspace);
        session.title = title;
        session.messages = [{ role: 'user', content: '保留历史' }, { role: 'assistant', content: '完成' }];
        await api.saveSession(session);
        ids.push(session.id);
      }
      await api.setSessionsArchived(ids, true);
      await api.createSession(true, workspace);
      await refreshSessions();
      return ids;
    }, workspace);
    await app.evaluate(({ ipcMain }) => {
      const store = global.__YAN_E2E_SESSION_STORE__;
      if (!store) throw new Error('E2E session store hook missing');
      ipcMain.removeHandler('session:delete');
      ipcMain.handle('session:delete', async (_event, payload) => {
        await new Promise(resolve => setTimeout(resolve, 1200));
        const id = typeof payload === 'string' ? payload : payload?.id;
        const confirmed = typeof payload === 'object' && !!payload?.confirmed;
        return store.deleteSessionRecord(id, { confirmed, archivedOnly: payload?.archivedOnly === true, cleanupDays: payload?.cleanupDays });
      });
    });
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-archived').click();
    await page.locator('.archive-chat').first().waitFor();
    assert.equal(await page.locator('.archive-chat').count(), 3);
    await page.locator('#archiveDeleteAll').click();
    await page.locator('#genericConfirmAccept').click();
    assert.equal(await page.locator('#archivedChatList .archive-chat').count(), 0, 'archived list clears immediately');
    assert.equal(await page.locator('#archiveDeleteAll').isDisabled(), true);
    await page.locator('#toast .toast-spinner').waitFor();
    assert.match(await page.locator('#toast').textContent(), /正在删除中……/);
    assert.equal(await page.locator('#toast').isVisible(), true);
    await page.screenshot({ path: path.join(output, 'clearing.png') });
    await page.evaluate(() => window.YanArchiveSettings.refresh());
    assert.equal(await page.locator('#archivedChatList .archive-chat').count(), 0, 'refresh during clearing keeps the list empty');
    assert.match(await page.locator('#toast').textContent(), /正在删除中……/);
    await page.waitForTimeout(2600);
    assert.equal(await page.locator('#toast').isVisible(), true, 'deleting toast stays visible past the default timeout');
    assert.match(await page.locator('#toast').textContent(), /正在删除中……/);
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('已全部清除'), { timeout: 10000 });
    assert.equal(await page.locator('#toast .toast-spinner').count(), 0);
    assert.equal(await page.locator('#archivedChatList .archive-chat').count(), 0);
    assert.equal((await page.evaluate(() => api.listArchivedSessions())).length, 0);
    for (const id of ids) assert.equal(await page.evaluate(id => api.getSession(id), id), null);
    await page.locator('#toast').waitFor({ state: 'hidden', timeout: 5000 });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, immediateClear: true, persistentToast: true, finalToast: '已全部清除' }));
  } finally {
    await app?.close();
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
