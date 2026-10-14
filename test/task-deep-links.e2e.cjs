'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-task-links-'));
const launch = args => electron.launch({ executablePath: require('electron'), args: [root, ...args], cwd: root,
  env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
(async () => {
  let app;
  try {
    app = await launch([]);
    let page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__ && state.currentSession);
    const ids = await page.evaluate(async () => {
      const original = state.currentSession.id;
      const target = await api.createSession(true, '');
      await api.renameSession(target.id, '深度链接测试');
      await refreshSessions();
      return { original, target: target.id };
    });
    const link = `yanagent://tasks/${ids.target}`;
    await page.locator(`.session-item[data-id="${ids.target}"]`).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: '复制', exact: true }).hover();
    await page.getByRole('menuitem', { name: '复制深度链接', exact: true }).click();
    for (let i = 0; i < 40; i++) {
      if ((await app.evaluate(({ clipboard }) => clipboard.readText())) === link) break;
      await page.waitForTimeout(50);
    }
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), link);
    await app.evaluate(({ app, BrowserWindow }, link) => {
      BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html')).hide();
      app.emit('second-instance', {}, [process.execPath, link]);
    }, link);
    await page.waitForFunction(id => state.currentSession.id === id, ids.target);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html')).isVisible()), true);
    await page.evaluate(async id => { await loadSession(id); switchSidebarNav('skills'); }, ids.original);
    await app.evaluate(({ app }, link) => app.emit('open-url', { preventDefault() {} }, link), link);
    await page.waitForFunction(id => state.currentSession.id === id && currentMainPage === 'chat', ids.target);
    await app.evaluate(({ app }) => app.emit('second-instance', {}, ['yanagent://tasks/sess_deleted']));
    await page.getByText('任务不存在或已删除，无法打开此链接', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => state.currentSession.id), ids.target);
    await app.evaluate(({ app }) => app.emit('second-instance', {}, ['yanagent://tasks/../../bad']));
    await page.getByText('无效的任务链接', { exact: true }).waitFor();
    await app.close(); app = null;
    app = await launch([`yanagent://tasks/${ids.original}`]);
    page = await app.firstWindow();
    await page.waitForFunction(id => window.__YAN_APP_READY__ && state.currentSession?.id === id, ids.original);
    // Allow boot completion to prove the normal startup task doesn't overwrite the linked task.
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => state.currentSession.id), ids.original);
    console.log(JSON.stringify({ ok: true, copiedLink: true, warmStart: true, coldStart: true, hiddenWindow: true, missingTask: true, invalidLink: true }));
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
