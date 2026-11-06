'use strict';

// Title-bar 文件 menu acceptance, verified in the real window:
//   1. the trigger sits to the right of the logo and opens a rounded panel;
//   2. options are full-width rectangular rows with label/shortcut at opposite
//      edges, in the requested order with one separator;
//   3. each option really acts: 打开文件夹 binds the picked folder, 新聊天
//      creates a task, 关闭窗口 hides the window, 退出 ends the process;
//   4. Ctrl+N / Ctrl+O / Ctrl+W reach the same actions.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-titlebar-menu-'));
const evidenceDir = path.join(appRoot, '.yanagent', 'evidence');

const menuMetrics = () => {
  const menu = document.querySelector('#titlebarFileMenu');
  const panel = menu.getBoundingClientRect();
  const items = [...menu.querySelectorAll('.titlebar-menu-item')];
  const first = items[0].getBoundingClientRect();
  return {
    hidden: menu.classList.contains('hidden'),
    radius: getComputedStyle(menu).borderTopLeftRadius,
    panelLeft: Math.round(panel.left),
    panelRight: Math.round(panel.right),
    borderLeft: Math.round(parseFloat(getComputedStyle(menu).borderLeftWidth) || 0),
    itemRadius: items.map(item => getComputedStyle(item).borderTopLeftRadius),
    itemLeft: items.map(item => Math.round(item.getBoundingClientRect().left)),
    labels: items.map(item => item.querySelector('.titlebar-menu-label').textContent.trim()),
    shortcuts: items.map(item => item.querySelector('.titlebar-menu-shortcut')?.textContent.trim() || ''),
    separators: menu.querySelectorAll('.titlebar-menu-sep').length,
    labelRight: Math.round(items[0].querySelector('.titlebar-menu-label').getBoundingClientRect().right),
    shortcutLeft: Math.round(items[0].querySelector('.titlebar-menu-shortcut').getBoundingClientRect().left),
    firstTop: Math.round(first.top),
    top: Math.round(panel.top)
  };
};

(async () => {
  let application;
  let pickedDir = '';
  let secondDir = '';
  try {
    fs.mkdirSync(evidenceDir, { recursive: true });
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    await page.waitForFunction(() => typeof newSession === 'function', null, { timeout: 60000 });
    await page.waitForSelector('#titlebarFileMenuBtn');
    await page.locator('#yanStartupHello').waitFor({ state: 'detached', timeout: 20000 }).catch(async () => {
      await page.evaluate(() => {
        document.querySelector('#yanStartupHello')?.remove();
        const app = document.querySelector('#app');
        if (app) app.inert = false;
      });
    });

    // --- 1. trigger placement ------------------------------------------------
    const trigger = await page.evaluate(() => {
      const btn = document.querySelector('#titlebarFileMenuBtn').getBoundingClientRect();
      const logo = document.querySelector('#sidebarToggle').getBoundingClientRect();
      return { btnLeft: Math.round(btn.left), btnTop: Math.round(btn.top), logoRight: Math.round(logo.right), text: document.querySelector('#titlebarFileMenuBtn').textContent.trim() };
    });
    assert.equal(trigger.text, '文件');
    assert.ok(trigger.btnLeft > trigger.logoRight, `文件 must sit right of the logo: ${JSON.stringify(trigger)}`);

    // --- 2. panel shape ------------------------------------------------------
    await page.click('#titlebarFileMenuBtn');
    await page.waitForSelector('#titlebarFileMenu:not(.hidden)');
    const opened = await page.evaluate(menuMetrics);
    assert.equal(opened.hidden, false);
    assert.equal(opened.radius, '14px', 'the panel keeps the 14px rounded chrome');
    assert.deepEqual(opened.labels, ['新聊天', '打开文件夹', '关闭窗口', '退出 Yan Agent']);
    assert.deepEqual(opened.shortcuts, ['Ctrl+N', 'Ctrl+O', 'Ctrl+W', '']);
    assert.equal(opened.separators, 1, 'exactly one separator, between 打开文件夹 and 关闭窗口');
    assert.ok(opened.itemRadius.every(radius => radius === '0px'), `option flashes must be strictly rectangular: ${opened.itemRadius}`);
    assert.ok(opened.itemLeft.every(left => left === opened.panelLeft + opened.borderLeft), `option flashes must touch the panel edge: ${opened.itemLeft} vs ${opened.panelLeft}+${opened.borderLeft}`);
    assert.ok(opened.labelRight < opened.shortcutLeft, 'label and shortcut sit at opposite edges');
    assert.ok(opened.shortcutLeft > opened.panelRight - 90, 'the shortcut is right-aligned inside the panel');
    assert.ok(opened.top >= opened.firstTop - 1 && opened.firstTop - opened.top <= 1, 'the first option starts at the panel top edge');
    const ariaExpanded = await page.getAttribute('#titlebarFileMenuBtn', 'aria-expanded');
    assert.equal(ariaExpanded, 'true');

    // The trigger label is bold and its open/hover flash is a strict surface.
    // The flash is animated, so read the settled value.
    await page.waitForTimeout(220);
    const triggerStyle = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('#titlebarFileMenuBtn'));
      return { weight: style.fontWeight, background: style.backgroundColor };
    });
    assert.equal(triggerStyle.weight, '700', '文件 must render bold');
    assert.equal(triggerStyle.background, 'rgb(0, 0, 0)', 'dark theme flash must be strict black');

    await page.screenshot({ path: path.join(evidenceDir, 'titlebar-file-menu.png') });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.waitForTimeout(220);
    const lightStyle = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('#titlebarFileMenuBtn'));
      return { weight: style.fontWeight, background: style.backgroundColor };
    });
    assert.equal(lightStyle.weight, '700');
    assert.equal(lightStyle.background, 'rgb(238, 245, 255)', 'light theme flash must be cool white');
    await page.screenshot({ path: path.join(evidenceDir, 'titlebar-file-menu-light.png') });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });

    await page.hover('[data-titlebar-action="open-folder"]');
    await page.waitForTimeout(150);
    const hovered = await page.evaluate(() => {
      const item = document.querySelector('[data-titlebar-action="open-folder"]');
      const style = getComputedStyle(item);
      return { radius: style.borderTopLeftRadius, background: style.backgroundColor, color: style.color };
    });
    assert.equal(hovered.radius, '0px');
    assert.notEqual(hovered.background, 'rgba(0, 0, 0, 0)', 'the option flash must be visible on hover');
    await page.screenshot({ path: path.join(evidenceDir, 'titlebar-file-menu-hover.png') });

    // Escape closes and returns focus to the trigger.
    await page.keyboard.press('Escape');
    await page.waitForSelector('#titlebarFileMenu.hidden', { state: 'attached' });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'titlebarFileMenuBtn');

    // --- 3. 打开文件夹 binds a picked folder ---------------------------------
    pickedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-titlebar-pick-'));
    await application.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('workspace:pick');
      ipcMain.handle('workspace:pick', () => dir);
    }, pickedDir);
    await page.click('#titlebarFileMenuBtn');
    await page.click('[data-titlebar-action="open-folder"]');
    await page.waitForFunction(dir => state.currentSession?.workspace === dir, pickedDir, { timeout: 20000 });
    assert.equal(await page.evaluate(() => state.currentSession.workspace), pickedDir);
    assert.equal(await page.evaluate(() => document.querySelector('#titlebarFileMenu').classList.contains('hidden')), true);

    // --- 4. 新聊天 invokes the new-task flow ---------------------------------
    await page.evaluate(() => {
      const original = window.newSession;
      window.__newChatCalls = 0;
      window.newSession = (...args) => { window.__newChatCalls += 1; return original.apply(null, args); };
    });
    await page.click('#titlebarFileMenuBtn');
    await page.click('[data-titlebar-action="new-chat"]');
    await page.waitForFunction(() => window.__newChatCalls > 0, null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => document.querySelector('#titlebarFileMenu').classList.contains('hidden')), true);

    // --- 5. 关闭窗口 hides the window (tray behaviour) -----------------------
    await page.click('#titlebarFileMenuBtn');
    await page.click('[data-titlebar-action="close-window"]');
    await page.waitForTimeout(400);
    const hidden = await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('renderer/index.html'));
      return win.isVisible();
    });
    assert.equal(hidden, false, '关闭窗口 must hide the main window');
    await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('renderer/index.html'));
      win.show();
      win.focus();
    });

    // --- 6. keyboard accelerators -------------------------------------------
    await page.evaluate(() => { window.__newChatCalls = 0; });
    await page.keyboard.press('Control+N');
    await page.waitForFunction(() => window.__newChatCalls > 0, null, { timeout: 10000 });
    secondDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-titlebar-pick2-'));
    await application.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('workspace:pick');
      ipcMain.handle('workspace:pick', () => dir);
    }, secondDir);
    await page.keyboard.press('Control+O');
    await page.waitForFunction(dir => state.currentSession?.workspace === dir, secondDir, { timeout: 20000 });
    await page.keyboard.press('Control+W');
    await page.waitForTimeout(400);
    const hiddenByShortcut = await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('renderer/index.html'));
      return win.isVisible();
    });
    assert.equal(hiddenByShortcut, false, 'Ctrl+W must hide the main window');
    await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('renderer/index.html'));
      win.show();
      win.focus();
    });

    // --- 7. 退出 Yan Agent ends the process ---------------------------------
    await page.click('#titlebarFileMenuBtn');
    const closed = application.waitForEvent('close', { timeout: 20000 });
    await page.click('[data-titlebar-action="quit"]');
    await closed;

    console.log('titlebar-file-menu.e2e: OK');
  } finally {
    try { await application?.close(); } catch { /* already quit */ }
    fs.rmSync(userDataDir, { recursive: true, force: true });
    for (const dir of [pickedDir, secondDir]) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } }
  }
})().catch(error => {
  console.error('titlebar-file-menu.e2e: FAILED');
  console.error(error);
  process.exitCode = 1;
});
