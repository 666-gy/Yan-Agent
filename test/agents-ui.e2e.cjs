'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { resolveSelectedPlugins, selectedPluginContext } = require('../lib/plugins/selection');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-agents-ui-'));
const workspace = path.join(userData, 'workspace A'); fs.mkdirSync(workspace);
const output = path.join(root, 'output/playwright/agents'); fs.mkdirSync(output, { recursive: true });
(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await app.evaluate(({ ipcMain }) => {
      const status = ipcMain._invokeHandlers.get('external-agents:status');
      ipcMain.removeHandler('external-agents:status');
      ipcMain.handle('external-agents:status', async (...args) => {
        global.__agentVersionStatus = await status(...args); return global.__agentVersionStatus;
      });
      global.__agentWebsiteVisits = [];
      ipcMain.removeHandler('browser:open-link');
      ipcMain.handle('browser:open-link', (_event, url) => { global.__agentWebsiteVisits.push(url); return { target: 'external' }; });
    });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && window.YanAgentsPage);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(async workspace => {
      const session = await api.createSession(true, workspace); await refreshSessions(); await loadSession(session.id);
      setComposerText('原来的草稿'); captureComposerDraftForSession(); window.__originalId = session.id;
    }, workspace);
    await page.locator('[data-nav="plugins"]').click();
    await page.locator('#pluginsAgentsTab').click();
    await page.locator('#agentMarketGrid .skill-card').first().waitFor();
    assert.equal(await page.locator('#pageAgents h2').textContent(), '智能体');
    assert.equal(await page.locator('#pageAgents .page-sub').textContent(), '委派任务，读取其他智能体的本机历史会话');
    assert.equal(await page.locator('#pluginsAgentsTab [data-keyline-icon="command"]').count(), 1);
    assert.equal(await page.locator('#agentMarketGrid .skill-card').count(), 3);
    assert.equal(await page.locator('.agent-card-state').count(), 0);
    assert.doesNotMatch(await page.locator('#agentMarketGrid').textContent(), /已关闭|已启用|派发给/);
    for (const provider of ['codex', 'claude', 'reasonix']) {
      assert.equal(await page.locator(`article[data-agent-open="external-agent:${provider}"] img`).getAttribute('src'), `assets/provider-logos/${provider}.svg`);
    }
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await page.locator('#pagePlugins').screenshot({ path: path.join(output, `cards-${theme}.png`) });
    }
    for (const provider of ['codex', 'claude', 'reasonix']) {
      await page.locator(`article[data-agent-open="external-agent:${provider}"]`).click();
      assert.equal(await page.locator('#agentDetailContent .plugin-info-section').count(), 1);
      assert.deepEqual(await page.locator('#agentDetailContent dt').allTextContents(), ['开发者', '版本', '网站']);
      assert.equal(await page.locator('#agentDetailContent dd').first().textContent(), ({codex: 'OpenAI', claude: 'Anthropic', reasonix: 'esengine'})[provider]);
      const summary = await page.locator('#agentDetailContent .plugin-detail-subtitle').textContent();
      assert.equal(summary, await page.locator(`article[data-agent-open="external-agent:${provider}"] .skill-card-desc`).textContent());
      assert.ok((await page.locator('#agentDetailContent .plugin-detail-description').textContent()).length > summary.length);
      assert.equal(await page.locator('#agentDetailContent > :last-child').getAttribute('class'), 'plugin-info-section');
      await page.waitForFunction(() => document.querySelector('[data-agent-version]').textContent !== '正在检测…');
      const detected = await app.evaluate((_electron, provider) => global.__agentVersionStatus.providers.find(item => item.provider === provider), provider);
      assert.equal(await page.locator('[data-agent-version]').textContent(), detected.installed ? detected.version || '版本未知' : '未检测到桌面应用');
      await page.locator('[data-agent-action="website"]').click();
      assert.equal(await page.locator('#agentDetailContent .plugin-example-row').count(), 3);
      assert.equal(await page.locator('#agentDetailContent .plugin-detail-logo img').getAttribute('src'), `assets/provider-logos/${provider}.svg`);
      if (provider === 'codex') {
        for (const theme of ['light', 'dark']) {
          await page.evaluate(theme => applyTheme(theme), theme);
          await page.locator('#pagePlugins').screenshot({ path: path.join(output, `detail-${theme}.png`) });
        }
      }
      await page.locator('[data-agent-action="back"]').click();
    }
    assert.deepEqual(await app.evaluate(() => global.__agentWebsiteVisits), ['https://openai.com/codex/', 'https://claude.com/', 'https://github.com/esengine/DeepSeek-Reasonix']);
    await page.locator('article[data-agent-open="external-agent:codex"]').click();
    const prompt = await page.locator('#agentDetailContent .plugin-example-prompt').first().textContent();
    await page.locator('[data-agent-action="example"]').first().click();
    await page.waitForFunction(prompt => getComposerText() === prompt, prompt);
    assert.equal(await page.locator('#composerInput [data-composer-plugin-id="external-agent:codex"]').count(), 1);
    assert.equal(await page.evaluate(() => state.currentSession.workspace), workspace);
    assert.equal(await page.evaluate(() => state.currentSession.messages.length + state.activeRuns.size), 0);
    assert.equal(await page.evaluate(() => state.composerDrafts.get(window.__originalId).text), '原来的草稿');
    assert.equal(await page.evaluate(() => window.YanComposerPlugins.validate()), false);
    assert.equal(await page.evaluate(() => window.YanAgentCatalog.enabled(window.YanAgentCatalog.items[0])), false);
    const draftId = await page.evaluate(() => state.currentSession.id);
    await page.evaluate(async id => { await loadSession(window.__originalId); await loadSession(id); }, draftId);
    assert.equal(await page.locator('#composerInput [data-composer-plugin-id="external-agent:codex"]').count(), 1);
    await page.evaluate(() => { window.YanComposerPlugins.set([]); setComposerText(''); input.focus(); });
    await page.evaluate(() => window.YanComposerPlugins.open());
    const claude = page.locator('[data-composer-plugin-choice="external-agent:claude"]');
    await claude.waitFor();
    assert.match(await claude.textContent(), /已关闭/);
    assert.equal(await page.locator('[data-composer-plugin-choice="external-agent:codex"]').count(), 1);
    await page.locator('#attachmentMenu').screenshot({ path: path.join(output, 'mentions.png') });
    await claude.click();
    assert.equal(await page.evaluate(() => state.selectedPlugins[0].id), 'external-agent:claude');
    await page.locator('#composerInput').press('Backspace');
    assert.equal(await page.evaluate(() => state.selectedPlugins.length), 0);
    await page.locator('[data-nav="plugins"]').click();
    await page.locator('#pluginsAgentsTab').click();
    await page.locator('[data-agent-action="toggle"]').check();
    await page.waitForFunction(() => state.config.externalAgents?.providers?.codex?.enabled);
    await page.locator('#settingsBtn').click();
    assert.equal(await page.locator('#settings-tab-external-agents, #tab-external-agents').count(), 0);
    await page.evaluate(() => switchSidebarNav('agents'));
    assert.equal(await page.locator('[data-agent-action="toggle"]').isChecked(), true);
    assert.equal(await page.evaluate(() => state.config.externalAgents.providers.claude.enabled), false);
    await page.locator('[data-agent-action="toggle"]').uncheck();
    await page.waitForFunction(() => !state.config.externalAgents.enabled);
    await page.evaluate(() => switchSidebarNav('agents'));
    await page.waitForFunction(() => !document.querySelector('[data-agent-action="toggle"]').checked);
    await page.locator('[data-agent-action="toggle"]').check();
    await page.waitForFunction(() => state.config.externalAgents.enabled);
    await page.evaluate(() => { switchSidebarNav('tasks'); window.YanComposerPlugins.set([window.YanAgentCatalog.items[0]]); setComposerText('检查工作区'); });
    const sent = await page.evaluate(async () => {
      const original = submitMessage; let captured;
      submitMessage = async (text, attachments, skills, options) => { captured = options.pluginCalls; };
      try { await sendMessage(); return captured; } finally { submitMessage = original; }
    });
    assert.equal(sent[0].id, 'external-agent:codex');
    const cfg = await page.evaluate(() => api.getConfig());
    const selected = resolveSelectedPlugins(path.join(userData, 'YanData'), sent, workspace, cfg.externalAgents);
    assert.deepEqual(selected, [{ id: 'external-agent:codex', name: 'Codex' }]);
    assert.match(selectedPluginContext(selected), /yan_session_delegate_external_task/);
    assert.match(selectedPluginContext(selected), /yan_session_list_external_sessions/);
    assert.match(selectedPluginContext(selected), /Do not dispatch a new task merely to read history/);
    assert.throws(() => resolveSelectedPlugins(userData, sent, workspace, { enabled: false }), /未启用/);
    assert.throws(() => resolveSelectedPlugins(userData, [{ id: 'external-agent:claude' }], workspace, cfg.externalAgents), /未启用/);
    await page.evaluate(() => switchSidebarNav('agents'));
    await page.locator('#sidebarToggle').click();
    await page.setViewportSize({ width: 414, height: 900 });
    assert.equal(await page.locator('#agentDetailContent').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.locator('#pagePlugins').screenshot({ path: path.join(output, 'narrow.png') });
    assert.deepEqual(errors, []);
    console.log('PASS agents: disabled visibility, branded cards/details, examples and draft preservation, @ tokens, removed settings page, send routing and backend enablement gate, themes and narrow layout.');
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }); }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
