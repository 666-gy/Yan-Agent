'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-full-agent-new-task-'));
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof setBrowserFocusMode === 'function' && typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    const inspect = () => page.evaluate(() => {
      const ids = ['pageChat', 'chatMainColumn', 'emptyHeader', 'composerStage', 'composer', 'composerInput', 'sideChatComposerInput'];
      return { session: { id: state.currentSession.id, count: state.currentSession.messages.length }, classes: document.querySelector('#app').className, nodes: Object.fromEntries(ids.map(id => {
        const el = document.getElementById(id), css = getComputedStyle(el);
        const ancestors = []; for (let node = el; node; node = node.parentElement) ancestors.push(node.id || node.tagName);
        return [id, { ancestors, parent: el.parentElement.id, rect: el.getBoundingClientRect().toJSON(), display: css.display,
          position: css.position, placeholder: el.dataset.placeholder, text: el.textContent.slice(0, 80) }];
      })) };
    });
    await page.evaluate(async () => {
      await newSession({ forceNew: true });
      state.currentSession.messages = [{ role: 'user', content: 'Layout fixture' }];
      state.currentSession.title = 'Layout fixture';
      await api.saveSession(state.currentSession);
      await refreshSessions();
      setEmptyState(false);
      openRightSidebarTool('browser');
      setBrowserFocusMode(true);
    });
    await page.locator('[data-agent-chat-tab]').click();
    const previousTask = await page.evaluate(() => state.currentSession.id);
    await page.locator('#newTaskNavBtn').click();
    await page.waitForFunction(() => !newSessionPromise);
    const full = await inspect();
    const verifyComposer = report => {
      const nodes = report.nodes;
      assert.equal(report.session.count, 0);
      assert.equal(nodes.emptyHeader.display, 'flex');
      assert.ok(nodes.emptyHeader.rect.height > 0);
      assert.equal(nodes.composerStage.position, 'static');
      assert.ok(nodes.composerInput.rect.top >= nodes.composer.rect.top);
      assert.ok(nodes.composerInput.rect.bottom <= nodes.composer.rect.bottom);
      assert.ok(nodes.sideChatComposerInput.ancestors.includes('sideChatComposer'));
      assert.ok(!nodes.sideChatComposerInput.ancestors.includes('composer'));
      assert.equal(nodes.sideChatComposerInput.rect.height, 0);
    };
    verifyComposer(full);
    assert.notEqual(full.session.id, previousTask);
    assert.equal(full.nodes.chatMainColumn.parent, 'rs-agent-chat');
    await page.locator('#composerInput').fill('Agent draft stays here');
    assert.equal(await page.locator('#sideChatComposerInput').textContent(), '');
    await page.locator('#composerInput').fill('');
    await page.screenshot({ path: path.join(root, '.yanagent/evidence/full-agent-new-task.png') });
    await page.evaluate(() => { for (const tab of [...openRightSidebarTabs]) closeRightSidebarTool(tab.id); });
    const home = await inspect();
    verifyComposer(home);
    assert.equal(home.nodes.chatMainColumn.parent, 'pageChat');
    await page.screenshot({ path: path.join(root, '.yanagent/evidence/full-agent-new-task-home.png') });
    assert.equal(await page.locator('#emptyHeader').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, fullScreenNewTask: true, restoredComposer: true }));
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
