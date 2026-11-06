'use strict';
// Detached built-in browser windows: drag a browser tab out of the sidebar,
// release outside the tab bar, and the page continues in its own window while
// the sidebar keeps a handoff panel. Restore must bring the page back.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, '.yanagent', 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
const step = message => console.log(`[browser-popout] ${message}`);

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-browser-popout-'));
  let fixtureRequests = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/count') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(String(fixtureRequests));
      return;
    }
    if (req.url === '/fixture') fixtureRequests += 1;
    if (req.url === '/second') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>Second Tab</title><h1>SECOND PAGE</h1>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Popout Fixture</title><h1 id="popout-ok">POPOUT PAGE</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let app;
  const findBrowserWindowPage = async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const found = app.windows().find(candidate => !candidate.isClosed() && candidate.url().includes('browser-window/index.html'));
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('detached browser window page not found');
  };
  try {
    app = await _electron.launch({
      executablePath: require('electron'),
      args: [root],
      cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile }
    });
    const page = await app.firstWindow();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(async () => {
      window.YanStartupHello?.skip();
      const session = await api.createSession(true, '');
      session.messages = [{ role: 'user', content: '独立浏览器窗口验证' }];
      await api.saveSession(session);
      await loadSession(session.id);
      closeRightSidebar();
    });
    await page.evaluate(() => setRightSidebarOpen(true));
    await page.evaluate(() => window.YanStartupHello?.skip?.());
    await page.locator('#yanStartupHello').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    await page.evaluate(() => { document.querySelector('#app').inert = false; });
    await page.waitForFunction(() => !document.getElementById('app')?.classList.contains('rs-hidden'));
    step('app ready');

    await page.evaluate(url => openBrowserUrlInNewTab(url), `${base}/fixture`);
    await page.waitForFunction(() => {
      const panel = document.querySelector('.rs-browser-panel.active');
      return !!panel && (panel.querySelector('[data-browser-role="url"]')?.title || '').endsWith('/fixture');
    }, null, { timeout: 15000 });
    const tabId = await page.evaluate(() => {
      const unit = document.querySelector('.rs-tab-unit[data-rs-tab-type="browser"]');
      return unit?.dataset.rsTabUnit || '';
    });
    assert.ok(tabId, 'a browser tab must exist before dragging');

    // Drag the tab out of the tab bar and drop it over the page body.
    const tab = page.locator(`[data-rs-tab-unit="${tabId}"] [data-rs-tab]`);
    const tabBox = await tab.boundingBox();
    assert.ok(tabBox, 'tab must be visible');
    await page.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
    await page.mouse.down();
    assert.equal(await page.evaluate(() => !!document.getElementById('browserTabDragOverlay')), true, 'drag overlay must start on pointerdown');
    await page.mouse.move(tabBox.x + tabBox.width / 2 - 30, tabBox.y + 50, { steps: 6 });
    await page.waitForSelector('.browser-tab-drag-ghost', { timeout: 3000 });
    const ghost = await page.evaluate(() => ({
      title: document.querySelector('.browser-tab-drag-title')?.textContent || '',
      url: document.querySelector('.browser-tab-drag-url')?.textContent || '',
      hint: document.querySelector('.browser-tab-drag-drop')?.textContent?.trim() || ''
    }));
    assert.match(ghost.title, /Popout Fixture/i);
    assert.match(ghost.hint, /松开，然后在新窗口中打开/);
    await page.screenshot({ path: path.join(evidenceDir, 'browser-popout-drag.png') });
    step('drag ghost visible');

    await page.mouse.move(520, 460, { steps: 8 });
    await page.mouse.up();
    const popout = await findBrowserWindowPage();
    await popout.waitForLoadState('domcontentloaded');
    await popout.waitForFunction(() => !!document.querySelector('#bwTabs .bw-tab'), null, { timeout: 15000 });
    await popout.waitForFunction(() => (document.querySelector('#bwUrl')?.title || '').includes('fixture'), null, { timeout: 15000 });
    step('detached window opened');

    const mainState = await page.evaluate(() => {
      const panel = document.querySelector('.rs-browser-panel.active');
      const unit = document.querySelector('.rs-tab-unit[data-rs-tab-type="browser"]');
      return {
        tabCount: document.querySelectorAll('.rs-tab-unit[data-rs-tab-type="browser"]').length,
        poppedClass: unit?.classList.contains('is-browser-popped') === true,
        panelPopped: panel?.classList.contains('browser-popped-out') === true,
        placeholderVisible: !panel?.querySelector('[data-browser-role="popout-state"]')?.classList.contains('hidden'),
        hint: panel?.querySelector('.browser-popout-hint')?.textContent?.trim() || '',
        title: panel?.querySelector('[data-browser-role="popout-title"]')?.textContent?.trim() || '',
        actions: [...panel.querySelectorAll('.browser-popout-actions button')].map(button => button.textContent.trim()),
        webviewVisible: (() => {
          const webview = panel?.querySelector('webview');
          return !!webview && getComputedStyle(webview).visibility !== 'hidden';
        })()
      };
    });
    assert.deepEqual(mainState.actions, ['恢复到标签页', '显示窗口']);
    assert.equal(mainState.poppedClass, true);
    assert.equal(mainState.panelPopped, true);
    assert.equal(mainState.placeholderVisible, true);
    assert.equal(mainState.hint, '此标签页已在单独窗口中打开');
    assert.equal(mainState.webviewVisible, false, 'the handoff panel must cover the sidebar guest');
    assert.equal(mainState.tabCount, 1, 'the detached tab must stay visible in the strip');
    step('sidebar handoff panel shown');

    const popoutState = await popout.evaluate(() => {
      const style = selector => getComputedStyle(document.querySelector(selector));
      const pin = document.querySelector('#bwPin');
      const restore = document.querySelector('#bwRestore');
      const tabs = document.querySelector('.bw-tabstrip-shell');
      const controls = document.querySelector('.bw-window-controls');
      return {
        titlebarButtons: [...document.querySelectorAll('.bw-titlebar-left button')].map(button => button.getAttribute('aria-label')),
        tabCount: document.querySelectorAll('#bwTabs .bw-tab').length,
        hasNewTab: !!document.querySelector('#bwNewTab'),
        hasAgentTab: !!document.querySelector('[data-agent-chat-tab]'),
        toolbarButtons: document.querySelectorAll('.bw-nav button, .bw-address button, .bw-zoom-pill button').length,
        zoomPillButtons: document.querySelectorAll('.bw-zoom-pill button').length,
        zoomPillText: (document.querySelector('.bw-zoom-pill')?.textContent || '').replace(/\s+/g, ' ').trim(),
        hasAnnotation: [...document.querySelectorAll('.bw-toolbar button')].some(button => button.textContent.includes('批注')),
        hasMore: !!document.querySelector('[data-browser-action="settings"]'),
        zoomText: document.querySelector('#bwZoomValue')?.textContent || '',
        theme: document.documentElement.getAttribute('data-theme'),
        urlValue: document.querySelector('#bwUrl')?.title || '',
        pinRadius: style('#bwPin').borderRadius,
        pinBorder: style('#bwPin').borderTopWidth,
        restoreRadius: style('#bwRestore').borderRadius,
        restoreBorder: style('#bwRestore').borderTopWidth,
        tabRadius: style('.bw-tab').borderRadius,
        tabContentCenter: style('.bw-tab-button').justifyContent,
        newTabRadius: style('#bwNewTab').borderRadius,
        newTabBorder: style('#bwNewTab').borderTopWidth,
        tabsAfterRestore: tabs.getBoundingClientRect().left >= restore.getBoundingClientRect().right,
        tabsLeftOfControls: tabs.getBoundingClientRect().left < controls.getBoundingClientRect().left
      };
    });
    assert.deepEqual(popoutState.titlebarButtons, ['置顶窗口', '还原到主窗口']);
    assert.equal(popoutState.tabCount, 1);
    assert.equal(popoutState.hasNewTab, true);
    assert.equal(popoutState.hasAgentTab, false);
    assert.equal(popoutState.toolbarButtons, 7, 'back/forward/reload/go/zoom - value +');
    assert.equal(popoutState.zoomPillButtons, 3);
    assert.match(popoutState.zoomPillText, /−\s*100%\s*\+/);
    assert.equal(popoutState.hasAnnotation, false);
    assert.equal(popoutState.hasMore, false);
    assert.equal(popoutState.zoomText, '100%');
    assert.match(popoutState.urlValue, /fixture/);
    assert.equal(popoutState.pinRadius, '50%');
    assert.equal(popoutState.pinBorder, '0px');
    assert.equal(popoutState.restoreRadius, '50%');
    assert.equal(popoutState.restoreBorder, '0px');
    assert.equal(popoutState.tabRadius, '999px');
    assert.equal(popoutState.tabContentCenter, 'flex-start');
    assert.equal(popoutState.newTabRadius, '50%');
    assert.equal(popoutState.newTabBorder, '0px');
    assert.equal(popoutState.tabsAfterRestore, true, 'tabs must sit left of the window controls');
    assert.equal(popoutState.tabsLeftOfControls, true);
    step('detached chrome verified');

    await popout.click('#bwPin');
    await popout.waitForFunction(() => document.querySelector('#bwPin')?.getAttribute('aria-pressed') === 'true');
    const pinned = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(item => !item.isDestroyed() && item.webContents.getURL().includes('browser-window'));
      return win ? win.isAlwaysOnTop() : null;
    });
    assert.equal(pinned, true, 'pin must set always-on-top');
    await popout.waitForTimeout(300);
    const pinState = await popout.evaluate(() => ({
      fill: getComputedStyle(document.querySelector('.bw-pin-fill')).display,
      stroke: getComputedStyle(document.querySelector('.bw-pin-stroke')).display,
      background: getComputedStyle(document.querySelector('#bwPin')).backgroundColor
    }));
    assert.notEqual(pinState.fill, 'none', 'pinned state must use the filled icon');
    assert.equal(pinState.stroke, 'none');
    assert.equal(pinState.background, 'rgba(0, 0, 0, 0)');
    await popout.click('[data-bw-zoom="in"]');
    await popout.waitForFunction(() => document.querySelector('#bwZoomValue')?.textContent === '110%');
    await popout.click('[data-bw-zoom="reset"]');
    await popout.waitForFunction(() => document.querySelector('#bwZoomValue')?.textContent === '100%');
    await popout.screenshot({ path: path.join(evidenceDir, 'browser-popout-window.png') });
    await page.screenshot({ path: path.join(evidenceDir, 'browser-popout-main.png') });
    step('pin and zoom pill verified');

    // A tab created inside the detached window must stay local until restore.
    const mainBeforeNewTab = await page.evaluate(() => ({
      title: document.querySelector('[data-browser-role="popout-title"]')?.textContent?.trim() || '',
      url: document.querySelector('.rs-browser-panel.active [data-browser-role="url"]')?.title || '',
      label: document.querySelector('.rs-tab-unit[data-rs-tab-type="browser"] .rs-work-tab-label')?.textContent?.trim() || ''
    }));
    await popout.click('#bwNewTab');
    await popout.waitForFunction(() => document.querySelectorAll('#bwTabs .bw-tab').length === 2);
    const startPageState = await popout.evaluate(() => ({
      visible: !document.querySelector('#bwStart')?.classList.contains('hidden'),
      hasHeading: !!document.querySelector('#bwStart h1'),
      hasInput: !!document.querySelector('#bwStart input'),
      hint: document.querySelector('.bw-start-hint')?.textContent?.trim() || '',
      iconBorder: getComputedStyle(document.querySelector('.bw-start-mark')).borderTopWidth,
      iconBackground: getComputedStyle(document.querySelector('.bw-start-mark')).backgroundColor
    }));
    assert.equal(startPageState.visible, true);
    assert.equal(startPageState.hasHeading, false);
    assert.equal(startPageState.hasInput, false);
    assert.equal(startPageState.hint, '在浏览器中输入网址以继续');
    assert.equal(startPageState.iconBorder, '0px');
    assert.equal(startPageState.iconBackground, 'rgba(0, 0, 0, 0)');
    await popout.screenshot({ path: path.join(evidenceDir, 'browser-popout-start.png') });
    await popout.fill('#bwUrl', `${base}/second`);
    await popout.press('#bwUrl', 'Enter');
    await popout.waitForFunction(() => (document.querySelector('#bwUrl')?.title || '').includes('/second'), null, { timeout: 15000 });
    await page.waitForTimeout(700);
    const mainAfterNewTab = await page.evaluate(() => ({
      title: document.querySelector('[data-browser-role="popout-title"]')?.textContent?.trim() || '',
      url: document.querySelector('.rs-browser-panel.active [data-browser-role="url"]')?.title || '',
      label: document.querySelector('.rs-tab-unit[data-rs-tab-type="browser"] .rs-work-tab-label')?.textContent?.trim() || ''
    }));
    assert.deepEqual(mainAfterNewTab, mainBeforeNewTab, 'a new detached tab must not rewrite the Agent-side tab');
    await popout.screenshot({ path: path.join(evidenceDir, 'browser-popout-new-tab.png') });
    step('new detached tab stayed local');

    // An empty new-tab page is not a browser tab and cannot be detached.
    const blankDetach = await page.evaluate(async () => {
      const blank = createRightSidebarTab('browser');
      activateRightSidebarTab(blank.id);
      const result = await popOutBrowserTab(blank, null);
      const blankId = blank.id;
      closeRightSidebarTool(blankId);
      const popped = openRightSidebarTabs.find(tab => tab.type === 'browser' && tab.poppedOut);
      if (popped) activateRightSidebarTab(popped.id);
      return result;
    });
    assert.equal(blankDetach, false, 'blank new-tab pages must not detach');
    step('blank tab blocked');

    // Restore from the sidebar placeholder.
    const guest = app.windows().find(candidate => !candidate.isClosed() && candidate.url().includes('/fixture'));
    await guest?.waitForLoadState('load').catch(() => {});
    const beforeRestore = Number(await (await fetch(`${base}/count`)).text());
    await page.click('.browser-popout-actions [data-browser-action="popout-restore"]');
    await page.waitForFunction(() => {
      const panel = document.querySelector('.rs-browser-panel.active');
      return !!panel?.querySelector('webview')
        && (panel.querySelector('[data-browser-role="url"]')?.title || '').includes('fixture');
    }, null, { timeout: 15000 });
    await popout.waitForEvent('close', { timeout: 10000 }).catch(() => {});
    const restored = await page.evaluate(() => ({
      popped: document.querySelectorAll('.rs-tab-unit.is-browser-popped').length,
      placeholder: !!document.querySelector('[data-browser-role="popout-state"]:not(.hidden)'),
      url: document.querySelector('.rs-browser-panel.active [data-browser-role="url"]')?.title || ''
    }));
    assert.equal(restored.popped, 0);
    assert.equal(restored.placeholder, false);
    assert.match(restored.url, /fixture/);
    await page.waitForFunction(() => document.querySelectorAll('.rs-tab-unit[data-rs-tab-type="browser"]').length === 2, null, { timeout: 10000 });
    await page.waitForFunction(() => openRightSidebarTabs.some(tab => tab.type === 'browser' && (getBrowserTabController(tab.id)?.currentUrl || '').includes('/second')), null, { timeout: 10000 });
    const restoredTabs = await page.evaluate(() => openRightSidebarTabs
      .filter(tab => tab.type === 'browser')
      .map(tab => ({ url: getBrowserTabController(tab.id)?.currentUrl || '', label: tab.label })));
    assert.equal(restoredTabs.length, 2, 'restore must bring every detached tab back');
    assert.ok(restoredTabs.some(tab => tab.url.includes('/fixture')), 'the original tab must stay on its page');
    assert.ok(restoredTabs.some(tab => tab.url.includes('/second')), 'the detached new tab must be transferred');
    await page.evaluate(() => {
      const extra = openRightSidebarTabs.find(tab => tab.type === 'browser' && (getBrowserTabController(tab.id)?.currentUrl || '').includes('/second'));
      if (extra) closeRightSidebarTool(extra.id);
      const fixture = openRightSidebarTabs.find(tab => tab.type === 'browser');
      if (fixture) activateRightSidebarTab(fixture.id);
    });
    await page.waitForFunction(() => document.querySelectorAll('.rs-tab-unit[data-rs-tab-type="browser"]').length === 1, null, { timeout: 10000 });
    await page.waitForTimeout(1200);
    const afterRestore = Number(await (await fetch(`${base}/count`)).text());
    assert.equal(afterRestore, beforeRestore, 'restoring the same URL must not reload the site');
    step('restored into the sidebar without refetching');

    // Closing a detached window must close its sidebar tab.
    await page.evaluate(() => popOutBrowserTab(
      openRightSidebarTabs.find(tab => tab.type === 'browser'),
      null
    ));
    const second = await findBrowserWindowPage();
    await second.waitForLoadState('domcontentloaded');
    await second.waitForFunction(() => !!document.querySelector('#bwTabs .bw-tab'), null, { timeout: 15000 });

    // The detached window's own restore control must hand the tab back too.
    await second.click('#bwRestore');
    await second.waitForEvent('close', { timeout: 10000 }).catch(() => {});
    await page.waitForFunction(() => {
      const panel = document.querySelector('.rs-browser-panel.active');
      return !!panel?.querySelector('webview') && (panel.querySelector('[data-browser-role="url"]')?.title || '').includes('fixture');
    }, null, { timeout: 15000 });
    step('restored from the detached window');

    // Closing a detached window must close its sidebar tab.
    await page.evaluate(() => popOutBrowserTab(
      openRightSidebarTabs.find(tab => tab.type === 'browser'),
      null
    ));
    const third = await findBrowserWindowPage();
    await third.waitForLoadState('domcontentloaded');
    await third.waitForFunction(() => !!document.querySelector('#bwTabs .bw-tab'), null, { timeout: 15000 });
    await third.click('#bwClose');
    await page.waitForFunction(() => document.querySelectorAll('.rs-tab-unit[data-rs-tab-type="browser"]').length === 0, null, { timeout: 10000 });
    step('window close removed the sidebar tab');

    assert.deepEqual(pageErrors, [], `renderer errors: ${pageErrors.join(' | ')}`);
    console.log('[browser-popout] PASS');
  } finally {
    await app?.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('[browser-popout] FAIL', error);
  process.exitCode = 1;
});
