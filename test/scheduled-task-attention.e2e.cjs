const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron } = require('playwright');
(async () => {
  const root = process.cwd();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-scheduled-attention-'));
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: data } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(async () => {
      window.YanStartupHello?.skip?.();
      applyTheme('light');
      showMainPage('scheduled-tasks');
      await refreshScheduledTasks();
      state.sessions = [{ id: 'normal-fixture', title: '普通任务' }, { id: 'scheduled-fixture', title: '提醒我玩游戏', scheduledTaskId: 'clock-fixture' }];
      state.currentSession = null;
      scheduledTasks = [{ id: 'clock-fixture', sessionId: 'scheduled-fixture', title: '提醒我玩游戏', status: 'active', lastRunStatus: 'running' }];
      renderScheduledTaskSidebar();
    });
    assert.equal(await page.locator('.scheduled-task-item.running .session-spinner').count(), 1);
    const colors = await page.evaluate(() => {
      const title = document.querySelector('.scheduled-task-item-title');
      const probe = document.createElement('span'); probe.style.color = 'var(--accent)'; document.body.append(probe);
      const values = [getComputedStyle(title).color, getComputedStyle(probe).color]; probe.remove(); return values;
    });
    assert.equal(colors[0], colors[1]);
    await page.evaluate(() => {
      scheduledTasks[0].lastRunStatus = 'success';
      markTaskCompletionAttention(state.sessions[1], 'success');
      renderScheduledTaskSidebar();
    });
    assert.equal(await page.locator('.scheduled-task-item .session-spinner').count(), 0);
    assert.equal(await page.locator('[data-nav="tasks"].has-unread').count(), 0);
    assert.equal(await page.locator('[data-nav="scheduled-tasks"].has-unread').count(), 1);
    await page.evaluate(() => { markTaskCompletionAttention(state.sessions[0], 'success'); updateRailUnreadDot(); });
    assert.equal(await page.locator('[data-nav="tasks"].has-unread').count(), 1);
    await page.evaluate(() => {
      state.currentSession = state.sessions[1]; scheduledTaskViewOpen = true;
      document.querySelector('#pageScheduledTasks').classList.add('hidden');
      document.querySelector('#pageChat').classList.remove('hidden');
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await page.waitForFunction(() => document.hasFocus());
    await page.evaluate(() => { markVisibleTaskRead(); markTaskCompletionAttention(state.sessions[1], 'success'); updateRailUnreadDot(); });
    assert.equal(await page.locator('[data-nav="scheduled-tasks"].has-unread').count(), 0);
    assert.equal(await page.locator('[data-nav="tasks"].has-unread').count(), 1);
    await page.evaluate(() => {
      scheduledTaskViewOpen = false;
      state.activeRuns.set('scheduled-fixture', { runCtx: { shouldAbort: false } });
      renderSessionList();
    });
    assert.equal(await page.locator('.scheduled-task-item.running .session-spinner').count(), 1);
    await page.evaluate(() => { state.activeRuns.delete('scheduled-fixture'); renderSessionList(); });
    assert.equal(await page.locator('.scheduled-task-item.running').count(), 0);
    console.log('PASS: separate rail dots, focused scheduled completion stays read, scheduled and manual run emphasis clears on completion');
  } finally {
    await app?.close();
    fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
