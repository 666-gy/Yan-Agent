'use strict';
// Regression: closing a built-in browser tab before its page finished loading
// left the 15 s load-timeout timer alive. It then called webview.stop() on a
// detached <webview>, throwing
// "The WebView must be attached to the DOM and the dom-ready event emitted
// before this method can be called." as an uncaught renderer error.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-browser-close-loading-'));
  // A request that never responds keeps the tab in its loading state.
  const server = http.createServer((req, res) => {
    if (req.url === '/hang') return;
    res.end('<title>ok</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const hangUrl = `http://127.0.0.1:${server.address().port}/hang`;
  let app;
  try {
    app = await _electron.launch({
      executablePath: require('electron'),
      args: [root],
      cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile }
    });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    const outcome = await page.evaluate(async url => {
      const tab = createRightSidebarTab('browser');
      activateRightSidebarTab(tab.id);
      const controller = browserTabControllers.get(tab.id);
      const pending = controller.navigate(url, { waitForLoad: true })
        .then(() => ({ ok: true }), error => ({ ok: false, code: error.code, message: error.message }));
      await new Promise(resolve => setTimeout(resolve, 400));
      closeRightSidebarTool(tab.id);
      const settled = await Promise.race([
        pending,
        new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 4000))
      ]);
      return { settled, remainingTabs: browserTabControllers.size, controllerDestroyed: controller.destroyed };
    }, hangUrl);

    assert.equal(outcome.settled.timeout, undefined, 'closing the tab must settle the pending navigation');
    assert.equal(outcome.settled.ok, false, 'closing the tab must reject the pending navigation');
    assert.equal(outcome.settled.code, 'BROWSER_TAB_CLOSED');
    assert.equal(outcome.controllerDestroyed, true);
    assert.equal(outcome.remainingTabs, 0);

    // The original crash fired from the 15 s timer after the tab was gone.
    await page.waitForTimeout(16500);
    assert.deepEqual(pageErrors, [], `closing a loading browser tab must not throw: ${pageErrors.join(' | ')}`);
    const state = await page.evaluate(() => ({
      panels: document.querySelectorAll('[data-browser-tab-id]').length,
      errorOverlays: [...document.querySelectorAll('[data-browser-role="error-state"]')].filter(el => !el.hidden).length
    }));
    assert.deepEqual(state, { panels: 0, errorOverlays: 0 });
    console.log('PASS: closing a browser tab mid-load cancels the pending navigation and leaves no uncaught webview error');
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
