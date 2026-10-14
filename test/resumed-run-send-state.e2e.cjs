'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-resumed-send-'));
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__ && state.currentSession);
    await page.evaluate(async () => {
      state.config.general.promptSuggestions = false;
      const session = state.currentSession;
      session.messages = [{ role: 'user', content: '处理后台 Bash 的结果', ts: Date.now() }];
      await api.saveSession(session);
      const ctx = createRunCtx(session.id, true, session.workspace || '');
      initOpenCodeRunState(ctx);
      ctx.sessionRef = session;
      state.activeRuns.set(session.id, { sessionRef: session, runCtx: ctx, assistantEl: null });
      window.__resumedCtx = ctx;
      setComposerText('');
      updateSendState();
    });
    assert.equal(await page.locator('#sendBtn').getAttribute('title'), '中止任务');
    await page.evaluate(async () => {
      await persistResumedOpenCodeRun(state.currentSession, window.__resumedCtx, {
        status: 'completed', text: '后台任务结果已处理完毕。'
      });
    });
    assert.equal(await page.evaluate(() => state.activeRuns.has(state.currentSession.id)), false);
    assert.equal(await page.locator('#sendBtn').getAttribute('title'), '发送');
    assert.equal(await page.locator('#app').evaluate(el => el.classList.contains('agent-working')), false);
    await page.evaluate(() => { setComposerText('继续'); syncComposerAfterInput(); });
    assert.equal(await page.locator('#sendBtn').getAttribute('title'), '发送');
    assert.equal(await page.locator('#sendBtn').isEnabled(), true);
    console.log('Resumed run completion restores composer send state.');
  } finally {
    if (app) await app.close();
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (error) { if (error.code !== 'EPERM' && error.code !== 'EBUSY') throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
