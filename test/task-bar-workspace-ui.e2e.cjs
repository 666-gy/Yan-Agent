'use strict';

// Task-bar acceptance: Yanxi Code removed from the workspace-tools menu, the
// "选择工作区" button carries the high-contrast empty state, and the task title
// opens the rename dialog on double click.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-task-bar-e2e-'));

(async () => {
  let application;
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: {
        ...process.env,
        YAN_E2E_MODE: '1',
        YAN_E2E_USER_DATA_DIR: userDataDir
      }
    });
    const page = await application.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__ && typeof setEmptyState === 'function');
    await page.evaluate(() => setEmptyState(false));
    await page.locator('#taskBar:not(.hidden)').waitFor();

    assert.equal(await page.locator('#taskBarYanxiCode').count(), 0, 'Yanxi Code entry must be removed');
    assert.equal(await page.locator('.task-tool-item', { hasText: 'Yanxi Code' }).count(), 0);

    // The workspace tools pill was removed; its open-with entries now live in the
    // task "…" menu as 打开方式.
    assert.equal(await page.locator('#taskToolsWrap').count(), 0, 'workspace tools pill must be removed');
    await page.locator('#taskBarMoreBtn').click();
    await page.locator('.task-toolbar-menu').waitFor();
    const undoLabels = await page.locator('#taskActionsMenu .sidebar-context-menu-item > span').allInnerTexts();
    assert.ok(undoLabels.includes('打开方式'), `task menu lacks 打开方式: ${undoLabels.join(', ')}`);
    await page.locator('#taskActionsMenu .sidebar-context-menu-item', { hasText: '打开方式' }).click();
    const openWithMenu = page.locator('.task-context-menu', { hasText: '文件资源管理器' }).last();
    await openWithMenu.waitFor();
    const labels = await openWithMenu.locator('.sidebar-context-menu-item > span').allInnerTexts();
    assert.deepEqual(labels, ['VS Code', '文件资源管理器', '终端']);
    await page.keyboard.press('Escape');

    const emptyState = await page.evaluate(() => {
      const button = document.querySelector('#taskBarFolder');
      return {
        hasClass: button.classList.contains('task-bar-folder-empty'),
        background: getComputedStyle(button).backgroundColor,
        color: getComputedStyle(button).color,
        shadow: getComputedStyle(button).boxShadow
      };
    });
    assert.equal(emptyState.hasClass, true, 'empty-state class must be applied without a workspace');
    const accentRgb = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.background = 'var(--accent)';
      document.body.append(probe);
      const rgb = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return rgb;
    });
    assert.equal(emptyState.background, accentRgb, `workspace button must use the theme accent, got ${emptyState.background}`);
    assert.notEqual(emptyState.shadow, 'none');

    await page.locator('#taskBarTitle').dblclick();
    await page.locator('#renameTaskModal:not(.hidden)').waitFor();
    const title = await page.locator('#renameTaskInput').inputValue();
    assert.ok(title.length > 0, 'rename dialog must be prefilled with the task title');
    const outputDir = path.join(appRoot, 'output', 'playwright');
    fs.mkdirSync(outputDir, { recursive: true });
    const screenshotPath = path.join(outputDir, 'task-bar-rename-double-click.png');
    await page.screenshot({ path: screenshotPath });
    await page.keyboard.press('Escape');
    await page.locator('#renameTaskModal').waitFor({ state: 'hidden' });

    console.log(JSON.stringify({ ok: true, toolLabels: labels, emptyState, screenshotPath }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
