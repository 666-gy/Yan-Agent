'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { _electron: electron } = require('playwright');
const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-world-navigation-'));
const fixtureUrl = pathToFileURL(path.join(__dirname, 'fixtures/browser-agent.html')).href;

(async () => {
  let application;
  const errors = [];
  try {
    application = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir } });
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof state !== 'undefined' && state.currentSession && quickInputHandlerReady && window.YanWorkGui);

    await page.evaluate(async () => {
      const session = state.currentSession;
      session.messages = [{ role: 'user', content: '观察 Agent 在后台工作', ts: Date.now() }];
      renderMessages(session.messages);
      const ctx = createRunCtx(session.id, true, session.workspace || '');
      initOpenCodeRunState(ctx);
      state.activeRuns.set(session.id, { sessionRef: session, runCtx: ctx, assistantEl: appendMessage('assistant', '') });
      window.worldNavigationCtx = ctx;
      await showWindowView('work-gui');
    });
    await page.locator('.wgu-root').waitFor({ state: 'visible' });

    async function expectWorld(stage) {
      const actual = await page.evaluate(() => ({
        view: currentWindowView, page: currentMainPage,
        visible: !document.querySelector('#pageWorkGui').classList.contains('hidden'),
        chatHidden: document.querySelector('#pageChat').classList.contains('hidden'),
        ticking: window.YanWorkGui.isOpen()
      }));
      assert.deepEqual(actual, { view: 'work-gui', page: 'work-gui', visible: true, chatHidden: true, ticking: true }, stage);
    }

    // Exercise the real tool route and real embedded browser, with a local fixture.
    const opened = await page.evaluate(url => agentOpenBuiltinBrowser(url, {
      runCtx: worldNavigationCtx, runId: worldNavigationCtx.runId
    }), fixtureUrl);
    assert.equal(opened.ok, true, JSON.stringify(opened));
    await expectWorld('an Agent browser tool must not replace the selected world');
    const browserContent = await page.evaluate(id => browserTabControllers.get(id).webview.executeJavaScript('document.body.innerText'), opened.tabId);
    assert.ok(browserContent.length > 40, 'the background browser still loads its content');
    const read = await page.evaluate(() => executeBrowserAgentCommand({
      action: 'read_page', params: { yan_run_id: worldNavigationCtx.runId }
    }));
    assert.notEqual(read.ok, false, JSON.stringify(read));
    await expectWorld('reading browser content must also preserve the selected world');

    await page.evaluate(() => {
      const ctx = worldNavigationCtx;
      applyOpenCodeEvent(ctx, { type: 'message.part.updated', data: { part: {
        id: 'world-child-task', callID: 'world-child-task', type: 'tool', tool: 'task',
        state: { status: 'running', input: { subagent_type: 'researcher', description: '读取项目资料' }, metadata: { sessionId: 'world-child' } }
      } } });
      for (let i = 0; i < 8; i += 1) {
        applyOpenCodeEvent(ctx, { type: 'message.part.updated', data: { part: { id: 'world-text', type: 'text', text: '后台工作进展 '.repeat(i + 1) } } });
        renderOpenCodeRunNow(ctx);
      }
      renderSubagentUi();
      openRightSidebarTool('plan');
      // Simulates late workspace/session refreshes that request the chat page.
      switchSidebarNav('tasks');
      showMainPage('chat');
    });
    await page.waitForTimeout(350);
    await expectWorld('streaming, subagent creation and background page requests preserve the world');

    await page.locator('.window-view-option[data-window-view="main"]').click();
    await page.locator('#pageChat').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window.YanWorkGui.isOpen()), false);
    const foregroundBrowser = await page.evaluate(async url => {
      const result = await agentOpenBuiltinBrowser(url, { runCtx: worldNavigationCtx });
      return { ok: result.ok, view: currentWindowView, sidebarOpen: !document.querySelector('#app').classList.contains('rs-hidden') };
    }, fixtureUrl + '?foreground');
    assert.deepEqual(foregroundBrowser, { ok: true, view: 'main', sidebarOpen: true }, 'browser tools still reveal their panel in the main view');
    await page.locator('.window-view-option[data-window-view="work-gui"]').click();
    await expectWorld('the titlebar can explicitly leave and reopen the world');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, browser: opened.ok, backgroundNavigation: 'preserved', explicitNavigation: 'passed' }));
  } finally {
    await application?.close();
    assert.equal(path.dirname(userDataDir), path.resolve(os.tmpdir()));
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
