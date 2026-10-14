'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-browser-errors-'));
  const server = http.createServer((req, res) => {
    if (req.url === '/hang') return;
    res.end('<title>Recovered</title><h1>Loaded</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const closed = http.createServer();
  await new Promise(resolve => closed.listen(0, '127.0.0.1', resolve));
  const refused = `http://127.0.0.1:${closed.address().port}/`;
  await new Promise(resolve => closed.close(resolve));
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(url => openBrowserUrlInNewTab(url), refused);
    const panel = page.locator('.rs-browser-panel.active');
    const error = panel.locator('[data-browser-role="error-state"]');
    await error.waitFor({ state: 'visible', timeout: 20000 });
    // Chromium's error-document DOM/finish events must not erase the overlay.
    await page.waitForTimeout(1200);
    assert.equal(await error.isVisible(), true);
    assert.equal(await error.locator('[data-browser-role="error-title"]').textContent(), '无法访问此站点');
    if (process.env.YAN_ERROR_SCREENSHOT) await error.screenshot({ path: process.env.YAN_ERROR_SCREENSHOT });
    await panel.locator('[data-browser-action="reload"]').click();
    await error.waitFor({ state: 'visible' });
    assert.match(await error.textContent(), /拒绝建立连接/);
    await page.evaluate(url => openBrowserUrlInNewTab(url), `${base}/hang`);
    await page.waitForFunction(() => {
      const panel = document.querySelector('.rs-browser-panel.active [data-browser-role="error-state"]');
      return panel && !panel.hidden && panel.textContent.includes('ERR_TIMED_OUT');
    }, null, { timeout: 22000 });
    assert.match(await error.textContent(), /响应时间过长/);
    await page.evaluate(url => openBrowserUrlInNewTab(url), `${base}/ok`);
    await page.waitForTimeout(1200);
    assert.equal(await error.isVisible(), false);
    console.log('PASS: refused connection persists, toolbar retry works, hanging request times out, success has no error overlay');
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
