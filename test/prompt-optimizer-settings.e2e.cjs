'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-optimizer-settings-'));
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && window.YanRemoteControl);
    const optimized = await page.evaluate(async () => {
      const originalLoop = runOpenCodeLoop;
      const originalSkill = api.readSkill;
      const originalSelection = getAgentModelSelection;
      state.config.api = { baseUrl: 'http://fixture.invalid', model: 'fixture-model' };
      getAgentModelSelection = () => ({ providerId: 'fixture-provider', modelId: 'fixture-model' });
      api.readSkill = async () => ({ ok: true, id: 'yan-prompt-optimizer', name: 'Optimizer', prompt: 'Rewrite the prompt.' });
      let request;
      runOpenCodeLoop = async (session, body, ctx) => {
        const persisted = await api.getSession(session.id);
        if (!persisted || persisted.id !== state.currentSession.id) throw new Error('SESSION_DELETED');
        request = { sessionId: session.id, ctxSessionId: ctx.sessionId, utility: ctx.utility, model: ctx.remoteModelSelection.modelId };
        return { content: '请检查项目并修复发现的问题。' };
      };
      try {
        setComposerText('检查项目');
        await optimizeComposerPrompt();
        const after = getComposerText();
        restorePromptOptimization();
        return { request, after, before: getComposerText(), current: state.currentSession.id };
      } finally {
        runOpenCodeLoop = originalLoop;
        api.readSkill = originalSkill;
        getAgentModelSelection = originalSelection;
      }
    });
    assert.equal(optimized.request.sessionId, optimized.current);
    assert.equal(optimized.request.ctxSessionId, optimized.current);
    assert.equal(optimized.request.utility, true);
    assert.equal(optimized.request.model, 'fixture-model');
    assert.equal(optimized.after, '请检查项目并修复发现的问题。');
    assert.equal(optimized.before, '检查项目');
    assert.equal(await page.locator('#remoteNavBtn').count(), 0);
    await page.locator('#settingsBtn').click();
    assert.equal(await page.locator('#settings-tab-browser').evaluate(el => el.nextElementSibling.id), 'settings-tab-remote');
    await page.locator('#settings-tab-remote').click();
    assert.equal(await page.locator('#tab-remote').isVisible(), true);
    assert.equal(await page.locator('#remoteAddressRefresh').isVisible(), true);
    assert.equal(await page.locator('#settingsSectionTitle').textContent(), '远程操控');
    await page.locator('#remoteAddressRefresh').click();
    await page.locator('#settings-tab-general').click();
    assert.equal(await page.locator('#remoteAddressRefresh').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('Prompt optimization uses a persisted session and remote controls work in Integration settings.');
  } finally {
    if (app) await app.close();
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (error) { if (error.code !== 'EPERM' && error.code !== 'EBUSY') throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
