'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-workspace-picker-'));
const names = ['Yan Agent v1.7.0', 'Yan Agent v1.6.0-copy', 'Downloads', 'Desktop', 'Hidden project'];
const folders = names.map(name => path.join(userData, name));
folders.forEach(folder => fs.mkdirSync(folder));

(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && !!state.currentSession);
    const open = () => page.locator('#taskBarFolder').click();
    const recent = page.locator('#workspaceChoiceRecent button');
    const search = page.locator('#workspaceChoiceSearch');
    await open();
    assert.equal(await recent.count(), 0);
    assert.equal(await page.locator('.workspace-choice-empty').textContent(), '暂无最近工作区');
    assert.equal(await search.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');

    await page.evaluate(async folders => {
      for (const folder of folders) await api.createSession(true, folder);
      await api.createSession(true, folders[0]); // Multiple tasks share one project row.
      await refreshSessions();
      for (const session of state.sessions) {
        const index = folders.indexOf(session.workspace);
        if (index >= 0) session.updatedAt = 10000 - index * 100;
      }
      workspaceSidebarMeta[workspaceGroupKey(folders[4])] = { hidden: true };
      renderSessionList();
    }, folders);
    await open();
    assert.deepEqual(await recent.locator('span').allTextContents(), names.slice(0, 3));
    assert.equal(await page.locator('#sessionList [data-workspace-group]').count(), 5); // Four projects + Blank.
    await search.fill('desktop');
    assert.deepEqual(await recent.locator('span').allTextContents(), ['Desktop']);
    await search.fill('hidden');
    assert.equal(await recent.count(), 0, 'hidden sidebar projects must never appear in search');
    await search.fill('not-a-project');
    assert.equal(await page.locator('.workspace-choice-empty').textContent(), '未找到匹配项目');
    assert.equal(await page.locator('[data-workspace-choice="pick"]').isVisible(), true);
    await search.fill('desktop');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(folder => state.currentSession.workspace === folder, folders[3]);
    assert.equal(await page.locator('#workspaceChoiceMenu').isVisible(), false);
    await open();
    assert.equal(await search.inputValue(), '', 'reopening clears the search');
    assert.equal(await recent.count(), 3);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#workspaceChoiceMenu').isVisible(), true, 'Tab navigates within the panel');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'taskBarFolder');
    await open();
    await page.locator('#composerInput').click();
    assert.equal(await page.locator('#workspaceChoiceMenu').isVisible(), false);

    // Canceling a native folder dialog leaves the chosen workspace untouched.
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    await open();
    await page.locator('[data-workspace-choice="pick"]').click();
    assert.equal(await page.evaluate(() => state.currentSession.workspace), folders[3]);
    await open();
    await page.locator('[data-workspace-choice="blank"]').click();
    await page.waitForFunction(() => state.currentSession.workspace === '');
    assert.equal(await page.locator('#taskBar').isVisible(), false);
    await open();
    await search.fill('v1.7.0');
    await recent.click();
    await page.waitForFunction(folder => state.currentSession.workspace === folder, folders[0]);

    fs.mkdirSync(path.join(root, 'output', 'playwright'), { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await open();
      const metrics = await page.locator('#workspaceChoiceMenu').evaluate(el => {
        const rect = el.getBoundingClientRect();
        const button = document.getElementById('taskBarFolder').getBoundingClientRect();
        return { radius: getComputedStyle(el).borderTopLeftRadius, width: rect.width,
          inside: rect.top >= 0 && rect.right <= innerWidth, gap: button.top - rect.bottom };
      });
      assert.ok(metrics.inside && metrics.gap >= 0 && parseFloat(metrics.radius) >= 16, JSON.stringify(metrics));
      await page.screenshot({ path: path.join(root, 'output', 'playwright', `workspace-picker-${theme}.png`) });
      await page.keyboard.press('Escape');
    }
    await page.evaluate(async () => {
      state.config = await yan.setConfig({ theme: 'dark', wallpaper: { id: 'night-sky', path: '', custom: [], removed: [] } });
      applyWallpaperConfig(state.config); await applyWallpaperCompat(state.config);
    });
    await open();
    await page.screenshot({ path: path.join(root, 'output', 'playwright', 'workspace-picker-wallpaper.png') });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, recentLimit: 3, sidebarOnly: true, searchOlderProjects: true,
      keyboardSelection: true, blankSelection: true, themes: ['light', 'dark', 'wallpaper'] }));
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
    catch (error) { console.warn(`cleanup skipped: ${error.message}`); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
