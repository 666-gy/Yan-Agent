'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-external-ui-'));
const outputDir = path.join(root, 'output/playwright/external-agents');
fs.mkdirSync(outputDir, { recursive: true });
const id = crypto.randomUUID();
const dir = path.join(userData, 'YanData/external-agents/jobs', id);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify({ id, provider: 'codex', title: '排查工作区 A 的构建问题',
  workspace: root, sessionId: 'ui-fixture', dependsOn: [], readOnly: false, createdAt: Date.now() - 31 * 60000 }));
fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ status: 'failed', startedAt: Date.now() - 31 * 60000,
  endedAt: Date.now(), error: '需要额外权限，已保留失败结果，不会重新派发。' }));
const completeOutput = '任务检查结果：保留完整的中文与 emoji 😀。\n'.repeat(1800) + 'COMPLETE-RESULT-END';
fs.writeFileSync(path.join(dir, 'result.txt'), completeOutput);
// Legacy master-off settings must remain effectively off after the UI change.
fs.writeFileSync(path.join(userData, 'YanData/config.json'), JSON.stringify({ externalAgents: {
  enabled: false, providers: { codex: { enabled: true }, claude: { enabled: true } }
} }));
(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    page.setDefaultTimeout(15000);
    await app.evaluate(({ ipcMain, dialog }) => {
      global.__sourcePick = ''; global.__sourceDialogCalls = []; global.__sourceProbeCount = 0;
      dialog.showOpenDialog = async (_window, options) => {
        global.__sourceDialogCalls.push(options);
        return { canceled: !global.__sourcePick, filePaths: global.__sourcePick ? [global.__sourcePick] : [] };
      };
      ipcMain.removeHandler('external-agents:status');
      ipcMain.handle('external-agents:status', async event => {
        ++global.__sourceProbeCount;
        const cfg = await ipcMain._invokeHandlers.get('config:get')(event);
        return { providers: ['codex', 'claude'].map(provider => ({
          provider, installed: true, version: cfg.externalAgents.providers[provider].executable ? '2.0.0-custom' : '1.0.0-auto'
        })) };
      });
    });
    assert.equal(await page.locator('#settings-tab-external-agents, #tab-external-agents, [data-external-detect]').count(), 0);
    async function open(provider) {
      await page.evaluate(() => switchSidebarNav('agents'));
      if (await page.locator('[data-agent-action="back"]').isVisible()) await page.locator('[data-agent-action="back"]').click();
      await page.locator('article[data-agent-open="external-agent:' + provider + '"]').click();
    }
    const toggle = page.locator('[data-agent-action="toggle"]');
    const source = page.locator('[data-agent-action="source"]');
    const selectedPaths = {};
    for (const provider of ['codex', 'claude']) {
      await open(provider);
      assert.equal(await toggle.isChecked(), false, 'legacy master-off remains effectively disabled');
      assert.equal(await source.innerText(), '不是这个？');
      assert.equal(await source.locator('[data-keyline-icon="badge-question"]').count(), 1);
      await page.waitForFunction(() => document.querySelector('[data-agent-version]').textContent === '1.0.0-auto');
      selectedPaths[provider] = path.join(userData, provider + ' 桌面端', provider + '.exe');
      await app.evaluate((_electron, selected) => { global.__sourcePick = selected; }, selectedPaths[provider]);
      const before = await page.evaluate(() => api.getConfig());
      await source.click();
      await page.waitForFunction(() => document.querySelector('[data-agent-version]').textContent === '2.0.0-custom'
        && document.getElementById('pageAgents').getAttribute('aria-busy') === 'false');
      const after = await page.evaluate(() => api.getConfig());
      assert.equal(after.externalAgents.providers[provider].executable, selectedPaths[provider]);
      assert.equal(after.externalAgents.enabled, before.externalAgents.enabled);
      for (const other of ['codex', 'claude']) assert.equal(after.externalAgents.providers[other].enabled, before.externalAgents.providers[other].enabled);
      assert.equal(await source.getAttribute('title'), selectedPaths[provider]);
      const previous = after.externalAgents;
      await app.evaluate(() => { global.__sourcePick = ''; });
      await source.click();
      await page.waitForFunction(() => document.getElementById('pageAgents').getAttribute('aria-busy') === 'false');
      assert.deepEqual((await page.evaluate(() => api.getConfig())).externalAgents, previous, 'cancel keeps saved paths and flags');
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => applyTheme(theme), theme);
        await page.locator('#agentInfoTitle').scrollIntoViewIfNeeded();
        await page.locator('#agentDetailContent .plugin-info-section').screenshot({ path: path.join(outputDir, provider + '-' + theme + '.png') });
      }
    }
    const dialogs = await app.evaluate(() => global.__sourceDialogCalls);
    assert.equal(dialogs.length, 4);
    assert.ok(dialogs.every(options => options.properties.includes('openFile') && options.filters[0].extensions.includes('exe')));
    await open('codex'); await toggle.check();
    await page.waitForFunction(() => state.config.externalAgents.enabled && state.config.externalAgents.providers.codex.enabled && !state.config.externalAgents.providers.claude.enabled);
    await open('claude'); await toggle.check();
    await page.waitForFunction(() => state.config.externalAgents.providers.claude.enabled);
    await toggle.uncheck();
    await page.waitForFunction(() => !state.config.externalAgents.providers.claude.enabled);
    const storedOutput = await page.evaluate(async id => {
      let offset = 0, text = '';
      do { const result = await api.externalAgentsResult({ id, offset, limit: 32000 }); text += result.output; offset = result.next_offset; } while (offset !== null);
      return text;
    }, id);
    assert.equal(storedOutput, completeOutput);
    await page.reload(); await page.waitForFunction(() => window.__YAN_APP_READY__);
    await open('codex');
    assert.equal(await toggle.isChecked(), true);
    const persisted = (await page.evaluate(() => api.getConfig())).externalAgents;
    assert.equal(persisted.providers.codex.executable, selectedPaths.codex);
    assert.equal(persisted.providers.claude.executable, selectedPaths.claude);
    assert.equal((await page.evaluate(() => api.externalAgentsList())).length, 1);
    await page.locator('#sidebarToggle').click(); await page.setViewportSize({ width: 414, height: 900 });
    await page.locator('#agentInfoTitle').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#agentDetailContent').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.locator('#agentDetailContent .plugin-info-section').screenshot({ path: path.join(outputDir, 'source-narrow.png') });
    assert.deepEqual(errors, []);
    console.log('PASS source selection via native dialog IPC, both provider paths, refreshed versions, cancellation, independent switches, legacy master-off, persistence, durable results and narrow/light/dark layout.');
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
