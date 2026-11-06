'use strict';

// In-app navigation history (视图 → 返回 / 前进) acceptance:
//   1. the menu exposes 返回 / 前进 with Ctrl+[ / Ctrl+] and disables them at
//      the ends of the stack;
//   2. every page-level switch is recorded: main pages, the settings workspace
//      and its active tab;
//   3. Ctrl+[ from settings returns to the page it was opened from (e.g. the
//      plugins page) without touching the rail, and Ctrl+] walks forward again.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-titlebar-history-'));
const evidenceDir = path.join(appRoot, '.yanagent', 'evidence');

const appState = () => ({
  page: currentMainPage,
  settingsOpen: !!document.querySelector('#settingsOverlay') && !document.querySelector('#settingsOverlay').classList.contains('hidden'),
  settingsTab: document.querySelector('#settingsOverlay')?.dataset.activeTab || '',
  historyIndex: appHistory.index,
  historyLength: appHistory.entries.length
});

const menuState = () => {
  const back = document.querySelector('#titlebarViewMenu [data-titlebar-action="history-back"]');
  const forward = document.querySelector('#titlebarViewMenu [data-titlebar-action="history-forward"]');
  return { backDisabled: back.disabled, forwardDisabled: forward.disabled };
};

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
    await page.waitForFunction(() => typeof switchSidebarNav === 'function' && typeof appHistory === 'object', null, { timeout: 60000 });
    await page.waitForSelector('#titlebarViewMenuBtn');
    await page.locator('#yanStartupHello').waitFor({ state: 'detached', timeout: 20000 }).catch(async () => {
      await page.evaluate(() => {
        document.querySelector('#yanStartupHello')?.remove();
        const app = document.querySelector('#app');
        if (app) app.inert = false;
      });
    });
    await page.waitForTimeout(300);

    // --- 1. menu wiring ------------------------------------------------------
    await page.click('#titlebarViewMenuBtn');
    await page.waitForSelector('#titlebarViewMenu:not(.hidden)');
    const items = await page.evaluate(() => {
      const el = document.querySelector('#titlebarViewMenu');
      return [...el.querySelectorAll('.titlebar-menu-item')].map(item => ({
        action: item.dataset.titlebarAction,
        label: item.querySelector('.titlebar-menu-label').textContent.trim(),
        shortcut: item.querySelector('.titlebar-menu-shortcut')?.textContent.trim() || ''
      }));
    });
    const back = items.find(item => item.action === 'history-back');
    const forward = items.find(item => item.action === 'history-forward');
    assert.equal(back.label, '返回');
    assert.equal(back.shortcut, 'Ctrl+[');
    assert.equal(forward.label, '前进');
    assert.equal(forward.shortcut, 'Ctrl+]');
    // Menu order: … 新建标签页, 返回, 前进, 放大 …
    const order = items.map(item => item.action);
    assert.ok(order.indexOf('history-back') > order.indexOf('new-tab'));
    assert.ok(order.indexOf('history-forward') < order.indexOf('zoom-in'));
    assert.deepEqual(await page.evaluate(menuState), { backDisabled: true, forwardDisabled: true });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#titlebarViewMenu.hidden', { state: 'attached' });

    // --- 2. record a page chain ---------------------------------------------
    const initial = await page.evaluate(appState);
    assert.equal(initial.page, 'chat');

    await page.evaluate(() => switchSidebarNav('plugins'));
    await page.waitForTimeout(350);
    const plugins = await page.evaluate(appState);
    assert.equal(plugins.page, 'packages', 'the rail must open the plugins workspace');

    await page.evaluate(() => openSettings('general'));
    await page.waitForTimeout(350);
    const settings = await page.evaluate(appState);
    assert.equal(settings.settingsOpen, true);
    assert.equal(settings.settingsTab, 'general');
    assert.ok(settings.historyIndex > plugins.historyIndex, 'opening settings must add a history entry');

    // --- 3. back from settings returns to plugins ---------------------------
    await page.keyboard.press('Control+[');
    await page.waitForTimeout(400);
    const afterBack = await page.evaluate(appState);
    assert.equal(afterBack.settingsOpen, false, 'Ctrl+[ must leave settings');
    assert.equal(afterBack.page, 'packages', 'Ctrl+[ must restore the plugins page it came from');
    assert.equal(await page.evaluate(() => document.querySelector('#pagePlugins').classList.contains('hidden')), false);

    await page.click('#titlebarViewMenuBtn');
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(menuState), { backDisabled: false, forwardDisabled: false }, 'back and forward must both be available mid-stack');
    await page.screenshot({ path: path.join(evidenceDir, 'titlebar-view-history.png') });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#titlebarViewMenu.hidden', { state: 'attached' });

    // --- 4. forward returns to settings ------------------------------------
    await page.keyboard.press('Control+]');
    await page.waitForTimeout(400);
    const afterForward = await page.evaluate(appState);
    assert.equal(afterForward.settingsOpen, true, 'Ctrl+] must walk forward into settings');
    assert.equal(afterForward.settingsTab, 'general');

    // --- 5. a second back walks to the previous page, then the origin ------
    await page.keyboard.press('Control+[');
    await page.waitForTimeout(400);
    assert.equal((await page.evaluate(appState)).page, 'packages');
    await page.keyboard.press('Control+[');
    await page.waitForTimeout(400);
    const origin = await page.evaluate(appState);
    assert.equal(origin.page, 'chat', 'the second back must reach the original page');
    assert.equal(origin.settingsOpen, false);
    await page.click('#titlebarViewMenuBtn');
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(menuState), { backDisabled: true, forwardDisabled: false }, 'back must disable at the stack start');
    await page.keyboard.press('Escape');


    console.log('titlebar-history.e2e: OK');
  } finally {
    try { await application?.close(); } catch { /* already closed */ }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('titlebar-history.e2e: FAILED');
  console.error(error);
  process.exitCode = 1;
});
