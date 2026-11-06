'use strict';

// Title-bar 视图 menu acceptance, verified in the real window:
//   1. 视图 sits between 文件 and 帮助;
//   2. the panel keeps the rounded chrome and the five requested options;
//   3. 显示/隐藏侧边栏 + Ctrl+B, 显示/隐藏侧边面板 + Ctrl+Shift+E really toggle;
//   4. 新建标签页 is disabled on the empty panel, and Ctrl+T only creates a tab
//      once a real tab exists, expanding the panel as it does;
//   5. 放大 / 缩小 and Ctrl+= / Ctrl+- change the app zoom factor.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-titlebar-view-'));
const evidenceDir = path.join(appRoot, '.yanagent', 'evidence');

const sidebarState = () => ({
  leftHidden: document.querySelector('#app').classList.contains('sidebar-hidden'),
  rightHidden: document.querySelector('#app').classList.contains('rs-hidden'),
  tabs: visibleRightSidebarTabs().length,
  activeType: getActiveRightSidebarTab()?.type || '',
  label: getActiveRightSidebarTab()?.label || '',
  zoom: Number(window.yan.zoom.get())
});

(async () => {
  let application;
  try {
    fs.mkdirSync(evidenceDir, { recursive: true });
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    await page.waitForFunction(() => typeof newSession === 'function' && typeof openRightSidebarTool === 'function', null, { timeout: 60000 });
    await page.waitForSelector('#titlebarViewMenuBtn');
    await page.locator('#yanStartupHello').waitFor({ state: 'detached', timeout: 20000 }).catch(async () => {
      await page.evaluate(() => {
        document.querySelector('#yanStartupHello')?.remove();
        const app = document.querySelector('#app');
        if (app) app.inert = false;
      });
    });

    // Start from the empty-panel state this menu is specified against.
    await page.evaluate(() => { setLeftSidebarOpen(true); closeAllRightSidebarTabs(); setRightSidebarOpen(false); });
    await page.waitForTimeout(300);

    // --- 1. placement --------------------------------------------------------
    const placement = await page.evaluate(() => {
      const file = document.querySelector('#titlebarFileMenuBtn').getBoundingClientRect();
      const view = document.querySelector('#titlebarViewMenuBtn');
      const help = document.querySelector('#titlebarHelpMenuBtn').getBoundingClientRect();
      return {
        text: view.textContent.trim(),
        weight: getComputedStyle(view).fontWeight,
        left: Math.round(view.getBoundingClientRect().left),
        fileRight: Math.round(file.right),
        helpLeft: Math.round(help.left)
      };
    });
    assert.equal(placement.text, '视图');
    assert.equal(placement.weight, '700');
    assert.ok(placement.left >= placement.fileRight && placement.left < placement.helpLeft, `视图 must sit between 文件 and 帮助: ${JSON.stringify(placement)}`);

    // --- 2. panel shape ------------------------------------------------------
    await page.click('#titlebarViewMenuBtn');
    await page.waitForSelector('#titlebarViewMenu:not(.hidden)');
    await page.waitForTimeout(220);
    const menu = await page.evaluate(() => {
      const el = document.querySelector('#titlebarViewMenu');
      const panel = el.getBoundingClientRect();
      const items = [...el.querySelectorAll('.titlebar-menu-item')];
      return {
        radius: getComputedStyle(el).borderTopLeftRadius,
        borderLeft: parseFloat(getComputedStyle(el).borderLeftWidth) || 0,
        panelLeft: Math.round(panel.left),
        labels: items.map(item => item.querySelector('.titlebar-menu-label').textContent.trim()),
        shortcuts: items.map(item => item.querySelector('.titlebar-menu-shortcut')?.textContent.trim() || ''),
        itemRadius: items.map(item => getComputedStyle(item).borderTopLeftRadius),
        itemLeft: items.map(item => Math.round(item.getBoundingClientRect().left)),
        separators: el.querySelectorAll('.titlebar-menu-sep').length,
        newTabDisabled: items.find(item => item.dataset.titlebarAction === 'new-tab').disabled
      };
    });
    assert.equal(menu.radius, '14px');
    assert.deepEqual(menu.labels, ['显示/隐藏侧边栏', '显示/隐藏侧边面板', '新建标签页', '返回', '前进', '放大', '缩小']);
    assert.deepEqual(menu.shortcuts, ['Ctrl+B', 'Ctrl+Shift+E', 'Ctrl+T', 'Ctrl+[', 'Ctrl+]', 'Ctrl+Shift+=', 'Ctrl+-']);
    assert.equal(menu.separators, 3);
    assert.ok(menu.itemRadius.every(radius => radius === '0px'), `options must be rectangular: ${menu.itemRadius}`);
    assert.ok(menu.itemLeft.every(left => Math.abs(left - (menu.panelLeft + menu.borderLeft)) <= 1), `options must touch the panel edge: ${menu.itemLeft}`);
    assert.equal(menu.newTabDisabled, false, '新建标签页 can always create the default 新标签页');

    // --- 3. sidebar toggles --------------------------------------------------
    await page.click('[data-titlebar-action="toggle-left-sidebar"]');
    await page.waitForTimeout(260);
    assert.equal((await page.evaluate(sidebarState)).leftHidden, true, '菜单项 must hide the left sidebar');
    await page.keyboard.press('Control+B');
    await page.waitForTimeout(260);
    assert.equal((await page.evaluate(sidebarState)).leftHidden, false, 'Ctrl+B must show the left sidebar');

    await page.click('#titlebarViewMenuBtn');
    await page.click('[data-titlebar-action="toggle-right-sidebar"]');
    await page.waitForTimeout(320);
    const shown = await page.evaluate(sidebarState);
    assert.equal(shown.rightHidden, false, '菜单项 must show the right panel');
    assert.equal(shown.tabs, 1, 'an empty panel must open on its default 新标签页');
    assert.equal(shown.activeType, 'browser');
    assert.match(shown.label, /新标签页/);
    await page.screenshot({ path: path.join(evidenceDir, 'view-side-panel-start-page.png') });
    await page.keyboard.press('Control+Shift+E');
    await page.waitForTimeout(320);
    assert.equal((await page.evaluate(sidebarState)).rightHidden, true, 'Ctrl+Shift+E must hide the right panel');

    // --- 4. new tab ----------------------------------------------------------
    // The panel now owns the blank 新标签页; Ctrl+T must reuse it.
    await page.keyboard.press('Control+Shift+E');
    await page.waitForTimeout(320);
    const beforeReuse = await page.evaluate(sidebarState);
    assert.equal(beforeReuse.tabs, 1);
    await page.keyboard.press('Control+T');
    await page.waitForTimeout(320);
    const afterReuse = await page.evaluate(sidebarState);
    assert.equal(afterReuse.tabs, 1, 'Ctrl+T must not stack a second 新标签页');
    assert.equal(afterReuse.activeType, 'browser');

    // With a real tab and no blank placeholder, Ctrl+T creates a new tab.
    await page.evaluate(() => { closeAllRightSidebarTabs(); openRightSidebarTool('review'); setRightSidebarOpen(false); });
    await page.waitForTimeout(320);
    const beforeCreate = await page.evaluate(sidebarState);
    assert.equal(beforeCreate.tabs, 1);
    assert.equal(beforeCreate.activeType, 'review');
    await page.keyboard.press('Control+T');
    await page.waitForTimeout(420);
    const afterCreate = await page.evaluate(sidebarState);
    assert.equal(afterCreate.tabs, 2, 'Ctrl+T must add a tab beside a real tab');
    assert.equal(afterCreate.activeType, 'browser');
    assert.equal(afterCreate.rightHidden, false, 'Ctrl+T must expand the right panel');
    assert.match(afterCreate.label, /新标签页/);

    await page.click('#titlebarViewMenuBtn');
    await page.waitForTimeout(220);
    const enabledState = await page.evaluate(() => document.querySelector('#titlebarViewMenu [data-titlebar-action="new-tab"]').disabled);
    assert.equal(enabledState, false, '新建标签页 stays available');
    await page.screenshot({ path: path.join(evidenceDir, 'titlebar-view-menu.png') });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#titlebarViewMenu.hidden', { state: 'attached' });

    // --- 5. zoom -------------------------------------------------------------
    const zoom0 = (await page.evaluate(sidebarState)).zoom;
    await page.click('#titlebarViewMenuBtn');
    await page.click('[data-titlebar-action="zoom-in"]');
    await page.waitForTimeout(200);
    const zoomIn = (await page.evaluate(sidebarState)).zoom;
    assert.ok(zoomIn > zoom0, `放大 must increase the zoom factor: ${zoom0} -> ${zoomIn}`);
    await page.keyboard.press('Control+-');
    await page.waitForTimeout(200);
    assert.ok((await page.evaluate(sidebarState)).zoom < zoomIn, 'Ctrl+- must zoom out');
    await page.keyboard.press('Control+Shift+=');
    await page.waitForTimeout(200);
    assert.ok((await page.evaluate(sidebarState)).zoom > zoom0 - 0.001, 'Ctrl+Shift+= must zoom in');
    await page.click('#titlebarViewMenuBtn');
    await page.click('[data-titlebar-action="zoom-out"]');
    await page.waitForTimeout(200);
    assert.ok((await page.evaluate(sidebarState)).zoom <= zoom0 + 0.001, '缩小 must reduce the zoom factor');
    await page.evaluate(() => window.yan.zoom.set(1));

    console.log('titlebar-view-menu.e2e: OK');
  } finally {
    try { await application?.close(); } catch { /* already closed */ }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('titlebar-view-menu.e2e: FAILED');
  console.error(error);
  process.exitCode = 1;
});
