'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-retired-mode-'));
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && state.currentSession);
    assert.equal(await page.locator('[data-work-mode=agi]').count(), 0);
    const result = await page.evaluate(async () => {
      const cfg = await yan.setConfig({ agent: { workMode: 'agi' } });
      state.config = cfg;
      const modes = Object.keys(WORK_MODE_UI);
      await newSession();
      appendMessage('user', '普通聊天仍然可用');
      return { savedMode: cfg.agent.workMode, uiMode: getCurrentWorkMode(), modes,
        created: !!state.currentSession.id, message: document.querySelector('#messages').textContent,
        runs: await yan.openCodeSyncActiveRuns(), core: await yan.yanCoreGetState() };
    });
    assert.equal(result.savedMode, 'normal');
    assert.equal(result.uiMode, 'normal');
    assert.ok(result.modes.includes('goal') && result.modes.includes('plan'));
    assert.ok(result.created);
    assert.match(result.message, /普通聊天仍然可用/);
    assert.deepEqual(result.runs, []);
    assert.equal(result.core.error, undefined);
    assert.equal(await page.locator('#yanFatalError').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('Startup, retired-mode normalization, mode menu, new chat and runtime IPC passed.');
  } finally {
    await app?.close();
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
