'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-task-status-'));
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && !!state.currentSession);
    const ids = await page.evaluate(async workspace => {
      const blank = state.currentSession.id;
      const first = await api.createSession(true, workspace);
      const second = await api.createSession(true, workspace);
      await api.setSessionPinned(first.id, true);
      await refreshSessions();
      state.activeRuns.set(first.id, { runCtx: createRunCtx(first.id, false, workspace) });
      state.activeRuns.set(second.id, { runCtx: createRunCtx(second.id, false, workspace) });
      collapsedWorkspaceGroups.add(workspaceGroupKey(workspace));
      renderSessionList();
      return { blank, first: first.id, second: second.id, key: workspaceGroupKey(workspace) };
    }, root);
    const group = page.locator('.workspace-group').filter({ has: page.locator('.workspace-spinner') });
    const more = group.locator('.workspace-more-btn');
    await page.locator('#composerInput').hover();
    assert.equal(await more.evaluate(node => getComputedStyle(node).opacity), '1');
    assert.equal(await more.locator('.workspace-spinner').isVisible(), true);
    assert.equal(await more.locator('.workspace-more-label').isVisible(), false);
    assert.equal(await group.evaluate(node => node.classList.contains('is-collapsed')), true);
    assert.equal(await page.locator('.workspace-spinner').count(), 1);
    await more.hover();
    assert.equal(await more.locator('.workspace-spinner').isVisible(), false);
    assert.equal(await more.locator('.workspace-more-label').isVisible(), true);
    await more.click();
    assert.equal(await page.locator('.sidebar-context-menu').isVisible(), true);
    await page.locator('#composerInput').click();
    await page.evaluate(id => { state.activeRuns.delete(id); renderSessionList(); }, ids.second);
    assert.equal(await page.locator('.workspace-spinner').count(), 1, 'pinned running task still marks its folder');
    fs.mkdirSync(path.join(root, 'output/playwright'), { recursive: true });
    await page.locator('#composerInput').hover();
    await page.locator('#sidebar').screenshot({ path: path.join(root, 'output/playwright/workspace-running.png') });
    await page.evaluate(id => { state.activeRuns.get(id).runCtx.shouldAbort = true; renderSessionList(); }, ids.first);
    assert.equal(await page.locator('.workspace-spinner').count(), 0);
    await page.evaluate(() => state.activeRuns.clear());

    const header = await page.evaluate(async () => {
      const host = document.createElement('div'); document.querySelector('#messages').append(host);
      const run = { status: 'working', startedAt: Date.now() - 5000, timeline: [],
        performance: { effectiveInputTokensPerSecond: 12345, outputTokensPerSecond: 55 } };
      renderAgentRunHeader(host, run);
      const waiting = host.querySelector('.agent-run-summary').textContent.trim();
      const aria = host.querySelector('.agent-run-summary').getAttribute('aria-label');
      const timer = agentRunTickers.get(host)?.timer;
      await new Promise(resolve => setTimeout(resolve, 1100));
      const unchanged = host.querySelector('.agent-run-summary').textContent.trim() === waiting;
      const waitElapsed = host.querySelectorAll('.run-elapsed').length;
      run.responseStartedAt = Date.now(); renderAgentRunHeader(host, run);
      const responding = host.querySelector('.run-status-label').textContent;
      run.status = 'done'; run.durationMs = 6500; run.responseDurationMs = 1400;
      run.usage = { input: 100, cacheRead: 400 };
      renderAgentRunHeader(host, run);
      const removedMetrics = host.querySelectorAll('.run-reply-time, .run-throughput, .run-throughput-input').length;
      const cache = host.querySelector('.run-cache-hit')?.textContent || '';
      host.remove();
      return { waiting, aria, timer, unchanged, waitElapsed, responding, removedMetrics, cache };
    });
    assert.equal(header.waiting, 'Yan Agent is starting up');
    assert.equal(header.aria, header.waiting);
    assert.equal(header.timer, null);
    assert.equal(header.unchanged, true);
    assert.equal(header.waitElapsed, 0);
    assert.equal(header.responding, '已处理');
    assert.equal(header.removedMetrics, 0);
    assert.match(header.cache, /缓存命中/);
    await page.evaluate(() => {
      const message = appendMessage('assistant', '');
      renderAgentRunHeader(message.querySelector('.msg-body'), { status: 'working', startedAt: Date.now() - 5000, timeline: [] });
    });
    await page.locator('#messages').screenshot({ path: path.join(root, 'output/playwright/agent-startup.png') });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, folderRunningState: true, pinnedAndCollapsed: true, hoverMenu: true, startupLabel: true, removedMetrics: true }));
  } finally {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
