'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-agent-shell-'));
const workspace = path.join(userData, 'workspace');
fs.mkdirSync(workspace);

(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && !!state.currentSession);
    const inspect = () => page.evaluate(() => {
      const el = id => document.getElementById(id);
      const css = id => getComputedStyle(el(id));
      const panel = el('newTaskWorkspace').getBoundingClientRect();
      const input = el('composer').getBoundingClientRect();
      return {
        empty: el('pageChat').classList.contains('empty'),
        parent: el('taskBarFolderWrap').parentElement.id,
        dock: css('rightDock').display,
        titleBg: getComputedStyle(document.querySelector('.titlebar')).backgroundColor,
        sidebarBg: css('sidebar').backgroundColor,
        titleBorder: getComputedStyle(document.querySelector('.titlebar')).borderBottomWidth,
        corner: css('pageChat').borderTopLeftRadius,
        taskBg: css('taskBar').backgroundColor,
        taskBorder: css('taskBar').borderBottomWidth,
        overlap: panel.bottom - input.top,
        panelHeight: panel.height,
        inset: panel.left - input.left,
        greeting: el('emptyHeader').getBoundingClientRect().height,
        menuParent: el('workspaceChoiceMenu').parentElement.id
      };
    });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      const metrics = await inspect();
      assert.equal(metrics.empty, true);
      assert.equal(await page.locator('#taskBar').isVisible(), false, 'new task must hide the whole task bar');
      assert.equal(metrics.parent, 'newTaskWorkspaceSlot');
      assert.equal(metrics.dock, 'none');
      assert.equal(metrics.titleBg, 'rgba(0, 0, 0, 0)');
      assert.equal(metrics.titleBorder, '0px');
      assert.equal(metrics.corner, '0px');
      assert.equal(metrics.taskBg, 'rgba(0, 0, 0, 0)');
      assert.ok(parseFloat(metrics.taskBorder) > 0 && parseFloat(metrics.taskBorder) <= 1);
      assert.ok(metrics.panelHeight <= 32 && Math.abs(metrics.overlap) <= 1 && metrics.inset >= 10,
        `separate raised workspace panel must meet the input without overlap: ${JSON.stringify(metrics)}`);
      assert.ok(metrics.greeting > 0);
    }

    // Existing native picker and persistence still serve the relocated control.
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, workspace);
    await page.locator('#taskBarFolder').click();
    await page.locator('[data-workspace-choice="pick"]').click();
    await page.waitForFunction(folder => state.currentSession.workspace === folder, workspace);
    assert.equal((await page.locator('#taskBarFolderName').textContent()).trim(), 'workspace');
    assert.equal((await inspect()).parent, 'newTaskWorkspaceSlot');
    await page.locator('#taskBarFolder').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.workspaceChoice), 'recent');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.workspaceChoice), 'pick');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.workspaceChoice), 'blank');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'taskBarFolder');
    assert.equal(await page.locator('#workspaceChoiceMenu').isVisible(), false);
    await page.locator('#taskBarFolder').click();
    await page.locator('[data-workspace-choice="blank"]').click();
    await page.waitForFunction(() => state.currentSession.workspace === '');
    await page.locator('#taskBarFolder').click();
    await page.locator('[data-workspace-choice="pick"]').click();
    await page.waitForFunction(folder => state.currentSession.workspace === folder, workspace);

    // Exercise the actual Enter submission path, stubbing only model execution.
    await page.evaluate(() => {
      runOpenCodeLoop = async () => ({ content: 'Verified reply', agentRun: null });
      setComposerText('Check the Agent shell');
      syncComposerAfterInput();
    });
    await page.locator('#composerInput').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => state.currentSession.messages.some(msg => msg.role === 'assistant'));
    await page.waitForFunction(() => state.activeRuns.size === 0);
    const started = await inspect();
    assert.equal(started.empty, false);
    assert.equal(await page.locator('#taskBar').isVisible(), true, 'first submitted message reveals the task bar');
    assert.equal(started.parent, '', 'workspace control returns to the task-bar row');
    assert.equal(await page.locator('#taskBar #taskBarFolderWrap').count(), 1);
    assert.notEqual(started.dock, 'none');
    assert.equal(await page.locator('#newTaskWorkspace').isVisible(), false);
    assert.equal(await page.locator('#taskBarFolder').getAttribute('aria-haspopup'), null);
    const previousSessionId = await page.evaluate(() => state.currentSession.id);
    assert.equal(await page.locator('#taskBarNewTask').isVisible(), false);
    await page.evaluate(() => setLeftSidebarOpen(false));
    const grouped = await page.evaluate(() => {
      const pen = document.querySelector('#taskBarNewTask');
      const folder = document.querySelector('#taskBarFolder');
      const group = folder.parentElement;
      return { penX: pen.getBoundingClientRect().left, folderX: folder.getBoundingClientRect().left,
        border: getComputedStyle(group).borderTopWidth,
        penBorder: getComputedStyle(pen).borderTopWidth, folderBorder: getComputedStyle(folder).borderTopWidth,
        penRightRadius: getComputedStyle(pen).borderTopRightRadius,
        folderLeftRadius: getComputedStyle(folder).borderTopLeftRadius };
    });
    assert.ok(grouped.penX < grouped.folderX);
    assert.ok(parseFloat(grouped.border) > 0);
    assert.equal(grouped.penBorder, '0px');
    assert.equal(grouped.folderBorder, '0px');
    assert.equal(grouped.penRightRadius, '0px');
    assert.equal(grouped.folderLeftRadius, '0px');
    await page.evaluate(async () => {
      state.config = await yan.setConfig({ theme: 'dark', wallpaper: { id: 'night-sky', path: '', custom: [], removed: [] } });
      applyTheme('dark'); applyWallpaperConfig(state.config); await applyWallpaperCompat(state.config);
    });
    await page.waitForTimeout(200);
    fs.mkdirSync(path.join(root, 'output', 'playwright'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'output', 'playwright', 'task-actions-pill.png'),
      clip: { x: 0, y: 40, width: 600, height: 70 } });
    await page.locator('#taskBarNewTask').click();
    await page.waitForFunction(() => document.querySelector('#pageChat').classList.contains('empty'));
    assert.equal(await page.locator('#taskBar').isVisible(), false, 'returning to a new task hides the bar again');
    assert.notEqual(await page.evaluate(() => state.currentSession.id), previousSessionId);
    assert.equal(await page.evaluate(() => state.currentSession.workspace), workspace);
    assert.equal(await page.locator('#sidebar').isVisible(), false, 'new task must keep the sidebar hidden');
    assert.equal(await page.locator('#taskBarNewTask').isVisible(), false, 'new-task panel only shows its workspace selector');
    assert.equal((await inspect()).parent, 'newTaskWorkspaceSlot');
    assert.equal((await inspect()).dock, 'none');
    await page.evaluate(() => setLeftSidebarOpen(false));
    assert.ok(parseFloat((await inspect()).corner) >= 12);
    await page.evaluate(() => setLeftSidebarOpen(true));
    assert.equal((await inspect()).corner, '0px');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, nativeWorkspacePicker: true, enterSubmission: true, themes: ['dark', 'light'] }));
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
    catch (error) { console.warn(`cleanup skipped: ${error.message}`); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
