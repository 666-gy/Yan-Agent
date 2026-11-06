'use strict';
// Regression: the built-in browser's 15 s watchdog must measure "the main
// document never committed", not "the load event finished". A page that is
// already readable while one request hangs used to be replaced by an
// ERR_TIMED_OUT error document. The start page also used to flash back during
// navigation because the fresh webview's about:blank lifecycle events arrive
// after the target navigation has started.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const shotDir = process.env.YAN_COMMIT_SCREENSHOT || '';
const step = message => console.log(`[commit-e2e] ${message}`);

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-browser-commit-'));
  const server = http.createServer((req, res) => {
    if (req.url === '/visible-hang') {
      // Headers and a readable body arrive but the response never ends, so the
      // document commits while its load event stays pending forever.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.write('<!doctype html><title>Visible</title><h1 id="ok">PAGE VISIBLE BEFORE LOAD</h1>');
      return;
    }
    if (req.url === '/slow-start') {
      setTimeout(() => res.end('<title>Slow</title><h1 id="ok">SLOW START</h1>'), 1500);
      return;
    }
    res.end('<title>ok</title><h1 id="ok">OK</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let app;
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
    // Dismiss the welcome overlay and open a session plus the right sidebar so
    // the browser panel is painted; otherwise the window stays on the welcome
    // screen and screenshots are not representative.
    await page.evaluate(async () => {
      window.YanStartupHello?.skip();
      const session = await api.createSession(true, '');
      session.messages = [{ role: 'user', content: '内置浏览器加载态验证' }];
      await api.saveSession(session);
      await loadSession(session.id);
      closeRightSidebar();
    });
    await page.evaluate(() => setRightSidebarOpen(true));
    await page.waitForFunction(() => !document.getElementById('app')?.classList.contains('rs-hidden'));
    step('app ready');

    // 1. Slow response: the start page is replaced by the loading layer as soon
    //    as the navigation is requested, and the late about:blank events must
    //    not bring the start page or an empty address bar back.
    await page.evaluate(url => openBrowserUrlInNewTab(url), `${base}/slow-start`);
    await page.waitForFunction(
      () => !!document.querySelector('.rs-browser-panel.active .browser-loading-state.active'),
      null,
      { timeout: 5000 }
    );
    const duringLoad = await page.evaluate(() => {
      const panel = document.querySelector('.rs-browser-panel.active');
      return {
        empty: !!panel.querySelector('.browser-empty-state.active'),
        loading: !!panel.querySelector('.browser-loading-state.active'),
        ariaBusy: panel.getAttribute('aria-busy'),
        address: panel.querySelector('[data-browser-role="url"]')?.title || '',
        host: panel.querySelector('[data-browser-role="loading-host"]')?.textContent || '',
        src: panel.querySelector('webview')?.getAttribute('src') || ''
      };
    });
    assert.equal(duringLoad.empty, false, 'the start page must not show while a document is loading');
    assert.equal(duringLoad.loading, true, 'a requested but uncommitted document must show the loading layer');
    assert.equal(duringLoad.ariaBusy, 'true');
    assert.match(duringLoad.address, /\/slow-start$/, 'the address bar must keep the requested URL');
    assert.match(duringLoad.src, /\/slow-start$/);
    assert.equal(duringLoad.host, `127.0.0.1:${server.address().port}`);
    if (shotDir) await page.screenshot({ path: path.join(shotDir, 'browser-loading-state.png') });
    step('loading layer visible, start page hidden, address kept');

    await page.waitForFunction(() => {
      const panel = document.querySelector('.rs-browser-panel.active');
      return !!panel
        && !panel.querySelector('.browser-loading-state.active')
        && (panel.querySelector('[data-browser-role="url"]')?.title || '').endsWith('/slow-start');
    }, null, { timeout: 10000 });
    const afterCommit = await page.evaluate(() => {
      const panel = document.querySelector('.rs-browser-panel.active');
      return {
        empty: !!panel.querySelector('.browser-empty-state.active'),
        loading: !!panel.querySelector('.browser-loading-state.active'),
        ariaBusy: panel.getAttribute('aria-busy'),
        errorVisible: !panel.querySelector('[data-browser-role="error-state"]').hidden
      };
    });
    assert.deepEqual(afterCommit, { empty: false, loading: false, ariaBusy: 'false', errorVisible: false });
    step('loading layer cleared on commit');

    // 2. Committed but never "loaded": the page stays readable and no error
    //    document may replace it after the 15 s budget elapses.
    await page.evaluate(url => openBrowserUrlInNewTab(url), `${base}/visible-hang`);
    await page.waitForTimeout(17000);
    // The guest's script channel can stall while a response is still open, so
    // readability is asserted from the committed document (URL + parsed title)
    // and confirmed visually by the screenshot below.
    const hang = await page.evaluate(() => {
      const panel = document.querySelector('.rs-browser-panel.active');
      const webview = panel.querySelector('webview');
      const error = panel.querySelector('[data-browser-role="error-state"]');
      return {
        errorVisible: !error.hidden,
        errorText: error.hidden ? '' : error.textContent.replace(/\s+/g, ' ').trim().slice(0, 160),
        empty: !!panel.querySelector('.browser-empty-state.active'),
        loading: !!panel.querySelector('.browser-loading-state.active'),
        address: panel.querySelector('[data-browser-role="url"]')?.title || '',
        url: String(webview.getURL?.() || ''),
        title: String(webview.getTitle?.() || '')
      };
    });
    assert.equal(hang.errorVisible, false, `a committed page must not be replaced by a timeout error: ${hang.errorText}`);
    assert.equal(hang.empty, false);
    assert.equal(hang.loading, false);
    assert.match(hang.url, /\/visible-hang$/);
    assert.equal(hang.title, 'Visible', 'the committed document must stay parsed and readable');
    assert.match(hang.address, /\/visible-hang$/);
    if (shotDir) await page.screenshot({ path: path.join(shotDir, 'browser-visible-hang-no-error.png') });
    step('committed page survived the 15 s budget with no error document');

    // 3. The Agent path (open_builtin_browser -> navigate(waitForLoad)) settles
    //    when the document commits instead of waiting for the load event.
    const agent = await page.evaluate(async url => {
      const tab = createRightSidebarTab('browser');
      activateRightSidebarTab(tab.id);
      const controller = browserTabControllers.get(tab.id);
      const started = performance.now();
      try {
        const result = await controller.navigate(url, { waitForLoad: true });
        return { ok: true, ms: Math.round(performance.now() - started), url: result?.url || '' };
      } catch (error) {
        return { ok: false, ms: Math.round(performance.now() - started), message: error?.message || String(error) };
      }
    }, `${base}/visible-hang`);
    assert.equal(agent.ok, true, `agent navigation must resolve once the document commits: ${agent.message}`);
    assert.match(agent.url, /\/visible-hang$/);
    assert.ok(agent.ms < 5000, `agent navigation should settle at commit, took ${agent.ms}ms`);
    step(`agent navigation settled in ${agent.ms}ms`);

    assert.deepEqual(pageErrors, [], `browser navigation must not throw: ${pageErrors.join(' | ')}`);
    console.log('PASS: loading layer replaces the start page, late about:blank events are ignored, and the 15 s budget only fails navigations that never commit');
  } finally {
    server.closeAllConnections();
    if (app) {
      await Promise.race([
        app.close().catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 10000))
      ]);
    }
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
})().then(
  () => process.exit(0),
  error => { console.error(error); process.exit(1); }
);
