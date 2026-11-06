'use strict';

// Right-panel launcher acceptance: the launcher now lives in the task bar,
// immediately right of the "more" button with a short divider between them.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-right-dock-e2e-'));
const evidenceDir = path.join(appRoot, '.yanagent', 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

(async () => {
  let application;
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__
      && !!state.currentSession
      && typeof syncRightDock === 'function'
      && !!document.querySelector('#rightDockLaunch'));
    await page.waitForFunction(() => document.querySelector('#yanStartupHello'));
    await page.evaluate(async () => {
      const layer = document.querySelector('#yanStartupHello');
      const enter = layer?.querySelector('.hello-enter');
      if (enter) { enter.disabled = false; enter.click(); }
      for (let index = 0; index < 60 && document.querySelector('#yanStartupHello'); index += 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      document.querySelector('#yanStartupHello')?.remove();
      const app = document.getElementById('app');
      if (app) app.inert = false;
    });

    const geometry = await page.evaluate(async () => {
      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      document.querySelector('#pageChat')?.classList.remove('empty');
      document.querySelector('#chatMainColumn')?.classList.remove('empty');
      document.querySelector('#app')?.classList.add('rs-hidden');
      if (!openRightSidebarTabs.length) createRightSidebarTab('review');
      activeRightSidebarTab = openRightSidebarTabs[0].id;
      syncRightDock();
      await settle();
      const rect = selector => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const r = element.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      };
      const launch = document.querySelector('#rightDockLaunch');
      return {
        legacyDock: !!document.querySelector('#rightDock'),
        parentClass: launch?.parentElement?.className || '',
        more: rect('#taskBarMoreBtn'),
        divider: rect('#taskBarSidePanelDivider'),
        launch: rect('#rightDockLaunch'),
        launchTitle: launch?.title || ''
      };
    });

    assert.equal(geometry.legacyDock, false, 'the floating right dock must be gone');
    assert.equal(geometry.parentClass, 'task-bar-side-panel-slot', 'the launcher must live in the task bar slot');
    assert.ok(geometry.more && geometry.divider && geometry.launch, 'more, divider and launcher must exist');
    assert.ok(geometry.more.right <= geometry.divider.left, 'the divider follows the more button');
    assert.ok(geometry.divider.right <= geometry.launch.left, 'the launcher sits right of the divider');
    assert.equal(geometry.launch.width, 30, 'launcher matches the task-bar icon button');
    assert.equal(geometry.launch.height, 30);
    assert.equal(geometry.divider.height, 16, 'divider stays short');

    await page.click('#rightDockLaunch');
    await page.waitForFunction(() => !document.querySelector('#app').classList.contains('rs-hidden'));
    const openState = await page.evaluate(() => {
      const launch = document.querySelector('#rightDockLaunch');
      const focus = document.querySelector('#rightSidebarFocusBtn');
      return {
        parentIsTabbar: launch.parentElement === focus.parentElement && launch.parentElement.classList.contains('rs-tabbar'),
        previousIsFocus: launch.previousElementSibling === focus,
        title: launch.title,
        expanded: launch.getAttribute('aria-expanded'),
        iconPaths: [...launch.querySelectorAll('path')].map(path => path.getAttribute('d')),
        taskSlotHidden: document.querySelector('#taskBarSidePanelSlot').classList.contains('hidden'),
        dividerHidden: document.querySelector('#taskBarSidePanelDivider').classList.contains('hidden')
      };
    });
    assert.equal(openState.parentIsTabbar, true, 'open panel button joins the tab bar');
    assert.equal(openState.previousIsFocus, true, 'panel button sits right of the fullscreen button');
    assert.equal(openState.title, '隐藏侧边面板');
    assert.equal(openState.expanded, 'true');
    assert.deepEqual(openState.iconPaths, ['M12 3v18'], 'open state uses the columns-2 divider path');
    assert.equal(openState.taskSlotHidden, true, 'task-bar slot collapses while the button is in the tab bar');
    assert.equal(openState.dividerHidden, true, 'task-bar divider hides with the moved button');
    await page.locator('#rightSidebarTabbar').screenshot({ path: path.join(evidenceDir, 'right-panel-open-button.png') });

    // Fullscreen: first click leaves fullscreen, the next click hides the panel.
    await page.click('#rightSidebarFocusBtn');
    await page.waitForFunction(() => document.querySelector('#app').classList.contains('browser-focus-mode'));
    assert.equal(await page.locator('#rightDockLaunch').getAttribute('title'), '退出全屏');
    await page.click('#rightDockLaunch');
    await page.waitForFunction(() => !document.querySelector('#app').classList.contains('browser-focus-mode'));
    assert.equal(await page.locator('#app').evaluate(node => node.classList.contains('rs-hidden')), false,
      'leaving fullscreen keeps the panel open');
    await page.click('#rightDockLaunch');
    await page.waitForFunction(() => document.querySelector('#app').classList.contains('rs-hidden'));
    assert.match(await page.locator('#rightDockLaunch').getAttribute('title'), /^打开侧边面板/);
    const closedState = await page.evaluate(() => ({
      inTaskSlot: document.querySelector('#rightDockLaunch').parentElement.id === 'taskBarSidePanelSlot',
      dividerHidden: document.querySelector('#taskBarSidePanelDivider').classList.contains('hidden')
    }));
    assert.equal(closedState.inTaskSlot, true, 'closing the panel returns the button to the task bar');
    assert.equal(closedState.dividerHidden, false, 'the task-bar divider returns with the button');

    const countState = await page.evaluate(async () => {
      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      openRightSidebarTabs.splice(0, openRightSidebarTabs.length);
      createRightSidebarTab('files');
      const agent = createRightSidebarTab('browser', { agentRunId: 'run-1', agentOwned: true });
      const agentController = getBrowserTabController(agent.id);
      if (agentController) agentController.currentUrl = 'https://example.com/agent';
      const web = createRightSidebarTab('browser');
      const webController = getBrowserTabController(web.id);
      if (webController) webController.currentUrl = 'https://www.bing.com';
      const blank = createRightSidebarTab('browser');
      document.querySelector('#app').classList.add('rs-hidden');
      renderRightSidebarTabs();
      syncRightDock();
      await settle();
      const launch = document.querySelector('#rightDockLaunch');
      return {
        text: launch.querySelector('text')?.textContent || '',
        title: launch.title,
        tabs: openRightSidebarTabs.length,
        blankHasUrl: !!getBrowserTabController(blank.id)?.currentUrl
      };
    });
    assert.equal(countState.text, '2', 'files + loaded page count; agent and blank tabs do not');
    assert.equal(countState.title, '打开侧边面板（2 个标签页）');
    assert.equal(countState.blankHasUrl, false);

    await page.locator('#taskBar').screenshot({ path: path.join(evidenceDir, 'right-dock-launcher.png') });
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ ok: true, geometry, countState }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
